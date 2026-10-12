import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountLinkIo, ProviderAccount } from '@plugin-sdk/core';

interface Child extends EventEmitter { stdout: PassThrough; stderr: PassThrough; stdin: PassThrough; kill: ReturnType<typeof vi.fn>; }
const children: { child: Child; args: string[]; env: NodeJS.ProcessEnv }[] = [];
let statusCode = 0;
let loggedIn = true;
let failure = false;
const makeChild = (): Child => {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn() });
  child.kill.mockImplementation(() => child.emit('close', null));
  return child;
};
vi.mock('@core/ai/resolveCli', () => ({ resolveCli: () => ({ command: 'test-claude', args: [] }) }));
vi.mock('node:child_process', () => ({ spawn: (_command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
  if (failure) throw new Error('test spawn failure');
  const child = makeChild(); children.push({ child, args, env: options.env });
  if (args.includes('status')) queueMicrotask(() => { child.stdout.end(JSON.stringify({ loggedIn, email: 'test@example.test' })); child.emit('close', statusCode); });
  if (args.includes('logout')) queueMicrotask(() => child.emit('close', statusCode));
  return child;
} }));
const { accountEnv } = await import('../core/accountEnv');
const { signedIn, linkAccount, signOut } = await import('../core/accounts');
const dirs: string[] = [];
const account = (): ProviderAccount => {
  const dir = mkdtempSync(join(tmpdir(), 'claude-account-test-')); dirs.push(dir);
  return { id: 'claude@work', auth: 'signIn', apiKey: () => null, dir };
};
const tick = async (): Promise<void> => { await new Promise<void>((resolve) => setImmediate(resolve)); };
afterEach(() => { children.length = 0; statusCode = 0; loggedIn = true; failure = false; vi.unstubAllEnvs(); dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })); });

describe('Claude account environment and authentication', () => {
  it('preserves machine credentials, isolates linked sign-ins and requires API-account keys', () => {
    for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']) vi.stubEnv(name, 'test-key');
    const linked = account(); const env = accountEnv(linked);
    expect(env.CLAUDE_CONFIG_DIR).toBe(linked.dir);
    for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']) expect(env[name]).toBeUndefined();
    const cli = { ...linked, id: 'claude', auth: 'cli' as const, dir: null };
    expect(accountEnv(cli)).toEqual({ ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'chattypop/0.1' });
    expect(accountEnv({ ...linked, auth: 'apiKey', apiKey: () => 'test-key' }).ANTHROPIC_API_KEY).toBe('test-key');
    expect(() => accountEnv({ ...linked, auth: 'apiKey' })).toThrow('Add an API key');
  });
  it.each([0, 1])('parses auth status exit %s without reading sign-in files', async (code) => {
    statusCode = code; loggedIn = code === 0; const linked = account();
    expect(await signedIn(linked)).toEqual({ signedIn: loggedIn, who: loggedIn ? 'test@example.test' : null });
    expect(children[0]?.args).toEqual(['auth', 'status', '--json']);
    expect(children[0]?.env.CLAUDE_CONFIG_DIR).toBe(linked.dir);
  });
  it('reports unexpected status failures', async () => {
    statusCode = 2; await expect(signedIn(account())).rejects.toThrow('auth status exited');
  });
  it('publishes a fallback URL, relays a code and confirms the sign-in after exit', async () => {
    let code!: (value: string) => void;
    const open = vi.fn(); const controller = new AbortController();
    const io: AccountLinkIo = { open, code: () => new Promise((resolve) => { code = resolve; }), signal: controller.signal };
    const pending = linkAccount(account(), io);
    await vi.waitFor(() => expect(children).toHaveLength(1));
    const child = children[0]!.child; let pasted = ''; child.stdin.on('data', (chunk) => { pasted += String(chunk); });
    child.stdout.write('If the browser did not open, visit: https://example.test/login\n');
    expect(open).toHaveBeenCalledWith('https://example.test/login', true);
    code('test-code'); await tick(); expect(pasted).toBe('test-code\n');
    child.emit('close', 0); await pending;
    expect(children[1]?.args).toEqual(['auth', 'status', '--json']);
  });
  it('kills the login child on cancellation', async () => {
    const controller = new AbortController();
    const pending = linkAccount(account(), { open: () => undefined, code: () => new Promise(() => undefined), signal: controller.signal });
    await vi.waitFor(() => expect(children).toHaveLength(1));
    controller.abort(new Error('test cancel'));
    await expect(pending).rejects.toThrow('test cancel'); expect(children[0]?.child.kill).toHaveBeenCalledOnce();
  });
  it('reports the CLI last line and tolerates a failing sign-out', async () => {
    const linked = account();
    const pending = linkAccount(linked, { open: () => undefined, code: () => new Promise(() => undefined), signal: new AbortController().signal });
    await vi.waitFor(() => expect(children).toHaveLength(1));
    children[0]!.child.stderr.write('test login failure\n'); children[0]!.child.emit('close', 1);
    await expect(pending).rejects.toThrow('test login failure');
    failure = true; const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try { await expect(signOut(linked)).resolves.toBeUndefined(); expect(warn).toHaveBeenCalled(); } finally { warn.mockRestore(); }
  });
});
