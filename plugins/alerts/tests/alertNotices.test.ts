// Alerts' desktop and phone notices for a burst of alerts.
import { describe, expect, it } from 'vitest';
import type { AlertItem } from '../shared/types';
import { alertNotices } from '../main/notices';

const alert = (i: number, sourceName = 'Drops'): AlertItem => ({
  id: i, ruleId: 1, sourceName, messageId: `m${i}`, channelId: 'c1', channelName: 'general', authorId: 'a', authorName: 'Ann',
  authorAvatar: null, ts: 0, snippet: 'restock at 5', mentions: {}, readAt: null, matchKind: 'pattern', probability: null, duplicateOf: null,
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
