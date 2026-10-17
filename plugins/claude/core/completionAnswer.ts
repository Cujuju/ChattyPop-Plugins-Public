import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { answerStream, type CompletionRequest } from '@plugin-sdk/core';

/** Streaming delivers deltas; otherwise assistant blocks supply all rounds of text. */
export function completionAnswer(onEvent: CompletionRequest['onEvent']): { accept(message: SDKMessage): void; readonly text: string } {
  const answer = answerStream(onEvent);
  let messageId: string | undefined;
  const begin = (id: string): void => {
    if (messageId !== undefined && id !== messageId) answer.endRound();
    messageId = id;
  };
  return {
    get text() { return answer.text; },
    accept(msg) {
      if (msg.type === 'stream_event' && msg.parent_tool_use_id === null && onEvent) {
        const event = msg.event;
        if (event.type === 'message_start') begin(event.message.id);
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') answer.push(event.delta.text);
        if (event.type === 'message_stop') answer.endRound();
      }
      if (msg.type !== 'assistant' || msg.parent_tool_use_id !== null) return;
      // The SDK may emit one assistant frame per content block, sharing the same message ID.
      begin(msg.message.id);
      if (!onEvent) {
        for (const block of msg.message.content) if (block.type === 'text') answer.push(block.text);
      }
      if (msg.message.stop_reason !== null) answer.endRound();
    },
  };
}
