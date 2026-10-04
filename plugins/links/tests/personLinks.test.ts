// A person's links (the Person window's Links tab): one row per link at their latest share of it, newest first.
import { beforeEach, describe, expect, it } from 'vitest';
import { SETTINGS_KEYS } from '@shared/settings';
import { MS_PER_MIN, MS_PER_S } from '@shared/units';
import type { Archive } from '@core/archive';
import { ARRIVAL } from '@core/arrival';
import { setSetting, type Db } from '@core/db';
import { rawMessage, seedArchive, tempDb } from '@chattypop/host-testing';
import { adoptLinks, personLinks } from './linksHarness';

const GUILD = { id: '100000000000000001', name: 'Open Server' };
const GENERAL = '200000000000000001';
const MODS = '200000000000000002';
const BOB = { id: '400000000000000001', username: 'bob', global_name: 'Bob', avatar: null };
const CAT = { id: '400000000000000002', username: 'cat', global_name: 'Cat', avatar: null };
const POST = 'https://example.com/post';
const NEWS = 'https://example.com/news';

let db: Db;
let archive: Archive;
/** One clock for every message and expectation. */
const T0 = Date.now() - MS_PER_MIN;
const at = (n: number): number => T0 + n * MS_PER_S;
const urls = (userId: string, limit = 10): string[] => personLinks(db, { userId, limit }).map((l) => l.url);

beforeEach(() => {
  db = adoptLinks(tempDb());
  archive = seedArchive(
    db,
    [
      { id: GENERAL, name: 'general', guildId: GUILD.id },
      { id: MODS, name: 'mod-chat', guildId: GUILD.id },
    ],
    { guilds: [GUILD] },
  );
  archive.setChannelPolicy(MODS, { hideInPrivacy: true });
  archive.ingestMessages([
    rawMessage(GENERAL, at(1), `first ${POST}`, { author: CAT }),
    rawMessage(GENERAL, at(2), `look ${POST}`, { author: BOB }),
    rawMessage(GENERAL, at(3), `read ${NEWS}`, { author: BOB }),
    rawMessage(MODS, at(4), `again ${POST}`, { author: BOB }),
  ], ARRIVAL.gateway);
});

describe("a person's links", () => {
  it('are the links they shared, each once at their latest share, newest first', () => {
    const [post, news] = personLinks(db, { userId: BOB.id, limit: 10 });
    expect([post!.url, news!.url]).toEqual([POST, NEWS]);
    // Cat shared the post first; Bob's row is his own latest share of it.
    expect(post).toMatchObject({ channelId: MODS, channelName: 'mod-chat', guildName: GUILD.name, authorName: 'Bob', ts: at(4), shares: 3 });
    expect(news).toMatchObject({ channelId: GENERAL, ts: at(3), shares: 1 });
    expect(urls(CAT.id)).toEqual([POST]);
  });

  it('stop at the limit', () => {
    expect(urls(BOB.id, 1)).toEqual([POST]);
  });

  it('count only the shares privacy mode shows', () => {
    setSetting(db, SETTINGS_KEYS.privacyMode, true);
    const links = personLinks(db, { userId: BOB.id, limit: 10 });
    // His share in the hidden channel is gone: the post falls back to his visible share of it.
    expect(links.map((l) => [l.url, l.channelId, l.ts])).toEqual([[NEWS, GENERAL, at(3)], [POST, GENERAL, at(2)]]);
  });
});
