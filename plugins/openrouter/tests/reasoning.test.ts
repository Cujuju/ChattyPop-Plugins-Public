import { describe, expect, it } from 'vitest';
import type { CompletionEvent } from '@plugin-sdk/core';
import { callDelta, delta, REQUEST, scripted, streamed, tool } from './streamFixture';

describe('OpenRouter reasoning replay', () => {
  it('merges native details by index and type, preserving order, metadata, and signatures', async () => {
    const events: CompletionEvent[] = [];
    const { provider, bodies } = scripted([
      streamed(
        delta({ reasoning: 'Look ', reasoning_details: [{ type: 'reasoning.text', index: 0, id: 'thought', format: 'anthropic-claude-v1', text: 'Look ', signature: null }] }),
        delta({ reasoning_details: [
          { type: 'reasoning.text', index: 0, text: 'up.', signature: 'signed-' },
          { type: 'reasoning.summary', index: 0, id: 'summary', summary: 'Search ' },
        ] }),
        delta({ reasoning_details: [
          { type: 'reasoning.text', index: 0, signature: 'thought' },
          { type: 'reasoning.summary', index: 0, summary: 'needed.' },
          { type: 'reasoning.encrypted', index: 1, id: 'encrypted', format: 'google-gemini-v1', data: 'opaque-' },
        ] }),
        delta({ reasoning_details: [
          { type: 'reasoning.text', index: 0, signature: null },
          { type: 'reasoning.encrypted', index: 1, data: 'state' },
          { type: 'reasoning.text', index: 2, id: 'next-thought', text: 'Use results.', signature: 'next-signature' },
        ] }),
        delta({ content: 'Looking.' }), callDelta('call'),
      ),
      streamed(delta({ reasoning_details: [{ type: 'reasoning.text', index: 0, text: 'Final thought.' }], content: 'Found it.' })),
    ]);
    const result = await provider.complete({ ...REQUEST, tools: [tool()], maxToolCalls: 1, onEvent: (event) => events.push(event) });
    expect(bodies[1]!.messages).toContainEqual({
      role: 'assistant', content: 'Looking.',
      tool_calls: [{ id: 'call', type: 'function', function: { name: 'search_messages', arguments: '{}' } }],
      reasoning_details: [
        { type: 'reasoning.text', index: 0, id: 'thought', format: 'anthropic-claude-v1', text: 'Look up.', signature: 'signed-thought' },
        { type: 'reasoning.summary', index: 0, id: 'summary', summary: 'Search needed.' },
        { type: 'reasoning.encrypted', index: 1, id: 'encrypted', format: 'google-gemini-v1', data: 'opaque-state' },
        { type: 'reasoning.text', index: 2, id: 'next-thought', text: 'Use results.', signature: 'next-signature' },
      ],
    });
    expect(result.text).toBe('Looking.\n\nFound it.');
    expect(events.filter((event) => event.type === 'text').map((event) => event.delta).join('')).toBe(result.text);
  });

  it('replays plaintext reasoning on the assistant message without emitting it as text', async () => {
    const events: CompletionEvent[] = [];
    const { provider, bodies } = scripted([
      streamed(delta({ reasoning: 'Search ' }), delta({ reasoning: 'first.' }), callDelta('call')),
      streamed(delta({ reasoning: 'Answer now.', content: 'Found it.' })),
    ]);
    const result = await provider.complete({ ...REQUEST, tools: [tool()], maxToolCalls: 1, onEvent: (event) => events.push(event) });
    expect(bodies[1]!.messages).toContainEqual({
      role: 'assistant', content: null, reasoning: 'Search first.',
      tool_calls: [{ id: 'call', type: 'function', function: { name: 'search_messages', arguments: '{}' } }],
    });
    expect(result.text).toBe('Found it.');
    expect(events.filter((event) => event.type === 'text')).toEqual([{ type: 'text', delta: 'Found it.' }]);
  });
});
