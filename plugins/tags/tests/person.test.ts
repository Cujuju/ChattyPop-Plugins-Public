// Tags' section of a person's profile.
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@core/db';
import { ARRIVAL } from '@core/arrival';
import { rawMessage, seedArchive, tempDb } from '@chattypop/host-testing';
import { personTags } from '../core/person';
import { TagStore } from '../core/store';
import { adoptTags } from './tagsHarness';

const THEO = { id: 'u2', username: 'theo', global_name: 'Theo' };

describe('person profile', () => {
  let db: Db;

  beforeEach(() => {
    db = tempDb();
    const archive = seedArchive(db, [{ id: 'c1', name: 'general' }]);
    archive.ingestMessages([
      rawMessage('c1', 1_000, 'hi', { author: THEO }),
      rawMessage('c1', 2_000, 'again', { author: THEO }),
      rawMessage('c1', 5_000, 'not theo'),
    ], ARRIVAL.sync);
  });

  it('counts shown tags only', () => {
    const tags = new TagStore(adoptTags(db));
    const id = tags.create({ name: 'Calls', jevQuestion: null, auto: false });
    const ids = db.prepare("SELECT id FROM messages WHERE author_id = 'u2' ORDER BY ts").pluck().all() as string[];
    tags.setManual(ids[0]!, id, true);
    tags.setManual(ids[1]!, id, true);
    tags.setManual(ids[1]!, id, false);
    expect(personTags(db, THEO.id)).toEqual([{ name: 'Calls', count: 1 }]);
  });
});
