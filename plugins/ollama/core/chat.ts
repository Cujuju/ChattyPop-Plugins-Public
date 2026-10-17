import { randomUUID } from 'node:crypto';
import { answerStream, toolRunner, type CompletionRequest, type CompletionResult, type PluginFetch } from '@plugin-sdk/core';

/** Context window requested per call; Ollama's own default is too small for chat logs. */
const OLLAMA_NUM_CTX_TOKENS = 16_384;
const FINAL_ANSWER_ROUNDS = 1;

interface OllamaToolCall {
  function: { name: string; arguments: unknown };
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  images?: string[];
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}

/** One streamed piece; the last line carries the stop reason and usage. */
interface OllamaChatLine {
  message?: { content?: string; thinking?: string; tool_calls?: OllamaToolCall[] };
  error?: string;
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

/** Splits a streamed body into JSON lines. Stopping early closes the body and ends the server's work. */
export async function* jsonLines<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffered += decoder.decode(value, { stream: !done });
      const lines = buffered.split('\n');
      buffered = done ? '' : (lines.pop() ?? '');
      for (const line of lines) if (line.trim()) yield JSON.parse(line) as T;
      if (done) return;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** Absent leaves the server's own keep-alive setting. */
export const keepAliveField = (unloadAfterS: number | null): { keep_alive?: number } => (unloadAfterS === null ? {} : { keep_alive: unloadAfterS });

const toThink = (effort: string): boolean | string => (effort === 'on' ? true : effort === 'off' ? false : effort);

/** Native chat rounds; answer pieces count toward the cap, while thinking and tool calls do not. */
export async function completeOllama(net: PluginFetch, baseUrl: string, model: string, unloadAfterS: number | null, req: CompletionRequest): Promise<CompletionResult> {
  const signal = req.signal ?? new AbortController().signal;
  const onEvent: CompletionRequest['onEvent'] = req.onEvent ? (event) => {
    signal.throwIfAborted();
    req.onEvent?.(event);
    signal.throwIfAborted();
  } : undefined;
  const answer = answerStream(onEvent);
  const runner = toolRunner({ ...req, onEvent }, signal);
  const tools = req.tools?.map(({ name, description, parameters }) => ({ type: 'function', function: { name, description, parameters } }));
  const maxRounds = (tools?.length ? req.maxToolCalls ?? 0 : 0) + FINAL_ANSWER_ROUNDS;
  const messages: OllamaMessage[] = [
    { role: 'system', content: req.system },
    ...(req.history ?? []).map(({ role, text }) => ({ role, content: text })),
    { role: 'user', content: req.prompt, ...(req.images?.length ? { images: req.images.map((i) => i.data) } : {}) },
  ];
  const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  let answerTokens = 0;
  for (let round = 0; round < maxRounds; round++) {
    signal.throwIfAborted();
    const res = await net(new URL('/api/chat', baseUrl).href, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: req.signal ?? null,
      body: JSON.stringify({
        model,
        stream: true,
        options: { num_ctx: OLLAMA_NUM_CTX_TOKENS },
        ...keepAliveField(unloadAfterS),
        ...(req.effort ? { think: toThink(req.effort) } : {}),
        messages,
        ...(req.schema ? { format: req.schema } : {}),
        ...(tools?.length && !runner.spent ? { tools } : {}),
      }),
    });
    signal.throwIfAborted();
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    let content: string | undefined;
    let thought = false;
    let body: OllamaChatLine | null = null;
    const calls: OllamaToolCall[] = [];
    const invalid = (): Error => new Error(`Ollama (${model}) returned an invalid API response.`);
    if (!res.body) throw invalid();
    try {
      for await (const line of jsonLines<OllamaChatLine | null>(res.body)) {
        signal.throwIfAborted();
        body = line;
        if (typeof line?.error === 'string') throw new Error(`Ollama (${model}): ${line.error}`);
        if (line?.message?.thinking) thought = true;
        const toolCalls = line?.message?.tool_calls;
        if (tools?.length && toolCalls !== undefined) {
          if (!Array.isArray(toolCalls) || toolCalls.some((call) => typeof call?.function?.name !== 'string')) throw invalid();
          calls.push(...toolCalls);
        }
        const piece = line?.message?.content;
        if (typeof piece !== 'string') continue;
        content = (content ?? '') + piece;
        answer.push(piece);
        // Each non-empty content line approximates one answer token, as in the single-round path.
        if (piece) answerTokens++;
        if (req.maxOutputTokens && answerTokens > req.maxOutputTokens)
          throw new Error(`Ollama (${model}) reached its output token limit; the response may be incomplete (answer limit: ${req.maxOutputTokens} tokens).`);
      }
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
      throw invalid();
    }
    signal.throwIfAborted();
    const details = [
      typeof body?.done_reason === 'string' ? `stop reason: ${body.done_reason}` : 'stop reason not reported',
      ...(typeof body?.eval_count === 'number' ? [`output tokens: ${body.eval_count}`] : []),
    ].join('; ');
    const failure = (message: string): Error => new Error(`Ollama (${model}) ${message} (${details}).`);
    if (body?.done_reason === 'length') throw failure(thought && !content ? 'ran out of output while thinking and gave no answer' : 'reached its output token limit; the response may be incomplete');
    if (body?.done === false) throw failure('returned an unfinished response');
    usage.inputTokens += body?.prompt_eval_count ?? 0;
    usage.outputTokens += body?.eval_count ?? 0;
    if (calls.length) {
      messages.push({ role: 'assistant', content: content ?? '', tool_calls: calls });
      answer.endRound();
      for (const call of calls) {
        const { name, arguments: args } = call.function;
        const outcome = await runner.call(name, args, `ollama_${name}_${randomUUID()}`);
        messages.push({ role: 'tool', content: outcome.text, tool_name: name });
      }
      continue;
    }
    if (typeof content !== 'string') throw failure('returned no response text');
    const text = answer.text;
    if (!req.schema) return { text, usage };
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw failure('returned malformed JSON');
    }
    return { text, usage, json };
  }
  throw new Error(`Ollama (${model}) kept calling tools after its tool call limit.`);
}
