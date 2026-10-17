import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Options, SDKUserMessage, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { ROUND_SEPARATOR, TOOL_CALLS_SPENT, historyTranscript, type CompletionEvent, type CompletionTool } from '@plugin-sdk/core';
import { plugin } from '../shared';

type ServerOptions = Parameters<typeof createSdkMcpServer>[0];
type QueryInput = { prompt: string | AsyncIterable<SDKUserMessage>; options: Options };
const requests: QueryInput[] = [];
const servers: ServerOptions[] = [];
let messages: unknown[] = [];
const close = vi.fn();
vi.mock('@core/ai/resolveCli', () => ({ resolveCli: () => ({ command: 'test-claude', args: [] }) }));
vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const sdk = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return {
    ...sdk,
    createSdkMcpServer: (options: ServerOptions) => { servers.push(options); return sdk.createSdkMcpServer(options); },
    query: (input: QueryInput) => {
      requests.push(input);
      return {
        close,
        supportedModels: async () => [{ value: 'default', displayName: 'Default', description: '' }, { value: 'test-model', displayName: 'Test', description: '' }],
        [Symbol.asyncIterator]: async function* () {
          for (const message of messages) {
            if (typeof message === 'function') await message();
            else yield message;
          }
        },
      };
    },
  };
});
const { ClaudeProvider } = await import('../core/claude');
const provider = (): InstanceType<typeof ClaudeProvider> => new ClaudeProvider({ id: 'claude', auth: 'cli', apiKey: () => null, dir: null });
const REQUEST = { system: 'system', prompt: 'question' };
const RESULT = {
  type: 'result', subtype: 'success', result: 'final result only', total_cost_usd: 0.25,
  usage: { input_tokens: 12, cache_creation_input_tokens: 3, cache_read_input_tokens: 5, output_tokens: 8 },
};
const TOOL: CompletionTool = { name: 'lookup', description: 'Look up messages', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, run: async () => 'found' };
const toolRequest = { ...REQUEST, tools: [TOOL], maxToolCalls: 2 };
const handler = (index = 0): NonNullable<ServerOptions['tools']>[number]['handler'] => servers[0]!.tools![index]!.handler;
const assistant = (id: string, text: string): unknown => ({ type: 'assistant', parent_tool_use_id: null, message: { id, content: [{ type: 'text', text }], stop_reason: null } });
const delta = (text: string): unknown => ({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });

afterEach(() => { requests.length = 0; servers.length = 0; messages = []; close.mockClear(); });

describe('Claude conversation completions', () => {
  it('keeps plain requests and aggregate usage unchanged', async () => {
    messages = [assistant('one', 'First'), assistant('two', 'Last'), RESULT];
    const result = await provider().complete(REQUEST);
    expect(result).toEqual({ text: RESULT.result, usage: { inputTokens: 20, cachedInputTokens: 5, outputTokens: 8 }, apiCostUsd: 0.25 });
    expect(requests[0]!.prompt).toBe(REQUEST.prompt);
    expect(requests[0]!.options).toMatchObject({ tools: [], mcpServers: {}, strictMcpConfig: true, settingSources: [], persistSession: false, permissionMode: 'dontAsk', maxTurns: 1, systemPrompt: 'system' });
    expect(requests[0]!.options).not.toHaveProperty('includePartialMessages');
    expect(requests[0]!.options).not.toHaveProperty('allowedTools');
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([undefined, [], [{ role: 'user' as const, text: 'Earlier question' }]].map((history) => ({ history })))('keeps structured output and its corrective-turn allowance with history $history', async ({ history }) => {
    messages = [assistant('one', 'First'), assistant('two', 'Last'), { ...RESULT, structured_output: { answer: 'yes' } }];
    const schema = { type: 'object', properties: { answer: { type: 'string' } } };
    const result = await provider().complete({ ...REQUEST, schema, history });
    expect(result).toMatchObject({ text: RESULT.result, json: { answer: 'yes' } });
    expect(requests[0]!.options).toMatchObject({ maxTurns: 3, outputFormat: { type: 'json_schema', schema } });
  });

  it.each([[], [{ role: 'user' as const, text: 'Earlier question' }]].map((history) => ({ history })))('joins every answer round for history-only requests with history $history', async ({ history }) => {
    messages = [assistant('one', 'First'), assistant('two', 'Last'), RESULT];
    const result = await provider().complete({ ...REQUEST, history });
    expect(result.text).toBe(`First${ROUND_SEPARATOR}Last`);
    expect(requests[0]!.options).not.toHaveProperty('includePartialMessages');
  });

  it('sends history as a transcript with and without images', async () => {
    messages = [RESULT];
    const history = [{ role: 'user' as const, text: 'earlier question' }, { role: 'assistant' as const, text: 'earlier answer' }];
    await provider().complete({ ...REQUEST, history });
    expect(requests[0]!.prompt).toBe(historyTranscript(history, REQUEST.prompt));
    const image = { mediaType: 'image/png', data: 'aW1hZ2U=' };
    await provider().complete({ ...REQUEST, history, images: [image] });
    const prompt = requests[1]!.prompt;
    if (typeof prompt === 'string') throw new Error('expected an image prompt');
    const turns = [];
    for await (const turn of prompt) turns.push(turn);
    expect(turns[0]!.message.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
      { type: 'text', text: historyTranscript(history, REQUEST.prompt) },
    ]);
  });

  it('limits tools to the request MCP server and enables partial messages only for events', async () => {
    const events: CompletionEvent[] = [];
    messages = [delta('streamed answer'), RESULT];
    const result = await provider().complete({ ...toolRequest, model: 'test-model', effort: 'high', onEvent: (e) => events.push(e) });
    expect(requests[0]!.options).toMatchObject({
      tools: [], mcpServers: { chattypop: { type: 'sdk', name: 'chattypop' } }, allowedTools: ['mcp__chattypop__lookup'],
      maxTurns: 4, includePartialMessages: true, strictMcpConfig: true, settingSources: [], permissionMode: 'dontAsk',
      model: 'test-model', effort: 'high',
    });
    expect(servers[0]!.name).toBe('chattypop');
    expect(servers[0]!.tools![0]).toMatchObject({ name: TOOL.name, description: TOOL.description });
    expect(servers[0]!.tools![0]!.inputSchema.query!.safeParse('term').success).toBe(true);
    expect(result.text).toBe('streamed answer');
    expect(events).toEqual([{ type: 'text', delta: result.text }]);
    expect(result.usage).toEqual({ inputTokens: 20, cachedInputTokens: 5, outputTokens: 8 });
    expect(result.apiCostUsd).toBe(RESULT.total_cost_usd);
  });

  it('collects all tool rounds without requesting partial messages when no event sink is given', async () => {
    messages = [assistant('one', 'Looking.'), assistant('two', 'Found it.'), RESULT];
    const result = await provider().complete(toolRequest);
    expect(result.text).toBe(`Looking.${ROUND_SEPARATOR}Found it.`);
    expect(requests[0]!.options).not.toHaveProperty('includePartialMessages');
  });

  it('streams without tools and keeps emitted deltas equal to the result', async () => {
    const events: CompletionEvent[] = [];
    messages = [delta('first'), { type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_stop' } }, delta('second'), RESULT];
    const result = await provider().complete({ ...REQUEST, onEvent: (e) => events.push(e) });
    expect(requests[0]!.options).toMatchObject({ maxTurns: 1, includePartialMessages: true, mcpServers: {} });
    expect(result.text).toBe(`first${ROUND_SEPARATOR}second`);
    expect(events.flatMap((e) => e.type === 'text' ? [e.delta] : []).join('')).toBe(result.text);
  });

  it('maps tool successes, failures and exhausted calls to MCP results with unique event IDs', async () => {
    const events: CompletionEvent[] = [];
    const run = vi.fn().mockResolvedValueOnce('found').mockRejectedValueOnce(new Error('lookup failed'));
    messages = [
      async () => {
        expect(await handler()({ query: 'one' }, { requestId: 1 })).toEqual({ content: [{ type: 'text', text: 'found' }], isError: false });
        expect(await handler()({ query: 'two' }, { requestId: 2 })).toEqual({ content: [{ type: 'text', text: 'lookup failed' }], isError: true });
        expect(await handler()({ query: 'three' }, { requestId: 3 })).toEqual({ content: [{ type: 'text', text: TOOL_CALLS_SPENT }], isError: true });
      }, RESULT,
    ];
    await provider().complete({ ...toolRequest, tools: [{ ...TOOL, run }], onEvent: (e) => events.push(e) });
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]![0]).toEqual({ query: 'one' });
    expect(run.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
    const calls = events.filter((e) => e.type === 'toolCall');
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((e) => e.callId)).size).toBe(3);
    expect(events).toEqual(calls.flatMap((call, index) => [call, { type: 'toolResult', callId: call.callId, ok: index === 0 }]));
  });

  it('streams the lookup preamble and final answer around a tool call in event order', async () => {
    const events: CompletionEvent[] = [];
    const run = vi.fn(async () => 'found');
    messages = [
      delta('Looking.'), { type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_stop' } },
      async () => { await handler()({ query: 'term' }, {}); },
      delta('Found it.'), RESULT,
    ];
    const result = await provider().complete({ ...toolRequest, tools: [{ ...TOOL, run }], onEvent: (e) => events.push(e) });
    expect(run).toHaveBeenCalledOnce();
    expect(events.map((e) => e.type)).toEqual(['text', 'toolCall', 'toolResult', 'text', 'text']);
    expect(result.text).toBe(`Looking.${ROUND_SEPARATOR}Found it.`);
    expect(events.flatMap((e) => e.type === 'text' ? [e.delta] : []).join('')).toBe(result.text);
  });

  it.each([{ type: 'string' }, { type: 'object', properties: { value: { type: 'unsupported' } } }])('rejects unsupported tool schemas before query starts: %j', async (parameters) => {
    await expect(provider().complete({ ...toolRequest, tools: [{ ...TOOL, parameters }] })).rejects.toThrow('requires a supported object JSON Schema');
    expect(requests).toEqual([]);
  });

  it.each([false, true])('allows a spent lookup and then a final answer (streaming: %s)', async (streaming) => {
    const events: CompletionEvent[] = [];
    const run = vi.fn(async () => 'found');
    const round = (id: string, text: string): unknown[] => streaming
      ? [delta(text), { type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_stop' } }]
      : [assistant(id, text)];
    messages = [
      ...round('one', 'Looking.'),
      async () => { expect(await handler()({ query: 'one' }, {})).toMatchObject({ isError: false }); },
      ...round('two', 'Checking again.'),
      async () => { expect(await handler()({ query: 'two' }, {})).toEqual({ content: [{ type: 'text', text: TOOL_CALLS_SPENT }], isError: true }); },
      ...round('three', 'Found it.'), RESULT,
    ];
    const result = await provider().complete({ ...toolRequest, tools: [{ ...TOOL, run }], maxToolCalls: 1,
      ...(streaming ? { onEvent: (e: CompletionEvent) => events.push(e) } : {}),
    });
    expect(requests[0]!.options.maxTurns).toBe(3);
    expect(run).toHaveBeenCalledOnce();
    expect(result.text).toBe(['Looking.', 'Checking again.', 'Found it.'].join(ROUND_SEPARATOR));
    if (streaming) expect(events.flatMap((e) => e.type === 'text' ? [e.delta] : []).join('')).toBe(result.text);
  });

  it.each([false, true])('rejects when Claude keeps calling past the grace turn, preserving streamed text (streaming: %s)', async (streaming) => {
    const events: CompletionEvent[] = [];
    const run = vi.fn(async () => 'found');
    messages = [
      streaming ? delta('Partial answer.') : assistant('one', 'Partial answer.'),
      async () => {
        await handler()({ query: 'one' }, {});
        for (const query of ['two', 'three']) {
          expect(await handler()({ query }, {})).toEqual({ content: [{ type: 'text', text: TOOL_CALLS_SPENT }], isError: true });
        }
      },
      { ...RESULT, subtype: 'error_max_turns' }, delta('late'), RESULT,
    ];
    await expect(provider().complete({ ...toolRequest, tools: [{ ...TOOL, run }], maxToolCalls: 1,
      ...(streaming ? { onEvent: (e: CompletionEvent) => events.push(e) } : {}),
    })).rejects.toThrow('Claude kept looking things up past its limit of 1 lookups.');
    expect(run).toHaveBeenCalledOnce();
    expect(events.flatMap((e) => e.type === 'text' ? [e.delta] : []).join('')).toBe(streaming ? 'Partial answer.' : '');
    expect(close).toHaveBeenCalledOnce();
  });

  it('fences tools and events after the request settles', async () => {
    const onEvent = vi.fn();
    const run = vi.fn(async () => 'late');
    messages = [RESULT];
    await provider().complete({ ...toolRequest, tools: [{ ...TOOL, run }], onEvent });
    await expect(handler()({ query: 'late' }, {})).rejects.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('honors an already aborted signal before query starts', async () => {
    const signal = AbortSignal.abort(new Error('stopped'));
    await expect(provider().complete({ ...toolRequest, signal })).rejects.toThrow('stopped');
    expect(requests).toEqual([]);
  });

  it('stops running tools and events when the request aborts', async () => {
    const controller = new AbortController();
    const events: CompletionEvent[] = [];
    const run = vi.fn(async () => { controller.abort(new Error('stopped')); return 'late'; });
    messages = [async () => { await handler()({ query: 'term' }, {}); }, delta('late'), RESULT];
    await expect(provider().complete({ ...toolRequest, tools: [{ ...TOOL, run }], signal: controller.signal, onEvent: (e) => events.push(e) })).rejects.toThrow('stopped');
    expect(events.map((e) => e.type)).toEqual(['toolCall']);
    expect(close).toHaveBeenCalledOnce();
  });

  it('advertises tools for the provider and every model', async () => {
    expect(plugin.providers[0]!.tools).toBe(true);
    const models = await provider().listModels();
    expect(models).toHaveLength(2);
    expect(models.every((m) => m.tools === true)).toBe(true);
    expect(models[0]!.isDefault).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });
});
