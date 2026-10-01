// A catch-up skips only time every channel it reads was already summarized, from its start without a gap.
import { expect, it } from 'vitest';
import { aiSettingsFrom } from '@shared/aiProviders';
import { newRuleAction } from '@shared/ruleSpec';
import { MS_PER_HOUR } from '@shared/units';
import type { Db } from '@core/db';
import { archivePayloads } from '@core/plugins/archivePayloads';
import { Summarizer } from '../core/summarize';
import { RuleSchedule } from '@core/rules/schedule';
import { SUMMARIES_TABLE } from '../core/schema';
import { fakeRegistry } from './summariesHarness';
import { ruleInput } from '@chattypop/host-testing';
import { summaryRuleHarness } from './summaryRuleHarness';

/** Local times on Friday 25 Sep 2026. */
const at = (h: number): number => new Date(2026, 8, 25, h).getTime();
/** The catch-up rule's absence threshold; the app was away longer. */
const AWAY_HOURS = 8;

let seq = 0;
/** A stored summary of `channelIds` from `since` to `until`. */
function summarized(db: Db, channelIds: string[], since: number, until: number): void {
  db.prepare(
    `INSERT INTO ${SUMMARIES_TABLE} (cache_key, created_at, provider, model, since_ts, until_ts, channel_ids, message_count, duration_ms, headline, items_json)
     VALUES (?, ?, 'ollama', NULL, ?, ?, ?, 1, 0, '', '[]')`,
  ).run(`k${++seq}`, until, since, until, JSON.stringify(channelIds));
}

/** Runs an app-start catch-up over every channel at 09:00 after the app was last seen at midnight; returns its start. */
async function catchUpStart(cover: (db: Db) => void): Promise<number | undefined> {
  let now = at(0) - MS_PER_HOUR; // the rule was made before the app was last seen
  const h = summaryRuleHarness(() => now);
  h.rules.create({ ...ruleInput([newRuleAction('summaries.summarize')], { trigger: { kind: 'appStart', awayHours: AWAY_HOURS } }), name: 'Catch-up' });
  now = at(9);
  cover(h.db);
  const schedule = new RuleSchedule(h.db, h.engine, h.actions, at(0), () => undefined, () => now);
  await schedule.tick();
  return h.ranges.summaries[0]?.sinceTs;
}

it("doesn't let one channel's summary cover another channel", async () => {
  expect(await catchUpStart((db) => summarized(db, ['c1'], at(0), at(9)))).toBe(at(0));
});

it('skips covered time only up to the first gap', async () => {
  expect(await catchUpStart((db) => {
    summarized(db, ['c1', 'c2'], at(0), at(3));
    summarized(db, ['c1', 'c2'], at(5), at(8));
  })).toBe(at(3));
});

it('chains overlapping summaries', async () => {
  expect(await catchUpStart((db) => {
    summarized(db, ['c1', 'c2'], at(0), at(3));
    summarized(db, ['c2', 'c1'], at(2), at(6));
  })).toBe(at(6));
});

it('counts only the channels a hosted run would read: local-AI-only ones stay out', () => {
  const h = summaryRuleHarness();
  h.db.prepare("UPDATE channels SET local_ai_only = 1 WHERE id = 'c2'").run();
  summarized(h.db, ['c1'], at(0), at(6));
  const s = new Summarizer(h.db, (ids) => archivePayloads(h.db, ids), fakeRegistry(() => h.db, () => ({})).registry, () => {});
  // A fresh profile: the default is Claude, which runs hosted.
  expect(s.coveredFrom({ sinceTs: at(0), channelIds: null }, aiSettingsFrom({}))).toBe(at(6));
  expect(s.coveredFrom({ sinceTs: at(1), channelIds: ['c1'] }, aiSettingsFrom({}))).toBe(at(6));
  h.db.prepare("UPDATE channels SET local_ai_only = 0 WHERE id = 'c2'").run();
  expect(s.coveredFrom({ sinceTs: at(0), channelIds: null }, aiSettingsFrom({}))).toBeNull();
});
