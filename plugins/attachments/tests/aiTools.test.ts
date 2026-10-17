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

const file = (index: number, channelId = 'c1', kind = 'image'): SeedMessage => ({
  ...message(index, channelId),
  extra: { attachments: [{ id: `file${index}-${channelId}`, filename: `report${index}.data`, content_type: `${kind}/example`,
    size: index + 1, url: `https://example.com/file${index}` }] },
});
function files(count = 0) {
  return start(count ? Array.from({ length: count }, (_, i) => file(i)) :
    [0, 1, 2, 3].map((i) => file(i)).concat([file(2, 'c2'), file(2, 'thread'), file(2, 'hidden')]));
}

describe('Attachments archive files', () => {
  it('returns files only for exact scoped messages and clamped inclusive bounds', async () => {
    const { t, run, consumer } = files();
    const rows = t.db.prepare("SELECT id FROM archive_messages WHERE channel_id = 'c1' AND ts >= ? AND ts <= ? ORDER BY ts DESC, id DESC")
      .pluck().all(scope.since!, scope.until!) as string[];
    const read = await run('files', { since: toolTime(START - MS_PER_MIN), until: toolTime(START + 9 * MS_PER_MIN) });
    expect(read.lines.map((line) => line.messageId)).toEqual(rows);
    expect(read.readChannels).toEqual(['c1']);
    expect(read.lines[0]!.text).toContain('report2.data | image | 3 bytes | Writer');
    expect((await run('files', { since: toolTime(START + 2 * MS_PER_MIN) })).lines.map((line) => line.messageId)).toEqual(rows.slice(0, 1));
    expect((await run('files', { until: toolTime(START + 1 * MS_PER_MIN) })).lines.map((line) => line.messageId)).toEqual(rows.slice(1));
    expect((await run('files', { until: toolTime(START) })).lines).toEqual([]);
    expect((await run('files', {}, { ...scope, channelIds: [] })).lines).toEqual([]);
    expect((await consumer.ai.tools.run('attachments_files', {}, scope, new AbortController().signal)).lines).toEqual(read.lines);
  });

  it('filters literal filenames, kinds and authors and excludes invisible or orphaned messages', async () => {
    const { t, run } = files();
    expect((await run('files', { name: 'REPORT2', kind: 'image', author: 'writer' })).lines).toHaveLength(1);
    expect((await run('files', { kind: 'audio' })).lines).toEqual([]);
    expect((await run('files', { name: '%_' })).lines).toEqual([]);
    expect((await run('files', { author: 'unknown' })).lines).toEqual([]);
    t.db.prepare("UPDATE attachments SET message_id = 'missing' WHERE filename = 'report2.data'").run();
    expect((await run('files')).lines).toHaveLength(1);
    t.archive.setPrivacyMode(true);
    expect((await run('files', {}, { ...unbounded, channelIds: ['hidden'] })).lines).toEqual([]);
  });

  it('supports every file kind and caps results with a note', async () => {
    const { run } = files(ARCHIVE_TOOL_LINES_MAX + 2);
    const read = await run('files', { limit: ARCHIVE_TOOL_LINES_MAX }, unbounded);
    expect(read.lines).toHaveLength(ARCHIVE_TOOL_LINES_MAX);
    expect(read.lines.every((line) => line.messageId)).toBe(true);
    expect(read.more).toBe(true);
    expect((await run('files', { limit: 1 }, unbounded)).more).toBe(true);
    const h = start(['image', 'video', 'audio', 'application'].map((kind, i) => file(i, 'c1', kind)));
    for (const kind of ['image', 'video', 'audio', 'file']) expect((await h.run('files', { kind }, unbounded)).lines).toHaveLength(1);
  });

  it('validates object schemas, rejects unknown or invalid arguments and observes cancellation', async () => {
    const { t, tools, run } = start();
    for (const tool of tools) {
      expect(tool.parameters).toMatchObject({ type: 'object', properties: expect.any(Object), additionalProperties: false });
      const valid: Record<string, unknown> = {};
      const bad: unknown[] = [null, [], 'text', { unexpected: true }, ...[{ name: '' }, { kind: 'document' }, { author: 1 }, { since: 'today' }, { until: Infinity }, { since: toolTime(START + 2 * MS_PER_MIN), until: toolTime(START) }]];
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
