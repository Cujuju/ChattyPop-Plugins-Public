import { statementRead } from '@chattypop/host-testing';
// The Links feed over a realistically shaped archive: shares read by index, with the same pages as a full scan.
import { describe, expect, it } from 'vitest';
import type { Db } from '@core/db';
import { adoptBundledData } from '@core/plugins/adoption';
import { tempDb } from '@chattypop/host-testing';
import { TEST_ARCHIVE, seedPerfArchive } from '@chattypop/host-testing/perfArchiveFixture';
import { readPlans } from '@chattypop/host-testing/queryPlan';
import { linkPage } from '../core/feed';
import { linksSql } from './linksHarness';
import { plugin as linksPlugin } from '../shared';
import type { LinkSort } from '../shared/types';

/** The feed's page size in the Links panel. */
const LINK_PAGE = 100;
const SORTS: LinkSort[] = ['newest', 'worth'];

/** The perf archive with Links' data adopted, as its reads run over it. */
function seedPluginArchive(db: Db): ReturnType<typeof seedPerfArchive> {
  adoptBundledData(db, [linksPlugin]);
  return seedPerfArchive(db, TEST_ARCHIVE);
}

const linkPages = async (db: Db) => Promise.all(SORTS.map(async (sort) => (await linkPage(statementRead(db), async () => new Map(), () => [], { limit: LINK_PAGE, sort }, linksSql))));
const indexesOn = (db: Db, table: string): string[] =>
  db.prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL").pluck().all(table) as string[];

describe('links feed shares', () => {
  it('counts and loads each page link’s shares by index, with the same pages as a full scan', async () => {
    const db = tempDb();
    seedPluginArchive(db);
    const details = (await readPlans(db, async () => (await linkPages(db)))).join('\n');
    expect(details).toMatch(/SEARCH (?:ml|message_links) USING COVERING INDEX/);
    expect(details).not.toMatch(/SCAN (?:ml|message_links)\b/);
    const indexed = (await linkPages(db));
    for (const name of indexesOn(db, 'message_links')) db.exec(`DROP INDEX ${name}`);
    expect((await linkPages(db))).toEqual(indexed);
    expect(indexed.flat().some((link) => link.shares > 1)).toBe(true);
  });
});
