// A Jev answer belongs to the tag question it answered: one that went away meanwhile is neither stored nor applied.
import { expect, it } from 'vitest';
import type { CustomJevQuestion } from '@shared/jevQuestion';
import type { DecisionRequest, DecisionResult, Question } from '@core/ai/decisions';
import { ARRIVAL } from '@core/arrival';
import type { Db } from '@core/db';
import { FakeJev, hostRuleStack, nextTs, rawMessage, seedArchive, settleAsync, tempDb } from '@chattypop/host-testing';
import { startTags } from './tagsHarness';
import { ruleHarness } from './ruleHarness';


/** Holds Jev's requests while `holding`; `release` answers the held ones in the order they were asked. */
function holdJev(jev: FakeJev) {
  const decide = jev.decide.bind(jev);
  const held: (() => void)[] = [];
  const state = { holding: true, release: () => held.splice(0).forEach((answer) => answer()) };
  jev.decide = (<Q extends Record<string, Question>>(req: DecisionRequest<Q>): Promise<DecisionResult<Q>> =>
    state.holding
      ? new Promise((resolve, reject) => held.push(() => void decide(req).then(resolve, reject)))
      : decide(req)) as FakeJev['decide'];
  return state;
}

/** Answers yes to every question whose text mentions `word`, and no to the rest. */
const yesAbout = (word: string) => (req: DecisionRequest<Record<string, Question>>) =>
  Object.fromEntries(Object.entries(req.questions).map(([k, q]) => [k, { type: 'noul', noul: JSON.stringify(q).includes(word) ? 0.99 : 0.01 }]));

const judgments = (db: Db, messageId: string) =>
  db.prepare('SELECT subject, value FROM jev_judgments WHERE message_id = ? ORDER BY subject').all(messageId);

const question = (text: string): CustomJevQuestion => ({ type: 'noul', question: text, yes: '', no: '', minProbability: 0.5 });

it('does not store an automatic tag answer that arrives after Tags turned off, so turning it on asks again', async () => {
  const h = ruleHarness();
  h.jev.on['tags.customTags'] = true;
  h.jev.answer = yesAbout('stock');
  const id = h.tags.create({ name: 'Stocks', auto: true, jevQuestion: question('Does `message` mention a stock?') });
  const hold = holdJev(h.jev);
  const m = h.say('NVDA to the moon');
  h.tags.dispose();
  hold.release();
  await settleAsync();
  expect(judgments(h.db, m.id)).toEqual([]);
  hold.holding = false;
  const tags = startTags(h.db, { kinds: h.engine.kinds, jev: () => h.jev, catchUp: () => h.matcher.catchUpJudgments() });
  h.matcher.catchUpJudgments();
  await settleAsync();
  expect(tags.forMessage(m.id).map((c) => c.tagId)).toEqual([id]);
});

it('drops a range answer for a tag deleted and replaced under the same id while Jev was asked', async () => {
  const db = tempDb();
  const jev = new FakeJev();
  jev.on['tags.customTags'] = true;
  jev.answer = yesAbout('');
  const { matcher } = hostRuleStack(db, () => undefined, jev.forFeature);
  const tags = startTags(db, { jev: () => jev, catchUp: () => matcher.catchUpJudgments() });
  const archive = seedArchive(db, [{ id: 'c1' }]);
  const m = rawMessage('c1', nextTs(), 'my salary went up');
  archive.ingestMessages([m], ARRIVAL.sync);
  const salary = tags.create({ name: 'Salary', auto: false, jevQuestion: question('Is `message` about salary?') });
  const hold = holdJev(jev);
  const run = tags.range({ channelId: 'c1', tagIds: [salary], scope: { kind: 'latest', count: 10 } });
  await settleAsync();
  tags.remove(salary);
  const vacation = tags.create({ name: 'Vacation', auto: false, jevQuestion: question('Is `message` about a vacation?') });
  expect(vacation).toBe(salary); // SQLite reuses the highest id
  hold.release();
  expect(await run).toMatchObject({ applied: 0 });
  expect(tags.forMessage(m.id)).toEqual([]);
  expect(judgments(db, m.id)).toEqual([]);
});
