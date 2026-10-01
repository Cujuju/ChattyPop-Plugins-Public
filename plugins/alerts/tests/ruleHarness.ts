// The host's rule engine over a seeded archive with Alerts' kinds, wired as core wires them, for Alerts' rule tests.
import type { AppEvent } from '@shared/contract';
import type { JevFeature } from '@shared/settings';
import type { RawMessage } from '@shared/discord';
import type { RuleAction, RuleGates, RuleInput } from '@shared/rules';
import type { DecisionProvider } from '@core/ai/decisions';
import type { Archive } from '@core/archive';
import type { Db } from '@core/db';
import type { RuleActions } from '@core/rules/actions';
import type { RuleEngine } from '@core/rules/engine';
import type { RuleMatcher } from '@core/rules/matcher';
import { ARRIVAL, type Arrival } from '@core/arrival';
import type { LegacyRuleMatch as RuleMatch, LegacyRuleNarrow as RuleNarrow } from '@chattypop/host-testing/ruleFixtures';
import { FakeJev, from, hostRuleStack, nextTs, rawMessage, ruleInput, seedArchive, tempDb } from '@chattypop/host-testing';
import { startAlerts } from './alertsHarness';

export { hostRuleStack, ruleInput, runsOf } from '@chattypop/host-testing';

/** Seeded archive, rule services and fakes exposed to Alerts' rule tests. */
export interface Harness {
  db: Db;
  events: AppEvent[];
  archive: Archive;
  engine: RuleEngine;
  actions: RuleActions;
  rules: ReturnType<typeof ruleStack>['rules'];
  alerts: ReturnType<typeof startAlerts>;
  /** Jev behind every feature switch (all off until a test turns one on). */
  jev: FakeJev;
  matcher: RuleMatcher;
  /** A message from `author` in `channel`, arriving `via` (live gateway by default); returns it. */
  say(
    content: string,
    o?: { author?: string; channel?: string; via?: Arrival; extra?: Partial<RawMessage> },
  ): RawMessage;
}

/** The host's rule services with Alerts' kinds. */
export function ruleStack(
  db: Db,
  emit: (e: AppEvent) => void,
  jevFor: (feature: JevFeature) => DecisionProvider | null,
  now: () => number = Date.now,
) {
  const { engine, actions, matcher, rules: service } = hostRuleStack(db, emit, jevFor, undefined, now);
  const alerts = startAlerts(db, { now, emit, kinds: engine.kinds, jev: jevFor, catchUp: () => matcher.catchUpJudgments() });
  const rules = Object.assign(service, {
    alerts: alerts.calls.alerts,
    markRead: alerts.calls.markRead,
    syncBuiltins: alerts.syncBuiltins,
  });
  return { engine, actions, matcher, rules, alerts };
}

/** `now`: the clock the engine reads (a test steps it past cooldowns). */
export function ruleHarness(now: () => number = Date.now): Harness {
  const db = tempDb();
  const events: AppEvent[] = [];
  const emit = (e: AppEvent): void => void events.push(e);
  const jev = new FakeJev();
  const stack = ruleStack(db, emit, jev.forFeature, now);
  const { matcher } = stack;
  const archive = seedArchive(db, [{ id: 'c1' }, { id: 'c2', guildId: 'g2' }], {
    guilds: [
      { id: 'g1', name: 'G1' },
      { id: 'g2', name: 'G2' },
    ],
    // As core wires it: every message text through the matcher.
    onText: (m, arrived) => matcher.check(m, arrived),
    onLinkedText: (m, arrived) => matcher.check(m, arrived),
  });
  const say: Harness['say'] = (content, o = {}) => {
    const m = rawMessage(o.channel ?? 'c1', nextTs(), content, { ...from(o.author ?? 'u2'), ...o.extra });
    if ((o.via ?? ARRIVAL.gateway) === ARRIVAL.sync) archive.ingestSyncPage(m.channel_id, [m], 'newer', false);
    else archive.ingestMessages([m], o.via ?? ARRIVAL.gateway);
    return m;
  };
  return {
    db,
    events,
    archive,
    engine: stack.engine,
    actions: stack.actions,
    rules: stack.rules,
    alerts: stack.alerts,
    jev,
    matcher,
    say,
  };
}

/** An Alert action that notifies every live match (no cooldown), as a watch-for-this rule does. */
export const alertAction = (id = 'alert'): RuleAction => ({
  id,
  type: 'alerts.notify',
  config: { toast: { cooldownMs: 0 } },
});

/** A rule that alerts on `match` (and `narrow`), taking missed messages too: what a topic was. */
export const alertRule = (
  match: RuleMatch,
  o: { narrow?: RuleNarrow; gates?: Partial<RuleGates>; name?: string } = {},
): RuleInput =>
  ruleInput([alertAction()], { match, narrow: o.narrow, gates: { missed: true, ...o.gates }, name: o.name ?? 'T' });
