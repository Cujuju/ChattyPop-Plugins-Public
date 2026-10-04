// Any OpenRouter model through its OpenAI-compatible API, paid by the host's stored key that lists it.
import {
  HOSTED_MAX_INPUT_CHARS,
  OPENROUTER_API,
  OPENROUTER_APP_HEADERS,
  ProviderUnavailableError,
  openRouterErrorText,
  type CompletionRequest,
  type CompletionResult,
  type LlmProvider,
  type ModelOption,
  type OpenRouterError,
  type OpenRouterKeyEntry,
  type OpenRouterKeyReader,
  type PlanUsageWindow,
  type PluginFetch,
} from '@plugin-sdk/core';

/** Public catalogue; no key needed to list models. */
const LIST_TIMEOUT_MS = 5000;
/** OpenRouter picks a model when the user hasn't chosen one. */
export const DEFAULT_MODEL = 'openrouter/auto';
const PERCENT = 100;
/** Structured completions require schema output; models without this parameter can't return it. */
const STRUCTURED_OUTPUTS = 'structured_outputs';
/** Every `reasoning.effort` OpenRouter accepts; a model whose `supported_efforts` is null takes them all. */
const GATEWAY_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

interface ListedModel {
  id: string;
  name: string;
  supported_parameters?: string[];
  /** Absent when the model doesn't reason. */
  reasoning?: { supported_efforts?: string[] | null };
  architecture?: { input_modalities?: string[] };
}
/** A model's input type for images (architecture.input_modalities). */
const IMAGE_INPUT = 'image';

/** The user turn: text alone, or the images first as data URLs, then the text. */
const userContent = (req: CompletionRequest): string | object[] =>
  req.images?.length
    ? [...req.images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mediaType};base64,${i.data}` } })), { type: 'text', text: req.prompt }]
    : req.prompt;

const effortsOf = (m: ListedModel): string[] | undefined => (m.reasoning ? (m.reasoning.supported_efforts ?? GATEWAY_EFFORTS) : undefined);

/** Every model OpenRouter lists. */
async function openRouterCatalogue(net: PluginFetch): Promise<ListedModel[]> {
  const res = await net(`${OPENROUTER_API}/models`, { signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`OpenRouter models: HTTP ${res.status}`);
  return ((await res.json()) as { data: ListedModel[] }).data;
}

/** Models that can return schema output, Auto first. */
export async function listOpenRouterModels(net: PluginFetch): Promise<ModelOption[]> {
  const models = (await openRouterCatalogue(net))
    .filter((m) => m.id !== DEFAULT_MODEL && m.supported_parameters?.includes(STRUCTURED_OUTPUTS))
    .map((m): ModelOption => {
      const efforts = effortsOf(m);
      return { id: m.id, label: m.name, ...(efforts?.length ? { efforts } : {}), ...(m.architecture?.input_modalities?.includes(IMAGE_INPUT) ? { images: true } : {}) };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  return [{ id: DEFAULT_MODEL, label: 'Auto (OpenRouter chooses)', isDefault: true }, ...models];
}

interface ChatResponse {
  choices: { message: { content: string } }[];
  /** `cost`: what the call was charged, in USD (credits). */
  usage?: { prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens?: number }; cost?: number };
  error?: OpenRouterError;
}

/** Any OpenRouter model through its OpenAI-compatible API, paid by the stored key that covers the model. */
export class OpenRouterProvider implements LlmProvider {
  readonly id = 'openrouter' as const;
  readonly maxInputChars = HOSTED_MAX_INPUT_CHARS;

  constructor(
    /** ctx.net.fetch: openrouter.ai only. */
    private readonly net: PluginFetch,
    /** The host's keys: the one that pays for a model, and its cap and spend. */
    private readonly keys: Pick<OpenRouterKeyReader, 'forModel' | 'balance'>,
    /** Settings → AI's model; a request's own model (a command's pick) wins. */
    private readonly model: string,
  ) {}

  /** The key that pays for `model`; throws naming the model when none does. */
  private keyFor(model: string): OpenRouterKeyEntry {
    const key = this.keys.forModel(model);
    if (!key) throw new ProviderUnavailableError(`No OpenRouter key pays for ${model}. Add it to a key in Settings.`);
    return key;
  }

  listModels(): Promise<ModelOption[]> {
    return listOpenRouterModels(this.net);
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const model = req.model ?? this.model;
    const key = this.keyFor(model);
    const res = await this.net(`${OPENROUTER_API}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key.key}`, 'content-type': 'application/json', ...OPENROUTER_APP_HEADERS },
      signal: req.signal ?? null,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: userContent(req) },
        ],
        // require_parameters: route only to hosts that honor response_format, else a host may ignore it and return prose.
        ...(req.effort ? { reasoning: { effort: req.effort } } : {}),
        ...(req.schema
          ? { response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: req.schema } }, provider: { require_parameters: true } }
          : {}),
      }),
    });
    // A non-JSON error page (an HTML 502, say) still reports its status.
    const body = (await res.json().catch(() => ({}))) as Partial<ChatResponse>;
    if (!res.ok || body.error || !body.choices) throw new Error(`OpenRouter: ${openRouterErrorText(body.error, res.status, key.label)}`);
    const text = body.choices[0]?.message.content ?? '';
    const u = body.usage;
    const usage = u ? { inputTokens: u.prompt_tokens, cachedInputTokens: u.prompt_tokens_details?.cached_tokens ?? 0, outputTokens: u.completion_tokens } : undefined;
    const apiCostUsd = u?.cost;
    return { text, ...(usage ? { usage } : {}), ...(apiCostUsd !== undefined ? { apiCostUsd } : {}), ...(req.schema ? { json: JSON.parse(text) } : {}) };
  }

  /** The paying key's own cap as one meter (account credits need a management key, which ChattyPop doesn't hold). */
  async planUsage(): Promise<PlanUsageWindow[] | null> {
    const key = this.keys.forModel(this.model);
    if (!key) return null;
    const b = await this.keys.balance(key);
    const used = b.limitUsd !== null && b.remainingUsd !== null ? b.limitUsd - b.remainingUsd : null;
    return [
      {
        id: 'key',
        label: `Key ${key.label}`,
        usedPercent: used !== null && b.limitUsd ? (used / b.limitUsd) * PERCENT : null,
        resetsAt: null,
        durationMs: null,
        note: b.remainingUsd !== null ? `$${b.remainingUsd.toFixed(2)} left${b.limitReset ? ` (resets ${b.limitReset})` : ''}` : `$${b.usageMonthlyUsd.toFixed(2)} this month, no cap`,
      },
    ];
  }
}
