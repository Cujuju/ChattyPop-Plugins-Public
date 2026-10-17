import { describe, expect, it } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { CompletionEvent } from '@plugin-sdk/core';
import { ROUND_SEPARATOR } from '@plugin-sdk/core';
import { completionAnswer } from '../core/completionAnswer';

const partial = (event: unknown, parent: string | null = null): SDKMessage => ({ type: 'stream_event', event, parent_tool_use_id: parent }) as SDKMessage;
const delta = (text: string, parent: string | null = null): SDKMessage => partial({ type: 'content_block_delta', delta: { type: 'text_delta', text } }, parent);
const assistant = (id: string, text: string, parent: string | null = null): SDKMessage => ({
  type: 'assistant', parent_tool_use_id: parent, message: { id, content: [{ type: 'text', text }], stop_reason: null },
}) as SDKMessage;
const joinedText = (events: CompletionEvent[]): string => events.flatMap((e) => e.type === 'text' ? [e.delta] : []).join('');

describe('Claude answer rounds', () => {
  it('joins top-level text deltas exactly, without duplicating completed blocks or separating blocks in one message', () => {
    const events: CompletionEvent[] = [];
    const answer = completionAnswer((e) => events.push(e));
    const messages = [
      partial({ type: 'message_start', message: { id: 'first' } }),
      delta('Look'), assistant('first', 'Look'),
      partial({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hidden' } }),
      delta(' here.'), assistant('first', ' here.'),
      partial({ type: 'message_stop' }),
      partial({ type: 'message_start', message: { id: 'empty-tool-round' } }),
      partial({ type: 'message_stop' }),
      delta('subagent', 'child'), assistant('child', 'subagent', 'child'),
      partial({ type: 'message_stop' }, 'child'),
      partial({ type: 'message_start', message: { id: 'final' } }),
      delta('Found '), delta('it.'), assistant('final', 'Found it.'),
      partial({ type: 'message_stop' }),
    ];
    messages.forEach((m) => answer.accept(m));
    expect(answer.text).toBe(`Look here.${ROUND_SEPARATOR}Found it.`);
    expect(joinedText(events)).toBe(answer.text);
    expect(events).toEqual([
      { type: 'text', delta: 'Look' }, { type: 'text', delta: ' here.' },
      { type: 'text', delta: ROUND_SEPARATOR },
      { type: 'text', delta: 'Found ' }, { type: 'text', delta: 'it.' },
    ]);
  });

  it('uses message IDs as boundaries even without a stream message_stop', () => {
    const events: CompletionEvent[] = [];
    const answer = completionAnswer((e) => events.push(e));
    [
      partial({ type: 'message_start', message: { id: 'one' } }), delta('first'), assistant('one', 'first'),
      partial({ type: 'message_start', message: { id: 'two' } }), delta('second'), assistant('two', 'second'),
    ].forEach((m) => answer.accept(m));
    expect(answer.text).toBe(`first${ROUND_SEPARATOR}second`);
    expect(joinedText(events)).toBe(answer.text);
  });

  it('collects assistant blocks without streaming and ignores non-text and subagent content', () => {
    const answer = completionAnswer(undefined);
    [
      assistant('one', 'Before'), assistant('one', ' tools'),
      { type: 'assistant', parent_tool_use_id: null, message: { id: 'one', stop_reason: null, content: [{ type: 'tool_use', id: 'lookup', name: 'lookup', input: {} }] } } as SDKMessage,
      assistant('child', 'hidden', 'lookup'),
      assistant('empty', ''), assistant('two', 'After tools'),
    ].forEach((m) => answer.accept(m));
    expect(answer.text).toBe(`Before tools${ROUND_SEPARATOR}After tools`);
  });
});
