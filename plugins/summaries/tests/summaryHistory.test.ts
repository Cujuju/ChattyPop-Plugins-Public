// Contract tests for summary history.
import { archivePayloads } from '@core/plugins/archivePayloads';
import { SUMMARIES_TABLE } from '../core/schema';
import { adoptSummaries } from './summariesHarness';
import { describe, expect, it } from 'vitest';
import type { SummaryProviders } from '../core/providers';
import { Summarizer } from '../core/summarize';
import { tempDb } from '@chattypop/host-testing';

const insertRun = (db: ReturnType<typeof tempDb>, createdAt: number, headline: string): void => {
  db.prepare(
    `INSERT INTO ${SUMMARIES_TABLE} (cache_key, created_at, provider, model, since_ts, until_ts, channel_ids, message_count, duration_ms, headline, items_json)
     VALUES (?, ?, 'claude', NULL, 0, ?, '[]', 1, 1, ?, '[]')`,
  ).run(headline, createdAt, createdAt, headline);
};

describe('summary history', () => {
  it('pages every run once, newest first, including runs that share a timestamp', () => {
    const db = adoptSummaries(tempDb());
    const s = new Summarizer(db, (ids) => archivePayloads(db, ids), {} as SummaryProviders, () => undefined);
    ['a', 'b', 'c'].forEach((h) => insertRun(db, 1000, h));
    ['d', 'e'].forEach((h, i) => insertRun(db, 2000 + i, h));

    const seen: string[] = [];
    let before: { createdAt: number; id: number } | undefined;
    for (;;) {
      const page = s.page({ limit: 2, ...(before ? { before } : {}) });
      if (!page.length) break;
      seen.push(...page.map((r) => r.headline));
      const last = page.at(-1)!;
      before = { createdAt: last.createdAt, id: last.id };
    }
    expect(seen).toEqual(['e', 'd', 'c', 'b', 'a']);
  });
});
