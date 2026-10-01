// Alerts' desktop and phone notices for a burst of alerts, and the devices each request goes to.
import { describe, expect, it } from 'vitest';
import type { AlertDelivery, AlertItem, NotifyDevice } from '../shared/types';
import { alertNotices, alertRequests } from '../main/notices';

const alert = (i: number, sourceName = 'Drops'): AlertItem => ({
  id: i, ruleId: 1, sourceName, messageId: `m${i}`, channelId: 'c1', channelName: 'general', authorId: 'a', authorName: 'Ann',
  authorAvatar: null, ts: 0, snippet: 'restock at 5', mentions: {}, readAt: null, matchKind: 'pattern', probability: null, duplicateOf: null,
  held: { desktop: null, phone: null },
});

describe('notices', () => {
  it('gives each alert of a small burst its own notice, opening its message', () => {
    const n = alertNotices([alert(1), alert(2)]);
    expect(n.map((x) => x.title)).toEqual(['Drops · #general', 'Drops · #general']);
    expect(n[0]).toMatchObject({ kind: 'alert', body: 'Ann: restock at 5', open: { channelId: 'c1', messageId: 'm1' } });
  });

  it('folds a larger burst into one notice naming its rules', () => {
    const n = alertNotices([alert(1), alert(2, 'Deals'), alert(3), alert(4)]);
    expect(n).toEqual([{ kind: 'alert', title: '4 new alerts', body: 'Drops, Deals', open: { channelId: 'c1', messageId: 'm1' } }]);
  });
});

const to = (devices: NotifyDevice[], ...ids: number[]): AlertDelivery[] => ids.map((id) => ({ alert: alert(id), devices }));

describe('notification requests', () => {
  it('narrows each request to the devices core chose', () => {
    const requests = alertRequests([...to(['desktop', 'phone'], 1), ...to(['phone'], 2), ...to(['desktop'], 3)]);
    expect(requests.map((r) => [r.target?.kind === 'message' && r.target.messageId, r.desktop, r.phone])).toEqual([
      ['m1', undefined, undefined],
      ['m2', false, undefined],
      ['m3', undefined, false],
    ]);
  });

  it('merges a burst only among alerts bound for the same devices', () => {
    const requests = alertRequests([...to(['desktop', 'phone'], 1, 2, 3, 4), ...to(['phone'], 5)]);
    expect(requests.map((r) => [r.title, r.desktop])).toEqual([
      ['4 new alerts', undefined],
      ['Drops · #general', false],
    ]);
  });
});
