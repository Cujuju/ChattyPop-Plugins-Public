// ChatGPT through the owner's own Codex CLI sign-in, driven over `codex app-server`.
import { tmpdir } from 'node:os';
import { MS_PER_MIN, MS_PER_S } from '@plugin-sdk/shared';
import {
  HOSTED_MAX_INPUT_CHARS,
  ProviderUnavailableError,
  resolveCli,
  type CliSpec,
  type CompletionRequest,
  type CompletionResult,
  type LlmProvider,
  type ModelOption,
  type PlanUsageWindow,
  type PriceAtApiRates,
} from '@plugin-sdk/core';
import { JsonRpcStdio } from './jsonRpcStdio';

/** The CLI it drives. */
export const CODEX_CLI: CliSpec = { bin: 'codex', npm: '@openai/codex', name: 'Codex CLI' };

const CLIENT_INFO = { name: 'chattypop', title: 'ChattyPop', version: __APP_VERSION__ };
/**
 * Codex features that add tool definitions or context to every turn; a read-only completion thread uses none.
 * Turning them off cut a one-line call from 16.4k to 12.3k input tokens (measured 2026-09-25, codex-cli 0.156.1).
 */
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

/**
 * Per-thread overrides of the user's config.toml: no plugin/MCP processes, AGENTS.md or notify hook
 * (it launches a program per turn), no optional features. Codex's core agent prompt (~12k tokens)
 * can't be switched off from app-server (#46); Settings says so.
 */
const READ_ONLY_THREAD_CONFIG = {
  mcp_servers: {},
  plugins: {},
  project_doc_max_bytes: 0,
  notify: [],
  tools: { web_search: false },
  features: Object.fromEntries(UNUSED_FEATURES.map((f) => [f, false])),
};

/** Delegates to sub-agents; completion threads turn multi_agent off, so it would only add cost. */
const HIDDEN_EFFORTS: ReadonlySet<string> = new Set(['ultra']);

interface ListedModel {
  model: string;
  displayName: string;
  hidden: boolean;
  isDefault: boolean;
  supportedReasoningEfforts: { reasoningEffort: string }[];
}

interface RateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}
interface RateLimitSnapshot {
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
}
interface Turn {
  id: string;
  status: string;
  error: { message?: string } | null;
}
interface ThreadItem {
  type: string;
  text?: string;
}
/** `inputTokens` includes cached and cache-written ones; `outputTokens` includes reasoning. */
interface TokenUsageBreakdown {
  inputTokens: number;
  cachedInputTokens: number;
  /** Absent before codex-cli reported cache writes. */
  cacheWriteInputTokens?: number;
  outputTokens: number;
}
/** Codex models are OpenAI's, listed on OpenRouter under this prefix. */
const OPENROUTER_OPENAI_PREFIX = 'openai/';

/** ChatGPT via the user's own Codex CLI login, driven through `codex app-server` (one warm process). */
export class CodexProvider implements LlmProvider {
  readonly id = 'codex' as const;
  readonly maxInputChars = HOSTED_MAX_INPUT_CHARS;
  private rpc: Promise<JsonRpcStdio> | undefined;
  /** Set by dispose (the plugin turned off): no app-server starts again. */
  private disposed = false;

  /** `price`: the host's API list-rate pricing (plan-paid calls have no bill of their own). */
  constructor(private readonly price: PriceAtApiRates) {}

  /** The warm app-server; a failed start or an exited process is dropped, so the next call starts a new one. */
  private connect(): Promise<JsonRpcStdio> {
    if (this.disposed) return Promise.reject(new ProviderUnavailableError('Codex was turned off.'));
    if (this.rpc) return this.rpc;
    const connecting = (async () => {
      const { bin, npm, name } = CODEX_CLI;
      const launch = resolveCli(bin, npm);
      if (!launch) throw new ProviderUnavailableError(`${name} is not installed or not on PATH.`);
      const rpc = new JsonRpcStdio(launch, ['app-server']);
      try {
        await rpc.request('initialize', { clientInfo: CLIENT_INFO, capabilities: null });
      } catch (err) {
        rpc.dispose();
        throw err;
      }
      rpc.notify('initialized');
      return rpc;
    })();
    const forget = (): void => {
      if (this.rpc === connecting) this.rpc = undefined;
    };
    connecting.then((rpc) => void rpc.closed.then(forget), forget);
    this.rpc = connecting;
    return connecting;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const rpc = await this.connect();
    // Ephemeral, read-only, never asks for approval; our system prompt replaces the coding-agent one.
    const { thread, model } = await rpc.request<{ thread: { id: string }; model: string }>('thread/start', {
      cwd: tmpdir(),
      sandbox: 'read-only',
      approvalPolicy: 'never',
      ephemeral: true,
      baseInstructions: req.system,
      config: READ_ONLY_THREAD_CONFIG,
      ...(req.model ? { model: req.model } : {}),
    });

    let text = '';
    let total: TokenUsageBreakdown | undefined;
    let largestPromptTokens = 0;
    let stopListening = (): void => undefined;
    const done = new Promise<Turn>((resolve) => {
      // Cumulative for this (single-turn, ephemeral) thread, so the last update is the whole call.
      const offUsage = rpc.on('thread/tokenUsage/updated', (p) => {
        const { threadId, tokenUsage } = p as { threadId: string; tokenUsage: { total: TokenUsageBreakdown; last: TokenUsageBreakdown } };
        if (threadId !== thread.id) return;
        total = tokenUsage.total;
        largestPromptTokens = Math.max(largestPromptTokens, tokenUsage.last.inputTokens);
      });
      const offItem = rpc.on('item/completed', (p) => {
        const { item, threadId } = p as { item: ThreadItem; threadId: string };
        if (threadId === thread.id && item.type === 'agentMessage' && item.text !== undefined) text = item.text;
      });
      const offDone = rpc.on('turn/completed', (p) => {
        const { turn, threadId } = p as { turn: Turn; threadId: string };
        if (threadId !== thread.id) return;
        stopListening();
        resolve(turn);
      });
      stopListening = () => {
        offItem();
        offUsage();
        offDone();
      };
    });

    let turn: Turn;
    try {
      await rpc.request('turn/start', {
        threadId: thread.id,
        input: [{ type: 'text', text: req.prompt, text_elements: [] }],
        ...(req.schema ? { outputSchema: req.schema } : {}),
        ...(req.effort ? { effort: req.effort } : {}),
      });
      // An app-server that exits mid-turn never sends turn/completed.
      turn = await Promise.race([done, rpc.closed.then((err) => Promise.reject(err))]);
    } finally {
      stopListening();
    }
    if (turn.status !== 'completed') throw new Error(`Codex turn ${turn.status}: ${turn.error?.message ?? 'no detail'}`);
    const json = req.schema ? { json: JSON.parse(text) } : {};
    if (!total) return { text, ...json };
    const usage = { inputTokens: total.inputTokens, cachedInputTokens: total.cachedInputTokens, outputTokens: total.outputTokens };
    // Plan-paid, so priced at the model's standard-tier API list rates; a priority or flex service tier bills differently.
    const apiCostUsd = await this.price(OPENROUTER_OPENAI_PREFIX + model, {
      ...usage,
      cacheWriteInputTokens: total.cacheWriteInputTokens ?? 0,
      largestPromptTokens,
    });
    return { text, usage, ...(apiCostUsd !== undefined ? { apiCostUsd } : {}), ...json };
  }

  /** Visible models from `model/list`, following pagination. */
  async listModels(): Promise<ModelOption[]> {
    const rpc = await this.connect();
    const out: ModelOption[] = [];
    for (let cursor: string | null = null; ;) {
      const page: { data: ListedModel[]; nextCursor: string | null } = await rpc.request('model/list', { cursor });
      for (const m of page.data) {
        if (m.hidden) continue;
        const efforts = m.supportedReasoningEfforts.map((e) => e.reasoningEffort).filter((e) => !HIDDEN_EFFORTS.has(e));
        out.push({ id: m.model, label: m.displayName, ...(efforts.length ? { efforts } : {}), ...(m.isDefault ? { isDefault: true } : {}) });
      }
      if (!page.nextCursor) return out;
      cursor = page.nextCursor;
    }
  }

  async planUsage(): Promise<PlanUsageWindow[] | null> {
    const rpc = await this.connect();
    const r = await rpc.request<{ rateLimits: RateLimitSnapshot }>('account/rateLimits/read', {});
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
    this.disposed = true;
    const rpc = this.rpc;
    this.rpc = undefined;
    rpc?.then(
      (r) => r.dispose(),
      () => undefined,
    );
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
