// Local models through Ollama's native API, at the address the owner set (ctx.net.fetch allows its origin).
import { errorMessage } from '@plugin-sdk/shared';
import { ProviderUnavailableError, type CompletionRequest, type CompletionResult, type LlmProvider, type ModelOption, type PluginFetch } from '@plugin-sdk/core';
import { completeOllama, keepAliveField } from './chat';
export { jsonLines } from './chat';

/** Ollama model-discovery timeout. */
const LIST_TIMEOUT_MS = 2000;
/** Estimates four characters per token and reserves half the context window for system text and output. */
const OLLAMA_MAX_INPUT_CHARS = 32_000;

interface OllamaTags {
  /** size: bytes on disk. */
  models: { name: string; size: number; digest: string }[];
}

/**
 * One entry per name a request can use. Ollama 0.40+ lists a tag once per runner variant, and each variant's
 * internal manifest under `<runner>:<digest>`; those are the same model, so only its tag name is kept.
 */
function distinctModels(models: OllamaTags['models']): OllamaTags['models'] {
  const isDigestAlias = (m: OllamaTags['models'][number]): boolean => m.name.endsWith(`:${m.digest}`);
  const named = new Set(models.filter((m) => !isDigestAlias(m)).map((m) => m.digest));
  const byName = new Map<string, OllamaTags['models'][number]>();
  for (const m of models) if (!byName.has(m.name) && !(isDigestAlias(m) && named.has(m.digest))) byName.set(m.name, m);
  return [...byName.values()];
}

/** An installed model: its name and size on disk. */
export interface InstalledModel {
  name: string;
  bytes: number;
}

/** `/api/ps`: the models loaded in memory, each with the context window it was loaded with. */
interface OllamaLoaded {
  models: { name: string; context_length: number }[];
}

/** `/api/show` fields that say how a model thinks; `thinking` is absent on older servers. */
interface OllamaShow {
  capabilities?: string[];
  thinking?: { values: (boolean | string)[] };
}

/** Ollama's boolean `think` values, as effort names. */
const THINK_ON = 'on';
const THINK_OFF = 'off';
const THINKING_CAPABILITY = 'thinking';
/** `/api/show` capability of a model that reads images. */
const VISION_CAPABILITY = 'vision';
const TOOLS_CAPABILITY = 'tools';

const toEffort = (v: boolean | string): string => (v === true ? THINK_ON : v === false ? THINK_OFF : v);

/** A model's effort choices, image reading and tool support. */
async function modelTraits(net: PluginFetch, baseUrl: string, model: string): Promise<{ efforts?: string[]; images: boolean; tools: boolean }> {
  try {
    const res = await net(new URL('/api/show', baseUrl).href, {
      method: 'POST',
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    if (!res.ok) return { images: false, tools: false };
    const show = (await res.json()) as OllamaShow;
    const efforts = show.thinking?.values.map(toEffort) ?? (show.capabilities?.includes(THINKING_CAPABILITY) ? [THINK_OFF, THINK_ON] : []);
    return {
      ...(efforts.some((e) => e !== THINK_OFF) ? { efforts } : {}),
      images: show.capabilities?.includes(VISION_CAPABILITY) ?? false,
      tools: show.capabilities?.includes(TOOLS_CAPABILITY) ?? false,
    };
  } catch {
    return { images: false, tools: false };
  }
}

/** Lists installed models; throws ProviderUnavailableError when the server can't be reached. */
export async function listOllamaModels(net: PluginFetch, baseUrl: string): Promise<InstalledModel[]> {
  try {
    const res = await net(new URL('/api/tags', baseUrl).href, { signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return distinctModels(((await res.json()) as OllamaTags).models).map((m) => ({ name: m.name, bytes: m.size }));
  } catch (err) {
    throw new ProviderUnavailableError(`Ollama not reachable at ${baseUrl} (${errorMessage(err)}).`);
  }
}

/** Removes an installed model from Ollama (its files on disk). */
export async function deleteOllamaModel(net: PluginFetch, baseUrl: string, model: string): Promise<void> {
  const res = await net(new URL('/api/delete', baseUrl).href, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model }) });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
}

/** Updates loaded models' keep-alive without a prompt; zero unloads immediately. Preserves the loaded context size to avoid reloading at Ollama's default. */
export async function applyUnloadAfter(net: PluginFetch, baseUrl: string, unloadAfterS: number | null): Promise<void> {
  const res = await net(new URL('/api/ps', baseUrl).href, { signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const { models } = (await res.json()) as OllamaLoaded;
  await Promise.all(
    models.map(async (m) => {
      const r = await net(new URL('/api/generate', baseUrl).href, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: m.name, options: { num_ctx: m.context_length }, ...keepAliveField(unloadAfterS) }),
      });
      if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text()}`);
    }),
  );
}

/**
 * Local models through Ollama's native chat API (structured output via `format`), streamed: a model's thinking and its
 * answer arrive apart, so `maxOutputTokens` limits the answer alone. Ollama's own limit (`num_predict`) counts both, and
 * a thinking model can spend it all before answering.
 */
export class OllamaProvider implements LlmProvider {
  readonly id = 'ollama' as const;
  readonly maxInputChars = OLLAMA_MAX_INPUT_CHARS;

  constructor(
    /** ctx.net.fetch: reaches the owner's address only. */
    private readonly net: PluginFetch,
    private readonly baseUrl: string,
    private readonly model: string | null,
    /** How long Ollama keeps the model loaded after this request (seconds); null leaves it to Ollama. */
    private readonly unloadAfterS: number | null = null,
  ) {}

  async listModels(): Promise<ModelOption[]> {
    const installed = await listOllamaModels(this.net, this.baseUrl);
    return Promise.all(
      installed.map(async ({ name, bytes }, i) => {
        const { efforts, images, tools } = await modelTraits(this.net, this.baseUrl, name);
        // complete() falls back to the first installed model.
        return { id: name, label: name, bytes, ...(efforts ? { efforts } : {}), ...(images ? { images } : {}), ...(tools ? { tools } : {}), ...(i === 0 ? { isDefault: true } : {}) };
      }),
    );
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const model = req.model ?? this.model ?? (await listOllamaModels(this.net, this.baseUrl))[0]?.name;
    if (!model) throw new ProviderUnavailableError('No Ollama models installed.');
    return completeOllama(this.net, this.baseUrl, model, this.unloadAfterS, req);
  }
}
