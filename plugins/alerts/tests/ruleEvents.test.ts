// Alerts' pending events clear as the host settles each rule event: arrivals, catch-up, rejudging and nested triggers.
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { RuleInput } from '@shared/rules';
import { newRuleAction } from '@shared/ruleSpec';
import { ARRIVAL } from '@core/arrival';
import { RuleActions } from '@core/rules/actions';
import { RuleEngine } from '@core/rules/engine';
import { registerHostMatches } from '@core/rules/hostMatches';
import { RuleKinds, type Settled } from '@core/rules/kinds';
import { RuleMatcher } from '@core/rules/matcher';
import { RuleService } from '@core/rules/ruleService';
import { textMessage } from '@core/queries/messageText';
import { FakeJev, nextTs, rawMessage, ruleInput, seedArchive, tempDb } from '@chattypop/host-testing';
import { includeProbe } from '@chattypop/host-testing/pluginRuleProbe';
import { startAlerts } from './alertsHarness';

/** An alert-only rule stack, exposing the registration's pending-event count. */
function stack() {
  const db = tempDb();
  const jev = new FakeJev();
  const kinds = new RuleKinds();
  registerHostMatches(kinds);
  const engine = new RuleEngine(db, () => undefined, new RuleActions(db, kinds));
  const matcher = new RuleMatcher(db, engine, jev.forFeature);
  const rules = new RuleService(db, () => undefined, engine, matcher);
  const { pending } = startAlerts(db, { kinds, jev: jev.forFeature });
  let checking = true;
  const archive = seedArchive(db, [{ id: 'c1' }], {
    onText: (m, arrived) => {
      if (checking) matcher.check(m, arrived);
    },
  });
  const settled: Settled[] = [];
  kinds.onSettled((e) => settled.push(e));
  const say = (check = true) => {
    checking = check;
    const raw = rawMessage('c1', nextTs(), 'news');
    archive.ingestMessages([raw], ARRIVAL.gateway);
    return textMessage(db, raw.id)!;
  };
  return { jev, kinds, matcher, rules, pending, settled, say };
}

afterEach(() => vi.restoreAllMocks());

/** The rule-kind probe's message trigger: a stand-in for another plugin's trigger (Tags' tags.applied in the app). */
const PROBE_TRIGGER = 'ruleprobe.start';
/** `input` started by the probe's trigger instead of a new message. */
const probeTriggered = (input: RuleInput): RuleInput => ({ ...input, spec: { ...input.spec, trigger: { type: PROBE_TRIGGER, config: 'yes' } } });

describe('explicit rule event settlement', () => {
  it.each(['no request', 'success', 'failure'] as const)('clears pending alerts after %s', async (path) => {
    const h = stack();
    h.rules.create(ruleInput([newRuleAction('alerts.notify')]));
    h.jev.on['alerts.urgentToasts'] = path !== 'no request';
    h.jev.values.urgency = 1;
    h.jev.fail = path === 'failure';
    h.say();
    if (path !== 'no request') expect(h.pending()).toBe(1);
    await vi.waitFor(() => expect(h.settled).toHaveLength(1));
    expect(h.pending()).toBe(0);
    expect(h.settled[0]!.answers === null).toBe(path !== 'success');
    expect(h.settled[0]!.eventId).toBeGreaterThan(0);
  });

  it('settles catch-up and rejudge messages with nothing to ask exactly once', async () => {
    const h = stack();
    const m = h.say();
    const arrivalId = h.settled[0]!.eventId;
    h.settled.length = 0;
    h.rules.create(ruleInput([newRuleAction('alerts.notify')], { gates: { missed: true } }));
    expect(h.settled).toHaveLength(1);
    expect(h.settled[0]).toMatchObject({ m: { id: m.id }, answers: null });
    expect(h.pending()).toBe(0);
    const catchUpId = h.settled[0]!.eventId;
    h.settled.length = 0;
    await h.matcher.rejudge([m], new Set());
    expect(h.settled).toHaveLength(1);
    expect(h.pending()).toBe(0);
    expect(new Set([arrivalId, catchUpId, h.settled[0]!.eventId]).size).toBe(3);
  });

  it.each([false, true])('clears pending catch-up alerts when batch failure is %s', async (fail) => {
    const h = stack();
    h.rules.create(ruleInput([newRuleAction('alerts.notify')], { gates: { missed: true } }));
    const id = h.rules.create(
      ruleInput([newRuleAction('alerts.notify')], { match: { meaning: 'news' }, gates: { missed: true } }),
    );
    h.jev.on.topicMeaning = true;
    h.jev.values[`rule:${id}`] = 1;
    h.jev.fail = fail;
    const m = h.say(false);
    h.matcher.catchUpJudgments();
    expect(h.pending()).toBe(1);
    await vi.waitFor(() => expect(h.settled).toHaveLength(1));
    expect(h.pending()).toBe(0);
    expect(h.settled[0]!.answers === null).toBe(fail);
    const catchUpId = h.settled[0]!.eventId;
    h.settled.length = 0;
    await h.matcher.rejudge([m], new Set([`rule:${id}`]));
    expect(h.settled).toHaveLength(1);
    expect(h.pending()).toBe(0);
    expect(h.settled[0]!.eventId).not.toBe(catchUpId);
    expect(h.settled[0]!.answers === null).toBe(fail);
  });

  it('settles a nested trigger separately while the arrival waits for urgency', async () => {
    onTestFinished(includeProbe());
    const h = stack();
    h.rules.create(ruleInput([newRuleAction('alerts.notify')]));
    h.rules.create(probeTriggered(ruleInput([newRuleAction('alerts.notify')], { gates: { missed: true } })));
    h.jev.on['alerts.urgentToasts'] = true;
    h.jev.values.urgency = 0;
    const m = h.say();
    expect(h.pending()).toBe(1);
    h.kinds.trigger(PROBE_TRIGGER).fire({ m, liveAt: null, key: 'nested', accepts: () => true });
    expect(h.settled).toHaveLength(1);
    expect(h.settled[0]!.answers).toBeNull();
    expect(h.pending()).toBe(1);
    await vi.waitFor(() => expect(h.settled).toHaveLength(2));
    expect(h.pending()).toBe(0);
    expect(new Set(h.settled.map((e) => e.eventId)).size).toBe(2);
  });
});
