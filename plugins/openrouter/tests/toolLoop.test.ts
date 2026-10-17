import { describe, expect, it, vi } from 'vitest';
import { TOOL_CALLS_SPENT, type CompletionEvent } from '@plugin-sdk/core';
import { callDelta, delta, KEY, MODEL, REQUEST, scripted, streamed, tool, toolSpec } from './streamFixture';

describe('OpenRouter streamed tool rounds', () => {
  it('assembles fragmented calls, sends native tool results, joins text, and sums usage and cost', async () => {
    const events: CompletionEvent[] = [];
    const lookup = tool();
    const { provider, bodies, auths, forModel } = scripted([
      streamed(
        delta({ content: 'Looking up.' }),
        callDelta('call_', '{"query":', 'search_'),
        delta({ tool_calls: [{ index: 0, id: '1', function: { name: 'messages', arguments: '"hello"}' } }] }),
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 2 }, cost: 0.01 } },
      ),
      streamed(delta({ content: 'Found ' }), delta({ content: 'it.' }), { choices: [], usage: { prompt_tokens: 15, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 5 }, cost: 0.02 } }),
    ]);
    const result = await provider.complete({
      ...REQUEST, tools: [lookup], maxToolCalls: 2, effort: 'low', onEvent: (event) => events.push(event),
      history: [{ role: 'user', text: 'Earlier question' }, { role: 'assistant', text: 'Earlier answer' }],
    });
    expect(result).toEqual({ text: 'Looking up.\n\nFound it.', usage: { inputTokens: 25, cachedInputTokens: 7, outputTokens: 7 }, apiCostUsd: 0.03 });
    expect(events).toEqual([
      { type: 'text', delta: 'Looking up.' },
      { type: 'toolCall', callId: 'call_1', name: 'search_messages', args: { query: 'hello' } },
      { type: 'toolResult', callId: 'call_1', ok: true },
      { type: 'text', delta: '\n\n' }, { type: 'text', delta: 'Found ' }, { type: 'text', delta: 'it.' },
    ]);
    expect(events.filter((event) => event.type === 'text').map((event) => event.delta).join('')).toBe(result.text);
    expect(lookup.run).toHaveBeenCalledWith({ query: 'hello' }, expect.any(AbortSignal));
    const firstMessages = [
      { role: 'system', content: REQUEST.system },
      { role: 'user', content: 'Earlier question' }, { role: 'assistant', content: 'Earlier answer' },
      { role: 'user', content: REQUEST.prompt },
    ];
    expect(bodies).toEqual([
      { model: MODEL, messages: firstMessages, reasoning: { effort: 'low' }, stream: true, tools: [toolSpec], provider: { require_parameters: true } },
      {
        model: MODEL, stream: true, reasoning: { effort: 'low' }, tools: [toolSpec], provider: { require_parameters: true },
        messages: [
          ...firstMessages,
          { role: 'assistant', content: 'Looking up.', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search_messages', arguments: '{"query":"hello"}' } }] },
          { role: 'tool', tool_call_id: 'call_1', content: 'Found a message' },
        ],
      },
    ]);
    expect(forModel).toHaveBeenCalledExactlyOnceWith(MODEL);
    expect(auths).toEqual([`Bearer ${KEY.key}`, `Bearer ${KEY.key}`]);
  });

  it('orders interleaved call indices, refuses calls over budget, and removes tools from the final round', async () => {
    const events: CompletionEvent[] = [];
    const lookup = tool();
    const { provider, bodies } = scripted([
      streamed(
        callDelta('second', '{"query":', 'search_messages', 1),
        callDelta('first', '{"query":"first"}'),
        delta({ tool_calls: [{ index: 1, function: { arguments: '"second"}' } }] }),
      ),
      streamed(delta({ content: 'Final answer' })),
    ]);
    await expect(provider.complete({ ...REQUEST, tools: [lookup], maxToolCalls: 1, onEvent: (event) => events.push(event) })).resolves.toEqual({ text: 'Final answer' });
    expect(lookup.run).toHaveBeenCalledExactlyOnceWith({ query: 'first' }, expect.any(AbortSignal));
    expect(events).toEqual([
      { type: 'toolCall', callId: 'first', name: 'search_messages', args: { query: 'first' } },
      { type: 'toolResult', callId: 'first', ok: true },
      { type: 'toolCall', callId: 'second', name: 'search_messages', args: { query: 'second' } },
      { type: 'toolResult', callId: 'second', ok: false },
      { type: 'text', delta: 'Final answer' },
    ]);
    expect(bodies[1]).not.toHaveProperty('tools');
    expect(bodies[1]).not.toHaveProperty('provider');
    expect(bodies[1]!.messages).toEqual([
      { role: 'system', content: REQUEST.system }, { role: 'user', content: REQUEST.prompt },
      { role: 'assistant', content: null, tool_calls: [
        { id: 'first', type: 'function', function: { name: 'search_messages', arguments: '{"query":"first"}' } },
        { id: 'second', type: 'function', function: { name: 'search_messages', arguments: '{"query":"second"}' } },
      ] },
      { role: 'tool', tool_call_id: 'first', content: 'Found a message' },
      { role: 'tool', tool_call_id: 'second', content: TOOL_CALLS_SPENT },
    ]);
  });

  it('returns bad argument JSON to the model as a failed attempt that spends the budget', async () => {
    const events: CompletionEvent[] = [];
    const lookup = tool();
    const { provider, bodies } = scripted([streamed(callDelta('bad', '{broken')), streamed(delta({ content: 'Answer without lookup' }))]);
    await expect(provider.complete({ ...REQUEST, tools: [lookup], maxToolCalls: 1, onEvent: (event) => events.push(event) })).resolves.toEqual({ text: 'Answer without lookup' });
    expect(lookup.run).not.toHaveBeenCalled();
    expect(events.slice(0, 2)).toEqual([
      { type: 'toolCall', callId: 'bad', name: 'search_messages', args: '{broken' },
      { type: 'toolResult', callId: 'bad', ok: false },
    ]);
    expect(bodies[1]!.messages).toContainEqual({ role: 'tool', tool_call_id: 'bad', content: 'Invalid tool arguments JSON.' });
    expect(bodies[1]).not.toHaveProperty('tools');
  });

  it.each(['unknown', 'throw'] as const)('returns an %s tool failure to the model without failing the answer', async (failure) => {
    const lookup = tool(vi.fn(async () => { throw new Error('Lookup failed'); }));
    const name = failure === 'unknown' ? 'unknown' : lookup.name;
    const { provider, bodies } = scripted([streamed(callDelta('call', '{}', name)), streamed(delta({ content: 'Final' }))]);
    await expect(provider.complete({ ...REQUEST, tools: [lookup], maxToolCalls: 1 })).resolves.toEqual({ text: 'Final' });
    expect(bodies[1]!.messages).toContainEqual({
      role: 'tool', tool_call_id: 'call', content: failure === 'unknown' ? 'Unknown tool "unknown". Available tools: search_messages.' : 'Lookup failed',
    });
  });

  it('bounds requests to the call budget plus one final round if the server keeps requesting tools', async () => {
    const lookup = tool();
    const { provider, bodies } = scripted([streamed(callDelta('first')), streamed(callDelta('unexpected'))]);
    await expect(provider.complete({ ...REQUEST, tools: [lookup], maxToolCalls: 1 })).rejects.toThrow('OpenRouter: tool calls continued after the final answer round.');
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).not.toHaveProperty('tools');
    expect(lookup.run).toHaveBeenCalledOnce();
  });

  it('allows a retry after invalid JSON while budget remains', async () => {
    const lookup = tool();
    const { provider, bodies } = scripted([
      streamed(callDelta('bad', '{')), streamed(callDelta('retry', '{"query":"fixed"}')), streamed(delta({ content: 'Final' })),
    ]);
    await expect(provider.complete({ ...REQUEST, tools: [lookup], maxToolCalls: 2 })).resolves.toEqual({ text: 'Final' });
    expect(lookup.run).toHaveBeenCalledExactlyOnceWith({ query: 'fixed' }, expect.any(AbortSignal));
    expect(bodies[1]).toHaveProperty('tools');
    expect(bodies[2]).not.toHaveProperty('tools');
  });
});
