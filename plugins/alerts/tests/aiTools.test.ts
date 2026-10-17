// Real activation plus direct tool calls, so host output guards cannot hide scope errors.
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { ARCHIVE_TOOL_LINES_MAX, type ArchiveToolScope } from '@plugin-sdk/core';
import { MS_PER_MIN } from '@plugin-sdk/shared';
import type { SeedMessage } from '@plugin-sdk/core/testing';
import { tempDb, seedArchive, rawMessage, hostRuleStack } from '@chattypop/host-testing';
import { ARRIVAL } from '@core/arrival';
import { setSetting } from '@core/db';
import { SETTINGS_KEYS } from '@shared/settings';
import { PUBLIC_THREAD_TYPE } from '@shared/discord';
import { listArchiveTools, runArchiveTool } from '@core/ai/archiveTools';
import { startAlerts } from './alertsHarness';
import { plugin } from '../shared';
import { archiveTools } from '../core/aiTools';

const START = Date.UTC(2026, 8, 1);
const scope: ArchiveToolScope = { channelIds: ['c1'], since: START + 1 * MS_PER_MIN, until: START + 2 * MS_PER_MIN };
const unbounded: ArchiveToolScope = { channelIds: ['c1'], since: null, until: null };
const message = (index: number, channelId = 'c1'): SeedMessage => ({
  channelId, ts: START + index * MS_PER_MIN, authorId: 'writer', authorName: 'Writer', content: `message ${index}`,
});
const messages = [0, 1, 2, 3].map((i) => message(i)).concat([message(2, 'c2'), message(2, 'thread'), message(2, 'hidden')]);

function start(seed = messages) {
  const db = tempDb();
  const archive = seedArchive(db, [{ id: 'c1' }, { id: 'c2' }, { id: 'hidden' }]);
  archive.upsertThreads([{ id: 'thread', name: 'thread', type: PUBLIC_THREAD_TYPE, parent_id: 'c1', last_message_id: null }], START);
  archive.setChannelPolicy('hidden', { hideInPrivacy: true });
  archive.ingestMessages(seed.map((m) => rawMessage(m.channelId, m.ts!, m.content, {
    author: { id: m.authorId!, username: m.authorName! }, ...m.extra,
  })), ARRIVAL.sync);
  const { engine } = hostRuleStack(db, () => undefined, () => null);
  let active = startAlerts(db, { kinds: engine.kinds });
  onTestFinished(() => active.dispose());
  const t = {
    db,
    archive: { setPrivacyMode: (on: boolean) => setSetting(db, SETTINGS_KEYS.privacyMode, on) },
    off: async () => active.dispose(),
    on: async () => { active = startAlerts(db, { kinds: engine.kinds }); },
  };
  const consumer = { ai: { tools: {
    list: () => listArchiveTools(db, 'toolreader'),
    run: (name: string, args: unknown, window: ArchiveToolScope, signal: AbortSignal) => runArchiveTool(db, 'toolreader', name, args, window, signal),
  } } };
  const tools = archiveTools(t.db, () => new Map());
  const run = (name: string, args: unknown = {}, window = scope, signal = new AbortController().signal) =>
    tools.find((tool) => tool.name === name)!.run(args, window, signal);
  return { t, tools, run, consumer };
}

import { ALERTS } from '../core/tables';

function alerts(count = 0) {
  const h = start(count ? Array.from({ length: count }, (_, i) => message(i)) : messages);
  const rule = Number(h.t.db.prepare("INSERT INTO rules (name, spec, position, armed_at, created_at) VALUES ('Watch', '{}', 0, 0, ?)").run(START).lastInsertRowid);
  const rows = h.t.db.prepare('SELECT id, channel_id AS channelId, author_id AS authorId, ts, content FROM archive_messages ORDER BY ts, id')
    .all() as { id: string; channelId: string; authorId: string; ts: number; content: string }[];
  const insert = h.t.db.prepare(`INSERT INTO ${ALERTS} (rule_id, message_id, channel_id, author_id, ts, snippet, created_at, read_at, match_kind)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'text')`);
  for (const row of rows) insert.run(rule, row.id, row.channelId, row.authorId, row.ts, row.content, row.ts, row.ts === START + 1 * MS_PER_MIN ? START : null);
  return { ...h, rows, rule };
}

describe('Alerts archive list', () => {
  it('confines messages to exact channels and the inclusive scope window', async () => {
    const { rows, run, consumer } = alerts();
    const read = await run('list');
    const expected = rows.filter((row) => row.channelId === 'c1' && row.ts >= scope.since! && row.ts <= scope.until!).reverse();
    expect(read.lines.map((line) => line.messageId)).toEqual(expected.map((row) => row.id));
    expect(read.readChannels).toEqual(['c1']);
    expect(read.lines[0]!.text).toContain('Watch |');
    expect(read.lines[0]!.text).toContain('message 2');
    expect((await run('list', {}, { ...scope, channelIds: [] })).lines).toEqual([]);
    expect((await consumer.ai.tools.run('alerts_list', {}, scope, new AbortController().signal)).lines).toEqual(read.lines);
  });

  it('filters rule names or ids and read state, and applies privacy', async () => {
    const { t, run, rule } = alerts();
    expect((await run('list', { rule: 'wat', unread: true })).lines.map((line) => line.text)).toEqual([expect.stringContaining('message 2')]);
    expect((await run('list', { rule: String(rule), unread: false })).lines.map((line) => line.text)).toEqual([expect.stringContaining('message 1')]);
    expect((await run('list', { rule: 'absent' })).lines).toEqual([]);
    t.archive.setPrivacyMode(true);
    expect((await run('list', {}, { ...unbounded, channelIds: ['hidden'] })).lines).toEqual([]);
  });

  it('caps alerts and signals omitted entries', async () => {
    const { run } = alerts(ARCHIVE_TOOL_LINES_MAX + 2);
    const read = await run('list', { limit: ARCHIVE_TOOL_LINES_MAX }, unbounded);
    expect(read.lines).toHaveLength(ARCHIVE_TOOL_LINES_MAX);
    expect(read.lines.every((line) => line.messageId)).toBe(true);
    expect(read.more).toBe(true);
    expect((await run('list', { limit: 1 }, unbounded)).more).toBe(true);
  });

  it('validates object schemas, rejects unknown or invalid arguments and observes cancellation', async () => {
    const { t, tools, run } = start();
    for (const tool of tools) {
      expect(tool.parameters).toMatchObject({ type: 'object', properties: expect.any(Object), additionalProperties: false });
      const valid: Record<string, unknown> = {};
      const bad: unknown[] = [null, [], 'text', { unexpected: true }, ...[{ rule: '' }, { rule: 1 }, { unread: 'true' }, { since: START }]];
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
    expect(consumer.ai.tools.list()).toHaveLength(plugin.aiTools.length);
  });

});
