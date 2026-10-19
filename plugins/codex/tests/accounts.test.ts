import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderAccount } from '@plugin-sdk/core';

interface Started { env?: NodeJS.ProcessEnv; args: string[]; calls: { method: string; params: unknown }[]; handlers: Map<string, Set<(p: unknown) => void>>; dispose: ReturnType<typeof vi.fn<() => void>>; }
const started: Started[] = [];
let read: unknown = { account: { type: 'chatgpt', email: 'test@example.test', planType: 'plus' }, requiresOpenaiAuth: true };
const LOGIN_ID = 'test-login-id';
vi.mock('@core/ai/asyncCli', () => ({ resolveCliAsync: async () => ({ command: 'test-codex', args: [] }) }));
vi.mock('../core/jsonRpcStdio', () => ({ JsonRpcStdio: class {
  private readonly state: Started;
  readonly closed = new Promise<Error>(() => undefined);
  constructor(_launch: unknown, args: string[], env?: NodeJS.ProcessEnv) {
    this.state = { env, args, calls: [], handlers: new Map(), dispose: vi.fn() }; started.push(this.state);
  }
  request = async (method: string, params: unknown) => {
    this.state.calls.push({ method, params });
    if (method === 'account/read') return read;
    if (method === 'account/login/start') return { type: 'chatgpt', loginId: LOGIN_ID, authUrl: 'https://example.test/login' };
    return {};
  };
  notify = () => undefined;
  on = (method: string, handler: (p: unknown) => void) => {
    const handlers = this.state.handlers.get(method) ?? new Set(); handlers.add(handler); this.state.handlers.set(method, handlers);
    return () => handlers.delete(handler);
  };
  dispose = () => this.state.dispose();
} }));
const { CodexConnection } = await import('../core/connection');
const { signedIn, linkAccount, signOut } = await import('../core/accounts');
const dirs: string[] = [];
const connections: InstanceType<typeof CodexConnection>[] = [];
const make = () => {
  const dir = mkdtempSync(join(tmpdir(), 'codex-account-test-')); dirs.push(dir);
  const account: ProviderAccount = { id: 'codex@work', auth: 'signIn', apiKey: () => null, dir };
  const connection = new CodexConnection({ bin: 'test', npm: 'test', name: 'Test CLI' }, {}, account); connections.push(connection);
  return { account, connection };
};
const tick = async (): Promise<void> => { await new Promise<void>((resolve) => setImmediate(resolve)); };
const notify = (state: Started, event: unknown): void => state.handlers.get('account/login/completed')?.forEach((fn) => fn(event));
afterEach(() => { connections.splice(0).forEach((connection) => connection.dispose()); dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })); started.length = 0; read = { account: { type: 'chatgpt', email: 'test@example.test', planType: 'plus' }, requiresOpenaiAuth: true }; });

describe('Codex linked accounts', () => {
  it('isolates each connection and CODEX_HOME without provider overrides', async () => {
    const first = make(); const second = make();
    const c = await first.connection.connect(); await second.connection.connect();
    expect(started).toHaveLength(2); expect(started.map((s) => s.env?.CODEX_HOME)).toEqual([first.account.dir, second.account.dir]);
    expect(started.map((s) => s.args)).toEqual([['app-server'], ['app-server']]);
    expect(() => second.connection.assertCurrent(c)).toThrow('another account');
  });
  it('reads sign-in identity, treating API and missing accounts as signed out', async () => {
    const { connection } = make();
    expect(await signedIn(connection)).toEqual({ signedIn: true, who: 'test@example.test' });
    for (const account of [null, { type: 'apiKey' }]) {
      read = { account, requiresOpenaiAuth: true };
      expect(await signedIn(connection)).toEqual({ signedIn: false, who: null });
    }
  });
  it('opens the login page and accepts only the matching completion', async () => {
    const { connection } = make(); const open = vi.fn(); let done = false;
    const pending = linkAccount(connection, { open, code: vi.fn(), signal: new AbortController().signal }).then(() => { done = true; });
    await vi.waitFor(() => expect(open).toHaveBeenCalled()); expect(open).toHaveBeenCalledWith('https://example.test/login');
    notify(started[0]!, { loginId: 'wrong-login', success: true }); await tick(); expect(done).toBe(false);
    notify(started[0]!, { loginId: LOGIN_ID, success: true }); await pending; expect(done).toBe(true);
    expect(started[0]?.calls).toContainEqual({ method: 'account/login/start', params: { type: 'chatgpt' } });
  });
  it('cancels by login id and reports failed completion', async () => {
    const first = make(); const controller = new AbortController();
    const opened = vi.fn();
    const pending = linkAccount(first.connection, { open: opened, code: vi.fn(), signal: controller.signal });
    await vi.waitFor(() => expect(opened).toHaveBeenCalled()); controller.abort(new Error('test cancel')); await expect(pending).rejects.toThrow('test cancel');
    expect(started[0]?.calls).toContainEqual({ method: 'account/login/cancel', params: { loginId: LOGIN_ID } });
    const second = make(); const failed = linkAccount(second.connection, { open: vi.fn(), code: vi.fn(), signal: new AbortController().signal });
    await vi.waitFor(() => expect(started[1]?.calls.some((call) => call.method === 'account/login/start')).toBe(true)); notify(started[1]!, { loginId: LOGIN_ID, success: false, error: 'test login failure' });
    await expect(failed).rejects.toThrow('test login failure');
  });
  it('logs out with null params, then disposes its own connection', async () => {
    const { connection } = make(); await signOut(connection);
    expect(started[0]?.calls).toContainEqual({ method: 'account/logout', params: null }); expect(started[0]?.dispose).toHaveBeenCalledOnce();
  });
});
