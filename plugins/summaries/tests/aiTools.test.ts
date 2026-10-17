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

import { SUMMARIES_TABLE } from '../core/schema';
import type { Citation, SummaryItem } from '../shared/types';

type Host = ReturnType<typeof start>;
function citation(h: Host, offset: number, channelId = 'c1'): Citation {
  const messageId = h.t.db.prepare('SELECT id FROM archive_messages WHERE channel_id = ? AND ts = ?').pluck().get(channelId, START + offset * MS_PER_MIN) as string;
  return { messageId, channelId, channelName: channelId, ts: START + offset * MS_PER_MIN };
}
function add(h: Host, key: string, channels = ['c1'], since = 1, until = 2, items: SummaryItem[] = [], created = 0) {
  h.t.db.prepare(`INSERT INTO ${SUMMARIES_TABLE}
    (cache_key, created_at, provider, since_ts, until_ts, channel_ids, message_count, duration_ms, headline, items_json)
    VALUES (?, ?, 'local', ?, ?, ?, 1, 1, ?, ?)`)
    .run(key, START + created, START + since * MS_PER_MIN, START + until * MS_PER_MIN, JSON.stringify(channels), key, JSON.stringify(items));
}
const item = (text: string, citations: Citation[]): SummaryItem => ({ parts: [{ text, citations }] });

describe('Summaries archive read', () => {
  it('selects channel subsets and overlapping spans, newest first, citing the first source for each item', async () => {
    const h = start();
    add(h, 'Older', ['c1'], 0, 3, [item('Outside item', [citation(h, 0)])], 1);
    add(h, 'Newest', ['c1'], 1, 2, [item('Window item', [citation(h, 1), citation(h, 2)])], 2);
    add(h, 'Wrong channel', ['c2'], 1, 2, [], 3);
    add(h, 'Mixed channels', ['c1', 'c2'], 1, 2, [], 4);
    add(h, 'Outside span', ['c1'], 0, 0, [], 5);
    add(h, 'Thread', ['thread'], 1, 2, [], 6);
    const read = await h.run('read', { since: toolTime(START - MS_PER_MIN), until: toolTime(START + 9 * MS_PER_MIN) });
    expect(read.lines.map((line) => line.text.split(' | ')[0])).toEqual(['Newest', 'Window item', 'Older']);
    expect(read.lines[1]!.messageId).toBe(citation(h, 1).messageId);
    expect(read.lines[0]!.messageId).toBeUndefined();
    expect(read.readChannels).toEqual(['c1']);
    expect((await h.run('read', {}, { ...scope, channelIds: [] })).lines).toEqual([]);
    expect((await h.run('read', { since: toolTime(START + 4 * MS_PER_MIN) })).lines).toEqual([]);
    expect((await h.consumer.ai.tools.run('summaries_read', {}, scope, new AbortController().signal)).lines).toEqual(read.lines);
  });

  it('narrows argument windows and removes items with any absent or out-of-window source', async () => {
    const h = start();
    add(h, 'Span', ['c1'], 1, 2, [
      item('First', [citation(h, 1)]), item('Second', [citation(h, 2)]),
      item('Both', [citation(h, 1), citation(h, 2)]),
      item('Missing', [{ ...citation(h, 1), messageId: 'missing' }]),
    ]);
    expect((await h.run('read', { since: toolTime(START + 2 * MS_PER_MIN) })).lines.map((line) => line.text.split(' | ')[0])).toEqual(['Span', 'Second']);
    expect((await h.run('read', { until: toolTime(START + 1 * MS_PER_MIN) })).lines.map((line) => line.text.split(' | ')[0])).toEqual(['Span', 'First']);
    add(h, 'Hidden mix', ['c1', 'hidden']);
    h.t.archive.setPrivacyMode(true);
    const read = await h.consumer.ai.tools.run('summaries_read', {}, { ...scope, channelIds: ['c1', 'hidden'] }, new AbortController().signal);
    expect(read.lines.some((line) => line.text.includes('Hidden mix'))).toBe(false);
  });

  it('caps expanded lines and summary counts with a note', async () => {
    const h = start();
    add(h, 'Long recap', ['c1'], 1, 2, Array.from({ length: ARCHIVE_TOOL_LINES_MAX + 1 }, () => item('Cited point', [citation(h, 1)])));
    const read = await h.run('read');
    expect(read.lines).toHaveLength(ARCHIVE_TOOL_LINES_MAX);
    expect(read.lines.slice(1).every((line) => line.messageId === citation(h, 1).messageId)).toBe(true);
    expect(read.more).toBe(true);
    const maximum = 10;
    for (let i = 0; i < maximum + 1; i++) add(h, `Short recap ${i}`, ['c1'], 1, 2, [], i + 1);
    const capped = await h.run('read', { limit: maximum });
    expect(capped.lines).toHaveLength(maximum);
    expect(capped.more).toBe(true);
    expect((await h.run('read')).lines).toHaveLength(3);
    await expect(h.run('read', { limit: maximum + 1 })).rejects.toThrow(/limit/);
  });

  it('declares every included item citation channel as well as the summary channels', async () => {
    const h = start();
    add(h, 'Recap', ['c1'], 1, 2, [item('Combined point', [citation(h, 1), citation(h, 2, 'c2')])]);
    const read = await h.run('read', {}, { ...scope, channelIds: ['c1', 'c2', 'thread'] });
    expect(read.lines.map((line) => line.text.split(' | ')[0])).toEqual(['Recap', 'Combined point']);
    expect(read.readChannels).toEqual(['c1', 'c2']);
  });

  it('includes actual message channels when stored citation channel metadata differs', async () => {
    const h = start();
    add(h, 'Recap', ['c1'], 1, 2, [item('Combined point', [citation(h, 1), { ...citation(h, 2, 'c2'), channelId: 'c1' }])]);
    const read = await h.run('read', {}, { ...scope, channelIds: ['c1', 'c2'] });
    expect(read.readChannels).toEqual(['c1', 'c2']);
  });

  it('rejects a summary through the host when an extra citation channel becomes hidden mid-run', async () => {
    const h = start();
    h.t.archive.setPrivacyMode(true);
    add(h, 'Recap', ['c1'], 1, 2, [item('Combined point', [citation(h, 1), citation(h, 2, 'c2')])]);
    const window = { ...scope, channelIds: ['c1', 'c2'] };
    expect((await h.run('read', {}, window)).lines).toHaveLength(2);
    const pending = h.consumer.ai.tools.run('summaries_read', {}, window, new AbortController().signal);
    h.t.archive.setChannel('c2', { hidden: true });
    expect(await pending).toEqual({ lines: [], note: "This lookup's results are unavailable." });
  });

  it('does not declare channels from items or summaries beyond the returned line cap', async () => {
    const h = start();
    add(h, 'Earlier recap', ['c2'], 1, 2, [], 0);
    add(h, 'Newest recap', ['c1'], 1, 2,
      [...Array.from({ length: ARCHIVE_TOOL_LINES_MAX }, () => item('Point', [citation(h, 1)])),
        item('Omitted point', [citation(h, 2, 'c2')])], 1);
    const read = await h.run('read', {}, { ...scope, channelIds: ['c1', 'c2'] });
    expect(read.lines).toHaveLength(ARCHIVE_TOOL_LINES_MAX);
    expect(read.readChannels).toEqual(['c1']);
    expect(read.more).toBe(true);
  });

  it('validates object schemas, rejects unknown or invalid arguments and observes cancellation', async () => {
    const { t, tools, run } = start();
    for (const tool of tools) {
      expect(tool.parameters).toMatchObject({ type: 'object', properties: expect.any(Object), additionalProperties: false });
      const valid: Record<string, unknown> = {};
      const bad: unknown[] = [null, [], 'text', { unexpected: true }, ...[{ since: 'today' }, { since: Infinity }, { until: NaN }, { since: toolTime(START + 2 * MS_PER_MIN), until: toolTime(START) }]];
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
