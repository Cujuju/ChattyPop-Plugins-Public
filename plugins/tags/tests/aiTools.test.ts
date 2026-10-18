// Real activation plus direct tool calls, so host output guards cannot hide scope errors.
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { ARCHIVE_TOOL_LINES_MAX, defineCorePlugin, type ArchiveToolScope, type CoreContext } from '@plugin-sdk/core';
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
  const read = vi.spyOn(t, 'read');
  const tools = archiveTools(t.read);
  const run = (name: string, args: unknown = {}, window = scope, signal = new AbortController().signal) =>
    tools.find((tool) => tool.name === name)!.run(args, window, signal);
  return { t, tools, run, consumer, read };
}

import { TagStore } from '../core/store';

function tagged(count = 0) {
  const h = start(count ? Array.from({ length: count }, (_, i) => message(i)) : messages);
  const store = new TagStore(h.t.db);
  const tag = store.create({ name: 'Focus', jevQuestion: null, auto: false });
  const rows = h.t.db.prepare('SELECT id, channel_id AS channelId, ts FROM archive_messages ORDER BY ts, id').all() as { id: string; channelId: string; ts: number }[];
  for (const row of rows) store.setManual(row.id, tag, true);
  return { ...h, store, tag, rows };
}

describe('Tags archive tools', () => {
  it('counts and reads only exact scope channels and inclusive time bounds', async () => {
    const { run, rows, store } = tagged();
    const expected = rows.filter((row) => row.channelId === 'c1' && row.ts >= scope.since! && row.ts <= scope.until!).reverse();
    const listed = await run('list');
    expect(listed).toEqual({ lines: [{ text: 'Focus: 2 messages' }], readChannels: ['c1'] });
    const read = await run('messages', { tag: 'focus' });
    expect(read.lines.map((line) => line.messageId)).toEqual(expected.map((row) => row.id));
    expect(read.readChannels).toEqual(['c1']);
    expect(read.lines.every((line) => line.text.includes('Writer'))).toBe(true);
    store.setManual(expected[0]!.id, store.create({ name: 'Other', jevQuestion: null, auto: false }), false);
    expect((await run('list')).lines).toHaveLength(1);
    expect((await run('messages', { tag: 'Other' })).lines).toEqual([]);
    expect((await run('list', {}, { ...scope, channelIds: [] })).lines).toEqual([]);
    expect((await run('messages', { tag: 'Focus' }, { ...scope, channelIds: [] })).lines).toEqual([]);
  });

  it('applies privacy to both counts and messages, including through the host', async () => {
    const { t, run, consumer } = tagged();
    t.archive.setPrivacyMode(true);
    const window = { ...unbounded, channelIds: ['c1', 'hidden'] };
    expect((await run('list', {}, window)).lines).toEqual([{ text: 'Focus: 4 messages' }]);
    const read = await consumer.ai.tools.run('tags_messages', { tag: 'Focus' }, window, new AbortController().signal);
    expect(read.lines).toHaveLength(4);
    expect(read.lines.every((line) => line.messageId)).toBe(true);
  });

  it('caps message reads and tag counts, with a truncation note', async () => {
    const { run, store, rows } = tagged(ARCHIVE_TOOL_LINES_MAX + 2);
    const read = await run('messages', { tag: 'Focus', limit: ARCHIVE_TOOL_LINES_MAX }, unbounded);
    expect(read.lines).toHaveLength(ARCHIVE_TOOL_LINES_MAX);
    expect(read.more).toBe(true);
    expect((await run('messages', { tag: 'Focus', limit: 1 }, unbounded)).more).toBe(true);
    for (let i = 0; i < ARCHIVE_TOOL_LINES_MAX; i++) {
      const id = store.create({ name: `Tag ${i}`, jevQuestion: null, auto: false });
      store.setManual(rows[0]!.id, id, true);
    }
    const listed = await run('list', {}, unbounded);
    expect(listed.lines).toHaveLength(ARCHIVE_TOOL_LINES_MAX);
    expect(listed.more).toBe(true);
    expect(listed.lines.every((line) => line.messageId === undefined)).toBe(true);
  });

  it('validates object schemas, rejects unknown or invalid arguments and observes cancellation', async () => {
    const { t, tools, run, read } = start();
    for (const tool of tools) {
      expect(tool.parameters).toMatchObject({ type: 'object', properties: expect.any(Object), additionalProperties: false });
      const valid: Record<string, unknown> = tool.name === 'messages' ? { tag: 'Focus' } : {};
      const bad: unknown[] = [null, [], 'text', { unexpected: true }, ...tool.name === 'messages' ? [{}, { tag: '' }, { tag: 1 }] : [{ tag: 'Focus' }]];
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
