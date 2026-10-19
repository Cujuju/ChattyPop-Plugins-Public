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

import { SCAN_BATCH_SIZE } from '../core/scan';

describe('Stats archive words', () => {
  it('confines words and AFINN sentiment to exact channels and both inclusive window bounds', async () => {
    const { t, run, consumer } = start([
      { ...message(0), content: 'outsidebefore bad' },
      { ...message(1), content: 'orchard orchard good and the' },
      { ...message(2), content: 'orchard bad' },
      { ...message(3), content: 'outsideafter good' },
      { ...message(2, 'c2'), content: 'outsidechannel good' },
      { ...message(2, 'thread'), content: 'outsidethread good' },
      { ...message(2, 'hidden'), content: 'outsidehidden good' },
    ]);
    const read = await run('words');
    expect(read.lines).toContainEqual({ text: 'orchard: 3' });
    expect(read.lines[0]!.text).toBe('AFINN sentiment: 1 positive, 1 negative, 0 neutral (2 text messages).');
    expect(read.lines.every((line) => line.messageId === undefined && !line.text.includes('outside'))).toBe(true);
    expect(read.lines.some((line) => /^(the|and):/.test(line.text))).toBe(false);
    expect(read.readChannels).toEqual(['c1']);
    expect((await consumer.ai.tools.run('stats_words', {}, scope, new AbortController().signal)).lines).toEqual(read.lines);
    t.archive.setPrivacyMode(true);
    expect((await run('words', {}, { ...unbounded, channelIds: ['hidden'] })).lines.some((line) => line.text.includes('outsidehidden'))).toBe(false);
    expect((await run('words', {}, { ...scope, channelIds: [] })).lines).toEqual([]);
  });

  it('filters an author by id or name only from the selected window', async () => {
    const { run } = start([
      { ...message(1), content: 'orchard good' },
      { ...message(2), authorId: 'contributor', authorName: 'Contributor', content: 'meadow bad' },
      { ...message(3), authorId: 'outsider', authorName: 'Outside', content: 'outside' },
    ]);
    const read = await run('words', { author: 'writer' });
    expect(read.lines).toContainEqual({ text: 'orchard: 1' });
    expect(read.lines.some((line) => line.text.includes('meadow'))).toBe(false);
    expect((await run('words', { author: 'WRIT' })).lines).toEqual(read.lines);
    expect((await run('words', { author: 'outsider' })).lines).toEqual([]);
    await expect(run('words', { author: 'r' })).rejects.toThrow(/multiple people/);
  });

  it('limits word rankings to thirty plus sentiment, with an omission note', async () => {
    const vocabulary = 'orchard meadow forest mountain river ocean desert canyon valley garden blossom harvest planet comet galaxy nebula meteor rocket satellite telescope engine battery voltage circuit copper silver marble granite pebble timber bridge tunnel harbor village meadowland woodland'.split(' ');
    const { run } = start([{ ...message(1), content: vocabulary.join(' ') }]);
    const maximum = 30;
    const read = await run('words', { limit: maximum });
    expect(read.lines).toHaveLength(maximum + 1);
    expect(read.lines.length).toBeLessThanOrEqual(ARCHIVE_TOOL_LINES_MAX);
    expect(read.more).toBe(true);
    expect((await run('words', { limit: 1 })).lines).toHaveLength(2);
    expect((await run('words', { limit: 1 })).more).toBe(true);
    await expect(run('words', { limit: maximum + 1 })).rejects.toThrow(/limit/);
  });

  it('stops a batched word scan after cancellation', async () => {
    const { run } = start(Array.from({ length: SCAN_BATCH_SIZE + 1 }, (_, i) => ({ ...message(i), content: 'orchard good' })));
    const controller = new AbortController();
    const reason = new Error('Cancelled scan.');
    const pending = run('words', {}, unbounded, controller.signal);
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it('validates object schemas, rejects unknown or invalid arguments and observes cancellation', async () => {
    const { t, tools, run, read } = start();
    for (const tool of tools) {
      expect(tool.parameters).toMatchObject({ type: 'object', properties: expect.any(Object), additionalProperties: false });
      const valid: Record<string, unknown> = {};
      const bad: unknown[] = [null, [], 'text', { unexpected: true }, ...[{ author: '' }, { author: 1 }, { since: START }]];
      if (Object.hasOwn(tool.parameters['properties'] as object, 'limit')) {
        bad.push({ ...valid, limit: 0 }, { ...valid, limit: -1 }, { ...valid, limit: 1.5 }, { ...valid, limit: NaN }, { ...valid, limit: Infinity }, { ...valid, limit: ARCHIVE_TOOL_LINES_MAX + 1 });
      }
      for (const args of [...bad, new Date(), new Map()]) await expect(run(tool.name, args)).rejects.toThrow(Error);
      const controller = new AbortController();
      const reason = new Error('Cancelled lookup.');
      controller.abort(reason);
      read.mockClear();
      const query = vi.spyOn(t.db, 'prepare');
      await expect(run(tool.name, valid, scope, controller.signal)).rejects.toBe(reason);
      expect(read).not.toHaveBeenCalled();
      for (const args of [valid, { ...valid, author: 'writer' }]) {
        read.mockClear();
        const midRead = new AbortController();
        const pending = run(tool.name, args, scope, midRead.signal);
        midRead.abort(reason);
        await expect(pending).rejects.toBe(reason);
        expect(read).toHaveBeenCalled();
      }
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
