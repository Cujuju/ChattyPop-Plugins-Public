// Activity stats over a realistically shaped archive: indexed plans, and the same counts as reading outside SQL.
import { describe, expect, it } from 'vitest';
import type { Db } from '@core/db';
import { privacyScope } from '@core/queries/privacy';
import { tempDb } from '@chattypop/host-testing';
import { statementPlans } from '@chattypop/host-testing/queryPlan';
import { TEST_ARCHIVE, hideSome, seedPerfArchive } from '@chattypop/host-testing/perfArchiveFixture';
import { activityStats } from '../core/stats';
import type { ActivityQuery } from '../shared/types';

/** Activity over the whole archive: the heaviest stats read. */
const ALL_TIME: ActivityQuery = { scope: 'all', channelId: null, sinceTs: null };

/** Visible messages computed outside SQL from the privacy scope: the parity oracle. */
function visibleMessages(db: Db): { id: string; author_id: string }[] {
  const { channelIds, guildIds } = privacyScope(db);
  const hidden = [...channelIds, ...guildIds];
  return (db.prepare('SELECT id, channel_id, author_id, content FROM messages').all() as { id: string; channel_id: string; author_id: string; content: string }[])
    .filter((m) => !channelIds.includes(m.channel_id) && !hidden.some((id) => m.content.includes(id)));
}

describe('activity stats under privacy mode', () => {
  it.each([false, true])('checks the scope once per statement and each message against the hidden ids alone (hiding: %s)', (hiding) => {
    const db = tempDb();
    const fixture = seedPerfArchive(db, TEST_ARCHIVE);
    if (hiding) hideSome(db, fixture);
    const details = statementPlans(db, () => activityStats(db, ALL_TIME)).join('\n');
    // Whether anything is hidden: an uncorrelated subquery, run once.
    expect(details).toMatch(/(?<!CORRELATED )SCALAR SUBQUERY \d+\nSCAN hidden_ids\b/);
    // Per message: a scan of the few hidden ids (#135), never the channels and servers the scope derives from.
    expect(details).toMatch(/CORRELATED SCALAR SUBQUERY \d+\nSCAN h\b/);
    expect(details).not.toMatch(/SCAN c\b|SEARCH p\b|SCAN guilds|COMPOUND QUERY/);
  });

  it('counts exactly the messages privacy mode leaves visible, on and off', () => {
    const db = tempDb();
    const fixture = seedPerfArchive(db, TEST_ARCHIVE);
    const expectVisible = (): void => {
      const visible = visibleMessages(db);
      const stats = activityStats(db, ALL_TIME);
      expect(stats.messages).toBe(visible.length);
      expect(stats.authors).toBe(new Set(visible.map((m) => m.author_id)).size);
      expect(db.prepare('SELECT id FROM archive_messages ORDER BY id').pluck().all()).toEqual(visible.map((m) => m.id).sort());
    };
    expectVisible();
    hideSome(db, fixture);
    expectVisible();
    expect(visibleMessages(db).length).toBeLessThan(TEST_ARCHIVE.messages);
  });
});
