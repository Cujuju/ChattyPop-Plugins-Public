// Links feed reads under privacy: hidden shares still count, and their previews stay candidates.
import { beforeEach, describe, expect, it } from 'vitest';
import { setSetting, type Db } from '@core/db';
import { adoptBundledData } from '@core/plugins/adoption';
import { archivePayloads } from '@core/plugins/archivePayloads';
import { tempDb } from '@chattypop/host-testing';
import { seedArchiveViews } from '@chattypop/host-testing/archiveViewsFixture';
import { linkPage } from '../core/feed';
import { plugin as links } from '../shared';

let db: Db;
beforeEach(() => {
  db = tempDb();
  seedArchiveViews(db);
  adoptBundledData(db, [links]);
});

describe('plugin archive read parity', () => {
  it('keeps hidden shares in visible link counts and preview candidates', () => {
    setSetting(db, 'privacyMode', true);
    const embed = { type: 'rich', url: 'https://example.com/open', title: 'Bot card' };
    db.prepare('UPDATE messages SET raw_json = ? WHERE id = ?').run(JSON.stringify({ author: { bot: true }, embeds: [embed] }), 'm-hide');
    const rows = linkPage(db, (ids) => archivePayloads(db, ids), () => [], { limit: 100 });
    expect(rows.map((row) => row.id)).toEqual([5, 1]);
    const shared = rows.find((row) => row.id === 1)!;
    expect(shared.shares).toBe(2);
    expect(shared.embed?.title).toBe('Bot card');
  });
});
