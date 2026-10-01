// Re-running Alerts' open-question query on past messages: old alerts land read.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MS_PER_DAY } from '@shared/units';
import type { Db } from '@core/db';
import { setJevQueryOverrides } from '@core/jev/queries';
import { rerunMessages, rerunSubjects } from '@core/jev/rerun';
import type { RuleMatcher } from '@core/rules/matcher';
import { ARRIVAL } from '@core/arrival';
import { FakeJev, rawMessage, seedArchive, tempDb } from '@chattypop/host-testing';
import { ruleStack } from './ruleHarness';

/** How long before now the past messages were sent; the re-run reaches a day further. */
const PAST_DAYS = 10;

let db: Db;
beforeEach(() => {
  db = tempDb();
  setJevQueryOverrides({});
});
afterEach(() => setJevQueryOverrides({}));

describe('run on past messages', () => {
  let jev: FakeJev;
  let w: RuleMatcher;
  let rules: ReturnType<typeof ruleStack>['rules'];
  beforeEach(() => {
    jev = new FakeJev();
    jev.on['alerts.unansweredQuestions'] = true;
    ({ matcher: w, rules } = ruleStack(db, () => undefined, jev.forFeature));
    rules.syncBuiltins(jev.on);
    const archive = seedArchive(db, [{ id: 'c1' }, { id: 'c2' }]);
    db.prepare("UPDATE channels SET local_ai_only = 1 WHERE id = 'c2'").run();
    const old = Date.now() - PAST_DAYS * MS_PER_DAY;
    archive.ingestMessages([rawMessage('c1', old, 'anyone know a good keyboard?'), rawMessage('c1', old + 1, 'lol'), rawMessage('c2', old + 2, 'secret?')], ARRIVAL.gateway);
  });

  it('asks only the chosen query, only in range, never local-only channels; old alerts land read', async () => {
    const req = { queryId: 'alerts.openQuestion', channelId: null, fromTs: Date.now() - (PAST_DAYS + 1) * MS_PER_DAY, toTs: Date.now() };
    expect(rerunMessages(db, req)).toHaveLength(2);
    jev.values = { question: 0.9 };
    const r = await w.rejudge(rerunMessages(db, req), rerunSubjects(db, req.queryId));
    expect(r).toMatchObject({ asked: 2, failed: 0 });
    expect(jev.requests.flatMap((q) => Object.keys(q.questions)).every((k) => k.startsWith('question_'))).toBe(true);
    const alerts = rules.alerts({ limit: 10 });
    expect(alerts).toHaveLength(2);
    expect(alerts.every((a) => a.readAt !== null)).toBe(true);
  });
});
