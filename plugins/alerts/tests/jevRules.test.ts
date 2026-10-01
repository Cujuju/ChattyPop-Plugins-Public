// Alerts' open-questions rule and repeat detection through Jev.
import { beforeEach, describe, expect, it } from 'vitest';
import type { Archive } from '@core/archive';
import type { Db } from '@core/db';
import { REPLY_MESSAGE_TYPE } from '@core/queries/messageExtras';
import { ARRIVAL } from '@core/arrival';
import { OWNER, from, nextTs, rawMessage, type FakeJev } from '@chattypop/host-testing';
import { ALERTS } from '../core/tables';
import { isRepeat } from '../core/dedupe';
import type { AlertItem } from '../shared/types';
import { settleAlerts } from './alertsHarness';
import { alertRule, ruleHarness, type Harness } from './ruleHarness';

let h: Harness;
let db: Db;
let jev: FakeJev;
let rules: Harness['rules'];
let archive: Archive;
beforeEach(() => {
  h = ruleHarness();
  ({ db, jev, rules, archive } = h);
  h.matcher.setSelf(OWNER);
});
const notified = (): AlertItem[] => h.events.flatMap((e) => (e.type === 'plugin-event' && e.pluginId === 'alerts' && e.name === 'notify' ? e.payload as AlertItem[] : []));

/** Each message is just after now, so newer than the rules the test made (older ones land as read history). */
const msg = (content: string, author = 'u2', extra = {}) => rawMessage('c1', nextTs(), content, { ...from(author), ...extra });
const replyTo = (target: ReturnType<typeof msg>, content: string, author = 'u3') =>
  msg(content, author, { type: REPLY_MESSAGE_TYPE, message_reference: { message_id: target.id }, referenced_message: target });

describe('#54 open questions', () => {
  beforeEach(() => {
    jev.on['alerts.unansweredQuestions'] = true;
    rules.syncBuiltins(jev.on);
  });

  it('collects questions from others and a Discord reply marks one answered', async () => {
    jev.values = { question: 0.9 };
    const q = msg('anyone know when the GB closes?');
    archive.ingestMessages([q], ARRIVAL.gateway);
    await settleAlerts();
    const [a] = rules.alerts({ limit: 5 });
    expect(a?.sourceName).toBe('Open questions');
    expect(a?.readAt).toBeNull();
    jev.values = { question: 0.1 };
    archive.ingestMessages([replyTo(q, 'friday')], ARRIVAL.gateway);
    await settleAlerts();
    expect(rules.alerts({ limit: 5, unreadOnly: true })).toEqual([]);
  });

  it('a question already answered when judged lands read, and own questions are never asked about', async () => {
    const q = msg('what time is the call?');
    archive.ingestMessages([q, replyTo(q, '6pm'), msg('should I?', OWNER.id)], ARRIVAL.gateway);
    await settleAlerts();
    jev.requests = [];
    jev.values = { question: 0.9 };
    jev.on['alerts.unansweredQuestions'] = false;
    rules.syncBuiltins(jev.on);
    jev.on['alerts.unansweredQuestions'] = true;
    rules.syncBuiltins(jev.on); // back on: catch-up asks the unjudged lookback messages
    await settleAlerts();
    expect(jev.requests.every((r) => !JSON.stringify(r).includes('should I?'))).toBe(true);
    const alert = rules.alerts({ limit: 5 }).find((x) => x.messageId === q.id)!;
    expect(alert.readAt).not.toBeNull();
  });
});

describe('#55 dedupe', () => {
  it('a live alert about the same event as the rule’s last one stays quiet; a new event notifies', async () => {
    jev.on['alerts.dedupeAlerts'] = true;
    rules.create(alertRule({ text: { pattern: 'gb', spec: null } }));
    archive.ingestMessages([msg('GB opens friday', 'u2')], ARRIVAL.gateway);
    await settleAlerts();
    expect(notified()).toHaveLength(1);
    jev.values = { same: 0.9 };
    archive.ingestMessages([msg('reminder: GB opens friday', 'u3')], ARRIVAL.gateway);
    await settleAlerts();
    expect(notified()).toHaveLength(1);
    expect(db.prepare(`SELECT COUNT(*) n FROM ${ALERTS} WHERE duplicate_of IS NOT NULL`).get()).toEqual({ n: 1 });
    jev.values = { same: 0.1 };
    archive.ingestMessages([msg('a second GB just got announced', 'u4')], ARRIVAL.gateway);
    await settleAlerts();
    expect(notified()).toHaveLength(2);
  });

  it('compares an alert only with earlier ones, so two judged at once never mark each other repeats', async () => {
    const id = rules.create(alertRule({ text: { pattern: 'gb', spec: null } }));
    archive.ingestMessages([msg('GB opens friday', 'u2'), msg('GB opens friday!', 'u3')], ARRIVAL.gateway);
    await settleAlerts();
    const [first, second] = (db.prepare(`SELECT id FROM ${ALERTS} WHERE rule_id = ? ORDER BY ts, id`).pluck().all(id) as number[]);
    jev.values = { same: 0.9 };
    expect(await Promise.all([isRepeat(db, jev, id, first!), isRepeat(db, jev, id, second!)])).toEqual([false, true]);
    expect(db.prepare(`SELECT id, duplicate_of AS of FROM ${ALERTS} WHERE rule_id = ? ORDER BY ts, id`).all(id)).toEqual([
      { id: first, of: null },
      { id: second, of: first },
    ]);
  });

  it('notifies when Jev fails', async () => {
    jev.on['alerts.dedupeAlerts'] = true;
    rules.create(alertRule({ text: { pattern: 'gb', spec: null } }));
    archive.ingestMessages([msg('GB one', 'u2')], ARRIVAL.gateway);
    await settleAlerts();
    jev.fail = true;
    archive.ingestMessages([msg('GB two', 'u3')], ARRIVAL.gateway);
    await settleAlerts();
    expect(notified()).toHaveLength(2);
  });
});
