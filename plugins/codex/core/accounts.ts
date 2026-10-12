import type { AccountLinkIo } from '@plugin-sdk/core';
import type { CodexConnection } from './connection';

interface AccountRead { account: { type: 'chatgpt'; email: string | null; planType: string } | { type: 'apiKey' } | null; requiresOpenaiAuth: boolean; }
interface Login { type: 'chatgpt'; loginId: string; authUrl: string; }
interface Completed { loginId?: string | null; success: boolean; error?: string | null; }
const LOGIN_COMPLETED = 'account/login/completed';

export async function signedIn(connection: CodexConnection): Promise<{ signedIn: boolean; who: string | null }> {
  const current = await connection.connect();
  const { account } = await connection.request<AccountRead>(current, 'account/read', { refreshToken: false });
  return { signedIn: account?.type === 'chatgpt', who: account?.type === 'chatgpt' ? account.email : null };
}

/** Subscribes before starting login so a completion arriving before its response is retained. */
export async function linkAccount(connection: CodexConnection, io: AccountLinkIo): Promise<void> {
  io.signal.throwIfAborted();
  const current = await connection.connect();
  io.signal.throwIfAborted();
  let loginId: string | null = null;
  const early: Completed[] = [];
  let complete!: (event: Completed) => void;
  const done = new Promise<Completed>((resolve) => { complete = resolve; });
  const off = current.rpc.on(LOGIN_COMPLETED, (value) => {
    const event = value as Completed;
    if (!loginId) early.push(event);
    else if (event.loginId === loginId) complete(event);
  });
  let aborted!: () => void;
  const cancelled = new Promise<Completed>((resolve) => {
    aborted = () => resolve({ success: false });
    io.signal.addEventListener('abort', aborted, { once: true });
  });
  try {
    const login = await connection.request<Login>(current, 'account/login/start', { type: 'chatgpt' });
    if (login.type !== 'chatgpt' || !login.loginId || !login.authUrl) throw new Error('Codex returned an invalid sign-in session.');
    loginId = login.loginId;
    io.signal.throwIfAborted();
    io.open(login.authUrl);
    const received = early.find((event) => event.loginId === loginId);
    if (received) complete(received);
    const event = await Promise.race([done, cancelled, connection.closed(current).then((err) => Promise.reject(err))]);
    io.signal.throwIfAborted();
    if (!event.success) throw new Error(event.error || 'Codex sign-in failed.');
  } finally {
    off();
    io.signal.removeEventListener('abort', aborted);
    if (io.signal.aborted && loginId) await connection.request(current, 'account/login/cancel', { loginId }).catch(() => undefined);
  }
}

/** Logout failures do not retain a removed account's folder or connection. */
export async function signOut(connection: CodexConnection): Promise<void> {
  try {
    const current = await connection.connect();
    await connection.request(current, 'account/logout', null);
  } catch (err) { console.warn('Codex account logout failed:', err); }
  finally { connection.dispose(); }
}
