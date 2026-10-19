import { expect, it, onTestFinished } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import { MS_PER_DAY, MS_PER_MIN } from '@plugin-sdk/shared';
import core from '../core';
import { analyticsClient } from './analyticsClient';
import { conversationStats } from '../core/conversations';

const START = Date.UTC(2026, 0, 1) + MS_PER_DAY - MS_PER_MIN;
const SETTLE_MS = 20_000;
const QUERY = { scope: 'all', channelId: null, sinceTs: null } as const;

it('keeps local split maintenance equivalent to full folds after references, names and deletion', async () => {
  const t = testPlugin(core, { archive: { channels: [{ id: 'c' }], messages: [
    { channelId: 'c', ts: START, authorId: 'a', content: 'opener' },
    { channelId: 'c', ts: START + MS_PER_MIN, authorId: 'b', content: 'future-reference' },
    { channelId: 'c', ts: START + 2 * MS_PER_MIN, authorId: 'b', content: 'reply' },
  ] } });
  onTestFinished(() => t.dispose());
  const c = analyticsClient(t);
  const same = async () => {
    await expect.poll(async () => { const s = await c.rollupStatus(); if (s.error) throw new Error(s.error); return s.maintaining; }, { timeout: SETTLE_MS }).toBe(false);
    expect(await c.conversationStats(QUERY)).toEqual(await conversationStats(t.read, QUERY));
  };
  await same();
  t.db.prepare("INSERT INTO channels(id, name, kind, hide_in_privacy) VALUES ('future-reference', 'New hidden', 0, 1)").run();
  await same();
  for (const privacy of [true, false]) { t.archive.setPrivacyMode(privacy); await same(); }
  t.db.prepare("UPDATE users SET global_name = 'Renamed' WHERE id = 'b'").run();
  await same();
  t.db.prepare('DELETE FROM messages WHERE ts = ?').run(START + MS_PER_MIN);
  await same();
  await c.rebuildRollups(); await same();
});
