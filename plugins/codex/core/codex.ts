// ChatGPT sign-in or an owner OpenAI API key, driven over `codex app-server`.
import { tmpdir } from 'node:os';
import { MS_PER_MIN, MS_PER_S } from '@plugin-sdk/shared';
import {
  HOSTED_MAX_INPUT_CHARS,
  type CliSpec,
  type CompletionRequest,
  type CompletionResult,
  type LlmProvider,
  type ModelOption,
  type PlanUsageWindow,
  type PriceAtApiRates,
  type ProviderAccount,
} from '@plugin-sdk/core';
import { API_KEY_PROVIDER, CodexConnection } from './connection';
import { completeTurn } from './turn';

/** The CLI it drives. */
export const CODEX_CLI: CliSpec = { bin: 'codex', npm: '@openai/codex', name: 'Codex CLI' };

const CLIENT_INFO = { name: 'chattypop', title: 'ChattyPop', version: __APP_VERSION__ };
/** Optional Codex features disabled for completion threads to reduce per-turn context and tool definitions. */
const UNUSED_FEATURES = [
  'apps',
  'browser_use',
  'browser_use_external',
  'browser_use_full_cdp_access',
  'computer_use',
  'image_generation',
  'goals',
  'hooks',
  'multi_agent',
  'plugins',
  'shell_tool',
  'sleep_tool',
  'skill_search',
  'tool_suggest',
  'unified_exec',
  'view_image',
  'code_mode_host',
  'workspace_dependencies',
  'worktrees',
  'in_app_browser',
  'in_app_chat',
  'in_app_local_automation',
  'realtime_conversation',
  'mentions_v2',
  'memories',
  'shell_snapshot',
  'skill_mcp_dependency_install',
  'tool_call_mcp_elicitation',
  'plugin_sharing',
  'remote_plugin',
];

/** Thread overrides disable plugins, MCP processes, AGENTS.md, notify hooks, and optional features. The app-server core prompt remains (#46). */
const READ_ONLY_THREAD_CONFIG = {
  mcp_servers: {},
  plugins: {},
  project_doc_max_bytes: 0,
  notify: [],
  tools: { web_search: false },
  features: Object.fromEntries(UNUSED_FEATURES.map((f) => [f, false])),
};

/** Disabled multi_agent feature adds unused completion-thread context. */
const HIDDEN_EFFORTS: ReadonlySet<string> = new Set(['ultra']);

interface ListedModel {
  model: string;
  displayName: string;
  hidden: boolean;
  isDefault: boolean;
  supportedReasoningEfforts: { reasoningEffort: string }[];
  /** What it reads ("text", "image", "audio"); absent before codex-cli reported it. */
  inputModalities?: string[];
}
/** A model's input type for images (model/list inputModalities). */
const IMAGE_INPUT = 'image';

interface RateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}
interface RateLimitSnapshot {
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
}
/** Codex models are OpenAI's, listed on OpenRouter under this prefix. */
const OPENROUTER_OPENAI_PREFIX = 'openai/';

/** ChatGPT via Codex sign-in or an owner API key, using one warm app-server per payment key. */
export class CodexProvider implements LlmProvider {
  get id(): string { return this.account.id; }
  readonly maxInputChars = HOSTED_MAX_INPUT_CHARS;
  readonly connection: CodexConnection;

  constructor(private readonly price: PriceAtApiRates, private readonly account: ProviderAccount) {
    this.connection = new CodexConnection(CODEX_CLI, CLIENT_INFO, account);
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    req.signal?.throwIfAborted();
    const connection = await this.connection.connect();
    this.connection.assertCurrent(connection);
    req.signal?.throwIfAborted();
    // Ephemeral, read-only, never asks for approval; our system prompt replaces the coding-agent one.
    const { thread, model, modelProvider } = await this.connection.request<{ thread: { id: string }; model: string; modelProvider: string }>(connection, 'thread/start', {
      cwd: tmpdir(),
      sandbox: 'read-only',
      approvalPolicy: 'never',
      ephemeral: true,
      baseInstructions: req.system,
      config: READ_ONLY_THREAD_CONFIG,
      ...(req.model ? { model: req.model } : {}),
      ...(req.tools ? { dynamicTools: req.tools.map((tool) => ({
        type: 'function', name: tool.name, description: tool.description, inputSchema: tool.parameters,
      })) } : {}),
    });

    this.connection.assertCurrent(connection);
    if (connection.key && modelProvider !== API_KEY_PROVIDER) throw new Error('Codex did not select your API key provider. The request was stopped.');
    const { text, total, largestPromptTokens } = await completeTurn(this.connection, connection, thread.id, req);
    this.connection.assertCurrent(connection);
    req.signal?.throwIfAborted();
    const json = req.schema ? { json: JSON.parse(text) } : {};
    if (!total) return { text, ...json };
    const usage = { inputTokens: total.inputTokens, cachedInputTokens: total.cachedInputTokens, outputTokens: total.outputTokens };
    // Costs use the model's standard-tier API list rates; priority and flex tiers bill differently.
    const apiCostUsd = await this.price(OPENROUTER_OPENAI_PREFIX + model, {
      ...usage,
      cacheWriteInputTokens: total.cacheWriteInputTokens ?? 0,
      largestPromptTokens,
    });
    this.connection.assertCurrent(connection);
    req.signal?.throwIfAborted();
    return { text, usage, ...(apiCostUsd !== undefined ? { apiCostUsd } : {}), ...json };
  }

  /** Visible models from `model/list`, following pagination. */
  async listModels(): Promise<ModelOption[]> {
    const connection = await this.connection.connect();
    this.connection.assertCurrent(connection);
    const out: ModelOption[] = [];
    for (let cursor: string | null = null; ;) {
      const page: { data: ListedModel[]; nextCursor: string | null } = await this.connection.request(connection, 'model/list', { cursor });
      for (const m of page.data) {
        if (m.hidden) continue;
        const efforts = m.supportedReasoningEfforts.map((e) => e.reasoningEffort).filter((e) => !HIDDEN_EFFORTS.has(e));
        out.push({
          id: m.model,
          label: m.displayName,
          tools: true,
          ...(efforts.length ? { efforts } : {}),
          ...(m.isDefault ? { isDefault: true } : {}),
          ...(m.inputModalities?.includes(IMAGE_INPUT) ? { images: true } : {}),
        });
      }
      if (!page.nextCursor) return out;
      cursor = page.nextCursor;
    }
  }

  async planUsage(): Promise<PlanUsageWindow[] | null> {
    if (this.account.auth === 'apiKey') return null;
    const connection = await this.connection.connect();
    this.connection.assertCurrent(connection);
    if (connection.key) return null;
    const r = await this.connection.request<{ rateLimits: RateLimitSnapshot }>(connection, 'account/rateLimits/read', {});
    const windows: PlanUsageWindow[] = [];
    const push = (id: string, fallbackLabel: string, w: RateLimitWindow | null): void => {
      if (!w) return;
      windows.push({
        id,
        label: w.windowDurationMins ? labelForMinutes(w.windowDurationMins) : fallbackLabel,
        usedPercent: w.usedPercent,
        resetsAt: w.resetsAt ? new Date(w.resetsAt * MS_PER_S).toISOString() : null,
        durationMs: w.windowDurationMins ? w.windowDurationMins * MS_PER_MIN : null,
      });
    };
    push('primary', '5h', r.rateLimits.primary);
    push('secondary', 'Weekly', r.rateLimits.secondary);
    return windows.length ? windows : null;
  }

  /** Stops the app-server, including one still starting; a start that fails is its caller's to report. */
  dispose(): void {
    this.connection.dispose();
  }
}

const MINS_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;
/** Short window names, matching Claude's: 5h, Weekly, else Nh / Nd. */
const labelForMinutes = (m: number): string => {
  const days = m / (MINS_PER_HOUR * HOURS_PER_DAY);
  if (days === DAYS_PER_WEEK) return 'Weekly';
  return Number.isInteger(days) ? `${days}d` : `${Math.round(m / MINS_PER_HOUR)}h`;
};
