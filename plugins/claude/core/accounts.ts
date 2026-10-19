import { mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolveCliAsync, spawnCli, type AccountLinkIo, type ProviderAccount } from '@plugin-sdk/core';
import { CLAUDE_CLI } from './claude';
import { accountEnv } from './accountEnv';

const AUTH_COMMAND = 'auth';
const SUCCESS_EXIT = 0;
const NOT_SIGNED_IN_EXIT = 1;
const AUTH_URL = /https?:\/\/[^\s]+/;
const NO_URL = null;

async function launch(account: ProviderAccount, args: string[]) {
  if (account.auth !== 'signIn' || !account.dir) throw new Error('Expected a linked Claude sign-in account.');
  const cli = await resolveCliAsync(CLAUDE_CLI.bin, CLAUDE_CLI.npm);
  if (!cli) throw new Error('Claude Code not found on PATH.');
  return spawnCli(cli.command, [...cli.args, AUTH_COMMAND, ...args], { env: accountEnv(account) });
}

export async function signedIn(account: ProviderAccount): Promise<{ signedIn: boolean; who: string | null }> {
  const child = await launch(account, ['status', '--json']);
  let output = '';
  let error = '';
  child.stdout.on('data', (chunk) => { output += String(chunk); });
  child.stderr.on('data', (chunk) => { error += String(chunk); });
  const code = await new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  if (code !== SUCCESS_EXIT && code !== NOT_SIGNED_IN_EXIT) throw new Error(error.trim() || `Claude auth status exited (${code}).`);
  const status: unknown = JSON.parse(output);
  if (!status || typeof status !== 'object' || !('loggedIn' in status) || typeof status.loggedIn !== 'boolean') throw new Error('Claude auth status returned an invalid report.');
  const who = 'email' in status && typeof status.email === 'string' ? status.email : null;
  return { signedIn: code === SUCCESS_EXIT && status.loggedIn, who: status.loggedIn ? who : null };
}

/** The CLI opens its own browser; its printed URL is published only as a fallback. */
export async function linkAccount(account: ProviderAccount, io: AccountLinkIo): Promise<void> {
  if (!account.dir) throw new Error('Linked Claude account has no config folder.');
  io.signal.throwIfAborted();
  await mkdir(account.dir, { recursive: true });
  io.signal.throwIfAborted();
  const child = await launch(account, ['login']);
  let lastLine = '';
  let shownUrl: string | null = NO_URL;
  const readers = [child.stdout, child.stderr].map((input) => createInterface({ input }));
  for (const reader of readers) reader.on('line', (line) => {
    if (line.trim()) lastLine = line.trim();
    const url = line.match(AUTH_URL)?.[0];
    if (url && url !== shownUrl) { shownUrl = url; io.open(url, true); }
  });
  const exit = new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  const cancel = (): void => { child.kill(); };
  io.signal.addEventListener('abort', cancel, { once: true });
  if (io.signal.aborted) cancel();
  child.stdin.on('error', () => undefined);
  const ended = exit.then(() => null, () => null);
  const relay = async (): Promise<void> => {
    for (;;) {
      const code = await Promise.race([io.code(), ended]);
      if (code === null || io.signal.aborted) return;
      child.stdin.write(`${code}\n`);
    }
  };
  void relay().catch(() => cancel());
  try {
    const code = await exit;
    io.signal.throwIfAborted();
    if (code !== SUCCESS_EXIT) throw new Error(lastLine || `Claude auth login exited (${code}).`);
    if (!(await signedIn(account)).signedIn) throw new Error('Claude Code did not keep the sign-in.');
  } finally {
    io.signal.removeEventListener('abort', cancel);
    readers.forEach((reader) => reader.close());
  }
}

/** A failed logout does not prevent the host from deleting this account's isolated folder. */
export async function signOut(account: ProviderAccount): Promise<void> {
  try {
    const child = await launch(account, ['logout']);
    child.stdout.resume(); child.stderr.resume();
    await new Promise<void>((resolve, reject) => { child.on('error', reject); child.on('close', () => resolve()); });
  } catch (err) { console.warn('Claude account logout failed:', err); }
}
