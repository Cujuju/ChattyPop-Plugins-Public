import {
  answerStream,
  OPENROUTER_API,
  OPENROUTER_APP_HEADERS,
  openRouterErrorText,
  type AnswerStream,
  type CompletionRequest,
  type CompletionResult,
  type OpenRouterError,
  type OpenRouterKeyEntry,
  type PluginFetch,
} from '@plugin-sdk/core';
import { sseData } from './sse';
import { requestToolRunner, toolArguments } from './toolCalls';

const FINAL_ANSWER_ROUNDS = 1;

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | object[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ChatBody {
  model: string;
  messages: ChatMessage[];
  reasoning?: { effort: string };
}

interface StreamUsage {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number };
  cost?: number;
}

interface StreamChunk {
  choices?: { delta?: {
    content?: string | null;
    tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
  } }[];
  usage?: StreamUsage | null;
  error?: OpenRouterError;
}

async function readRound(res: Response, signal: AbortSignal, answer: AnswerStream, keyLabel: string) {
  const calls = new Map<number, ToolCall>();
  let content = '';
  let usage: StreamUsage | undefined;
  for await (const data of sseData(res.body, signal)) {
    const chunk = JSON.parse(data) as StreamChunk;
    if (chunk.error) throw new Error(`OpenRouter: ${openRouterErrorText(chunk.error, res.status, keyLabel)}`);
    if (chunk.usage) usage = chunk.usage;
    const delta = chunk.choices?.[0]?.delta;
    if (delta?.content) {
      content += delta.content;
      answer.push(delta.content);
      signal.throwIfAborted();
    }
    for (const fragment of delta?.tool_calls ?? []) {
      const call = calls.get(fragment.index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
      call.id += fragment.id ?? '';
      call.function.name += fragment.function?.name ?? '';
      call.function.arguments += fragment.function?.arguments ?? '';
      calls.set(fragment.index, call);
    }
  }
  signal.throwIfAborted();
  const toolCalls = [...calls].sort(([a], [b]) => a - b).map(([, call]) => call);
  if (toolCalls.some((call) => !call.id || !call.function.name)) throw new Error('OpenRouter: incomplete streamed tool call.');
  return { content, toolCalls, usage };
}

/** Keeps one paying key and one tool budget for every round of the answer. */
export async function streamCompletion(net: PluginFetch, req: CompletionRequest, key: OpenRouterKeyEntry, body: ChatBody): Promise<CompletionResult> {
  const signal = req.signal ?? new AbortController().signal;
  const answer = answerStream((event) => {
    signal.throwIfAborted();
    req.onEvent?.(event);
    signal.throwIfAborted();
  });
  const runner = requestToolRunner(req, signal);
  const tools = req.tools?.map(({ name, description, parameters }) => ({ type: 'function', function: { name, description, parameters } }));
  const maxRounds = (req.tools ? req.maxToolCalls ?? 0 : 0) + FINAL_ANSWER_ROUNDS;
  let usage: CompletionResult['usage'];
  let apiCostUsd: number | undefined;
  for (let round = 0; round < maxRounds; round++) {
    signal.throwIfAborted();
    const res = await net(`${OPENROUTER_API}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key.key}`, 'content-type': 'application/json', ...OPENROUTER_APP_HEADERS },
      signal,
      body: JSON.stringify({
        ...body,
        stream: true,
        ...(tools && !runner.spent ? { tools, provider: { require_parameters: true } } : {}),
      }),
    });
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({})) as { error?: OpenRouterError };
      signal.throwIfAborted();
      throw new Error(`OpenRouter: ${openRouterErrorText(errorBody.error, res.status, key.label)}`);
    }
    const result = await readRound(res, signal, answer, key.label);
    const u = result.usage;
    if (u) {
      usage = {
        inputTokens: (usage?.inputTokens ?? 0) + u.prompt_tokens,
        cachedInputTokens: (usage?.cachedInputTokens ?? 0) + (u.prompt_tokens_details?.cached_tokens ?? 0),
        outputTokens: (usage?.outputTokens ?? 0) + u.completion_tokens,
      };
      if (u.cost !== undefined) apiCostUsd = (apiCostUsd ?? 0) + u.cost;
    }
    if (!result.toolCalls.length) return { text: answer.text, ...(usage ? { usage } : {}), ...(apiCostUsd !== undefined ? { apiCostUsd } : {}) };
    if (round === maxRounds - FINAL_ANSWER_ROUNDS) throw new Error('OpenRouter: tool calls continued after the final answer round.');
    body.messages.push({ role: 'assistant', content: result.content || null, tool_calls: result.toolCalls });
    for (const call of result.toolCalls) {
      const outcome = await runner.call(call.function.name, toolArguments(call.function.arguments), call.id);
      body.messages.push({ role: 'tool', tool_call_id: call.id, content: outcome.text });
    }
    answer.endRound();
  }
  throw new Error('OpenRouter: tool round limit exceeded.');
}
