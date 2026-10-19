// The feed's place filter: one channel with its threads, or every channel and thread in a server.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MS_PER_MIN, MS_PER_S } from '@shared/units';
import { ARRIVAL } from '@core/arrival';
import type { Db } from '@core/db';
import { linkCounts } from '../core/feed';
import { rawMessage, seedArchive, tempDb, statementRead } from '@chattypop/host-testing';
import { adoptLinks, linkFeed } from './linksHarness';

const HOME = { id: '100000000000000001', name: 'Home' };
const AWAY = { id: '100000000000000002', name: 'Away' };
const GENERAL = '200000000000000001';
const NEWS = '200000000000000002';
const LOBBY = '200000000000000003';
const GENERAL_THREAD = '300000000000000001';

let db: Db;
const at = (n: number): number => Date.now() - MS_PER_MIN + n * MS_PER_S;
const urls = async (q: { channelId?: string; guildId?: string }): Promise<string[]> => (await linkFeed(db, { ...q, limit: 10 })).map((l) => l.url).sort();

beforeEach(() => {
  db = adoptLinks(tempDb());
  const archive = seedArchive(
    db,
    [
      { id: GENERAL, name: 'general', guildId: HOME.id },
      { id: NEWS, name: 'news', guildId: HOME.id },
      { id: LOBBY, name: 'lobby', guildId: AWAY.id },
    ],
    { guilds: [HOME, AWAY] },
  );
  archive.upsertThreads([{ id: GENERAL_THREAD, name: 'side talk', type: 11, parent_id: GENERAL, last_message_id: null }], 0);
  archive.ingestMessages([
    rawMessage(GENERAL, at(1), 'https://example.com/general'),
    rawMessage(GENERAL_THREAD, at(2), 'https://example.com/thread'),
    rawMessage(NEWS, at(3), 'https://example.com/news'),
    rawMessage(LOBBY, at(4), 'https://example.com/lobby'),
  ], ARRIVAL.gateway);
});

afterEach(() => { db.close(); });

describe('the links feed by place', async () => {
  it('a server lists links from each of its channels and threads, and no other server', async () => {
    expect(await urls({ guildId: HOME.id })).toEqual(['https://example.com/general', 'https://example.com/news', 'https://example.com/thread']);
    expect(await urls({ guildId: AWAY.id })).toEqual(['https://example.com/lobby']);
  });

  it('a channel lists its own links and its threads\'', async () => {
    expect(await urls({ channelId: GENERAL })).toEqual(['https://example.com/general', 'https://example.com/thread']);
  });

  it('counts follow the place', async () => {
    expect(Object.values(await linkCounts(statementRead(db), { guildId: HOME.id })).reduce((a, n) => a + (n ?? 0), 0)).toBe(3);
  });
});
