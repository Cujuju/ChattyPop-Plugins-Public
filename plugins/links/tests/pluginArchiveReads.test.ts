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
import { testPlugin } from '@plugin-sdk/core/testing';
import core from '../core';

let db: Db;
beforeEach(() => {
  db = tempDb();
  seedArchiveViews(db);
  adoptBundledData(db, [links]);
});

describe('plugin archive read parity', () => {
  it('serves a complete link page through strict host projection reads', async () => {
    const t = testPlugin(core, { archive: { channels: [{ id: 'c' }], messages: [{
      id: '1000000000000000000', channelId: 'c', content: 'https://example.com/projected',
      extra: { embeds: [{ type: 'rich', url: 'https://example.com/projected', title: 'Projected card' }] },
    }] } });
    try {
      const page = await t.client('renderer').page({ limit: 10 });
      expect(page).toHaveLength(1);
      expect(page[0]!.embed?.title).toBe('Projected card');
      expect(page[0]!.message?.id).toBe('1000000000000000000');
      expect(t.status().error).toBeNull();
    } finally { await t.dispose(); }
  });

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
