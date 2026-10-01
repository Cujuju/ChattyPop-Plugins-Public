// Installs models through Ollama's own download API (/api/pull, streamed progress), one download per model.
import { errorMessage } from '@plugin-sdk/shared';
import type { PluginFetch } from '@plugin-sdk/core';
import type { OllamaPull } from '../shared/types';

/** Coalesces Ollama's many progress lines a second into one event. */
const PROGRESS_EVENT_MS = 250;
/** Ollama's last progress line. */
const PULL_SUCCESS = 'success';

/** One line of /api/pull's stream: a step, a layer's progress (digest, total, completed) or an error. */
interface PullLine {
  status?: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
}

interface Job {
  pull: OllamaPull;
  /** Each layer's progress by digest: a model downloads several. */
  layers: Map<string, { completed: number; total: number }>;
  abort: AbortController;
}

/** Splits a streamed body into JSON lines. */
async function* jsonLines(body: ReadableStream<Uint8Array>): AsyncGenerator<PullLine> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  for (;;) {
    const { done, value } = await reader.read();
    buffered += decoder.decode(value, { stream: !done });
    const lines = buffered.split('\n');
    buffered = done ? '' : (lines.pop() ?? '');
    for (const line of lines) if (line.trim()) yield JSON.parse(line) as PullLine;
    if (done) return;
  }
}

/** Downloads in progress and failed, for Settings → AI; a download stops when the plugin turns off. */
export class ModelPulls {
  private readonly jobs = new Map<string, Job>();
  private readonly failed = new Map<string, OllamaPull>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    /** ctx.net.fetch: reaches the owner's address only. */
    private readonly net: PluginFetch,
    /** The server's address, read when a download starts. */
    private readonly baseUrl: () => string,
    /** The list changed (throttled while downloading). */
    private readonly onChange: (pulls: OllamaPull[]) => void,
    private readonly onInstalled: (model: string) => void,
    private readonly lifetime: AbortSignal,
  ) {}

  list(): OllamaPull[] {
    return [...[...this.jobs.values()].map((j) => ({ ...j.pull })), ...this.failed.values()];
  }

  pull(name: string): void {
    const model = name.trim();
    if (!model) throw new Error('Type a model name, such as qwen3-vl:8b-instruct.');
    if (this.jobs.has(model)) return;
    this.failed.delete(model);
    const job: Job = { pull: { model, state: 'downloading', step: 'starting', completed: 0, total: 0, error: null }, layers: new Map(), abort: new AbortController() };
    this.jobs.set(model, job);
    this.changed(true);
    void this.run(job)
      .then(() => this.onInstalled(model))
      .catch((err: unknown) => {
        if (job.abort.signal.aborted || this.lifetime.aborted) return;
        this.failed.set(model, { ...job.pull, state: 'failed', error: errorMessage(err) });
      })
      .finally(() => {
        this.jobs.delete(model);
        this.changed(true);
      });
  }

  /** Stops a download, or clears a failed one. */
  cancel(model: string): void {
    this.jobs.get(model)?.abort.abort();
    if (this.failed.delete(model)) this.changed(true);
  }

  dispose(): void {
    clearTimeout(this.timer);
    for (const job of this.jobs.values()) job.abort.abort();
  }

  private async run(job: Job): Promise<void> {
    const res = await this.net(new URL('/api/pull', this.baseUrl()).href, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: job.pull.model, stream: true }),
      signal: AbortSignal.any([job.abort.signal, this.lifetime]),
    });
    if (!res.ok || !res.body) {
      const text = await res.text();
      const error = (() => {
        try {
          return (JSON.parse(text) as PullLine).error;
        } catch {
          return undefined;
        }
      })();
      throw new Error(error ?? `Ollama ${res.status}: ${text}`);
    }
    for await (const line of jsonLines(res.body)) {
      if (line.error) throw new Error(line.error);
      if (line.status === PULL_SUCCESS) return;
      if (line.status) job.pull.step = line.status;
      if (line.digest && line.total) job.layers.set(line.digest, { completed: line.completed ?? 0, total: line.total });
      job.pull.completed = [...job.layers.values()].reduce((n, l) => n + l.completed, 0);
      job.pull.total = [...job.layers.values()].reduce((n, l) => n + l.total, 0);
      this.changed(false);
    }
    throw new Error('Ollama stopped before the download finished.');
  }

  private changed(now: boolean): void {
    if (this.lifetime.aborted) return; // turned off: no one listens
    if (now) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.onChange(this.list());
      return;
    }
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      this.onChange(this.list());
    }, PROGRESS_EVENT_MS);
  }
}
