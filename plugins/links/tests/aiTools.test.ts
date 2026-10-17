// Real activation plus direct tool calls, so host output guards cannot hide scope errors.
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { ARCHIVE_TOOL_LINES_MAX, toolTime, defineCorePlugin, type ArchiveToolScope, type CoreContext } from '@plugin-sdk/core';
import { definePlugin, MS_PER_MIN } from '@plugin-sdk/shared';
import { testPlugin, type SeedMessage } from '@plugin-sdk/core/testing';
import core from '../core';
import { plugin } from '../shared';
import { archiveTools } from '../core/aiTools';

const START = Date.UTC(2026, 8, 1);
const scope: ArchiveToolScope = { channelIds: ['c1'], since: START + 1 * MS_PER_MIN, until: START + 2 * MS_PER_MIN };
const unbounded: ArchiveToolScope = { channelIds: ['c1'], since: null, until: null };
const reader = definePlugin({ manifest: { id: 'toolreader', name: 'Tool reader', version: '1', description: '' } });
const message = (index: number, channelId = 'c1'): SeedMessage => ({
  channelId, ts: START + index * MS_PER_MIN, authorId: 'writer', authorName: 'Writer', content: `message ${index}`,
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

const linked = (index: number, channelId = 'c1'): SeedMessage => ({
  ...message(index, channelId), content: `https://example.com/resource${index}`,
});
function links(count = 0) {
  const h = start(count ? Array.from({ length: count }, (_, i) => linked(i)) :
    [0, 1, 2, 3].map((i) => linked(i)).concat([linked(2, 'c2'), linked(2, 'thread'), linked(2, 'hidden')]));
  h.t.db.prepare("UPDATE links SET title = 'Reference', site = 'Example', platform = 'web'").run();
  return h;
}

describe('Links archive search', () => {
  it('uses the sharing message for exact channel and inclusive window confinement', async () => {
    const { t, run, consumer } = links();
    const rows = t.db.prepare("SELECT id FROM archive_messages WHERE channel_id = 'c1' AND ts >= ? AND ts <= ? ORDER BY ts DESC, id DESC")
      .pluck().all(scope.since!, scope.until!) as string[];
    const read = await run('search', { since: toolTime(START - MS_PER_MIN), until: toolTime(START + 9 * MS_PER_MIN) });
    expect(read.lines.map((line) => line.messageId)).toEqual(rows);
    expect(read.lines.every((line) => line.text.includes('Reference | https://example.com/') && line.text.includes('Writer'))).toBe(true);
    expect((await run('search', { since: toolTime(START + 2 * MS_PER_MIN) })).lines.map((line) => line.messageId)).toEqual(rows.slice(0, 1));
    expect((await run('search', { until: toolTime(START + 1 * MS_PER_MIN) })).lines.map((line) => line.messageId)).toEqual(rows.slice(1));
    expect((await run('search', { since: toolTime(START + 3 * MS_PER_MIN) })).lines).toEqual([]);
    expect((await run('search', {}, { ...scope, channelIds: [] })).lines).toEqual([]);
    expect((await consumer.ai.tools.run('links_search', {}, scope, new AbortController().signal)).lines).toEqual(read.lines);
  });

  it('finds later shares of links first shared elsewhere, and filters literal query, platform and author', async () => {
    const { t, run } = links();
    t.archive.arrive([{ ...linked(1), ts: START + 2 * MS_PER_MIN, authorId: 'other', authorName: 'Other writer' }]);
    expect((await run('search', { query: 'reference', platform: 'web', author: 'other' })).lines).toHaveLength(1);
    expect((await run('search', { query: '%_\'' })).lines).toEqual([]);
    expect((await run('search', { platform: 'missing' })).lines).toEqual([]);
    expect((await run('search', { author: 'missing' })).lines).toEqual([]);
    t.archive.setPrivacyMode(true);
    expect((await run('search', {}, { ...unbounded, channelIds: ['hidden'] })).lines).toEqual([]);
  });

  it('caps shares, records omitted results and rejects aborts after a query', async () => {
    const { t, run } = links(ARCHIVE_TOOL_LINES_MAX + 2);
    const read = await run('search', { limit: ARCHIVE_TOOL_LINES_MAX }, unbounded);
    expect(read.lines).toHaveLength(ARCHIVE_TOOL_LINES_MAX);
    expect(read.lines.every((line) => line.messageId)).toBe(true);
    expect(read.note).toMatch(/more/i);
    expect((await run('search', { limit: 1 }, unbounded)).note).toMatch(/more/i);
    const controller = new AbortController();
    const reason = new Error('Cancelled after query.');
    const prepare = t.db.prepare.bind(t.db);
    vi.spyOn(t.db, 'prepare').mockImplementation((sql) => {
      const statement = prepare(sql);
      const all = statement.all.bind(statement);
      return { ...statement, all: (...args: unknown[]) => { const rows = all(...args); controller.abort(reason); return rows; } };
    });
    await expect(run('search', {}, unbounded, controller.signal)).rejects.toBe(reason);
  });

  it('validates object schemas, rejects unknown or invalid arguments and observes cancellation', async () => {
    const { t, tools, run } = start();
    for (const tool of tools) {
      expect(tool.parameters).toMatchObject({ type: 'object', properties: expect.any(Object), additionalProperties: false });
      const valid: Record<string, unknown> = {};
      const bad: unknown[] = [null, [], 'text', { unexpected: true }, ...[{ query: '' }, { platform: 1 }, { author: [] }, { since: 'yesterday' }, { since: Infinity }, { until: NaN }, { since: toolTime(START + 2 * MS_PER_MIN), until: toolTime(START) }]];
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
