import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { defineCorePlugin, TOOL_CALLS_SPENT, type CompletionEvent, type CompletionRequest, type CompletionTool } from '@plugin-sdk/core';
import { testPlugin } from '@plugin-sdk/core/testing';
import ollamaCore from '../core';
import { OllamaProvider } from '../core/ollama';
import { plugin } from '../shared';
import { OLLAMA_DEFAULT_URL } from '../shared/settings';

const MODEL = 'qwen3:8b';
const REQUEST: CompletionRequest = { system: 'Use the archive.', prompt: 'What happened?' };
const PARAMETERS = { type: 'object', properties: { query: { type: 'string' } } };
const STOP = { done: true, done_reason: 'stop' };
const call = (query: string) => ({ function: { name: 'lookup', arguments: { query } } });
const streamed = (...lines: object[]) => new Response(lines.map((line) => JSON.stringify(line)).join('\n'));
const tool = (run = vi.fn(async () => 'Matched messages.')): CompletionTool => ({ name: 'lookup', description: 'Search messages.', parameters: PARAMETERS, run });

function start(responses: readonly Response[], unloadAfterS: number | null = null) {
  const sent: { path: string; bytes: string; body: Record<string, unknown> }[] = [];
  let p!: OllamaProvider;
  const t = testPlugin(defineCorePlugin(plugin, (ctx) => {
    p = new OllamaProvider(ctx.net.fetch, OLLAMA_DEFAULT_URL, MODEL, unloadAfterS);
    return ollamaCore.activate(ctx);
  }), {
    network: async (url, init) => {
      const bytes = String(init.body);
      sent.push({ path: url.pathname, bytes, body: JSON.parse(bytes) });
      const response = responses[sent.length - 1];
      if (!response) throw new Error('Unexpected Ollama request.');
      return response;
    },
  });
  onTestFinished(() => t.dispose());
  return { p, sent };
}

describe('Ollama conversation rounds', () => {
  it('sends native history in order and images only with the new user message', async () => {
    const { p, sent } = start([streamed({ message: { content: 'Answer' }, ...STOP })]);
    await p.complete({
      ...REQUEST,
      history: [{ role: 'user', text: 'Earlier question' }, { role: 'assistant', text: 'Earlier answer' }],
      images: [{ mediaType: 'image/png', data: 'aGVsbG8=' }],
    });
    expect(sent[0]!.body.messages).toEqual([
      { role: 'system', content: REQUEST.system },
      { role: 'user', content: 'Earlier question' },
      { role: 'assistant', content: 'Earlier answer' },
      { role: 'user', content: REQUEST.prompt, images: ['aGVsbG8='] },
    ]);
  });

  it('streams a tool round and final answer, joins their deltas, and sums usage', async () => {
    const run = vi.fn(async () => 'Matched messages.');
    const events: CompletionEvent[] = [];
    const lookup = call('release');
    const { p, sent } = start([
      streamed(
        { message: { thinking: 'Hidden ', content: '' } },
        { message: { thinking: 'reasoning' } },
        { message: { content: 'Checking' } },
        { message: { content: ' now.', tool_calls: [lookup] } },
        { ...STOP, prompt_eval_count: 10, eval_count: 8 },
      ),
      streamed({ message: { content: 'Found' } }, { message: { content: ' it.' } }, { ...STOP, prompt_eval_count: 20, eval_count: 5 }),
    ]);
    const result = await p.complete({ ...REQUEST, tools: [tool(run)], maxToolCalls: 2, onEvent: (e) => events.push(e) });
    expect(result).toEqual({ text: 'Checking now.\n\nFound it.', usage: { inputTokens: 30, cachedInputTokens: 0, outputTokens: 13 } });
    expect(events.filter((e) => e.type === 'text').map((e) => e.delta).join('')).toBe(result.text);
    expect(events.map((e) => e.type)).toEqual(['text', 'text', 'toolCall', 'toolResult', 'text', 'text', 'text']);
    const called = events.find((e) => e.type === 'toolCall');
    expect(called).toMatchObject({ name: 'lookup', args: { query: 'release' }, callId: expect.stringMatching(/^ollama_lookup_/) });
    expect(events.find((e) => e.type === 'toolResult')).toEqual({ type: 'toolResult', callId: called!.callId, ok: true });
    expect(run).toHaveBeenCalledExactlyOnceWith({ query: 'release' }, expect.any(AbortSignal));
    const tools = [{ type: 'function', function: { name: 'lookup', description: 'Search messages.', parameters: PARAMETERS } }];
    expect(sent.map((s) => s.path)).toEqual(['/api/chat', '/api/chat']);
    expect(sent[0]!.body.tools).toEqual(tools);
    expect(sent[1]!.body).toEqual({
      model: MODEL, stream: true, options: { num_ctx: 16_384 }, tools,
      messages: [
        { role: 'system', content: REQUEST.system }, { role: 'user', content: REQUEST.prompt },
        { role: 'assistant', content: 'Checking now.', thinking: 'Hidden reasoning', tool_calls: [lookup] },
        { role: 'tool', content: 'Matched messages.', tool_name: 'lookup' },
      ],
    });
  });

  it('refuses calls past the budget, gives every call a unique id, and omits tools once spent', async () => {
    const run = vi.fn(async () => 'One result.');
    const calls = [call('one'), call('two'), call('three')];
    const events: CompletionEvent[] = [];
    const { p, sent } = start([
      streamed({ message: { tool_calls: [calls[0]] } }, { message: { tool_calls: calls.slice(1) }, ...STOP }),
      streamed({ message: { content: 'Final answer' }, ...STOP }),
    ]);
    expect((await p.complete({ ...REQUEST, tools: [tool(run)], maxToolCalls: 1, onEvent: (e) => events.push(e) })).text).toBe('Final answer');
    expect(run).toHaveBeenCalledOnce();
    const callEvents = events.filter((e) => e.type === 'toolCall');
    expect(new Set(callEvents.map((e) => e.callId)).size).toBe(calls.length);
    expect(events.filter((e) => e.type === 'toolResult').map((e) => e.ok)).toEqual([true, false, false]);
    expect(sent[1]!.body).not.toHaveProperty('tools');
    expect(sent[1]!.body.messages).toEqual([
      { role: 'system', content: REQUEST.system }, { role: 'user', content: REQUEST.prompt },
      { role: 'assistant', content: '', tool_calls: calls },
      { role: 'tool', content: 'One result.', tool_name: 'lookup' },
      { role: 'tool', content: TOOL_CALLS_SPENT, tool_name: 'lookup' },
      { role: 'tool', content: TOOL_CALLS_SPENT, tool_name: 'lookup' },
    ]);
  });

  it('rejects a tool round without done before running tools or sending another request', async () => {
    const run = vi.fn(async () => 'One result.');
    const { p, sent } = start([streamed({ message: { content: 'Looking.', tool_calls: [call('one')] } })]);
    await expect(p.complete({ ...REQUEST, tools: [tool(run)], maxToolCalls: 1 })).rejects.toThrow('returned an unfinished response');
    expect(run).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
  });

  it('bounds a model that keeps calling tools to the budget plus a final round', async () => {
    const run = vi.fn(async () => 'One result.');
    const { p, sent } = start([
      streamed({ message: { tool_calls: [call('one')] }, ...STOP }),
      streamed({ message: { tool_calls: [call('again')] }, ...STOP }),
    ]);
    await expect(p.complete({ ...REQUEST, tools: [tool(run)], maxToolCalls: 1 })).rejects.toThrow('kept calling tools after its tool call limit');
    expect(sent).toHaveLength(2);
    expect(sent[1]!.body).not.toHaveProperty('tools');
    expect(run).toHaveBeenCalledOnce();
  });

  it('counts answer tokens across rounds while excluding thinking and separators', async () => {
    const rounds = () => [
      streamed({ message: { thinking: 'long reasoning' } }, { message: { content: 'Checking' } }, { message: { content: '.', tool_calls: [call('one')] }, ...STOP }),
      streamed({ message: { thinking: 'more reasoning' } }, { message: { content: 'Found' } }, { message: { content: '.' }, ...STOP }),
    ];
    const { p } = start(rounds());
    expect((await p.complete({ ...REQUEST, tools: [tool()], maxToolCalls: 1, maxOutputTokens: 4 })).text).toBe('Checking.\n\nFound.');
    const limited = start(rounds());
    await expect(limited.p.complete({ ...REQUEST, tools: [tool()], maxToolCalls: 1, maxOutputTokens: 3 })).rejects.toThrow('answer limit: 3 tokens');
  });

  it.each([
    { name: 'length', response: () => streamed({ message: { content: 'Partial' }, done: true, done_reason: 'length', eval_count: 7 }), error: 'reached its output token limit; the response may be incomplete (stop reason: length; output tokens: 7)' },
    { name: 'unfinished', response: () => streamed({ message: { content: 'Partial' }, done: false }), error: 'returned an unfinished response (stop reason not reported)' },
    { name: 'missing done', response: () => streamed({ message: { content: 'Partial' } }), error: 'returned an unfinished response (stop reason not reported)' },
    { name: 'invalid JSON', response: () => new Response('invalid JSON'), error: 'returned an invalid API response' },
    { name: 'missing answer', response: () => streamed(STOP), error: 'returned no response text (stop reason: stop)' },
    { name: 'thinking limit', response: () => streamed({ message: { thinking: 'Still thinking' }, done_reason: 'length', eval_count: 7 }), error: 'ran out of output while thinking and gave no answer (stop reason: length; output tokens: 7)' },
  ])('keeps the final round $name failure', async ({ response, error }) => {
    const { p } = start([streamed({ message: { content: 'Looking.', tool_calls: [call('one')] }, ...STOP }), response()]);
    await expect(p.complete({ ...REQUEST, tools: [tool()], maxToolCalls: 1 })).rejects.toThrow(error);
  });

  it('streams text without tools and stops events when a text callback aborts', async () => {
    const controller = new AbortController();
    const reason = new Error('Stop requested.');
    const events: CompletionEvent[] = [];
    const { p } = start([streamed({ message: { content: 'First' } }, { message: { content: 'Second' }, ...STOP })]);
    await expect(p.complete({ ...REQUEST, signal: controller.signal, onEvent: (e) => { events.push(e); controller.abort(reason); } })).rejects.toBe(reason);
    expect(events).toEqual([{ type: 'text', delta: 'First' }]);
  });

  it.each([undefined, { type: 'object', properties: { ok: { type: 'boolean' } } }])('preserves plain and schema request bytes: %j', async (schema) => {
    const content = schema ? '{"ok":true}' : 'Plain answer';
    const { p, sent } = start([streamed({ message: { content }, ...STOP, prompt_eval_count: 9, eval_count: 3 })], 60);
    const result = await p.complete({ ...REQUEST, schema, effort: 'off', images: [{ mediaType: 'image/png', data: 'aGVsbG8=' }] });
    expect(result).toEqual({ text: content, usage: { inputTokens: 9, cachedInputTokens: 0, outputTokens: 3 }, ...(schema ? { json: { ok: true } } : {}) });
    expect(sent[0]!.bytes).toBe(JSON.stringify({
      model: MODEL, stream: true, options: { num_ctx: 16_384 }, keep_alive: 60, think: false,
      messages: [{ role: 'system', content: REQUEST.system }, { role: 'user', content: REQUEST.prompt, images: ['aGVsbG8='] }],
      ...(schema ? { format: schema } : {}),
    }));
    expect(sent).toHaveLength(1);
  });
});
