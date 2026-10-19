import { statementRead } from '@chattypop/host-testing';
// Links feed reads under privacy: hidden shares still count, but never supply preview cards.
import { beforeEach, describe, expect, it } from 'vitest';
import { setSetting, type Db } from '@core/db';
import { adoptBundledData } from '@core/plugins/adoption';
import { archivePayloads } from '@core/plugins/archivePayloads';
import { tempDb } from '@chattypop/host-testing';
import { seedArchiveViews } from '@chattypop/host-testing/archiveViewsFixture';
import { linkPage } from '../core/feed';
import { linksSql } from './linksHarness';
import { plugin as links } from '../shared';

let db: Db;
beforeEach(() => {
  db = tempDb();
  seedArchiveViews(db);
  adoptBundledData(db, [links]);
});

describe('plugin archive read parity', () => {
  it('keeps hidden shares in counts while excluding their preview cards', async () => {
    setSetting(db, 'privacyMode', true);
    const embed = { type: 'rich', url: 'https://example.com/open', title: 'Bot card' };
    db.prepare('UPDATE messages SET raw_json = ? WHERE id = ?').run(JSON.stringify({ author: { bot: true }, embeds: [embed] }), 'm-hide');
    const rows = (await linkPage(statementRead(db), (ids) => archivePayloads(db, ids), () => [], { limit: 100 }, linksSql));
    expect(rows.map((row) => row.id)).toEqual([5, 1]);
    const shared = rows.find((row) => row.id === 1)!;
    expect(shared.shares).toBe(2);
    expect(shared.embed).toBeNull();
  });
});
