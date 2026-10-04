// Claude through the Agent SDK, driving the owner's own Claude Code install and sign-in.
import { tmpdir } from 'node:os';
import { query, type EffortLevel, type Options, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
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
} from '@plugin-sdk/core';

/** The CLI it drives. */
export const CLAUDE_CLI: CliSpec = { bin: 'claude', npm: '@anthropic-ai/claude-code', name: 'Claude Code' };

/** Structured output may need a corrective retry turn; plain text needs one. */
const MAX_TURNS_WITH_SCHEMA = 3;
const MAX_TURNS_TEXT = 1;
const CLIENT_APP_ID = 'chattypop/0.1';
/** supportedModels() row that stands for Claude Code's own default model. */
const DEFAULT_MODEL_VALUE = 'default';
/** Lengths of the plan windows the SDK names five_hour and seven_day. */
const FIVE_HOURS_MS = 5 * MS_PER_HOUR;
const SEVEN_DAYS_MS = 7 * MS_PER_DAY;

/** Image types the Messages API reads. */
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type ImageMediaType = (typeof IMAGE_TYPES)[number];
const isImageType = (t: string): t is ImageMediaType => (IMAGE_TYPES as readonly string[]).includes(t);

/** The prompt and its images as one user turn: the SDK takes content blocks only as a streamed message. Throws on a type it can't read. */
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

/** Claude via the user's own Claude Code install and login (Agent SDK). ChattyPop never touches credentials. */
export class ClaudeProvider implements LlmProvider {
  readonly id = 'claude' as const;
  readonly maxInputChars = HOSTED_MAX_INPUT_CHARS;

  private baseOptions(): Options {
    const { bin, npm, name } = CLAUDE_CLI;
    const launch = resolveCli(bin, npm);
    if (!launch) throw new ProviderUnavailableError(`${name} is not installed or not on PATH.`);
    return {
      pathToClaudeCodeExecutable: launch.args[0] ?? launch.command,
      // Isolation: no tools, no user/project settings, CLAUDE.md, hooks or skills, no saved transcript.
      tools: [],
      settingSources: [],
      // The user's own MCP servers would otherwise load, and their tool definitions ride along on every call.
      mcpServers: {},
      strictMcpConfig: true,
      persistSession: false,
      permissionMode: 'dontAsk',
      cwd: tmpdir(),
      env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: CLIENT_APP_ID },
    };
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const prompt = req.images?.length ? withImages(req.prompt, req.images) : req.prompt;
    const abortController = new AbortController();
    req.signal?.addEventListener('abort', () => abortController.abort(), { once: true });
    const q = query({
      prompt,
      options: {
        ...this.baseOptions(),
        systemPrompt: req.system,
        maxTurns: req.schema ? MAX_TURNS_WITH_SCHEMA : MAX_TURNS_TEXT,
        abortController,
        ...(req.model ? { model: req.model } : {}),
        // Levels come from the model's supportedEffortLevels (listModels).
        ...(req.effort ? { effort: req.effort as EffortLevel } : {}),
        ...(req.schema ? { outputFormat: { type: 'json_schema', schema: req.schema } } : {}),
      },
    });
    for await (const msg of q) {
      if (msg.type !== 'result') continue;
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
  }

  /** Opens a session that never sends a prompt: the SDK exposes usage and models only on a live query. */
  private idleQuery(): ReturnType<typeof query> {
    const idle: AsyncIterable<SDKUserMessage> = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) };
    return query({ prompt: idle, options: this.baseOptions() });
  }

  async listModels(): Promise<ModelOption[]> {
    const q = this.idleQuery();
    try {
      return (await q.supportedModels()).map((m) => ({
        id: m.value,
        label: m.displayName,
        ...(m.supportedEffortLevels?.length ? { efforts: m.supportedEffortLevels } : {}),
        // supportedModels() reports no input types. Assumption: every model Claude Code offers reads images.
        images: true,
        ...(m.value === DEFAULT_MODEL_VALUE ? { isDefault: true } : {}),
      }));
    } finally {
      q.close();
    }
  }

  async planUsage(): Promise<PlanUsageWindow[] | null> {
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
      q.close();
    }
  }
}
