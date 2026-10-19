import { expect, it } from 'vitest';
import { defineCorePlugin, type ArchiveRead } from '@plugin-sdk/core';
import { testPlugin } from '@plugin-sdk/core/testing';
import { corePort } from '@plugin-sdk/shared/testing/ports';
import core from '../core';
import { plugin } from '../shared';
import { MESSAGE_TAGS } from '../core/tables';
import { SHOWN_TAG_SQL, channelChipsSql } from '../core/store';
import { LIVE_CHIPS_MAX } from '../core/reads';

/** More than one live-chip page exercises filtering before the tagged-message limit. */
const MESSAGES = LIVE_CHIPS_MAX * 2;
/** One third of memberships are suppressed, so LIMIT follows the shown-state predicate. */
const REMOVED_EVERY = 3;

it('preserves live chips and uses indexed channel-first reads at the served priority', async () => {
  const priorities: string[] = [];
  const instrumented = defineCorePlugin(plugin, (ctx) => core.activate({ ...ctx, storage: { ...ctx.storage,
    read: ((sql, params, options) => {
      priorities.push(ctx.channels.call().priority);
      return ctx.storage.read(sql, params, options);
    }) as ArchiveRead,
  } }));
  const t = testPlugin(instrumented, { archive: { channels: [{ id: 'c' }, { id: 'other' }],
    messages: Array.from({ length: MESSAGES }, (_, n) => ({ id: String(n), channelId: 'c', ts: n, content: 'hello' })) } });
  try {
    const client = t.client('renderer');
    const tag = await client.createTag({ name: 'Kept', auto: false, jevQuestion: null });
    const insert = t.db.prepare(`INSERT INTO ${MESSAGE_TAGS}(message_id, tag_id, state, updated_at) VALUES (?, ?, ?, 0)`);
    for (let n = 0; n < MESSAGES; n++) insert.run(String(n), tag, n % REMOVED_EVERY === 0 ? 'removed' : 'manual');
    const before = t.db.prepare(`SELECT DISTINCT m.id FROM ${MESSAGE_TAGS} mt JOIN archive_all_messages m ON m.id = mt.message_id
      WHERE m.channel_id = ? AND mt.${SHOWN_TAG_SQL} ORDER BY m.ts DESC LIMIT ?`).all('c', LIVE_CHIPS_MAX) as { id: string }[];
    const reply = await corePort(t.link).call('pluginCall', 'renderer', 'tags', 'liveTagChips', ['c'], { id: randomUUID(), priority: 'interactive' }) as { status: string; value: unknown };
    expect(reply.status).toBe('ok');
    const result = (reply as { status: 'ok'; value: Record<string, unknown> }).value;
    expect(Object.keys(result).sort()).toEqual(before.map((r) => r.id).sort());
    expect(Object.values(result)).toEqual(before.map(() => [{ tagId: tag, name: 'Kept', source: 'manual' }]));
    expect(priorities).toEqual(['interactive', 'interactive']);
    expect(await client.liveTagChips('other')).toEqual({});
    expect(await client.tags()).toMatchObject([{ id: tag, count: MESSAGES - Math.ceil(MESSAGES / REMOVED_EVERY) }]);
    expect(await client.messageTags('1')).toEqual([{ tagId: tag, name: 'Kept', source: 'manual' }]);
    expect(await client.tagRangeCount({ channelId: 'c', tagIds: [tag], scope: { kind: 'latest', count: MESSAGES } })).toBe(MESSAGES);
    expect(await client.taggedMessages(tag, LIVE_CHIPS_MAX)).toHaveLength(LIVE_CHIPS_MAX);
    expect(await client.personTags('u1')).toEqual([{ name: 'Kept', count: MESSAGES - Math.ceil(MESSAGES / REMOVED_EVERY) }]);
    const plan = t.db.prepare(`EXPLAIN QUERY PLAN ${channelChipsSql()}`).all('c', LIVE_CHIPS_MAX) as { detail: string }[];
    expect(plan.some((r) => /SEARCH m .*channel_id=\?/.test(r.detail))).toBe(true);
    expect(plan.some((r) => /SEARCH mt .*message_id=\?/.test(r.detail))).toBe(true);
    expect(plan.some((r) => /\bSCAN (?:m|mt)\b/.test(r.detail))).toBe(false);
  } finally { await t.dispose(); }
});
import { randomUUID } from 'node:crypto';
