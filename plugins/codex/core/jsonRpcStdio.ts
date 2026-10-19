// JSON-RPC 2.0 over a child process's stdio, as `codex app-server` speaks it.
import { createInterface } from 'node:readline';
import { spawnCli, type CliProcess, type Launch } from '@plugin-sdk/core';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
type Handler = (params: unknown) => void;
type RequestHandler = (params: unknown) => unknown | Promise<unknown>;

const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

/** Newline-delimited JSON-RPC 2.0 over a child process's stdio (the codex app-server transport). */
export class JsonRpcStdio {
  private readonly proc: CliProcess;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<string, Set<Handler>>();
  private readonly requestHandlers = new Map<string, RequestHandler>();
  private nextId = 1;
  /** Why the process ended; null while it runs. */
  private ended: Error | null = null;
  /** Resolves with why the process ended (exit or spawn error), so a caller waiting on a notification can stop. */
  readonly closed: Promise<Error>;

  constructor(launch: Launch, extraArgs: string[], env?: NodeJS.ProcessEnv) {
    this.proc = spawnCli(launch.command, [...launch.args, ...extraArgs], { env });
    this.proc.stderr.resume();
    createInterface({ input: this.proc.stdout }).on('line', (line) => this.onLine(line));
    let close!: (err: Error) => void;
    this.closed = new Promise((r) => (close = r));
    const end = (err: Error): void => {
      this.ended ??= err;
      this.failAll(this.ended);
      close(this.ended);
    };
    this.proc.on('exit', (code) => end(new Error(`codex app-server exited (${code})`)));
    this.proc.on('error', end);
    this.proc.stdin.on('error', () => undefined); // a write after exit (EPIPE); 'exit' already failed the requests
  }

  request<T>(method: string, params: unknown): Promise<T> {
    if (this.ended) return Promise.reject(this.ended);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
  }

  on(method: string, handler: Handler): () => void {
    const set = this.listeners.get(method) ?? new Set<Handler>();
    set.add(handler);
    this.listeners.set(method, set);
    return () => set.delete(handler);
  }

  handleRequest(method: string, handler: RequestHandler): () => void {
    if (this.requestHandlers.has(method)) throw new Error(`Already handling ${method}`);
    this.requestHandlers.set(method, handler);
    return () => {
      if (this.requestHandlers.get(method) === handler) this.requestHandlers.delete(method);
    };
  }

  dispose(): void {
    this.proc.kill();
  }

  private write(msg: object): void {
    this.proc.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  private onLine(line: string): void {
    if (!line.trim()) return;
    let msg: { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { message: string } };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      console.warn('codex app-server: skipped a non-JSON line');
      return;
    }
    if (msg.method !== undefined && msg.id !== undefined) {
      void this.answerRequest(msg.id, msg.method, msg.params);
      return;
    }
    if (msg.method !== undefined) {
      for (const h of this.listeners.get(msg.method) ?? []) h(msg.params);
      return;
    }
    const p = typeof msg.id === 'number' ? this.pending.get(msg.id) : undefined;
    if (!p) return;
    this.pending.delete(msg.id as number);
    if (msg.error) p.reject(new Error(msg.error.message));
    else p.resolve(msg.result);
  }

  private async answerRequest(id: number | string, method: string, params: unknown): Promise<void> {
    const handler = this.requestHandlers.get(method);
    if (!handler) {
      this.write({ jsonrpc: '2.0', id, error: { code: METHOD_NOT_FOUND, message: 'ChattyPop does not handle server requests' } });
      return;
    }
    try {
      const result = await handler(params);
      this.write({ jsonrpc: '2.0', id, result: result ?? null });
    } catch (error) {
      this.write({ jsonrpc: '2.0', id, error: { code: INTERNAL_ERROR, message: error instanceof Error ? error.message : String(error) } });
    }
  }

  private failAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}
