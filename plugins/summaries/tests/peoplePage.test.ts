import { performance } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';
import { archiveRead, type ArchiveRead } from '@core/plugins/pluginDb';
import { setSetting } from '@core/db';
import { tempDb } from '@chattypop/host-testing';
import { seedArchiveViews } from '@chattypop/host-testing/archiveViewsFixture';
import { closeArchiveReads } from '@core/reads/archiveReads';
import { withPeople, withPeopleRead, withPeoplePageRead } from '../core/people';
import type { Summary } from '../shared/types';

/** Default summary page size; legacy hydration dispatched two reads for each row. */
const PAGE_ROWS = 20;
const summary = (id: number, channels: string[]): Summary => ({
  id, createdAt: id, provider: 'probe', model: null, sinceTs: 0, untilTs: 9, channelIds: channels, scope: null,
  messageCount: 1, skippedCount: 0, durationMs: 0, headline: '<@u1> and <@u2>',
  items: [{ parts: [{ text: '<@u1>', citations: [{ messageId: 'm-open', channelId: 'c-open', channelName: 'Open', ts: 1 }] }] }],
  actions: [], grouping: 'overall', trigger: 'manual', usage: null, apiCostUsd: null, apiCostEstimated: false, jevCostUsd: null,
  themes: [{ title: '<@u2>', citations: [{ messageId: 'm-hide', channelId: 'c-hide', channelName: 'Hidden', ts: 2 }] }], people: {}, authors: {},
});

describe('summary page person resolution', () => {
  it('uses two reads per page with exact per-summary nickname and privacy parity', async () => {
    const db = tempDb(); seedArchiveViews(db);
    const channels = [['c-open'], ['c-secret'], ['c-secret', 'c-open'], ['c-open', 'c-secret'], [], ['missing']];
    const page = Array.from({ length: PAGE_ROWS }, (_, i) => summary(i, channels[i % channels.length]!));
    try {
      for (const privacy of [false, true]) {
        setSetting(db, 'privacyMode', privacy);
        const expected = page.map((s) => withPeople(db, s));
        const read = vi.fn(archiveRead(() => db));
        const before = performance.now();
        expect(await Promise.all(page.map((s) => withPeopleRead(read as ArchiveRead, s)))).toEqual(expected);
        const legacyMs = performance.now() - before, legacyReads = read.mock.calls.length;
        read.mockClear();
        const start = performance.now();
        expect(await withPeoplePageRead(read as ArchiveRead, page)).toEqual(expected);
        expect(read).toHaveBeenCalledTimes(2);
        process.stdout.write(JSON.stringify({ privacy, rows: PAGE_ROWS, legacyReads, pageReads: read.mock.calls.length, legacyMs, pageMs: performance.now() - start }) + '\n');
      }
    } finally { await closeArchiveReads(db); db.close(); }
  });
});
