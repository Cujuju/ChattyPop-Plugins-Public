// The host's rule engine over a seeded archive with Tags' kinds, wired as core wires them, for Tags' rule tests.
import type { AppEvent } from '@shared/contract';
import type { JevFeature } from '@shared/settings';
import type { RawMessage } from '@shared/discord';
import type { DecisionProvider } from '@core/ai/decisions';
import type { Archive } from '@core/archive';
import type { Db } from '@core/db';
import type { RuleActions } from '@core/rules/actions';
import type { RuleEngine } from '@core/rules/engine';
import type { RuleMatcher } from '@core/rules/matcher';
import type { RuleService } from '@core/rules/ruleService';
import { ARRIVAL, type Arrival } from '@core/arrival';
import { FakeJev, from, hostRuleStack, nextTs, rawMessage, seedArchive, tempDb } from '@chattypop/host-testing';
import { startTags } from './tagsHarness';

export { hostRuleStack, ruleInput, runsOf } from '@chattypop/host-testing';

/** The Settings → Jev switch Tags' Jev answers sit behind. */
const TAGS_JEV_FEATURE: JevFeature = 'tags.customTags';

/** Seeded archive, rule services and fakes exposed to Tags' rule tests. */
export interface Harness {
  db: Db;
  events: AppEvent[];
  archive: Archive;
  engine: RuleEngine;
  actions: RuleActions;
  rules: RuleService;
  tags: ReturnType<typeof startTags>;
  /** Jev behind every feature switch (all off until a test turns one on). */
  jev: FakeJev;
  matcher: RuleMatcher;
  /** A message from `author` in `channel`, arriving `via` (live gateway by default); returns it. */
  say(
    content: string,
    o?: { author?: string; channel?: string; via?: Arrival; extra?: Partial<RawMessage> },
  ): RawMessage;
}

/** The host's rule services with Tags' kinds. */
function ruleStack(db: Db, emit: (e: AppEvent) => void, jevFor: (feature: JevFeature) => DecisionProvider | null) {
  const stack = hostRuleStack(db, emit, jevFor);
  const tags = startTags(db, {
    emit,
    kinds: stack.engine.kinds,
    jev: () => jevFor(TAGS_JEV_FEATURE),
    catchUp: () => stack.matcher.catchUpJudgments(),
  });
  return { ...stack, tags };
}

/** A seeded archive whose every message text goes through the rule matcher, as core wires it. */
export function ruleHarness(): Harness {
  const db = tempDb();
  const events: AppEvent[] = [];
  const emit = (e: AppEvent): void => void events.push(e);
  const jev = new FakeJev();
  const stack = ruleStack(db, emit, jev.forFeature);
  const { matcher } = stack;
  const archive = seedArchive(db, [{ id: 'c1' }, { id: 'c2', guildId: 'g2' }], {
    guilds: [
      { id: 'g1', name: 'G1' },
      { id: 'g2', name: 'G2' },
    ],
    onText: (m, arrived) => matcher.check(m, arrived),
    onLinkedText: (m, arrived) => matcher.check(m, arrived),
  });
  const say: Harness['say'] = (content, o = {}) => {
    const m = rawMessage(o.channel ?? 'c1', nextTs(), content, { ...from(o.author ?? 'u2'), ...o.extra });
    if ((o.via ?? ARRIVAL.gateway) === ARRIVAL.sync) archive.ingestSyncPage(m.channel_id, [m], 'newer', false);
    else archive.ingestMessages([m], o.via ?? ARRIVAL.gateway);
    return m;
  };
  return { db, events, archive, engine: stack.engine, actions: stack.actions, rules: stack.rules, tags: stack.tags, jev, matcher, say };
}
