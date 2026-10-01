// The host's rule services with Summaries' rule kinds over recording fakes, on a seeded archive: what rule tests drive.
import type { AppEvent } from '@shared/contract';
import type { RawMessage } from '@shared/discord';
import type { JevFeature } from '@shared/settings';
import type { DecisionProvider } from '@core/ai/decisions';
import type { Archive } from '@core/archive';
import { ARRIVAL, type Arrival } from '@core/arrival';
import type { Db } from '@core/db';
import { FakeJev, from, hostRuleStack, nextTs, rawMessage, seedArchive, tempDb } from '@chattypop/host-testing';
import { registerSummaryKinds, type SummaryRangeDeps } from '../core/kinds';
import { coveredFrom } from '../core/summaryRows';
import type { SummaryPromptTemplates } from '../shared/prompts';
import type { SummaryTrigger } from '../shared/settings';
import type { Summary, SummaryEvent, SummaryRequest } from '../shared/types';
import { startSummaries } from './summariesHarness';

/** Recorded summary requests with a configurable answer. */
export interface FakeSummaries extends SummaryRangeDeps {
  summaries: SummaryRequest[];
  /** Each summary's rule prompts, in the same order. */
  summaryPrompts: (SummaryPromptTemplates | undefined)[];
  /** How each summary is labelled, in the same order. */
  summaryTriggers: SummaryTrigger[];
  /** The headline each summary answers with; a rejection fails the summary. */
  answer: () => Promise<string | null>;
}

function fakeSummaries(): FakeSummaries {
  const f: FakeSummaries = {
    summaries: [],
    summaryPrompts: [],
    summaryTriggers: [],
    answer: async () => 'answered',
    summarize: async (req, prompts, trigger) => {
      f.summaries.push(req);
      f.summaryPrompts.push(prompts);
      f.summaryTriggers.push(trigger);
      return { headline: (await f.answer()) ?? '' } as Summary;
    },
  };
  return f;
}

/** Archived channels: what a run over every channel reads (without local-only exclusions, which Summarizer tests cover). */
const optedIn = (db: Db): string[] => db.prepare('SELECT id FROM channels WHERE opted_in = 1').pluck().all() as string[];

/** The host's rule services with Summaries' kinds over `deps`; `summaries` turns those kinds off and on, as its switch does. */
export function summaryRuleStack(
  db: Db,
  emit: (e: AppEvent) => void,
  jevFor: (feature: JevFeature) => DecisionProvider | null,
  deps: SummaryRangeDeps,
  now: () => number = Date.now,
  summaryEmit: (e: SummaryEvent) => void = () => undefined,
) {
  const stack = hostRuleStack(db, emit, jevFor, undefined, now);
  /** Summaries' rule kinds, with coverage as the plugin reads it; disposing is turning Summaries off. */
  const summaryKinds = () => {
    const summaries = startSummaries(db, { kinds: stack.actions.kinds, activate: false });
    registerSummaryKinds(summaries.ctx.rules, deps, summaryEmit, (q) => coveredFrom(db, q.channelIds ?? optedIn(db), q.sinceTs));
    return summaries;
  };
  let summaryPlugin = summaryKinds();
  const summaries = {
    off: () => summaryPlugin.dispose(),
    on: () => {
      summaryPlugin = summaryKinds();
      stack.engine.reload();
    },
  };
  return { ...stack, summaries };
}

/** A seeded archive (c1, c2) whose messages reach the rule matcher as core wires it. `now`: the engine's clock. */
export function summaryRuleHarness(now: () => number = Date.now) {
  const db = tempDb();
  const events: AppEvent[] = [];
  const summaryEvents: SummaryEvent[] = [];
  const jev = new FakeJev();
  const ranges = fakeSummaries();
  const stack = summaryRuleStack(db, (e) => void events.push(e), jev.forFeature, ranges, now, (e) => void summaryEvents.push(e));
  const archive: Archive = seedArchive(db, [{ id: 'c1' }, { id: 'c2', guildId: 'g2' }], {
    guilds: [
      { id: 'g1', name: 'G1' },
      { id: 'g2', name: 'G2' },
    ],
    onText: (m, arrived) => stack.matcher.check(m, arrived),
    onLinkedText: (m, arrived) => stack.matcher.check(m, arrived),
  });
  /** A message from `author` in `channel`, arriving `via` (live gateway by default); returns it. */
  const say = (content: string, o: { author?: string; channel?: string; via?: Arrival } = {}): RawMessage => {
    const m = rawMessage(o.channel ?? 'c1', nextTs(), content, from(o.author ?? 'u2'));
    if ((o.via ?? ARRIVAL.gateway) === ARRIVAL.sync) archive.ingestSyncPage(m.channel_id, [m], 'newer', false);
    else archive.ingestMessages([m], o.via ?? ARRIVAL.gateway);
    return m;
  };
  return { ...stack, db, events, summaryEvents, jev, archive, ranges, say };
}

export type SummaryRuleHarness = ReturnType<typeof summaryRuleHarness>;
