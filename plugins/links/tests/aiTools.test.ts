// Real activation plus direct tool calls, so host output guards cannot hide scope errors.
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { ARCHIVE_TOOL_LINES_MAX, toolTime, defineCorePlugin, type ArchiveRead, type ArchiveToolScope, type CoreContext } from '@plugin-sdk/core';
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
  let archive!: CoreContext['archive'];
  const t = testPlugin(core, {
    with: [defineCorePlugin(reader, (ctx) => { consumer = ctx; archive = ctx.archive; })],
    ai: { providers: [{ id: 'localreader', local: true, provider: {
      id: 'localreader', maxInputChars: 1000, complete: async () => ({ text: '' }), listModels: async () => [],
    } }] },
    archive: { channels: [{ id: 'c1' }, { id: 'c2' }, { id: 'thread', parentId: 'c1' }, { id: 'hidden', hidden: true }], messages: seed },
  });
  onTestFinished(() => t.dispose());
  expect(t.status()).toEqual({ status: 'active', error: null });
  const read = vi.spyOn(t, 'read');
  const tools = archiveTools(t.read, archive);
  const run = (name: string, args: unknown = {}, window = scope, signal = new AbortController().signal) =>
    tools.find((tool) => tool.name === name)!.run(args, window, signal);
  return { t, tools, run, consumer, read, archive };
}

const linked = (index: number, channelId = 'c1'): SeedMessage => ({
  ...message(index, channelId), content: `https://example.com/resource${index}`,
  extra: { embeds: [{ url: `https://example.com/resource${index}`, title: 'Reference', provider: { name: 'Example' } }] },
});
function links(count = 0) {
  const h = start(count ? Array.from({ length: count }, (_, i) => linked(i)) :
    [0, 1, 2, 3].map((i) => linked(i)).concat([linked(2, 'c2'), linked(2, 'thread'), linked(2, 'hidden')]));
  h.t.db.prepare("UPDATE links SET platform = 'web'").run();
  return h;
}

describe('Links archive search', () => {
  it('never searches or prints metadata from an excluded, hidden or local-only source share', async () => {
    const url = 'https://example.com/scoped';
    for (const source of ['c2', 'hidden', 'thread']) {
      const h = start([
        { ...message(1), content: url },
        { ...message(2, source), content: url, extra: { embeds: [{ url, title: 'classified quartz', provider: { name: 'Secret site' } }] } },
      ]);
      if (source === 'hidden') h.t.archive.setPrivacyMode(true);
      if (source === 'thread') h.t.archive.setChannel(source, { localOnly: true });
      const allowed = source === 'thread' ? { ...unbounded, channelIds: ['c1', 'thread'] } : unbounded;
      expect((await h.run('search', { query: 'classified' }, allowed)).lines).toEqual([]);
      const read = await h.run('search', {}, unbounded);
      expect(read.lines).toHaveLength(1);
      expect(read.lines[0]!.text).toContain(url);
      expect(read.lines[0]!.text).not.toMatch(/classified|Secret site/);
    }
  });

  it('excludes preview sources outside the clamped time window', async () => {
    const url = 'https://example.com/old-preview';
    const h = start([
      { ...message(0), content: url, extra: { embeds: [{ url, title: 'classified quartz' }] } },
      { ...message(2), content: url },
    ]);
    expect((await h.run('search', { query: 'classified' })).lines).toEqual([]);
    expect((await h.run('search')).lines[0]!.text).not.toContain('classified');
  });

  it('preserves provider identity through host scopes and clamping for a local lookup', async () => {
    const url = 'https://example.com/local';
    const h = start([
      { ...message(1), content: url },
      { ...message(2, 'thread'), content: url, extra: { embeds: [{ url, title: 'quartz local preview' }] } },
    ]);
    h.t.archive.setChannel('thread', { localOnly: true });
    const window: ArchiveToolScope = { ...unbounded, channelIds: ['c1', 'thread'], reader: { provider: 'localreader' } };
    expect((await h.run('search', { query: 'quartz' }, window)).lines).toHaveLength(2);
    expect((await h.consumer.ai.tools.run('links_search', { query: 'quartz' }, window, new AbortController().signal)).lines).toHaveLength(2);
  });

  it('uses the sharing message for exact channel and inclusive window confinement', async () => {
    const { t, run, consumer } = links();
    const rows = t.db.prepare("SELECT id FROM archive_messages WHERE channel_id = 'c1' AND ts >= ? AND ts <= ? ORDER BY ts DESC, id DESC")
      .pluck().all(scope.since!, scope.until!) as string[];
    const read = await run('search', { since: toolTime(START - MS_PER_MIN), until: toolTime(START + 9 * MS_PER_MIN) });
    expect(read.lines.map((line) => line.messageId)).toEqual(rows);
    expect(read.readChannels).toEqual(['c1']);
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
    const { t, run, consumer, archive } = links(ARCHIVE_TOOL_LINES_MAX + 2);
    const read = await run('search', { limit: ARCHIVE_TOOL_LINES_MAX }, unbounded);
    expect(read.lines).toHaveLength(ARCHIVE_TOOL_LINES_MAX);
    expect(read.lines.every((line) => line.messageId)).toBe(true);
    expect(read.more).toBe(true);
    expect((await run('search', { limit: 1 }, unbounded)).more).toBe(true);
    const guarded = await consumer.ai.tools.run('links_search', { limit: 1 }, unbounded, new AbortController().signal);
    expect(guarded).toMatchObject({ readChannels: ['c1'], more: true, note: 'More results not shown.' });
    expect(guarded.lines).toHaveLength(1);
    const controller = new AbortController();
    const reason = new Error('Cancelled after query.');
    const abortAfterRead: ArchiveRead = async <R,>(sql: string, params?: readonly unknown[] | Record<string, unknown>, options?: { signal?: AbortSignal }) => {
      const rows = await t.read<R>(sql, params, options);
      controller.abort(reason);
      return rows;
    };
    const [search] = archiveTools(abortAfterRead, archive);
    await expect(search!.run({}, unbounded, controller.signal)).rejects.toBe(reason);
  });

  it('validates object schemas, rejects unknown or invalid arguments and observes cancellation', async () => {
    const { t, tools, run, read } = start();
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
      read.mockClear();
      await expect(run(tool.name, valid, scope, controller.signal)).rejects.toBe(reason);
      expect(read).not.toHaveBeenCalled();
      const midRead = new AbortController();
      const pending = run(tool.name, valid, scope, midRead.signal);
      midRead.abort(reason);
      await expect(pending).rejects.toBe(reason);
      expect(read).toHaveBeenCalled();
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
