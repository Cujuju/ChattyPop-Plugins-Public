// Summary history, progress and range state over scoped plugin channels.
import { createEffect, createMemo, createResource, createSignal } from 'solid-js';
import type { Summary, SummaryProgress } from '../shared/types';
import { plugin } from '../shared';
import { callable, pluginsLoaded, coreClient, pluginData, pluginResource, onEvent, lastSeenAt, pluginPreference, onAppEvent } from '@plugin-sdk/renderer';
import { refetchPlanUsage, createAction, createPagedList, aiSettings } from '@plugin-sdk/renderer/kit';
import { MS_PER_DAY, type ProviderId } from '@plugin-sdk/shared';
import type { SummaryPromptTemplates } from '../shared/prompts';
import { SUMMARY_RANGES, type SummaryRange } from '../shared/settings';
import { summarySettings } from './settings';
import { mergeHistoryPage } from './historyPage';
import { dayOf } from './order';

/** The range picked in the panel this session; until one is picked, Settings → Summaries' default. */
const [pickedRange, setSummaryRange] = createSignal<SummaryRange | null>(null);
export { setSummaryRange };
export const summaryRange = (): SummaryRange => pickedRange() ?? summarySettings().defaultRange;

/** Summary runs fetched per page of the history. */
const SUMMARY_PAGE_SIZE = 20;
const core = coreClient(plugin);
const active = createMemo(() => pluginsLoaded() && callable(plugin, 'page'));

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
createEffect(() => {
  const on = active();
  firstPage = reload();
  void firstPage.then(async () => {
    await seenSetting.loaded;
    if (on && active() && seenSummaryId() === null) setSeenSummaryId(latestSummary()?.id ?? NO_RUN_SEEN);
  }).catch(() => undefined);
});

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

/** A range's span, open-ended (to now) unless it ends earlier; "since the last summary" falls back to "since you were last here" before the first run. */
async function rangeOf(id: SummaryRange): Promise<{ sinceTs: number; untilTs?: number }> {
  const ms = SUMMARY_RANGES[id].ms;
  if (ms !== null) return { sinceTs: Date.now() - ms };
  if (id === 'today') return { sinceTs: midnight(0) };
  if (id === 'yesterday') return { sinceTs: midnight(1), untilTs: midnight(0) };
  if (id === 'last') {
    await firstPage;
    const until = latestSummary()?.untilTs;
    if (until !== undefined) return { sinceTs: until };
  }
  return { sinceTs: await lastSeenAt() };
}

/** Runs a summary for the selected range with the default provider. */
export async function runSummary(): Promise<void> {
  setSummaryProgress(null);
  const run = await summaryAction.run(async () => core.summarize(await rangeOf(summaryRange())));
  setSummaryProgress(null);
  // A cache hit returns a stored run (no summary-added event).
  if (run && active()) addRun(run);
}

/** The next run's cost (Jev's upper bound, the model's likely cost), re-estimated when the range, settings or stored runs change; null when it can't run. */
export const [summaryEstimate] = createResource(
  () => active() && ({ range: summaryRange(), ai: aiSettings(), prefs: summarySettings(), runs: history.items.length }),
  async (k) => core.estimate(await rangeOf(k.range)).catch(() => null),
);

/**
 * The system prompts a run would send, with `own` (a rule's prompts) over the owner's; rebuilt when either or the
 * AI or summary settings change. null when core can't build them. Call inside a component.
 */
export function createPromptPreview(own: () => SummaryPromptTemplates | undefined = () => undefined) {
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

/**
 * Where the part of a run already covered by runs listed before it ends; null when none overlaps.
 * Only loaded runs count: the oldest one listed gains its label once the page before it loads.
 */
export function overlapUntil(s: Summary): number | null {
  let covered = -Infinity;
  for (const earlier of history.items) {
    if (earlier.id === s.id) break;
    covered = Math.max(covered, earlier.untilTs);
  }
  return covered > s.sinceTs ? Math.min(covered, s.untilTs) : null;
}
