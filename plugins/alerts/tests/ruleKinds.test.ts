// A nested trigger's settlement never releases the notification an arrival's Alert still holds for urgency.
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';
import { registerMessageQuestion, unregisterMessageQuestion } from '@core/jev/messageQuestions';
import { newRuleAction } from '@shared/ruleSpec';
import { includeProbe } from '@chattypop/host-testing/pluginRuleProbe';
import type { AlertItem } from '../shared/types';
import { settleAlerts } from './alertsHarness';
import { ruleHarness, ruleInput } from './ruleHarness';

/** The rule-kind probe's message trigger: a stand-in for another plugin's trigger (Tags' tags.applied in the app). */
const PROBE_TRIGGER = 'ruleprobe.start';
/** A per-message question whose answer fires the nested trigger. */
const MAY_ACT_SUBJECT = 'test:mayAct';

afterEach(() => unregisterMessageQuestion(MAY_ACT_SUBJECT));

describe('core kind dispatch', () => {
  it('settles nested trigger events without releasing another event notification', async () => {
    onTestFinished(includeProbe());
    const h = ruleHarness();
    h.jev.on['alerts.urgentToasts'] = true;
    h.jev.on.topicMeaning = true;
    h.jev.values = { urgency: 0, [MAY_ACT_SUBJECT]: 1 };
    registerMessageQuestion({
      subject: MAY_ACT_SUBJECT,
      feature: 'topicMeaning',
      question: () => ({ type: 'noul', instructions: 'Is `message` news?', criteria: { true: 'Yes', false: 'No' } }),
      onAnswer: (m, _, liveAt) =>
        h.engine.kinds.trigger(PROBE_TRIGGER).fire({ m, liveAt, key: 'nested', accepts: () => true }),
    });
    h.rules.create(ruleInput([newRuleAction('alerts.notify')], { match: { text: { pattern: 'news', spec: null } } }));
    h.say('news');
    await settleAlerts();
    expect(h.rules.alerts({ limit: 10 })).toHaveLength(1);
    expect(h.events.flatMap((e) => (e.type === 'plugin-event' && e.pluginId === 'alerts' && e.name === 'notify' ? e.payload as AlertItem[] : []))).toEqual([]);
  });
});
