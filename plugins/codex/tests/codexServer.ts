import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, vi } from 'vitest';
import { tempDir } from '@chattypop/host-testing';
import type { CompletionTool } from '@plugin-sdk/core';
import type { CodexProvider } from '../core/codex';

/** Scripted app-server exercises the real connection, stdio transport, and concurrent thread routing without inference. */
const SERVER = String.raw`
const rl = require('readline').createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const notify = (method, params) => send({ jsonrpc: '2.0', method, params });
const requests = [];
const pending = new Map();
const delayed = new Map();
let nextThread = 0;
let nextCall = 0;
rl.on('line', (line) => {
  const m = JSON.parse(line);
  if (pending.has(m.id)) {
    reply(pending.get(m.id), m);
    pending.delete(m.id);
    return;
  }
  if (!m.method.startsWith('test/')) requests.push(m);
  if (m.method === 'initialize') reply(m.id, {});
  else if (m.method === 'thread/start') {
    const id = 'thread-' + ++nextThread;
    if (m.params.baseInstructions === 'delayed') delayed.set(id, true);
    reply(m.id, { thread: { id }, model: 'model', modelProvider: 'chattypop' });
  }
  else if (m.method === 'turn/start') {
    const threadId = m.params.threadId;
    const turn = { id: 'turn-' + threadId, items: [], status: 'inProgress', error: null };
    if (delayed.has(threadId)) delayed.set(threadId, { id: m.id, turn });
    else {
      notify('turn/started', { threadId, turn });
      reply(m.id, { turn });
    }
  }
  else if (m.method === 'turn/interrupt') {
    reply(m.id, {});
    notify('turn/completed', { threadId: m.params.threadId, turn: { id: m.params.turnId, status: 'interrupted', error: null } });
  }
  else if (m.method === 'model/list') reply(m.id, { data: [{ model: 'model', displayName: 'Model', hidden: false,
    isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'high' }], inputModalities: ['text', 'image'] }], nextCursor: null });
  else if (m.method === 'test/requests') reply(m.id, requests);
  else if (m.method === 'test/notify') { notify(m.params.method, m.params.params); reply(m.id, {}); }
  else if (m.method === 'test/call') {
    const id = 'call-' + ++nextCall;
    pending.set(id, m.id);
    send({ jsonrpc: '2.0', id, method: 'item/tool/call', params: m.params });
  }
  else if (m.method === 'test/release') {
    const value = delayed.get(m.params.threadId);
    reply(value.id, { turn: value.turn });
    reply(m.id, {});
  }
  else if (m.method === 'test/exit') process.exit(3);
});
`;

export function fakeLaunch() {
  const script = join(tempDir(), 'codex-server.cjs');
  writeFileSync(script, SERVER);
  return { command: process.execPath, args: [script] };
}
const providers: CodexProvider[] = [];
afterEach(() => providers.splice(0).forEach((provider) => provider.dispose()));

interface Request { method: string; params: Record<string, unknown> }
export const REQUEST = { system: 'system', prompt: 'question' };
export const lookup = (run: CompletionTool['run'] = async () => 'found'): CompletionTool => ({
  name: 'lookup', description: 'Look up messages', parameters: { type: 'object', properties: { query: { type: 'string' } } }, run,
});

export async function harness(price = vi.fn(async () => undefined as number | undefined), apiKey?: () => string | null) {
  const { CodexProvider } = await import('../core/codex');
  const provider = new CodexProvider(price, {
    id: apiKey ? 'codex@api' : 'codex', auth: apiKey ? 'apiKey' : 'cli', apiKey: apiKey ?? (() => null), dir: null,
  });
  providers.push(provider);
  const { rpc } = await provider.connection.connect();
  const requests = () => rpc.request<Request[]>('test/requests', {});
  await requests();
  const notify = (method: string, params: unknown) => rpc.request('test/notify', { method, params });
  const threads = async (count = 1): Promise<string[]> => {
    let starts: Request[] = [];
    await vi.waitFor(async () => {
      starts = (await requests()).filter((request) => request.method === 'turn/start');
      expect(starts).toHaveLength(count);
    });
    return starts.map((start) => start.params.threadId as string);
  };
  const message = (threadId: string, text: string, id = 'message') => notify('item/completed', {
    threadId, turnId: 'turn-' + threadId, completedAtMs: 0, item: { id, type: 'agentMessage', text },
  });
  const delta = (threadId: string, itemId: string, text: string) => notify('item/agentMessage/delta', {
    threadId, turnId: 'turn-' + threadId, itemId, delta: text,
  });
  const finish = (threadId: string, status = 'completed') => notify('turn/completed', {
    threadId, turn: { id: 'turn-' + threadId, status, error: null },
  });
  const call = (threadId: string, callId = 'lookup-call', args: unknown = { query: 'hi' }, tool = 'lookup') =>
    rpc.request<{ result?: { success: boolean; contentItems: { type: string; text: string }[] }; error?: { code: number } }>('test/call', {
      threadId, turnId: 'turn-' + threadId, callId, tool, namespace: null, arguments: args,
    });
  return { provider, rpc, requests, threads, notify, message, delta, finish, call, price };
}
