import { afterEach, expect, it } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import { MS_PER_DAY } from '@plugin-sdk/shared';
import core from '../core';
import { linkCounts } from '../core/feed';

const START = Date.UTC(2026, 0, 1);
const CHANNEL = '200000000000000001';
const HIDDEN = '200000000000000002';
const SETTLE_TIMEOUT_MS = 10_000; // Native worker startup can exceed Vitest's one-second polling default under concurrent checks.
let stop: (() => Promise<void>) | undefined;
afterEach(async () => { await stop?.(); });

it('keeps first-share counts exact through reverse history, boundaries, privacy, edits and rebuilds', async () => {
  const t = testPlugin(core, { archive: { channels: [{ id: CHANNEL }, { id: HIDDEN, hidden: true }] } });
  stop = () => t.dispose();
  const client = t.client('renderer');
  const settled = async () => {
    await expect.poll(async () => { const s = await client.rollupStatus(); expect(s.error).toBeNull(); return s.building; }, { timeout: SETTLE_TIMEOUT_MS }).toBe(false);
  };
  t.archive.arrive([{ channelId: CHANNEL, ts: START + MS_PER_DAY, content: 'https://example.test/shared' }]);
  await settled();
  const ids = t.archive.arrive([
    { channelId: CHANNEL, ts: START, content: 'https://example.test/shared https://example.test/other' },
    { channelId: HIDDEN, ts: START, content: 'https://example.test/hidden' },
    { channelId: CHANNEL, ts: START, content: `https://discord.com/channels/100000000000000001/${HIDDEN}/300000000000000001` },
  ]);
  const same = async () => {
    for (const f of [{}, { channelId: CHANNEL }, { sinceTs: START, untilTs: START + MS_PER_DAY },
      { sinceTs: START - MS_PER_DAY, untilTs: START - 1 }, { hideFlagged: true }]) {
      expect(await client.counts(f)).toEqual(await linkCounts(t.read, f));
    }
  };
  await settled();
  await same();
  t.archive.setPrivacyMode(true);
  await same();
  t.archive.setPrivacyMode(false);
  t.db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(`<#${HIDDEN}>`, ids[0]);
  await settled();
  await same();
  const incremental = await client.counts({});
  await client.rebuildRollups();
  await settled();
  expect(await client.counts({})).toEqual(incremental);
});
