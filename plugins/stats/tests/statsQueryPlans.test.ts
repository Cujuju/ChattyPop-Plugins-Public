// Analytics stats over a realistically shaped archive: indexed plans, and the same counts as reading outside SQL.
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '@core/db';
import { privacyScope } from '@core/queries/privacy';
import { tempDb } from '@chattypop/host-testing';
import { statementPlans } from '@chattypop/host-testing/queryPlan';
import { TEST_ARCHIVE, hideSome, seedPerfArchive } from '@chattypop/host-testing/perfArchiveFixture';
import { activityStats, postersPage } from '../core/stats';
import { hourlyHistogram } from '../core/histogram';
import { voiceStats } from '../core/voice';
import { VOICE_PEOPLE } from '../shared/voice';
import { wordStats } from '../core/words';
import { conversationStats } from '../core/conversations';
import { peopleStats, personHistory } from '../core/personHistory';
import type { ActivityQuery } from '../shared/types';
import { ATTACHMENT_KINDS, EDIT_DELAY_BUCKETS, POSTERS_PAGE_MAX, POSTERS_TOP, STATS_TOP } from '../shared/types';
import { MS_PER_MIN } from '@plugin-sdk/shared';

/** Analytics over the whole archive: the heaviest stats read. */
const ALL_TIME: ActivityQuery = { scope: 'all', channelId: null, sinceTs: null };

/** Visible messages computed outside SQL from the privacy scope: the parity oracle. */
interface Message {
  id: string;
  channel_id: string;
  author_id: string;
  ts: number;
  edited_ts: number | null;
  content: string;
}

function visibleMessages(db: Db): Message[] {
  const { channelIds, guildIds } = privacyScope(db);
  const hidden = [...channelIds, ...guildIds];
  return (db.prepare('SELECT id, channel_id, author_id, ts, edited_ts, content FROM messages').all() as Message[])
    .filter((m) => !channelIds.includes(m.channel_id) && !hidden.some((id) => m.content.includes(id)));
}

const EDIT_EVERY_MESSAGES = 11;
const ATTACHMENT_EVERY_MESSAGES = 19;
const LOCAL_DATE_PAD = 2;
const MONTH_NUMBER_OFFSET = 1;

function seedCounts(db: Db): void {
  const rows = db.prepare('SELECT id, channel_id FROM messages ORDER BY seq').all() as Pick<Message, 'id' | 'channel_id'>[];
  const edit = db.prepare('UPDATE messages SET edited_ts = ts + ? WHERE id = ?');
  const attach = db.prepare('INSERT INTO attachments (id, message_id, channel_id, filename, content_type, url) VALUES (?, ?, ?, ?, ?, ?)');
  for (const [index, row] of rows.entries()) {
    if (index % EDIT_EVERY_MESSAGES === 0) edit.run(index * MS_PER_MIN, row.id);
    if (index % ATTACHMENT_EVERY_MESSAGES === 0) {
      const kind = ATTACHMENT_KINDS[index % ATTACHMENT_KINDS.length]!;
      attach.run(`a-${index}`, row.id, row.channel_id, 'file', kind === 'other' ? null : `${kind}/test`, 'https://cdn.example/file');
    }
  }
}

const pad = (n: number): string => String(n).padStart(LOCAL_DATE_PAD, '0');
function localStart(ts: number, period: 'hour' | 'day' | 'month' | 'year'): string {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = period === 'year' ? '01' : pad(d.getMonth() + MONTH_NUMBER_OFFSET);
  const day = period === 'year' || period === 'month' ? '01' : pad(d.getDate());
  return `${year}-${month}-${day}${period === 'hour' ? `T${pad(d.getHours())}:00:00` : ''}`;
}

function ranked(values: string[]): { id: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const id of values) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

/** JS grouping over raw fixture rows is independent of the plugin's aggregate SQL. */
function expectCounts(db: Db): void {
  const visible = visibleMessages(db);
  const byId = new Map(visible.map((m) => [m.id, m]));
  const attachments = (db.prepare('SELECT message_id, content_type FROM attachments').all() as { message_id: string; content_type: string | null }[])
    .filter((a) => byId.has(a.message_id));
  const shares = (db.prepare('SELECT message_id FROM message_links').all() as { message_id: string }[]).filter((s) => byId.has(s.message_id));
  const stats = activityStats(db, ALL_TIME);
  expect(stats.activeDays).toBe(new Set(visible.map((m) => localStart(m.ts, 'day'))).size);
  const edited = visible.filter((m) => m.edited_ts !== null);
  expect(stats.editedMessages).toBe(edited.length);
  expect(stats.textMessages).toBe(visible.filter((m) => m.content.trim() !== '').length);
  expect(stats.linkedMessages).toBe(new Set(shares.map((s) => s.message_id)).size);
  expect(stats.attachmentMessages).toBe(new Set(attachments.map((a) => a.message_id)).size);
  for (const period of ['hour', 'day', 'month', 'year'] as const) {
    const first = ranked(visible.map((m) => localStart(m.ts, period)))[0];
    expect(stats.mostActive[period]).toEqual(first ? { start: first.id, count: first.count } : null);
  }
  expect(stats.channels.map((c) => ({ id: c.channelId, count: c.count }))).toEqual(ranked(visible.map((m) => m.channel_id)).slice(0, STATS_TOP));
  expect(stats.posters.map((p) => ({ id: p.userId, count: p.count }))).toEqual(ranked(visible.map((m) => m.author_id)).slice(0, POSTERS_TOP));
  expect(stats.linksByPerson.map((p) => ({ id: p.userId, count: p.count }))).toEqual(ranked(shares.map((s) => byId.get(s.message_id)!.author_id)).slice(0, STATS_TOP));
  expect(stats.linksByChannel.map((c) => ({ id: c.channelId, count: c.count }))).toEqual(ranked(shares.map((s) => byId.get(s.message_id)!.channel_id)).slice(0, STATS_TOP));
  expect(stats.editDelay).toEqual(EDIT_DELAY_BUCKETS.map((bucket) => ({
    id: bucket.id,
    count: edited.filter((m) => EDIT_DELAY_BUCKETS.find((b) => b.beforeMs === null || m.edited_ts! - m.ts < b.beforeMs)!.id === bucket.id).length,
  })));
  expect(stats.attachmentTypes).toEqual(ATTACHMENT_KINDS.map((kind) => ({ kind, count: attachments.filter((a) => {
    const prefix = a.content_type?.split('/')[0];
    return (prefix && ATTACHMENT_KINDS.includes(prefix as typeof kind) ? prefix : 'other') === kind;
  }).length })));
  const firstByPerson = new Map<string, number>();
  for (const m of visible) firstByPerson.set(m.author_id, Math.min(firstByPerson.get(m.author_id) ?? Infinity, m.ts));
  for (const month of stats.timeline) {
    expect(month.activePosters).toBe(new Set(visible.filter((m) => localStart(m.ts, 'month') === month.start).map((m) => m.author_id)).size);
    expect(month.newPosters).toBe([...firstByPerson.values()].filter((ts) => localStart(ts, 'month') === month.start).length);
  }
  expect(postersPage(db, { ...ALL_TIME, offset: STATS_TOP, limit: POSTERS_PAGE_MAX }).map((p) => ({ id: p.userId, count: p.count })))
    .toEqual(ranked(visible.map((m) => m.author_id)).slice(STATS_TOP, STATS_TOP + POSTERS_PAGE_MAX));
}

describe('activity stats under privacy mode', () => {
  it.each([false, true])('shares one privacy-aware author/day history read (hiding: %s)', (hiding) => {
    const db = tempDb();
    const fixture = seedPerfArchive(db, TEST_ARCHIVE);
    if (hiding) hideSome(db, fixture);
    const stats = personHistory(db, ALL_TIME);
    const visible = visibleMessages(db);
    expect(stats.archivedSince).toBe(Math.min(...visible.map((m) => m.ts)));
    expect(stats.lastDay).toBe(localStart(Math.max(...visible.map((m) => m.ts)), 'day'));
    const prepare = vi.spyOn(db, 'prepare');
    peopleStats(db, { ...ALL_TIME, sinceTs: Math.max(...visible.map((m) => m.ts)) });
    expect(prepare.mock.calls.filter(([sql]) => /FROM archive_messages/.test(sql))).toHaveLength(1);
    prepare.mockRestore();
    const details = statementPlans(db, () => peopleStats(db, ALL_TIME)).join('\n');
    expect(details).toMatch(/(?<!CORRELATED )SCALAR SUBQUERY \d+\nSCAN hidden_ids\b/);
    expect(details).toMatch(/CORRELATED SCALAR SUBQUERY \d+\nSCAN h\b/);
    expect(details).not.toMatch(/SCAN c\b|SEARCH p\b|SCAN guilds|COMPOUND QUERY/);
  });

  it.each([false, true])('keeps conversation-role identities on visible messages (hiding: %s)', async (hiding) => {
    const db = tempDb();
    const fixture = seedPerfArchive(db, TEST_ARCHIVE);
    if (hiding) hideSome(db, fixture);
    const visible = visibleMessages(db);
    const first = visible[0]!;
    const second = visible.find((m) => m.channel_id === first.channel_id && m.id !== first.id)!;
    db.prepare('UPDATE messages SET ts = ?, author_id = ? WHERE id = ?').run(first.ts, 'role-replier', second.id);
    const prepare = vi.spyOn(db, 'prepare');
    try {
      const stats = await conversationStats(db, ALL_TIME);
      expect(stats.messages).toBe(visibleMessages(db).length);
      expect(stats.roles.starts.length).toBeGreaterThan(0);
      const sql = prepare.mock.calls.map(([sql]) => sql).find((sql) => sql.startsWith('SELECT m.author_id AS userId'))!;
      prepare.mockRestore();
      const ids = [...new Set([...stats.people, ...stats.roles.starts, ...stats.roles.closes, ...stats.roles.fastest].map((p) => p.userId))];
      const details = statementPlans(db, () => db.prepare(sql).all(...ids)).join('\n');
      expect(details).toMatch(/(?<!CORRELATED )SCALAR SUBQUERY \d+\nSCAN hidden_ids\b/);
      expect(details).toMatch(/CORRELATED SCALAR SUBQUERY \d+\nSCAN h\b/);
    } finally { prepare.mockRestore(); }
  });

  it.each([false, true])('keeps word-trend extent and token counts private (hiding: %s)', async (hiding) => {
    const db = tempDb();
    const fixture = seedPerfArchive(db, TEST_ARCHIVE);
    if (hiding) hideSome(db, fixture);
    const prepare = vi.spyOn(db, 'prepare');
    try {
      const stats = await wordStats(db, ALL_TIME);
      expect(stats.textMessages).toBe(visibleMessages(db).filter((m) => m.content.trim()).length);
      expect(stats.trends.earlierWords + stats.trends.laterWords).toBe(stats.totalWords);
      const extent = prepare.mock.calls.map(([sql]) => sql).find((sql) => sql.startsWith('SELECT MIN(m.ts)'))!;
      prepare.mockRestore();
      const details = statementPlans(db, () => db.prepare(extent).get()).join('\n');
      expect(details).toMatch(/(?<!CORRELATED )SCALAR SUBQUERY \d+\nSCAN hidden_ids\b/);
      expect(details).toMatch(/CORRELATED SCALAR SUBQUERY \d+\nSCAN h\b/);
    } finally { prepare.mockRestore(); }
  });

  it.each([false, true])('keeps share-of-voice SQL on the privacy-aware archive (hiding: %s)', (hiding) => {
    const db = tempDb();
    const fixture = seedPerfArchive(db, TEST_ARCHIVE);
    if (hiding) hideSome(db, fixture);
    const visible = visibleMessages(db);
    const stats = voiceStats(db, ALL_TIME);
    expect(stats.buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(visible.length);
    expect(stats.people.map((p) => [p.poster.userId, p.poster.count])).toEqual(ranked(visible.map((m) => m.author_id)).slice(0, VOICE_PEOPLE).map((p) => [p.id, p.count]));
    const details = statementPlans(db, () => voiceStats(db, ALL_TIME)).join('\n');
    expect(details).toMatch(/(?<!CORRELATED )SCALAR SUBQUERY \d+\nSCAN hidden_ids\b/);
    expect(details).toMatch(/CORRELATED SCALAR SUBQUERY \d+\nSCAN h\b/);
    expect(details).not.toMatch(/SCAN c\b|SEARCH p\b|SCAN guilds|COMPOUND QUERY/);
  });

  it('runs 12 archive-message statements with one local hourly histogram for Everything', () => {
    const db = tempDb();
    seedPerfArchive(db, TEST_ARCHIVE);
    const prepare = vi.spyOn(db, 'prepare');
    try {
      activityStats(db, ALL_TIME);
      const statements = prepare.mock.calls.map(([sql]) => sql).filter((sql) => /\barchive_messages\b/.test(sql));
      expect(statements).toHaveLength(12);
      expect(prepare.mock.calls).toHaveLength(13);
      expect(statements.filter((sql) => /GROUP BY date, hour/.test(sql))).toHaveLength(1);
    } finally {
      prepare.mockRestore();
    }
  });

  it.each([false, true])('groups the hourly histogram in one privacy-aware message scan (hiding: %s)', (hiding) => {
    const db = tempDb();
    const fixture = seedPerfArchive(db, TEST_ARCHIVE);
    if (hiding) hideSome(db, fixture);
    const details = statementPlans(db, () => hourlyHistogram(db, { sql: '1', params: [] })).join('\n');
    expect(details.match(/SCAN m\b/g)).toHaveLength(1);
    expect(details).toMatch(/USE TEMP B-TREE FOR GROUP BY/);
    expect(details).toMatch(/(?<!CORRELATED )SCALAR SUBQUERY \d+\nSCAN hidden_ids\b/);
    expect(details).toMatch(/CORRELATED SCALAR SUBQUERY \d+\nSCAN h\b/);
  });

  it.each([false, true])('checks the scope once per statement and each message against the hidden ids alone (hiding: %s)', (hiding) => {
    const db = tempDb();
    const fixture = seedPerfArchive(db, TEST_ARCHIVE);
    seedCounts(db);
    if (hiding) hideSome(db, fixture);
    const details = statementPlans(db, () => {
      activityStats(db, ALL_TIME);
      postersPage(db, { ...ALL_TIME, offset: STATS_TOP, limit: STATS_TOP });
    }).join('\n');
    // Whether anything is hidden: an uncorrelated subquery, run once.
    expect(details).toMatch(/(?<!CORRELATED )SCALAR SUBQUERY \d+\nSCAN hidden_ids\b/);
    // Per message: a scan of the few hidden ids (#135), never the channels and servers the scope derives from.
    expect(details).toMatch(/CORRELATED SCALAR SUBQUERY \d+\nSCAN h\b/);
    expect(details).not.toMatch(/SCAN c\b|SEARCH p\b|SCAN guilds|COMPOUND QUERY/);
  });

  it.each([false, true])('matches every new aggregate and poster page to raw fixture rows (hiding: %s)', (hiding) => {
    const db = tempDb();
    const fixture = seedPerfArchive(db, TEST_ARCHIVE);
    seedCounts(db);
    if (hiding) hideSome(db, fixture);
    expectCounts(db);
    const details = statementPlans(db, () => activityStats(db, ALL_TIME)).join('\n');
    expect(details).toMatch(/SCAN message_links\nSEARCH (?:l|m)\b/);
    expect(details).toMatch(/SEARCH m USING INDEX sqlite_autoindex_messages_1 \(id=\?\)/);
    expect(details).toMatch(/SEARCH (?:a|attachments).*attachments_message/);
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
