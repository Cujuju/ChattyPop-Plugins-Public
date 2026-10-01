// Jev's urgency and aimed-at-me judgments deciding Alerts' inbox and notifications.
import { beforeEach, describe, expect, it } from 'vitest';
import type { Rule } from '@shared/rules';
import { MS_PER_HOUR, MS_PER_MIN } from '@shared/units';
import { REPLY_MESSAGE_TYPE } from '@core/queries/messageExtras';
import type { RuleMatcher } from '@core/rules/matcher';
import { ARRIVAL } from '@core/arrival';
import { OWNER, arrivedLive, rawMessage, type FakeJev } from '@chattypop/host-testing';
import type { AlertItem } from '../shared/types';
import { settleAlerts } from './alertsHarness';
import { alertRule, ruleHarness, type Harness } from './ruleHarness';

const OTHER = 'u2';

let h: Harness;
let jev: FakeJev;
let rules: Harness['rules'];
let w: RuleMatcher;
beforeEach(() => {
  h = ruleHarness();
  ({ jev, rules, matcher: w } = h);
  jev.on.topicMeaning = true;
  w.setSelf(OWNER);
});
const notified = (): AlertItem[] => h.events.flatMap((e) => (e.type === 'plugin-event' && e.pluginId === 'alerts' && e.name === 'notify' ? e.payload as AlertItem[] : []));

let seq = 0;
const live = (content: string, authorId = OTHER) => ({
  id: `m${++seq}`,
  channelId: 'c1',
  authorId,
  ts: Date.now(),
  content,
  linked: '',
});
const topic = (pattern: string, description: string | null) =>
  rules.create(
    alertRule(
      { ...(pattern ? { text: { pattern, spec: null } } : {}), ...(description ? { meaning: description } : {}) },
      { name: pattern || description! },
    ),
  );
const builtin = (): Rule => rules.list().find((x) => x.builtin === 'alerts.aimed_at_me')!;

describe('#53 urgency decides notification vs inbox', () => {
  beforeEach(() => {
    jev.on['alerts.urgentToasts'] = true;
  });

  it('keeps a non-urgent live alert in the inbox without notifying', async () => {
    topic('launch', null);
    jev.values = { urgency: 0.4 };
    w.check(live('launch party pics'), arrivedLive());
    await settleAlerts();
    expect(rules.alerts({ limit: 10 })).toHaveLength(1);
    expect(notified()).toEqual([]);
  });

  it('notifies an urgent live alert', async () => {
    topic('launch', null);
    jev.values = { urgency: 1.8 };
    w.check(live('launch in 5 minutes, get in now'), arrivedLive());
    await settleAlerts();
    expect(notified()).toHaveLength(1);
  });

  it('records but never notifies for an Alert without desktop notifications, urgent or not', async () => {
    const id = topic('launch', null);
    rules.update(id, {
      ...alertRule({ text: { pattern: 'launch', spec: null } }),
      spec: {
        ...alertRule({ text: { pattern: 'launch', spec: null } }).spec,
        actions: [{ id: 'alert', type: 'alerts.notify', config: { toast: null } }],
      },
    });
    jev.values = { urgency: 1.8 };
    w.check(live('launch in 5 minutes, get in now'), arrivedLive());
    await settleAlerts();
    expect(rules.alerts({ limit: 10 })).toHaveLength(1);
    expect(notified()).toEqual([]);
  });

  it('notifies as before when Jev fails or gives no urgency', async () => {
    topic('launch', null);
    jev.fail = true;
    w.check(live('launch soon'), arrivedLive());
    await settleAlerts();
    jev.fail = false;
    jev.values = {};
    w.check(live('launch again'), arrivedLive());
    await settleAlerts();
    expect(notified()).toHaveLength(2);
  });

  it('does not ask about urgency when nothing could alert', async () => {
    jev.on.topicMeaning = false;
    w.check(live('nothing to see'), arrivedLive());
    await settleAlerts();
    expect(jev.requests).toEqual([]);
  });

  it('never asks about urgency for old messages', async () => {
    topic('launch', null);
    w.check({ ...live('launch'), ts: Date.now() - MS_PER_HOUR }, arrivedLive());
    await settleAlerts();
    expect(jev.requests.every((r) => !('urgency' in r.questions))).toBe(true);
  });
});

describe('#54 aimed at me', () => {
  beforeEach(() => {
    jev.on['alerts.aimedAtMe'] = true;
    rules.syncBuiltins(jev.on);
    jev.requests = [];
  });

  it('adds the built-in rule and alerts on a message aimed at the owner', async () => {
    const t = builtin();
    expect(t.name).toBe('Aimed at you');
    jev.values = { aimed: 0.92 };
    w.check(live('cujuju can you send me the link?'), arrivedLive());
    await settleAlerts();
    const [a] = rules.alerts({ limit: 10 });
    expect(a?.ruleId).toBe(t.id);
    expect(a?.probability).toBe(0.92);
    expect(notified()).toHaveLength(1);
    const q = jev.requests[0]!.questions['aimed']!;
    expect(JSON.stringify(q.instructions)).toContain('<@me>');
  });

  it('a Discord reply to the owner or an @mention is aimed at them without asking Jev', async () => {
    const { archive } = h;
    const now = Date.now();
    const mine = rawMessage('c1', now - 2_000, 'anyone up for games?', {
      author: { id: OWNER.id, username: OWNER.username },
    });
    const reply = rawMessage('c1', now - 1_000, 'sure', {
      author: { id: OTHER, username: 'bob' },
      type: REPLY_MESSAGE_TYPE,
      message_reference: { message_id: mine.id },
      referenced_message: mine,
    } as never);
    const mention = rawMessage('c1', now, `<@${OWNER.id}> look`, { author: { id: OTHER, username: 'bob' } });
    archive.ingestMessages([mine, reply, mention], ARRIVAL.gateway);
    await settleAlerts();
    expect(rules.alerts({ limit: 10 }).map((a) => [a.messageId, a.matchKind])).toEqual([
      [mention.id, 'pattern'],
      [reply.id, 'pattern'],
    ]);
    expect(jev.requests.some((r) => 'aimed' in r.questions)).toBe(false);
  });

  it('shows Jev the message a reply answers', async () => {
    const { archive } = h;
    const now = Date.now();
    const theirs = rawMessage('c1', now - 1_000, 'who has the doc?', { author: { id: 'u3', username: 'carol' } });
    const reply = rawMessage('c1', now, 'I do', {
      author: { id: OTHER, username: 'bob' },
      type: REPLY_MESSAGE_TYPE,
      message_reference: { message_id: theirs.id },
      referenced_message: theirs,
    } as never);
    archive.ingestMessages([theirs, reply], ARRIVAL.gateway);
    await settleAlerts();
    const req = jev.requests.find((r) => (r.state as { message: string }).message.endsWith('I do'))!;
    expect((req.state as { replying_to?: string }).replying_to).toBe('carol: who has the doc?');
  });

  it('never judges the owner’s own messages', async () => {
    w.check(live('talking to myself', OWNER.id), arrivedLive());
    await settleAlerts();
    expect(jev.requests).toEqual([]);
  });

  it('turning it off keeps its alerts and stops new ones', async () => {
    jev.values = { aimed: 0.9 };
    w.check(live('hey cujuju'), arrivedLive());
    await settleAlerts();
    jev.on['alerts.aimedAtMe'] = false;
    rules.syncBuiltins(jev.on);
    w.check(live('cujuju?'), arrivedLive());
    await settleAlerts();
    expect(rules.alerts({ limit: 10 })).toHaveLength(1);
    expect(builtin().enabled).toBe(false);
  });

  it('only name, gates and actions of the built-in rule are editable; its Jev switch owns on/off', () => {
    const t = builtin();
    const edit = {
      ...t,
      name: 'For me',
      enabled: !t.enabled,
      spec: {
        ...t.spec,
        gates: { ...t.spec.gates, channelIds: ['c1'] },
        actions: [{ id: 'alert', type: 'alerts.notify', config: { toast: { cooldownMs: MS_PER_MIN } } }],
      },
    };
    rules.update(t.id, edit);
    expect(builtin()).toMatchObject({ name: 'For me', enabled: t.enabled, builtin: 'alerts.aimed_at_me', spec: edit.spec });
    expect(() =>
      rules.update(t.id, { ...edit, spec: { ...edit.spec, match: [{ type: 'meaning', config: 'x' }] } }),
    ).toThrow();
  });
});
