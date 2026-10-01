// Alert recording, read state and notification behavior through rule execution.
import { archivePayloads } from '@core/plugins/archivePayloads';
import { ALERTS } from '../core/tables';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RuleAction } from '@shared/rules';
import { newRuleAction } from '@shared/ruleSpec';
import type { AlertItem } from '../shared/types';
import { setSetting } from '@core/db';
import { alertItems } from '../core/queries';
import { markAlertsRead } from '../core/queries';
import { ARRIVAL } from '@core/arrival';
import { MS_PER_HOUR } from '@shared/units';
import { settleAlerts } from './alertsHarness';
import { ruleHarness, ruleInput, type Harness } from './ruleHarness';
import { startAlerts } from './alertsHarness';

let h: Harness;
beforeEach(() => {
  h = ruleHarness();
});

type Notify = import('../shared/rules').NotifyConfig;
const notify = (toast: Notify['toast'] = { cooldownMs: 0 }, over: Partial<Notify> = {}): RuleAction =>
  ({ ...newRuleAction('alerts.notify'), config: { toast, ...over } }) as RuleAction;
const toasts = (): AlertItem[] => h.events.flatMap((e) => (e.type === 'plugin-event' && e.pluginId === 'alerts' && e.name === 'notify' ? e.payload as import('../shared/types').AlertItem[] : []));
const alerts = (): AlertItem[] => alertItems(h.db, (ids) => archivePayloads(h.db, ids), { limit: 50 });

describe('rule Alert action', () => {
  it('puts a live message in Alerts under the rule, unread, with a desktop notification', async () => {
    const id = h.rules.create(ruleInput([notify()], { name: 'Watch' }));
    const m = h.say('hello');
    await settleAlerts();
    expect(alerts().map((a) => [a.ruleId, a.sourceName, a.messageId, a.readAt, a.matchKind])).toEqual([
      [id, 'Watch', m.id, null, 'pattern'],
    ]);
    expect(toasts().map((a) => a.messageId)).toEqual([m.id]);
    expect(h.alerts.calls.unread()[h.rules.list()[0]!.id] ?? 0).toBe(1);
  });

  it('records the alert as the message arrives, before its other actions run', () => {
    // The host's command action stands in for another plugin's slower action.
    const command = { ...newRuleAction('command', 'cmd'), config: { pluginId: 'probe', commandId: 'run', lookbackMs: MS_PER_HOUR } };
    const id = h.rules.create(ruleInput([notify(), command]));
    const m = h.say('now');
    expect(alerts().map((a) => a.messageId)).toEqual([m.id]);
    expect(h.rules.runs(id, 1)[0]!.actions.map((a) => a.kind)).toEqual(['alerts.notify']);
  });

  it('a missed message lands unread without a desktop notification; one older than the rule lands read', async () => {
    h.rules.create(ruleInput([notify()], { gates: { missed: true } }));
    const m = h.say('fetched', { via: ARRIVAL.sync });
    await settleAlerts();
    expect(alerts().map((a) => [a.messageId, a.readAt])).toEqual([[m.id, null]]);
    expect(toasts()).toEqual([]);
  });

  it('a notification without a toast still records the alert', async () => {
    h.rules.create(ruleInput([notify(null)]));
    h.say('quiet');
    await settleAlerts();
    expect([alerts().length, toasts().length]).toEqual([1, 0]);
  });

  it('waits out its notification cooldown; the alert is still recorded', async () => {
    h.rules.create(ruleInput([notify({ cooldownMs: 60_000 })]));
    h.say('one');
    h.say('two');
    await settleAlerts();
    expect([alerts().length, toasts().length]).toEqual([2, 1]);
  });

  it('keeps its cooldown across Alerts turned off and on', async () => {
    h.rules.create(ruleInput([notify({ cooldownMs: 60_000 })]));
    h.say('one');
    await settleAlerts();
    h.alerts.dispose();
    startAlerts(h.db, { kinds: h.engine.kinds, emit: (e) => void h.events.push(e) });
    h.say('two');
    await settleAlerts();
    expect([alerts().length, toasts().length]).toEqual([2, 1]);
  });

  it('privacy mode hides the alert and its notification, not the record', async () => {
    const id = h.rules.create(ruleInput([notify()]));
    h.db.prepare('UPDATE channels SET hide_in_privacy = 1 WHERE id = ?').run('c1');
    setSetting(h.db, 'privacyMode', true);
    h.say('secret');
    await settleAlerts();
    expect([alerts().length, toasts().length, h.alerts.calls.unread()[h.rules.list()[0]!.id] ?? 0]).toEqual([0, 0, 0]);
    expect(h.db.prepare(`SELECT COUNT(*) AS n FROM ${ALERTS} WHERE rule_id = ?`).get(id)).toEqual({ n: 1 });
  });

  it('privacy mode turned on while a notification is queued drops it', async () => {
    h.rules.create(ruleInput([notify()]));
    h.db.prepare('UPDATE channels SET hide_in_privacy = 1 WHERE id = ?').run('c1');
    h.say('secret');
    setSetting(h.db, 'privacyMode', true); // before the debounced delivery
    await settleAlerts();
    expect(toasts()).toEqual([]);
  });

  it('an alert read while its notification is queued does not notify', async () => {
    const id = h.rules.create(ruleInput([notify()]));
    h.say('seen already');
    markAlertsRead(h.db, null, [id]);
    await settleAlerts();
    expect(toasts()).toEqual([]);
  });

  it('filters and marks read by rule; deleting the rule drops its alerts', async () => {
    const a = h.rules.create(ruleInput([notify()]));
    const b = h.rules.create(ruleInput([notify()]));
    h.say('x');
    await settleAlerts();
    expect(alertItems(h.db, (ids) => archivePayloads(h.db, ids), { limit: 9, ruleIds: [b] }).map((x) => x.ruleId)).toEqual([b]);
    markAlertsRead(h.db, null, [a]);
    expect(alertItems(h.db, (ids) => archivePayloads(h.db, ids), { limit: 9, unreadOnly: true }).map((x) => x.ruleId)).toEqual([b]);
    h.rules.remove(b);
    expect(alerts().map((x) => x.ruleId)).toEqual([a]);
  });
});
