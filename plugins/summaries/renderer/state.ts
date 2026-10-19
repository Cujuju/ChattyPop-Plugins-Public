// Summary history, progress and range state over scoped plugin channels.
import { createEffect, createMemo, createResource, createSignal } from 'solid-js';
import type { Summary, SummaryProgress, SummaryRunFailure, SummaryScope } from '../shared/types';
import { scopeKey } from './scope';
import { plugin } from '../shared';
import { callable, pluginsLoaded, coreClient, pluginData, pluginResource, onEvent, lastSeenAt, pluginPreference, onAppEvent, containedRoot } from '@plugin-sdk/renderer';
import { refetchPlanUsage, createAction, createPagedList, aiSettings, type TimeWindow } from '@plugin-sdk/renderer/kit';
import { MS_PER_DAY, type ProviderId } from '@plugin-sdk/shared';
import { SUMMARY_RANGES, type SummaryRange, type SummaryRuleOptions } from '../shared/settings';
import { summarySettings } from './settings';
import { mergeHistoryPage, runOpen } from './historyPage';
import { dayOf } from './order';

/** A run's time frame: one of Summaries' ranges, or a custom span. */
export type RunFrame = SummaryRange | { sinceTs: number; untilTs: number };
/** The frame picked in the panel this session; until one is picked, Settings → Summaries' default. */
const [pickedRange, setSummaryRange] = createSignal<RunFrame | null>(null);
export { setSummaryRange };
export const summaryRange = (): RunFrame => pickedRange() ?? summarySettings().defaultRange;

/** Which runs the history lists, by the time they cover; null is any time. */
export const [summaryWindow, setSummaryWindow] = createSignal<TimeWindow | null>(null);

/** What the panel summarizes this session, and which runs its history lists: everything until a server or channel is picked. */
export const [summaryScope, setSummaryScope] = createSignal<SummaryScope | null>(null);
/** The desktop rail's channel column is folded away. */
export const [summaryChannelsHidden, setSummaryChannelsHidden] = pluginPreference(plugin, 'channelsHidden');

/** Summary runs fetched per page of the history. */
const SUMMARY_PAGE_SIZE = 20;
const core = coreClient(plugin);
const active = containedRoot(() => createMemo(() => pluginsLoaded() && callable(plugin, 'page')));

/** Core pages newest first; the history lists oldest first (newest at the bottom). */
const oldestFirst = (page: Summary[]): Summary[] => [...page].reverse();

const list = createPagedList<Summary>(SUMMARY_PAGE_SIZE, async (oldest) =>
  oldestFirst(await pluginData(() => core.page({ limit: SUMMARY_PAGE_SIZE, before: { createdAt: oldest.createdAt, id: oldest.id } }), [])),
);
/** Summary runs oldest first (newest at the bottom); `reachedStart` once the first run is loaded. */
const history = list.state;
export { history as summaryHistory };
/** Prepends the previous (older) page; returns how many runs were added (the view keeps its scroll anchor). */
export const loadOlderSummaries = async (): Promise<number> => {
  if (!active()) return 0;
  return list.loadOlder();
};

/** The newest run, or null before the first. */
export const latestSummary = (): Summary | null => history.items.at(-1) ?? null;

/** Runs opened or closed by hand this session, by id. */
const [runToggles, setRunToggles] = createSignal<ReadonlyMap<number, boolean>>(new Map());
/** Whether a run shows its body, or only its heading. */
export const isSummaryOpen = (id: number): boolean => runOpen(runToggles(), id, latestSummary()?.id ?? null);
export const toggleSummary = (id: number): void => void setRunToggles(new Map(runToggles()).set(id, !isSummaryOpen(id)));

/** Adds a finished run at the bottom; a cache hit returns a run already listed, which stays where it is. */
function addRun(s: Summary): void {
  if (!history.items.some((x) => x.id === s.id)) list.setItems([...history.items, s]);
}

let firstPage: Promise<boolean> = Promise.resolve(false);
const reload = (): Promise<boolean> => list.reload(async () => {
  if (!active()) return { items: [], reachedStart: true };
  return pluginData(async () => {
    const page = await core.page({ limit: SUMMARY_PAGE_SIZE });
    // A run finished while this page loaded stays after it.
    return { items: mergeHistoryPage(page, history.items), reachedStart: page.length < SUMMARY_PAGE_SIZE };
  }, { items: [], reachedStart: true });
});

// Privacy mode changed: every listed run may be filtered or redacted differently, so the newest page replaces them all.
onAppEvent('privacy-changed', () => {
  if (!active()) return;
  void list.reload(async () => {
    const page = await pluginData(() => core.page({ limit: SUMMARY_PAGE_SIZE }), []);
    return { items: oldestFirst(page), reachedStart: page.length < SUMMARY_PAGE_SIZE };
  }).catch(() => undefined);
});

/** Run ids begin at one; zero records that no run existed when first seen. */
const NO_RUN_SEEN = 0;
const [seenSummaryId, setSeenSummaryId, seenSetting] = pluginPreference(plugin, 'seenId');
containedRoot(() => createEffect(() => {
  const on = active();
  firstPage = reload();
  void firstPage.then(async () => {
    await seenSetting.loaded;
    if (on && active() && seenSummaryId() === null) setSeenSummaryId(latestSummary()?.id ?? NO_RUN_SEEN);
  }).catch(() => undefined);
}));

/** Runs added since the Summary panel was last on screen. */
export const unseenSummaryCount = (): number => {
  const seen = seenSummaryId();
  return seen === null ? 0 : history.items.filter((s) => s.id > seen).length;
};

export function markSummariesSeen(): void {
  const id = latestSummary()?.id ?? NO_RUN_SEEN;
  if (id > (seenSummaryId() ?? -Infinity)) setSeenSummaryId(id);
}

// Every new run, automatic ones included; each one spent its provider's plan usage.
onEvent(plugin, 'added', (summary) => {
  if (!active()) return;
  addRun(summary);
  refetchPlanUsage(summary.provider);
});

/** Timed summaries that failed and are still owed, oldest first: read with the first page and whenever a rule runs. */
const [failures, setFailures] = createSignal<SummaryRunFailure[]>([]);
export { failures as summaryFailures };
const readFailures = async (): Promise<void> => {
  // A core from before failures were listed serves none.
  setFailures(callable(plugin, 'failures') ? await pluginData(() => core.failures(), []) : []);
};
containedRoot(() => createEffect(() => {
  active();
  void readFailures();
}));
onAppEvent('rules-changed', () => void readFailures());

/** Failed runs being retried, by rule run and action: one run can owe more than one summary. */
const [retrying, setRetrying] = createSignal<ReadonlySet<string>>(new Set());
const failureKey = (f: SummaryRunFailure): string => `${f.runId}:${f.actionId}`;
export const isRetrying = (f: SummaryRunFailure): boolean => retrying().has(failureKey(f));

/** Runs a failed summary again now; its row goes once it is done, or says why it failed this time. */
export async function retryFailure(f: SummaryRunFailure): Promise<void> {
  if (isRetrying(f)) return;
  const key = failureKey(f);
  setRetrying(new Set(retrying()).add(key));
  try {
    await pluginData(() => core.retryFailure(f.runId, f.actionId), false);
  } finally {
    setRetrying(new Set([...retrying()].filter((k) => k !== key)));
    await readFailures();
  }
}

type Progress = SummaryProgress;
export const [summaryProgress, setSummaryProgress] = createSignal<Progress | null>(null);
const summaryAction = createAction();
export const summaryError = summaryAction.error;
/** True for the lifetime of the summarize call; progress events only label it (a cache hit sends none). */
export const summaryRunning = summaryAction.busy;

onEvent(plugin, 'progress', (event) => { if (active()) setSummaryProgress(event); });

/** Local midnight `daysBack` calendar days before today's (by the calendar, so a clock change doesn't shift it). */
function midnight(daysBack: number): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysBack);
  return d.getTime();
}

/** Resolves range spans through now unless bounded; a custom span is its own. "Last run" is the last run over scope; before one, the previous session. */
export async function rangeOf(id: RunFrame, scope: SummaryScope | null = null): Promise<{ sinceTs: number; untilTs?: number }> {
  if (typeof id === 'object') return id;
  const ms = SUMMARY_RANGES[id].ms;
  if (ms !== null) return { sinceTs: Date.now() - ms };
  if (id === 'today') return { sinceTs: midnight(0) };
  if (id === 'yesterday') return { sinceTs: midnight(1), untilTs: midnight(0) };
  if (id === 'last') {
    await firstPage;
    const until = history.items.findLast((s) => scopeKey(s.scope) === scopeKey(scope))?.untilTs;
    if (until !== undefined) return { sinceTs: until };
  }
  return { sinceTs: await lastSeenAt() };
}

/** Runs a summary for the selected range with the default provider. */
export async function runSummary(): Promise<void> {
  setSummaryProgress(null);
  const scope = summaryScope();
  const run = await summaryAction.run(async () => core.summarize({ ...(await rangeOf(summaryRange(), scope)), ...(scope ? { scope } : {}) }));
  setSummaryProgress(null);
  // A cache hit returns a stored run (no summary-added event).
  if (run && active()) addRun(run);
}

/** Builds system-prompt previews from a rule's own options over the owner's, and AI settings. Null when unavailable; call inside a component. */
export function createPromptPreview(own: () => SummaryRuleOptions | undefined = () => undefined) {
  return pluginResource(plugin, 'prompts', () => {
    // Core builds them from the AI and summary settings as well: re-read when either changes.
    aiSettings();
    summarySettings();
    return [own()];
  }, null);
}

const WEEK_DAYS = 7;
const MONTH_DAYS = 30;
/** Spending windows: since local midnight, then rolling back from now. */
export const SPEND_PERIODS = [
  { label: 'Today', since: (now: number): number => dayOf(now) },
  { label: `Last ${WEEK_DAYS} days`, since: (now: number): number => now - WEEK_DAYS * MS_PER_DAY },
  { label: `Last ${MONTH_DAYS} days`, since: (now: number): number => now - MONTH_DAYS * MS_PER_DAY },
] as const;

/** What runs cost over each SPEND_PERIODS window, in order; re-read when a run is added. [] until read. Call inside a component. */
export function createSpending() {
  return pluginResource(plugin, 'spending', () => {
    latestSummary();
    const now = Date.now();
    return [SPEND_PERIODS.map((p) => p.since(now))];
  }, []);
}

/** Returns the endpoint covered by earlier loaded runs over the same scope, or null without overlap. Earlier pages can change the oldest displayed run's label. */
export function overlapUntil(s: Summary): number | null {
  let covered = -Infinity;
  for (const earlier of history.items) {
    if (earlier.id === s.id) break;
    if (scopeKey(earlier.scope) !== scopeKey(s.scope)) continue;
    covered = Math.max(covered, earlier.untilTs);
  }
  return covered > s.sinceTs ? Math.min(covered, s.untilTs) : null;
}
