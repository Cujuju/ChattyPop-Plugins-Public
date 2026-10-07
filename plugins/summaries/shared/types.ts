// Summary results, citations, requests and progress.
import type { AppUsage, ProviderId, TokenUsage } from '@plugin-sdk/shared';
import type { SummaryGrouping, SummaryTrigger } from './settings';

export interface Citation {
  messageId: string;
  channelId: string;
  channelName: string;
  ts: number;
}

/** Jev's verdict on whether a bullet's cited messages back it up. */
export interface CitationCheck {
  /** `uncited`: the bullet cites no message, so there was nothing to check. */
  verdict: 'supported' | 'contradicted' | 'unsupported' | 'uncited';
  /** Jev's confidence in the verdict, 0–1; null for `uncited`. */
  confidence: number | null;
}

/** Flag a bullet only at this confidence or above (the starting cut-off in TypeSafe's citation-check cookbook). */
export const CITATION_FLAG_CONFIDENCE = 0.8;

/** #59: a theme the summary named, with the messages Jev sorted under it (oldest first). */
export interface SummaryTheme {
  title: string;
  citations: Citation[];
}

/** A stretch of a point about one thread (one exchange, or the same people on one sub-topic), with the messages it covers. */
export interface SummaryPart {
  text: string;
  citations: Citation[];
}

export interface SummaryItem {
  /** In reading order, each citing its own messages, so sources sit next to what they back. */
  parts: SummaryPart[];
  /** Absent when the check was off or failed. */
  check?: CitationCheck;
}

/** A point's citations in part order, each message once. */
export const pointCitations = (i: SummaryItem): Citation[] => [...new Map(i.parts.flatMap((p) => p.citations).map((c) => [c.messageId, c])).values()];


export interface Summary {
  id: number;
  createdAt: number;
  provider: ProviderId;
  model: string | null;
  sinceTs: number;
  untilTs: number;
  channelIds: string[];
  /** What the run was asked to read; null when it read everything. */
  scope: SummaryScope | null;
  /** Messages the LLM read. */
  messageCount: number;
  /** Messages in range that Jev judged filler and left out. */
  skippedCount: number;
  durationMs: number;
  headline: string;
  items: SummaryItem[];
  /** "For you": what the run found needs the reader (questions, requests, deadlines); empty when none or not asked. */
  actions: SummaryItem[];
  /** How the points are grouped; `channel` runs list each channel's points together. */
  grouping: SummaryGrouping;
  trigger: SummaryTrigger;
  /** Summed over every call of the run; null when the provider didn't report it. */
  usage: TokenUsage | null;
  /** What the run's calls cost, or would cost, at the model's API list rates, in USD; null when any call's cost is unknown. */
  apiCostUsd: number | null;
  /** apiCostUsd was estimated later from the run's stored tokens (it ran before costs were kept). */
  apiCostEstimated: boolean;
  /** What Jev's filter and citation check cost, in USD; null when Jev wasn't used or reported no cost. */
  jevCostUsd: number | null;
  /** #59: key themes, each with the messages Jev sorted under it; null when not asked. */
  themes: SummaryTheme[] | null;
  /** Each person its text names (as <@id>) or its sources cite, by user id: their name now (server nickname, else display name). */
  people: Record<string, string>;
  /** Each cited message's author: message id to user id. */
  authors: Record<string, string>;
}

/** What one provider's summary runs since a time cost: runs, tokens and the model's cost at API rates. */
export interface ProviderSpend extends AppUsage {
  provider: ProviderId;
  /** Summed over runs that reported a model cost, in USD. */
  apiCostUsd: number;
  /** Runs that called a model but have no cost (a local model, or no known price): left out of apiCostUsd. */
  unpricedRuns: number;
}

/** What summary runs since a time cost: each provider's model, most expensive first, and Jev's. */
export interface SummarySpend {
  providers: ProviderSpend[];
  /** Jev's cost, in USD. */
  jevCostUsd: number;
}

/** Keyset page of summary runs, newest first; `before` is the oldest run of the previous page. */
export interface SummaryPageQuery {
  limit: number;
  before?: { createdAt: number; id: number };
}

/** Where a run reads: whole servers, and channels with their threads. A run with none reads every archived channel. */
export interface SummaryScope {
  guildIds: string[];
  channelIds: string[];
}

export interface SummaryRequest {
  sinceTs: number;
  untilTs?: number;
  /** Exactly these channels (a rule's, already resolved); unset, the run reads `scope`. */
  channelIds?: string[];
  /** The servers and channels to read; unset, every opted-in channel. */
  scope?: SummaryScope;
  /** Defaults to the default provider in AI settings. */
  provider?: ProviderId;
}


/** A summary run's cost projection, before it runs. */
export interface SummaryEstimate {
  /** Messages in the range. */
  messages: number;
  /** The same range and settings were summarized already: the run is served from cache and costs nothing. */
  cached: boolean;
  /** Upper bound on Jev questions the run would ask. */
  questions: number;
  /** The model's cost at API rates, from what recent runs with it cost per message; null when none was priced (or cached). */
  modelUsd: number | null;
}

/** The system prompts a summary run sends with the current settings, for Settings → Summaries. */
export interface SummaryPrompts {
  /** Sent with each part of the message log. */
  summarize: string;
  /** Sent with the partial summaries when a log is too long for one call. */
  merge: string;
}


/** Progress emitted for a run. */
export interface SummaryProgress {
  phase: 'reading' | 'filtering' | 'quiet' | 'routing' | 'summarizing' | 'merging' | 'checking' | 'themes' | 'done' | 'error';
  done: number;
  total: number;
  message?: string;
}
/** Internal run events, routed through the plugin channel. */
export type SummaryEvent =
  | ({ type: 'summary-progress' } & SummaryProgress)
  | { type: 'summary-added'; summary: Summary }
  | ({ type: 'summary-auto-failed' } & SummaryFailure);

/** An automatic run that failed; `channelIds` when its rule named the channels. */
export interface SummaryFailure {
  trigger: SummaryTrigger;
  message: string;
  channelIds?: string[];
}
