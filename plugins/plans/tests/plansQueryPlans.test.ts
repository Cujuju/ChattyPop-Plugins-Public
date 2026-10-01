// The plans list over a realistically shaped archive: indexed message lookups, and the same list as the plain join.
import { describe, expect, it } from 'vitest';
import type { Db } from '@core/db';
import { adoptBundledData } from '@core/plugins/adoption';
import { MS_PER_MIN } from '@shared/units';
import { tempDb } from '@chattypop/host-testing';
import { statementPlans } from '@chattypop/host-testing/queryPlan';
import { START_TS, TEST_ARCHIVE, hideSome, seedPerfArchive } from '@chattypop/host-testing/perfArchiveFixture';
import { planList } from '../core/plans';
import { PLANS_TABLE } from '../core/schema';
import { plugin as plansPlugin } from '../shared';

/** Plans listed by the panel at once. */
const PLAN_LIMIT = 200;
/** Plans seeded over the perf archive's messages: enough that the list's lookups plan differently from a scan. */
const PERF_PLANS = 40;
/** Plans spread over the messages by a step coprime to their count; every third a decision, every fourth undated. */
const PLAN_MESSAGE_STEP = 71;
const DECISION_EVERY = 3;
const UNDATED_EVERY = 4;

/** The perf archive with Plans' data adopted, as its reads run over it, and `plans` plans. */
function seedPlansArchive(db: Db, plans: number): ReturnType<typeof seedPerfArchive> {
  adoptBundledData(db, [plansPlugin]);
  const fixture = seedPerfArchive(db, TEST_ARCHIVE);
  const plan = db.prepare(`INSERT INTO ${PLANS_TABLE} (message_id, channel_id, kind, title, when_ts, who_json, details, created_at)
    SELECT id, channel_id, ?, 'Title ' || id, ?, '[]', 'Details ' || content, ts FROM messages WHERE id = ?`);
  for (let p = 0; p < plans; p++) {
    const id = `m${(p * PLAN_MESSAGE_STEP) % TEST_ARCHIVE.messages}`;
    plan.run(p % DECISION_EVERY ? 'plan' : 'decision', p % UNDATED_EVERY ? START_TS + p * MS_PER_MIN : null, id);
  }
  return fixture;
}

/** The list order as the planner-chosen join returned it before the fix: the parity oracle. */
const plansJoinedByPlanner = (db: Db): string[] => db.prepare(
  `SELECT p.message_id FROM ${PLANS_TABLE} p JOIN archive_messages m ON m.id = p.message_id
   ORDER BY p.kind = 'decision', CASE WHEN p.kind = 'plan' THEN p.when_ts IS NULL END, CASE WHEN p.kind = 'plan' THEN p.when_ts END, m.ts DESC
   LIMIT ?`,
).pluck().all(PLAN_LIMIT) as string[];

describe('plans list', () => {
  it.each([0, PERF_PLANS])('drives %i plans’ message lookups from the plans table, listing what the join listed', (plans) => {
    const db = tempDb();
    const fixture = seedPlansArchive(db, plans);
    const details = statementPlans(db, () => planList(db, PLAN_LIMIT)).join('\n');
    expect(details).toMatch(/SEARCH m USING INDEX/);
    expect(details).not.toMatch(/SCAN m\b/);
    const listed = (): string[] => planList(db, PLAN_LIMIT).map((plan) => plan.messageId);
    expect(listed()).toEqual(plansJoinedByPlanner(db));
    hideSome(db, fixture);
    expect(listed()).toEqual(plansJoinedByPlanner(db));
    if (plans) expect(listed().length).toBeLessThan(plans);
  });
});
