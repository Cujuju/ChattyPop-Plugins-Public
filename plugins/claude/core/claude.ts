// Claude through the Agent SDK, using the owner's sign-in or API key.
import { accountEnv, API_KEY_ENV } from './accountEnv';
import { tmpdir } from 'node:os';
import { query, type ApiKeySource, type EffortLevel, type Options, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { MS_PER_DAY, MS_PER_HOUR } from '@plugin-sdk/shared';
import {
  HOSTED_MAX_INPUT_CHARS,
  ProviderUnavailableError,
  resolveCli,
  type CliSpec,
  type CompletionImage,
  type CompletionRequest,
  type CompletionResult,
  type LlmProvider,
  type ModelOption,
  type PlanUsageWindow,
  type ProviderAccount,
} from '@plugin-sdk/core';

/** The CLI it drives. */
export const CLAUDE_CLI: CliSpec = { bin: 'claude', npm: '@anthropic-ai/claude-code', name: 'Claude Code' };

/** Structured output may need a corrective retry turn; plain text needs one. */
const MAX_TURNS_WITH_SCHEMA = 3;
const MAX_TURNS_TEXT = 1;
const API_KEY_SOURCE: ApiKeySource = API_KEY_ENV;
/** supportedModels() row that stands for Claude Code's own default model. */
const DEFAULT_MODEL_VALUE = 'default';
/** Lengths of the plan windows the SDK names five_hour and seven_day. */
const FIVE_HOURS_MS = 5 * MS_PER_HOUR;
const SEVEN_DAYS_MS = 7 * MS_PER_DAY;

/** Image types the Messages API reads. */
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type ImageMediaType = (typeof IMAGE_TYPES)[number];
const isImageType = (t: string): t is ImageMediaType => (IMAGE_TYPES as readonly string[]).includes(t);

/** Streams text and images as one SDK user message. Rejects unsupported input types. */
function withImages(prompt: string, images: readonly CompletionImage[]): AsyncIterable<SDKUserMessage> {
  const blocks = images.map((i) => {
    if (!isImageType(i.mediaType)) throw new Error(`Claude can't read ${i.mediaType} images.`);
    return { type: 'image' as const, source: { type: 'base64' as const, media_type: i.mediaType, data: i.data } };
  });
  const turn: SDKUserMessage = { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [...blocks, { type: 'text', text: prompt }] } };
  return (async function* () {
    yield turn;
  })();
}

/** Claude via the user's Claude Code install; an owner API key enters only the child environment. */
export class ClaudeProvider implements LlmProvider {
  get id(): string { return this.account.id; }
  private readonly queries = new Set<ReturnType<typeof query>>();
  readonly maxInputChars = HOSTED_MAX_INPUT_CHARS;

  constructor(private readonly account: ProviderAccount) {}

  private baseOptions(key = this.account.auth === 'apiKey' ? this.account.apiKey() : null): Options {
    const { bin, npm, name } = CLAUDE_CLI;
    const launch = resolveCli(bin, npm);
    if (!launch) throw new ProviderUnavailableError(`${name} is not installed or not on PATH.`);
    return {
      pathToClaudeCodeExecutable: launch.args[0] ?? launch.command,
      // Isolation: no tools, no user/project settings, CLAUDE.md, hooks or skills, no saved transcript.
      tools: [],
      settingSources: [],
      // Disables user MCP servers to omit their tool definitions from completion calls.
      mcpServers: {},
      strictMcpConfig: true,
      persistSession: false,
      permissionMode: 'dontAsk',
      cwd: tmpdir(),
      env: accountEnv(this.account, key),
    };
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const key = this.account.auth === 'apiKey' ? this.account.apiKey() : null;
    let verifiedKeySource = key === null;
    const prompt = req.images?.length ? withImages(req.prompt, req.images) : req.prompt;
    const abortController = new AbortController();
    req.signal?.addEventListener('abort', () => abortController.abort(), { once: true });
    const q = query({
      prompt,
      options: {
        ...this.baseOptions(key),
        systemPrompt: req.system,
        maxTurns: req.schema ? MAX_TURNS_WITH_SCHEMA : MAX_TURNS_TEXT,
        abortController,
        ...(req.model ? { model: req.model } : {}),
        // Levels come from the model's supportedEffortLevels (listModels).
        ...(req.effort ? { effort: req.effort as EffortLevel } : {}),
        ...(req.schema ? { outputFormat: { type: 'json_schema', schema: req.schema } } : {}),
      },
    });
    this.queries.add(q);
    try {
      for await (const msg of q) {
        if (key && msg.type === 'system' && msg.subtype === 'init') {
          if (msg.apiKeySource !== API_KEY_SOURCE) throw new Error('Claude did not select your API key. The request was stopped.');
          verifiedKeySource = true;
        }
        if (msg.type !== 'result') continue;
        if (!verifiedKeySource) throw new Error('Claude did not confirm your API key. The request was stopped.');
        if (msg.subtype !== 'success') throw new Error(`Claude run failed: ${msg.subtype}`);
        // Anthropic reports cache reads/writes apart from input_tokens; all three are prompt tokens.
        const u = msg.usage;
        const usage = {
          inputTokens: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
          cachedInputTokens: u.cache_read_input_tokens ?? 0,
          outputTokens: u.output_tokens,
        };
        // Priced by Claude Code at API list rates, cache writes and reads included, whatever the plan.
        return { text: msg.result, usage, apiCostUsd: msg.total_cost_usd, ...(req.schema ? { json: msg.structured_output } : {}) };
      }
      throw new Error('Claude run ended without a result.');
    } catch (err) {
      // Rewritten only when it echoes the key, so an abort keeps its own error.
      if (key && err instanceof Error && err.message.includes(key)) throw new Error(err.message.replaceAll(key, '[API key]'));
      throw err;
    } finally {
      this.queries.delete(q);
      q.close();
    }
  }

  /** Opens a session that never sends a prompt: the SDK exposes usage and models only on a live query. */
  private idleQuery(): ReturnType<typeof query> {
    const idle: AsyncIterable<SDKUserMessage> = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) };
    const q = query({ prompt: idle, options: this.baseOptions() });
    this.queries.add(q);
    return q;
  }

  async listModels(): Promise<ModelOption[]> {
    const q = this.idleQuery();
    try {
      return (await q.supportedModels()).map((m) => ({
        id: m.value,
        label: m.displayName,
        ...(m.supportedEffortLevels?.length ? { efforts: m.supportedEffortLevels } : {}),
        // supportedModels omits input types; this adapter advertises image support for every returned model.
        images: true,
        ...(m.value === DEFAULT_MODEL_VALUE ? { isDefault: true } : {}),
      }));
    } finally {
      this.queries.delete(q);
      q.close();
    }
  }

  async planUsage(): Promise<PlanUsageWindow[] | null> {
    if (this.account.auth === 'apiKey') return null;
    const q = this.idleQuery();
    try {
      const u = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
      if (!u.rate_limits_available || !u.rate_limits) return null;
      const windows: PlanUsageWindow[] = [];
      const push = (id: string, label: string, durationMs: number, w: { utilization: number | null; resets_at: string | null } | null | undefined): void => {
        if (w) windows.push({ id, label, usedPercent: w.utilization, resetsAt: w.resets_at, durationMs });
      };
      push('five_hour', '5h', FIVE_HOURS_MS, u.rate_limits.five_hour);
      push('seven_day', 'Weekly', SEVEN_DAYS_MS, u.rate_limits.seven_day);
      return windows;
    } finally {
      this.queries.delete(q);
      q.close();
    }
  }
  dispose(): void { for (const q of this.queries) q.close(); this.queries.clear(); }

}
