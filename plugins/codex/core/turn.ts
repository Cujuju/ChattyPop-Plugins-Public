import { answerStream, historyTranscript, toolRunner, type CompletionImage, type CompletionRequest } from '@plugin-sdk/core';
import type { CodexConnection } from './connection';
import { handleToolCalls } from './toolCalls';

interface Turn { id: string; status: string; error: { message?: string } | null }
interface ThreadItem { id: string; type: string; text?: string }
/** Input includes cached tokens; output includes reasoning. Totals include every round in the ephemeral thread. */
interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens?: number;
  outputTokens: number;
}
type Connection = Awaited<ReturnType<CodexConnection['connect']>>;
const dataUrl = (image: CompletionImage): string => `data:${image.mediaType};base64,${image.data}`;
const TOOL_CANCELLED = 'The completion ended before this tool call finished.';

export async function completeTurn(owner: CodexConnection, connection: Connection, threadId: string, req: CompletionRequest): Promise<{
  text: string; total?: TokenUsage; largestPromptTokens: number;
}> {
  const lifetime = new AbortController();
  const signal = req.signal ? AbortSignal.any([req.signal, lifetime.signal]) : lifetime.signal;
  signal.throwIfAborted();
  const done = Promise.withResolvers<Turn>();
  let active = true;
  const emit: CompletionRequest['onEvent'] = (event) => {
    if (!active || signal.aborted) return;
    owner.assertCurrent(connection);
    req.onEvent?.(event);
  };
  const answer = answerStream(emit);
  const joined = !req.schema && (req.history !== undefined || req.tools !== undefined || req.onEvent !== undefined);
  const streamed = new Set<string>();
  let text = '';
  let total: TokenUsage | undefined;
  let largestPromptTokens = 0;
  let turnId: string | undefined;
  let interrupted = false;
  let completed = false;
  const interrupt = (): void => {
    if (!turnId || interrupted || completed) return;
    interrupted = true;
    void owner.request(connection, 'turn/interrupt', { threadId, turnId }).catch(() => undefined);
  };
  const abort = (): void => { interrupt(); done.reject(signal.reason); };
  const stops: (() => void)[] = [];
  const on = (method: string, handler: (params: unknown) => void): void => {
    stops.push(connection.rpc.on(method, (params) => {
      if (!active || signal.aborted) return;
      try { owner.assertCurrent(connection); handler(params); }
      catch (error) { done.reject(owner.error(connection, error)); }
    }));
  };
  on('turn/started', (params) => {
    const value = params as { threadId: string; turn: Turn };
    if (value.threadId === threadId) turnId = value.turn.id;
  });
  on('thread/tokenUsage/updated', (params) => {
    const value = params as { threadId: string; tokenUsage: { total: TokenUsage; last: TokenUsage } };
    if (value.threadId !== threadId) return;
    total = value.tokenUsage.total;
    largestPromptTokens = Math.max(largestPromptTokens, value.tokenUsage.last.inputTokens);
  });
  if (joined && req.onEvent) on('item/agentMessage/delta', (params) => {
    const value = params as { threadId: string; itemId: string; delta: string };
    if (value.threadId !== threadId || !value.delta) return;
    streamed.add(value.itemId);
    answer.push(value.delta);
  });
  on('item/completed', (params) => {
    const value = params as { threadId: string; item: ThreadItem };
    if (value.threadId !== threadId || value.item.type !== 'agentMessage' || value.item.text === undefined) return;
    text = value.item.text;
    if (!joined) return;
    if (!streamed.delete(value.item.id)) answer.push(text);
    answer.endRound();
  });
  on('turn/completed', (params) => {
    const value = params as { threadId: string; turn: Turn };
    if (value.threadId !== threadId) return;
    completed = true;
    active = false;
    done.resolve(value.turn);
  });
  if (req.tools) {
    const runner = toolRunner({ ...req, onEvent: emit }, signal);
    stops.push(handleToolCalls(connection.rpc, threadId, async (call) => {
      turnId ??= call.turnId;
      try {
        owner.assertCurrent(connection);
        signal.throwIfAborted();
        const outcome = await runner.call(call.tool, call.arguments, call.callId);
        owner.assertCurrent(connection);
        signal.throwIfAborted();
        return outcome;
      } catch (error) {
        return { ok: false, text: signal.aborted ? TOOL_CANCELLED : owner.error(connection, error).message };
      }
    }));
  }
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    const start = owner.request<{ turn?: Turn } | undefined>(connection, 'turn/start', {
      threadId,
      input: [...(req.images ?? []).map((image) => ({ type: 'image', url: dataUrl(image) })),
        { type: 'text', text: historyTranscript(req.history, req.prompt), text_elements: [] }],
      ...(req.schema ? { outputSchema: req.schema } : {}),
      ...(req.effort ? { effort: req.effort } : {}),
    }).then((result) => {
      turnId ??= result?.turn?.id;
      if (signal.aborted) interrupt();
      owner.assertCurrent(connection);
    });
    const [, turn] = await Promise.race([
      Promise.all([start, done.promise]),
      owner.closed(connection).then((error) => Promise.reject(error)),
    ]);
    owner.assertCurrent(connection);
    signal.throwIfAborted();
    if (turn.status !== 'completed') throw owner.error(connection, new Error(`Codex turn ${turn.status}: ${turn.error?.message ?? 'no detail'}`));
    return { text: joined ? answer.text : text, total, largestPromptTokens };
  } finally {
    active = false;
    interrupt();
    signal.removeEventListener('abort', abort);
    lifetime.abort();
    stops.forEach((off) => off());
  }
}
