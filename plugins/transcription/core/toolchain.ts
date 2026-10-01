// Settings → Transcription: finds, downloads and installs ffmpeg, whisper.cpp and whisper models under the app profile.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { InstallItem, InstallState, ToolBuild, TranscriptionStatus } from '../shared/types';
import { errorMessage } from '@plugin-sdk/shared';
import { exeName, findExecutable, IS_WINDOWS, type PluginFetch } from '@plugin-sdk/core';
import { MODELS, TOOLS, modelEntry, type Download, type ModelEntry, type ToolEntry, type ToolId } from './catalog';
import { downloadVerified, extractZip } from './download';

/** Coalesces download progress into status events. */
const PROGRESS_EVENT_MS = 250;
const MODELS_DIR = 'models';
/** Written beside an installed program: which build it is. */
const BUILD_FILE = 'build.txt';

interface Job {
  state: Extract<InstallState, 'downloading' | 'installing'>;
  progress: number;
  abort: AbortController;
}

export type ToolPaths = Record<ToolId, string>;

/** First file named `name` (case-insensitive) under `dir`, depth first; archive layouts differ between builds. */
function findFile(dir: string, name: string): string | null {
  if (!existsSync(dir)) return null;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return p;
    if (e.isDirectory()) {
      const found = findFile(p, name);
      if (found) return found;
    }
  }
  return null;
}

export class Toolchain {
  private readonly jobs = new Map<string, Job>();
  private readonly errors = new Map<string, string>();
  private timer: NodeJS.Timeout | undefined;
  /** nvidia-smi ships with the NVIDIA driver, so its presence means CUDA can run. */
  readonly gpu = findExecutable('nvidia-smi') !== undefined;

  constructor(
    private readonly dir: string,
    /** Status changed (throttled while downloading). */
    private readonly onChange: () => void,
    /** The context's net.fetch: the descriptor's download hosts only. */
    private readonly fetchImpl: PluginFetch,
    /** Installs still running or cleaning up, by id, across activations: one starts only after the last one ended. */
    private readonly installs: Map<string, Promise<void>> = new Map(),
  ) {}

  /** ChattyPop's own copy first, then PATH. */
  private locate(t: ToolEntry): { path: string; source: 'app' | 'path'; build: ToolBuild | null } | null {
    const own = findFile(join(this.dir, t.id), exeName(t.exe));
    if (own) return { path: own, source: 'app', build: this.installedBuild(t) };
    const onPath = findExecutable(t.exe);
    return onPath ? { path: onPath, source: 'path', build: null } : null;
  }

  private installedBuild(t: ToolEntry): ToolBuild {
    const file = join(this.dir, t.id, BUILD_FILE);
    return existsSync(file) && readFileSync(file, 'utf8').trim() === 'gpu' ? 'gpu' : 'cpu';
  }

  /** Builds on offer for a program, the recommended one first; none off Windows. */
  private builds(t: ToolEntry): { build: ToolBuild; download: Download }[] {
    if (!IS_WINDOWS) return [];
    const cpu = { build: 'cpu' as const, download: t.cpu };
    return t.gpu ? (this.gpu ? [{ build: 'gpu', download: t.gpu }, cpu] : [cpu, { build: 'gpu', download: t.gpu }]) : [cpu];
  }

  /** Both programs, or null when one is missing. */
  tools(): ToolPaths | null {
    const found = TOOLS.map((t) => [t.id, this.locate(t)?.path] as const);
    return found.every(([, p]) => p) ? (Object.fromEntries(found) as ToolPaths) : null;
  }

  modelPath(id: string | null): string | null {
    const m = modelEntry(id);
    const p = m ? join(this.dir, MODELS_DIR, m.id) : null;
    return p && existsSync(p) ? p : null;
  }

  /** Programs and model paths when everything `model` needs is installed. */
  ready(model: string | null): { tools: ToolPaths; model: string } | null {
    const tools = this.tools();
    const path = this.modelPath(model);
    return tools && path ? { tools, model: path } : null;
  }

  status(model: string | null): TranscriptionStatus {
    const item = (base: Pick<InstallItem, 'id' | 'label' | 'description' | 'bytes' | 'builds' | 'build' | 'source' | 'score'>, installed: boolean): InstallItem => {
      const job = this.jobs.get(base.id);
      const error = this.errors.get(base.id) ?? null;
      const state: InstallState = job ? job.state : installed ? 'ready' : error ? 'failed' : 'missing';
      // A failed switch of build leaves the old build installed; its error still shows.
      return { ...base, state, progress: job ? job.progress : null, error: job ? null : error };
    };
    const tools = TOOLS.map((t) => {
      const found = this.locate(t);
      const builds = this.builds(t).map((b) => ({ build: b.build, bytes: b.download.bytes }));
      const base = { id: t.id, label: t.label, description: t.description, bytes: builds[0]?.bytes ?? 0, builds, build: found?.build ?? null, source: found?.source ?? null, score: null };
      return item(base, found !== null);
    });
    const models = MODELS.map((m) => item({ id: m.id, label: m.label, description: m.description, bytes: m.bytes, builds: [], build: null, source: null, score: m.score }, this.modelPath(m.id) !== null));
    return { canInstallTools: IS_WINDOWS, gpu: this.gpu, tools, models, ready: this.ready(model) !== null };
  }

  /** Starts a download in the background (a program's `build`, null = recommended); progress and outcome arrive through `onChange`. */
  install(id: string, build: ToolBuild | null): void {
    if (this.jobs.has(id)) return;
    const model = modelEntry(id);
    const tool = TOOLS.find((t) => t.id === id);
    if (!model && !tool) throw new Error(`Unknown download: ${id}`);
    let variant: { build: ToolBuild; download: Download } | undefined;
    if (tool) {
      const builds = this.builds(tool);
      if (!builds.length) throw new Error(`Install ${tool.label} with your package manager; ChattyPop finds it on PATH.`);
      variant = build ? builds.find((b) => b.build === build) : builds[0];
      if (!variant) throw new Error(`${tool.label} has no ${build} build.`);
    }
    const job: Job = { state: 'downloading', progress: 0, abort: new AbortController() };
    this.jobs.set(id, job);
    this.errors.delete(id);
    this.changed(true);
    // A turned-off activation's install of the same item may still be cleaning up its staging folder: wait for it.
    const run = (this.installs.get(id) ?? Promise.resolve()).then(() => {
      job.abort.signal.throwIfAborted();
      return model ? this.installModel(model, job) : this.installTool(tool!, variant!, job);
    });
    const ended = run.catch(() => undefined);
    this.installs.set(id, ended);
    void ended.then(() => {
      if (this.installs.get(id) === ended) this.installs.delete(id);
    });
    void run
      .catch((err: unknown) => {
        if (!job.abort.signal.aborted) this.errors.set(id, errorMessage(err));
      })
      .finally(() => {
        this.jobs.delete(id);
        this.changed(true);
      });
  }

  /** Stops every download (the plugin is turned off). */
  dispose(): void {
    for (const job of this.jobs.values()) job.abort.abort();
  }

  cancel(id: string): void {
    this.jobs.get(id)?.abort.abort();
  }

  async deleteModel(id: string): Promise<void> {
    const m = modelEntry(id);
    if (!m) throw new Error(`Unknown model: ${id}`);
    if (this.jobs.has(id)) throw new Error('Cancel the download first.');
    await rm(join(this.dir, MODELS_DIR, m.id), { force: true });
    this.errors.delete(id);
    this.changed(true);
  }

  private installModel(m: ModelEntry, job: Job): Promise<void> {
    return downloadVerified(m, join(this.dir, MODELS_DIR, m.id), (f) => this.progress(job, f), job.abort.signal, this.fetchImpl);
  }

  /** Download, unpack to a staging folder, check the program is there, then swap it in (replacing another build). */
  private async installTool(t: ToolEntry, variant: { build: ToolBuild; download: Download }, job: Job): Promise<void> {
    // Named per build, so a resumed partial download is never the other build's.
    const zip = join(this.dir, `${t.id}-${variant.build}.zip`);
    const staging = join(this.dir, `${t.id}.staging`);
    const target = join(this.dir, t.id);
    const old = join(this.dir, `${t.id}.old`);
    try {
      await downloadVerified(variant.download, zip, (f) => this.progress(job, f), job.abort.signal, this.fetchImpl);
      job.state = 'installing';
      this.changed(true);
      await rm(staging, { recursive: true, force: true });
      await mkdir(staging, { recursive: true });
      await extractZip(zip, staging, job.abort.signal);
      if (!findFile(staging, exeName(t.exe))) throw new Error(`${exeName(t.exe)} was not in the download.`);
      await writeFile(join(staging, BUILD_FILE), variant.build);
      // Cancelled (or the plugin turned off) while unpacking: nothing is installed.
      job.abort.signal.throwIfAborted();
      // Renames, not deletes, so a program in use fails the swap cleanly instead of leaving half a folder.
      await rm(old, { recursive: true, force: true });
      const replacing = existsSync(target);
      if (replacing) await rename(target, old);
      try {
        await rename(staging, target);
      } catch (err) {
        if (replacing) await rename(old, target);
        throw err;
      }
      await rm(old, { recursive: true, force: true });
    } finally {
      await rm(zip, { force: true });
      await rm(staging, { recursive: true, force: true });
    }
  }

  private progress(job: Job, fraction: number): void {
    job.progress = fraction;
    this.changed(false);
  }

  private changed(now: boolean): void {
    if (now) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.onChange();
      return;
    }
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      this.onChange();
    }, PROGRESS_EVENT_MS);
  }
}
