// Real activation plus direct tool calls, so host output guards cannot hide scope errors.
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { ARCHIVE_TOOL_LINES_MAX, defineCorePlugin, type ArchiveToolScope, type CoreContext } from '@plugin-sdk/core';
import { definePlugin } from '@plugin-sdk/shared';
import { testPlugin, type SeedMessage } from '@plugin-sdk/core/testing';
import core from '../core';
import { plugin } from '../shared';
import { archiveTools } from '../core/aiTools';

const START = Date.UTC(2026, 8, 1);
const scope: ArchiveToolScope = { channelIds: ['c1'], since: START + 1, until: START + 2 };
const unbounded: ArchiveToolScope = { channelIds: ['c1'], since: null, until: null };
const reader = definePlugin({ manifest: { id: 'toolreader', name: 'Tool reader', version: '1', description: '' } });
const message = (index: number, channelId = 'c1'): SeedMessage => ({
  channelId, ts: START + index, authorId: 'writer', authorName: 'Writer', content: `message ${index}`,
});
const messages = [0, 1, 2, 3].map((i) => message(i)).concat([message(2, 'c2'), message(2, 'thread'), message(2, 'hidden')]);

function start(seed = messages) {
  let consumer!: CoreContext<typeof reader>;
  const t = testPlugin(core, {
    with: [defineCorePlugin(reader, (ctx) => { consumer = ctx; })],
    archive: { channels: [{ id: 'c1' }, { id: 'c2' }, { id: 'thread', parentId: 'c1' }, { id: 'hidden', hidden: true }], messages: seed },
  });
  onTestFinished(() => t.dispose());
  expect(t.status()).toEqual({ status: 'active', error: null });
  const tools = archiveTools(t.db);
  const run = (name: string, args: unknown = {}, window = scope, signal = new AbortController().signal) =>
    tools.find((tool) => tool.name === name)!.run(args, window, signal);
  return { t, tools, run, consumer };
}

import { PLANS_TABLE } from '../core/schema';

function plans(count = 0) {
  const h = start(count ? Array.from({ length: count }, (_, i) => message(i)) : messages);
  const rows = h.t.db.prepare('SELECT id, channel_id AS channelId, ts FROM archive_messages ORDER BY ts, id')
    .all() as { id: string; channelId: string; ts: number }[];
  const insert = h.t.db.prepare(`INSERT INTO ${PLANS_TABLE} (message_id, channel_id, kind, title, when_ts, who_json, details, created_at)
    VALUES (?, ?, 'plan', ?, NULL, '["Participant"]', '', ?)`);
  for (const row of rows) insert.run(row.id, row.channelId, `Plan ${row.ts - START}`, row.ts);
  return { ...h, rows };
}

describe('Plans archive list', () => {
  it('reads exact channels and the source-message window, with citations and participants', async () => {
    const { run, rows, consumer } = plans();
    const expected = rows.filter((row) => row.channelId === 'c1' && row.ts >= scope.since! && row.ts <= scope.until!).reverse();
    const read = await run('list');
    expect(read.lines.map((line) => line.messageId)).toEqual(expected.map((row) => row.id));
    expect(read.lines[0]!.text).toContain('plan: Plan 2 | Undated | Participant');
    expect((await run('list', {}, { ...scope, channelIds: [] })).lines).toEqual([]);
    expect((await consumer.ai.tools.run('plans_list', {}, scope, new AbortController().signal)).lines).toEqual(read.lines);
  });

  it('defaults upcoming to true, retaining undated plans and decisions, and honors privacy', async () => {
    const { t, run, rows } = plans();
    const past = rows.find((row) => row.channelId === 'c1' && row.ts === START + 1)!;
    t.db.prepare(`UPDATE ${PLANS_TABLE} SET when_ts = ? WHERE message_id = ?`).run(START, past.id);
    expect((await run('list')).lines).toHaveLength(1);
    expect((await run('list', { upcoming: false })).lines).toHaveLength(2);
    t.db.prepare(`UPDATE ${PLANS_TABLE} SET kind = 'decision' WHERE message_id = ?`).run(past.id);
    expect((await run('list')).lines).toHaveLength(2);
    t.db.prepare(`UPDATE ${PLANS_TABLE} SET kind = 'plan', when_ts = ? WHERE message_id = ?`).run(Date.now() + 1_000_000, past.id);
    expect((await run('list')).lines).toHaveLength(2);
    t.archive.setPrivacyMode(true);
    expect((await run('list', {}, { ...unbounded, channelIds: ['hidden'] })).lines).toEqual([]);
  });

  it('caps entries with a note', async () => {
    const { run } = plans(ARCHIVE_TOOL_LINES_MAX + 2);
    const read = await run('list', { limit: ARCHIVE_TOOL_LINES_MAX }, unbounded);
    expect(read.lines).toHaveLength(ARCHIVE_TOOL_LINES_MAX);
    expect(read.lines.every((line) => line.messageId)).toBe(true);
    expect(read.note).toMatch(/more/i);
    expect((await run('list', { limit: 1 }, unbounded)).note).toMatch(/more/i);
  });

  it('validates object schemas, rejects unknown or invalid arguments and observes cancellation', async () => {
    const { t, tools, run } = start();
    for (const tool of tools) {
      expect(tool.parameters).toMatchObject({ type: 'object', properties: expect.any(Object), additionalProperties: false });
      const valid: Record<string, unknown> = {};
      const bad: unknown[] = [null, [], 'text', { unexpected: true }, ...[{ upcoming: 1 }, { since: START }]];
      if (Object.hasOwn(tool.parameters['properties'] as object, 'limit')) {
        bad.push({ ...valid, limit: 0 }, { ...valid, limit: -1 }, { ...valid, limit: 1.5 }, { ...valid, limit: NaN }, { ...valid, limit: Infinity }, { ...valid, limit: ARCHIVE_TOOL_LINES_MAX + 1 });
      }
      for (const args of [...bad, new Date(), new Map()]) await expect(run(tool.name, args)).rejects.toThrow(Error);
      const controller = new AbortController();
      const reason = new Error('Cancelled lookup.');
      controller.abort(reason);
      const query = vi.spyOn(t.db, 'prepare');
      await expect(run(tool.name, valid, scope, controller.signal)).rejects.toBe(reason);
      expect(query).not.toHaveBeenCalled();
      query.mockRestore();
    }
  });

  it('provides exactly the declared tools and removes them on deactivation', async () => {
    const { t, consumer } = start();
    expect(consumer.ai.tools.list().map((tool) => tool.name)).toEqual(plugin.aiTools.map((name) => `${plugin.manifest.id}_${name}`));
    await t.off();
    expect(consumer.ai.tools.list()).toEqual([]);
    await t.on();
    expect(t.status().status).toBe('active');
    expect(consumer.ai.tools.list()).toHaveLength(plugin.aiTools.length);
  });

});
