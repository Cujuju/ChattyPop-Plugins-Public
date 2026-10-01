// Tags' tag: search operator over the archive.
import { beforeEach, describe, expect, it } from 'vitest';
import { SEARCH_MATCH_END, SEARCH_MATCH_START } from '@shared/contract';
import type { Db } from '@core/db';
import { searchMessages } from '@core/queries/search';
import { ARRIVAL } from '@core/arrival';
import { rawMessage, seedArchive, tempDb } from '@chattypop/host-testing';
import { startTags } from './tagsHarness';

/** Noon local time on a day of September 2026 (month index 8), clear of any day edge. */
const sept = (day: number): number => new Date(2026, 8, day, 12).getTime();

describe('archive search', () => {
  let db: Db;
  const hits = (q: string): string[] =>
    searchMessages(db, q, 50)
      .map((h) => h.snippet.replaceAll(SEARCH_MATCH_START, '').replaceAll(SEARCH_MATCH_END, ''))
      .sort();

  beforeEach(() => {
    db = tempDb();
    const archive = seedArchive(db, [{ id: 'c1', name: 'general' }]);
    archive.ingestMessages([rawMessage('c1', sept(1), 'alpha one'), rawMessage('c1', sept(2), 'alpha two')], ARRIVAL.gateway);
  });

  it('filters by a shown tag, case-insensitively', () => {
    const tags = startTags(db);
    const id = tags.create({ name: 'Calls', jevQuestion: null, auto: false });
    const [one] = searchMessages(db, 'one', 1);
    tags.setManual(one!.messageId, id, true);
    expect(hits('tag:calls')).toEqual(['alpha one']);
    tags.setManual(one!.messageId, id, false);
    expect(hits('tag:calls')).toEqual([]);
  });
});
