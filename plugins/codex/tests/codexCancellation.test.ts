import { describe, expect, it, vi } from 'vitest';
import type { CompletionEvent } from '@plugin-sdk/core';
import { fakeLaunch, harness, lookup, REQUEST } from './codexServer';

vi.mock('@core/ai/asyncCli', () => ({ resolveCliAsync: async () => fakeLaunch() }));

describe('Codex completion cancellation', () => {
  it('answers an outstanding tool call on abort, interrupts only its turn, and fences later events', async () => {
    const c = await harness();
    const controller = new AbortController();
    const late = Promise.withResolvers<string>();
    const run = vi.fn(() => late.promise);
    const events: CompletionEvent[] = [];
    const result = c.provider.complete({ ...REQUEST, tools: [lookup(run)], maxToolCalls: 1,
      signal: controller.signal, onEvent: (event) => events.push(event),
    });
    const companion = c.provider.complete(REQUEST);
    const [thread, other] = await c.threads(2);
    await c.delta(thread!, 'first', 'Looking');
    const call = c.call(thread!);
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    const rejected = expect(result).rejects.toThrow('cancel answer');
    controller.abort(new Error('cancel answer'));
    await rejected;
    await expect(call).resolves.toMatchObject({ result: { success: false, contentItems: [{ type: 'inputText', text: expect.any(String) }] } });
    expect(run.mock.calls[0]).toEqual([{ query: 'hi' }, expect.objectContaining({ aborted: true })]);
    const before = [...events];
    late.resolve('too late');
    await c.delta(thread!, 'last', 'ignored');
    await c.message(thread!, 'ignored');
    expect(events).toEqual(before);
    expect(events.map((event) => event.type)).toEqual(['text', 'toolCall']);
    const interrupts = (await c.requests()).filter((request) => request.method === 'turn/interrupt');
    expect(interrupts).toHaveLength(1);
    expect(interrupts[0]?.params).toEqual({ threadId: thread, turnId: 'turn-' + thread });
    await c.message(other!, 'Companion answer');
    await c.finish(other!);
    await expect(companion).resolves.toEqual({ text: 'Companion answer' });
  });

  it('rejects an already aborted request before starting a thread', async () => {
    const c = await harness();
    const controller = new AbortController();
    controller.abort(new Error('already cancelled'));
    await expect(c.provider.complete({ ...REQUEST, signal: controller.signal })).rejects.toThrow('already cancelled');
    expect((await c.requests()).some((request) => request.method === 'thread/start')).toBe(false);
  });

  it('rejects promptly before turn/start replies and interrupts when the turn id arrives', async () => {
    const c = await harness();
    const controller = new AbortController();
    const result = c.provider.complete({ ...REQUEST, system: 'delayed', signal: controller.signal });
    const [thread] = await c.threads();
    const rejected = expect(result).rejects.toThrow('cancel starting');
    controller.abort(new Error('cancel starting'));
    await rejected;
    await c.rpc.request('test/release', { threadId: thread });
    await vi.waitFor(async () => expect((await c.requests()).filter((request) => request.method === 'turn/interrupt')).toHaveLength(1));
  });

  it('fences and answers tools still running when the turn settles', async () => {
    const c = await harness();
    const run = vi.fn(() => new Promise<string>(() => undefined));
    const events: CompletionEvent[] = [];
    const result = c.provider.complete({ ...REQUEST, tools: [lookup(run)], maxToolCalls: 1, onEvent: (event) => events.push(event) });
    const [thread] = await c.threads();
    const call = c.call(thread!);
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    await c.message(thread!, 'Finished');
    await c.finish(thread!);
    await expect(result).resolves.toEqual({ text: 'Finished' });
    await expect(call).resolves.toMatchObject({ result: { success: false } });
    expect(events.some((event) => event.type === 'toolResult')).toBe(false);
  });

  it('reports failed turns and connection exits while awaiting completion', async () => {
    const c = await harness();
    const failed = c.provider.complete(REQUEST);
    const [thread] = await c.threads();
    const rejected = expect(failed).rejects.toThrow('Codex turn failed: no detail');
    await c.finish(thread!, 'failed');
    await rejected;
    const result = c.provider.complete(REQUEST);
    await c.threads(2);
    const exited = expect(result).rejects.toThrow('exited (3)');
    await expect(c.rpc.request('test/exit', {})).rejects.toThrow('exited (3)');
    await exited;
  });

  it('rechecks the payment key before a running tool publishes its result', async () => {
    let key = 'test-key';
    const c = await harness(undefined, () => key);
    const late = Promise.withResolvers<string>();
    const run = vi.fn(() => late.promise);
    const onEvent = vi.fn();
    const result = c.provider.complete({ ...REQUEST, tools: [lookup(run)], maxToolCalls: 1, onEvent });
    const [thread] = await c.threads();
    const call = c.call(thread!);
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    const resultRejected = expect(result).rejects.toThrow('exited');
    const callRejected = expect(call).rejects.toThrow('exited');
    key = 'test-next';
    late.resolve('found');
    await Promise.all([resultRejected, callRejected]);
    expect(onEvent.mock.calls.map(([event]) => event.type)).toEqual(['toolCall']);
    expect(c.price).not.toHaveBeenCalled();
  });
});
