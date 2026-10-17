import { describe, expect, it, vi } from 'vitest';
import { historyTranscript, TOOL_CALLS_SPENT, type CompletionEvent } from '@plugin-sdk/core';
import { fakeLaunch, harness, lookup, REQUEST } from './codexServer';

vi.mock('@core/ai/resolveCli', () => ({ resolveCli: () => fakeLaunch() }));

const joinedText = (events: CompletionEvent[]): string => events.map((event) => event.type === 'text' ? event.delta : '').join('');

describe('Codex chat completions', () => {
  it('opts the shared connection into experimental tools and preserves plain last-message results', async () => {
    const c = await harness();
    const result = c.provider.complete(REQUEST);
    const [thread] = await c.threads();
    await c.message(thread!, 'first', 'first');
    await c.message(thread!, 'answer', 'last');
    await c.finish(thread!);
    await expect(result).resolves.toEqual({ text: 'answer' });
    const requests = await c.requests();
    expect(requests.filter((request) => request.method === 'initialize')).toEqual([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        clientInfo: expect.objectContaining({ name: 'chattypop' }), capabilities: { experimentalApi: true },
      } },
    ]);
    expect(requests.find((request) => request.method === 'thread/start')?.params).not.toHaveProperty('dynamicTools');
    expect(requests.find((request) => request.method === 'turn/start')?.params).toEqual({
      threadId: thread, input: [{ type: 'text', text: REQUEST.prompt, text_elements: [] }],
    });
    expect((await c.provider.listModels())[0]).toMatchObject({ tools: true, images: true, efforts: ['high'] });
    expect((await c.requests()).filter((request) => request.method === 'initialize')).toHaveLength(1);
  });

  it.each([[], [{ role: 'user' as const, text: 'Earlier question' }]].map((history) => ({ history })))('joins every agent message for history-only requests with history $history', async ({ history }) => {
    const c = await harness();
    const result = c.provider.complete({ ...REQUEST, history });
    const [thread] = await c.threads();
    await c.message(thread!, 'First', 'first');
    await c.message(thread!, 'Last', 'last');
    await c.finish(thread!);
    await expect(result).resolves.toEqual({ text: 'First\n\nLast' });
  });

  it('sends history as a transcript alongside images and effort', async () => {
    const c = await harness();
    const history = [{ role: 'user' as const, text: 'Earlier question' }, { role: 'assistant' as const, text: 'Earlier answer' }];
    const result = c.provider.complete({ ...REQUEST, history, images: [{ mediaType: 'image/png', data: 'abc' }], effort: 'high' });
    const [thread] = await c.threads();
    const start = (await c.requests()).find((request) => request.method === 'turn/start');
    expect(start?.params).toEqual({ threadId: thread, effort: 'high', input: [
      { type: 'image', url: 'data:image/png;base64,abc' },
      { type: 'text', text: historyTranscript(history, REQUEST.prompt), text_elements: [] },
    ] });
    await c.message(thread!, 'answer');
    await c.finish(thread!);
    await expect(result).resolves.toEqual({ text: 'answer' });
  });

  it('streams deltas and round separators exactly once, ignoring other threads and late events', async () => {
    const c = await harness();
    const events: CompletionEvent[] = [];
    const result = c.provider.complete({ ...REQUEST, onEvent: (event) => events.push(event) });
    const [thread] = await c.threads();
    await c.delta('unrelated', 'other', 'ignored');
    await c.delta(thread!, 'first', 'Checking');
    await c.delta(thread!, 'first', ' the archive.');
    await c.message(thread!, 'Checking the archive.', 'first');
    await c.message('unrelated', 'ignored');
    await c.delta(thread!, 'last', 'Here is ');
    await c.delta(thread!, 'last', 'the answer.');
    await c.message(thread!, 'Here is the answer.', 'last');
    await c.finish(thread!);
    await expect(result).resolves.toEqual({ text: 'Checking the archive.\n\nHere is the answer.' });
    expect(joinedText(events)).toBe('Checking the archive.\n\nHere is the answer.');
    const before = [...events];
    await c.delta(thread!, 'late', 'ignored');
    expect(events).toEqual(before);
  });

  it('emits completed text when no deltas arrive, with no separators for empty messages', async () => {
    const c = await harness();
    const events: CompletionEvent[] = [];
    const result = c.provider.complete({ ...REQUEST, onEvent: (event) => events.push(event) });
    const [thread] = await c.threads();
    await c.delta(thread!, 'empty', '');
    await c.message(thread!, '', 'empty');
    await c.message(thread!, 'first', 'first');
    await c.message(thread!, '', 'empty2');
    await c.message(thread!, 'last', 'last');
    await c.finish(thread!);
    await expect(result).resolves.toEqual({ text: 'first\n\nlast' });
    expect(joinedText(events)).toBe('first\n\nlast');
  });

  it.each([undefined, [], [{ role: 'user' as const, text: 'Earlier question' }]].map((history) => ({ history })))('keeps schema results on the last-message path even with onEvent and history $history', async ({ history }) => {
    const c = await harness();
    const onEvent = vi.fn();
    const schema = { type: 'object', properties: { answer: { type: 'number' } } };
    const result = c.provider.complete({ ...REQUEST, schema, onEvent, history });
    const [thread] = await c.threads();
    await c.message(thread!, 'commentary', 'first');
    await c.delta(thread!, 'last', '{"answer":1}');
    await c.message(thread!, '{"answer":1}', 'last');
    await c.finish(thread!);
    await expect(result).resolves.toEqual({ text: '{"answer":1}', json: { answer: 1 } });
    expect(onEvent).not.toHaveBeenCalled();
    expect((await c.requests()).find((request) => request.method === 'turn/start')?.params.outputSchema).toEqual(schema);
  });

  it.each([false, true])('routes tool calls and joins every agent message (streaming: %s)', async (streaming) => {
    const c = await harness();
    const run = vi.fn(async () => 'message [1]');
    const tool = lookup(run);
    const events: CompletionEvent[] = [];
    const result = c.provider.complete({ ...REQUEST, tools: [tool], maxToolCalls: 1,
      ...(streaming ? { onEvent: (event: CompletionEvent) => events.push(event) } : {}),
    });
    const [thread] = await c.threads();
    expect((await c.requests()).find((request) => request.method === 'thread/start')?.params.dynamicTools).toEqual([
      { type: 'function', name: tool.name, description: tool.description, inputSchema: tool.parameters },
    ]);
    await c.message(thread!, 'Looking up messages.', 'first');
    await expect(c.call(thread!, 'one')).resolves.toMatchObject({ result: {
      success: true, contentItems: [{ type: 'inputText', text: 'message [1]' }],
    } });
    await expect(c.call(thread!, 'two')).resolves.toMatchObject({ result: {
      success: false, contentItems: [{ type: 'inputText', text: TOOL_CALLS_SPENT }],
    } });
    expect(run).toHaveBeenCalledExactlyOnceWith({ query: 'hi' }, expect.any(AbortSignal));
    await c.message(thread!, 'Answer [1].', 'last');
    await c.finish(thread!);
    await expect(result).resolves.toEqual({ text: 'Looking up messages.\n\nAnswer [1].' });
    if (streaming) {
      expect(joinedText(events)).toBe('Looking up messages.\n\nAnswer [1].');
      expect(events.filter((event) => event.type !== 'text')).toEqual([
        { type: 'toolCall', callId: 'one', name: 'lookup', args: { query: 'hi' } },
        { type: 'toolResult', callId: 'one', ok: true },
        { type: 'toolCall', callId: 'two', name: 'lookup', args: { query: 'hi' } },
        { type: 'toolResult', callId: 'two', ok: false },
      ]);
    }
    await expect(c.call(thread!)).resolves.toMatchObject({ error: { code: -32601 } });
  });

  it('isolates simultaneous tool requests and keeps the remaining route after one settles', async () => {
    const c = await harness();
    const first = c.provider.complete({ ...REQUEST, tools: [lookup(async () => 'first')], maxToolCalls: 1 });
    const second = c.provider.complete({ ...REQUEST, tools: [lookup(async () => 'second')], maxToolCalls: 2 });
    const [a, b] = await c.threads(2);
    await expect(c.call('unrelated')).resolves.toMatchObject({ result: { success: false } });
    await expect(c.call(b!)).resolves.toMatchObject({ result: { contentItems: [{ text: 'second' }] } });
    await expect(c.call(a!)).resolves.toMatchObject({ result: { contentItems: [{ text: 'first' }] } });
    await c.message(a!, 'a');
    await c.finish(a!);
    await expect(first).resolves.toEqual({ text: 'a' });
    await expect(c.call(b!, 'again')).resolves.toMatchObject({ result: { contentItems: [{ text: 'second' }] } });
    await c.message(b!, 'b');
    await c.finish(b!);
    await expect(second).resolves.toEqual({ text: 'b' });
  });

  it('returns unknown tools and thrown tool failures to the model', async () => {
    const c = await harness();
    const result = c.provider.complete({ ...REQUEST, tools: [lookup(async () => { throw new Error('lookup failed'); })], maxToolCalls: 2 });
    const [thread] = await c.threads();
    await expect(c.call(thread!, 'unknown', {}, 'missing')).resolves.toMatchObject({ result: {
      success: false, contentItems: [{ text: expect.stringContaining('Unknown tool') }],
    } });
    await expect(c.call(thread!, 'failed')).resolves.toMatchObject({ result: { success: false, contentItems: [{ text: 'lookup failed' }] } });
    await c.message(thread!, 'No messages available.');
    await c.finish(thread!);
    await expect(result).resolves.toEqual({ text: 'No messages available.' });
  });

  it('prices cumulative usage across rounds and keeps the largest individual prompt', async () => {
    const c = await harness(vi.fn(async () => 0.25));
    const result = c.provider.complete({ ...REQUEST, tools: [lookup()], maxToolCalls: 1 });
    const [thread] = await c.threads();
    const usage = (inputTokens: number, outputTokens: number) => ({ inputTokens, cachedInputTokens: 5, cacheWriteInputTokens: 2, outputTokens });
    await c.notify('thread/tokenUsage/updated', { threadId: thread, tokenUsage: { total: usage(100, 10), last: usage(100, 10) } });
    await c.message(thread!, 'First', 'first');
    await c.call(thread!);
    await c.notify('thread/tokenUsage/updated', { threadId: 'unrelated', tokenUsage: { total: usage(999, 999), last: usage(999, 999) } });
    await c.notify('thread/tokenUsage/updated', { threadId: thread, tokenUsage: { total: usage(180, 25), last: usage(80, 15) } });
    await c.message(thread!, 'Last', 'last');
    await c.finish(thread!);
    await expect(result).resolves.toEqual({ text: 'First\n\nLast', usage: { inputTokens: 180, cachedInputTokens: 5, outputTokens: 25 }, apiCostUsd: 0.25 });
    expect(c.price).toHaveBeenCalledExactlyOnceWith('openai/model', {
      inputTokens: 180, cachedInputTokens: 5, cacheWriteInputTokens: 2, outputTokens: 25, largestPromptTokens: 100,
    });
  });
});
