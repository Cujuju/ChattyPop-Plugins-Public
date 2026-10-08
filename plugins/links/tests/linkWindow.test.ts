// The Links feed around a place: a restart reopens there, paging newer links in toward the newest.
import { describe, expect, it } from 'vitest';
import { MS_PER_MIN, MS_PER_S } from '@shared/units';
import { ARRIVAL } from '@core/arrival';
import { rawMessage, seedArchive, tempDb } from '@chattypop/host-testing';
import { normalizeLinkPlace, type LinkItem } from '../shared/types';
import { adoptLinks, linkFeed, linkFeedWindow } from './linksHarness';

const GENERAL = '200000000000000001';
const ids = (items: { id: number }[]): number[] => items.map((i) => i.id);

/** `count` links, one per message a second apart; returns them newest first. */
function seedLinks(count: number) {
  const db = adoptLinks(tempDb());
  const t0 = Date.now() - MS_PER_MIN;
  seedArchive(db, [{ id: GENERAL, name: 'general' }]).ingestMessages(
    Array.from({ length: count }, (_, n) => rawMessage(GENERAL, t0 + n * MS_PER_S, `see https://example.com/${n}`)),
    ARRIVAL.gateway,
  );
  return { db, newestFirst: linkFeed(db, { limit: count }) as LinkItem[] };
}

describe('links window', () => {
  it('reads the place and its neighbours in sort order, and pages newer links before a cursor', () => {
    const { db, newestFirst } = seedLinks(6);
    const [n6, n5, n4, n3, n2] = newestFirst as [LinkItem, LinkItem, LinkItem, LinkItem, LinkItem];
    const w = linkFeedWindow(db, { around: { ts: n3.ts, id: n3.id }, newer: 2, older: 2 });
    expect(ids(w.items)).toEqual([n5.id, n4.id, n3.id, n2.id]);
    expect(w).toMatchObject({ anchorId: n3.id, reachesNewest: false, reachedStart: false });
    // The page before a loaded link: the nearest newer ones, still newest first.
    expect(ids(linkFeed(db, { limit: 1, before: { ts: n3.ts, id: n3.id } }))).toEqual([n4.id]);
    expect(ids(linkFeed(db, { limit: 5, before: { ts: n5.ts, id: n5.id } }))).toEqual([n6.id]);
    const all = linkFeedWindow(db, { around: { ts: n2.ts, id: n2.id }, newer: 5, older: 5 });
    expect(ids(all.items)).toEqual(ids(newestFirst));
    expect(all).toMatchObject({ reachesNewest: true, reachedStart: true });
  });

  it('stands a gone place for its nearest older link, else its nearest newer', () => {
    const { db, newestFirst } = seedLinks(3);
    const [n3, n2, n1] = newestFirst as [LinkItem, LinkItem, LinkItem];
    // Just newer than n2, older than n3: no link there.
    expect(linkFeedWindow(db, { around: { ts: n2.ts, id: n2.id + 1 }, newer: 1, older: 1 }).anchorId).toBe(n2.id);
    expect(linkFeedWindow(db, { around: { ts: n1.ts - 1, id: 0 }, newer: 1, older: 1 }).anchorId).toBe(n1.id);
    expect(linkFeedWindow(db, { around: { ts: n3.ts, id: n3.id }, newer: 0, older: 0 }).anchorId).toBeNull();
  });

  it('keeps only a whole place', () => {
    expect(normalizeLinkPlace({ ts: 1, id: 2, bottom: -3, worth: 2.5 })).toEqual({ ts: 1, id: 2, bottom: -3, worth: 2.5 });
    expect(normalizeLinkPlace({ ts: 1, id: 2, bottom: 0 })).toEqual({ ts: 1, id: 2, bottom: 0 });
    expect(normalizeLinkPlace({ ts: 1, id: 2 })).toBeNull();
    expect(normalizeLinkPlace({ ts: 1, id: 2, bottom: Number.NaN })).toBeNull();
    expect(normalizeLinkPlace('x')).toBeNull();
  });
});
