// Windows.Media.Ocr adapter using a persistent Windows PowerShell worker.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { IS_WINDOWS } from '@plugin-sdk/core';
import { MS_PER_MIN, MS_PER_S } from '@plugin-sdk/shared';
import type { EngineStatus } from '../shared/types';
import { OCR_SCRIPT } from './ocrScript';

/** Windows PowerShell 5.1 by its fixed path: the only PowerShell that loads WinRT types, and not found through PATH alone. */
const WINDOWS_POWERSHELL = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
/** Worker startup timeout, including WinRT loading. */
const START_TIMEOUT_MS = 30 * MS_PER_S;
/** Per-image OCR timeout prevents stalled reads from blocking the queue. */
const READ_TIMEOUT_MS = MS_PER_MIN;
/** An idle worker holds a PowerShell process and WinRT's OCR engine; stopped after this, started again on the next read. */
const WORKER_IDLE_MS = 5 * MS_PER_MIN;
const SCRIPT_FILE = 'windows-ocr.ps1';
const NOT_WINDOWS = 'Windows OCR runs only on Windows.';

interface Reply {
  id?: number;
  ready?: boolean;
  language?: string;
  text?: string;
  error?: string;
}

/** The worker, one image at a time; started on first use and again after it fails or times out. */
export class WindowsOcr {
  private child: ChildProcessWithoutNullStreams | null = null;
  /** The worker spawned last, ready or still starting: what stop() kills. */
  private spawned: ChildProcessWithoutNullStreams | null = null;
  private disposed = false;
  private starting: Promise<ChildProcessWithoutNullStreams> | null = null;
  private language: string | null = null;
  private lastError: string | null = null;
  private nextId = 0;
  private idle: NodeJS.Timeout | null = null;
  private readonly waiting = new Map<number, (r: Reply) => void>();

  constructor(
    /** The plugin's data folder: the script is written there. */
    private readonly dataDir: string,
  ) {}

  /** Whether OCR runs: starts the worker to find out (its language, or why it can't). */
  async status(): Promise<EngineStatus> {
    if (!IS_WINDOWS) return { ready: false, detail: NOT_WINDOWS };
    try {
      await this.worker();
      this.idleLater();
      return { ready: true, detail: `Windows OCR (${this.language})` };
    } catch {
      return { ready: false, detail: this.lastError ?? 'Windows OCR did not start.' };
    }
  }

  /** The text of the image at `path`, lines joined by newlines; '' when it has none. */
  async read(path: string, signal: AbortSignal): Promise<string> {
    if (!IS_WINDOWS) throw new Error(NOT_WINDOWS);
    const child = await this.worker();
    signal.throwIfAborted();
    const id = ++this.nextId;
    const reply = new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => fail(new Error('Windows OCR took too long.')), READ_TIMEOUT_MS);
      const aborted = (): void => fail(signal.reason as Error);
      const settled = (): void => {
        clearTimeout(timer);
        signal.removeEventListener('abort', aborted);
        this.waiting.delete(id);
      };
      const fail = (err: Error): void => {
        settled();
        this.stop(); // a hung or aborted read leaves the worker mid-image
        reject(err);
      };
      signal.addEventListener('abort', aborted, { once: true });
      this.waiting.set(id, (r) => {
        settled();
        resolve(r);
      });
    });
    child.stdin.write(`${JSON.stringify({ id, path })}\n`);
    const r = await reply.finally(() => this.idleLater());
    if (r.error) throw new Error(r.error);
    return r.text ?? '';
  }

  /** Stops the worker for good (the plugin turned off), one still starting included. */
  dispose(): void {
    this.disposed = true;
    this.stop();
  }

  /** Stops the worker once nothing has used it for WORKER_IDLE_MS. */
  private idleLater(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      if (!this.waiting.size) this.stop();
    }, WORKER_IDLE_MS).unref();
  }

  private stop(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    this.spawned?.kill();
    this.spawned = null;
    this.child = null;
    this.starting = null;
    for (const done of this.waiting.values()) done({ error: 'Windows OCR stopped.' });
    this.waiting.clear();
  }

  private worker(): Promise<ChildProcessWithoutNullStreams> {
    if (this.child) return Promise.resolve(this.child);
    this.starting ??= this.start().catch((err: unknown) => {
      this.starting = null;
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    });
    return this.starting;
  }

  private start(): Promise<ChildProcessWithoutNullStreams> {
    if (this.disposed) return Promise.reject(new Error('Windows OCR stopped.'));
    mkdirSync(this.dataDir, { recursive: true });
    const script = join(this.dataDir, SCRIPT_FILE);
    writeFileSync(script, OCR_SCRIPT);
    const child = spawn(WINDOWS_POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true });
    this.spawned = child;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Windows OCR did not start in time.'));
      }, START_TIMEOUT_MS);
      let ready = false;
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('exit', () => {
        if (this.child === child) this.stop();
        clearTimeout(timer);
        if (!ready) reject(new Error(this.lastError ?? 'Windows OCR exited while starting.'));
      });
      createInterface({ input: child.stdout }).on('line', (line) => {
        let r: Reply;
        try {
          r = JSON.parse(line) as Reply;
        } catch {
          return; // not the worker's JSON (a stray PowerShell message)
        }
        if (!ready) {
          clearTimeout(timer);
          if (!r.ready) {
            this.lastError = r.error ?? 'Windows OCR did not start.';
            return reject(new Error(this.lastError));
          }
          // Stopped while starting: it was killed, and is no one's worker.
          if (this.spawned !== child) return reject(new Error('Windows OCR stopped.'));
          ready = true;
          this.language = r.language ?? null;
          this.lastError = null;
          this.child = child;
          return resolve(child);
        }
        const done = r.id !== undefined ? this.waiting.get(r.id) : undefined;
        if (!done || r.id === undefined) return;
        this.waiting.delete(r.id);
        done(r);
      });
    });
  }
}
