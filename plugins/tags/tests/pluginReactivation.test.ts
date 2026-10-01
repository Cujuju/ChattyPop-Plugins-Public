// Tags across edits: unchanged tag questions keep their callbacks; changed ones are retired.
import { expect, it } from 'vitest';
import { ARRIVAL } from '@core/arrival';
import { messageQuestions } from '@core/jev/messageQuestions';
import { textMessage } from '@core/queries/messageText';
import { rawMessage, seedArchive, tempDb } from '@chattypop/host-testing';
import { startTags } from './tagsHarness';

it('keeps unchanged tag callbacks alive through unrelated edits and retires changed questions', () => {
  const db = tempDb();
  const archive = seedArchive(db, [{ id: 'c' }]);
  const raw = rawMessage('c', Date.now(), 'trading');
  archive.ingestMessages([raw], ARRIVAL.sync);
  const tags = startTags(db);
  const input = { name: 'Trading', auto: true, jevQuestion: { type: 'noul' as const, question: 'Trading?', yes: '', no: '', minProbability: 0.5 } };
  const id = tags.create(input);
  const question = messageQuestions().find((q) => q.subject === `usertag:${id}`)!;
  tags.create({ name: 'Other', auto: false, jevQuestion: null });
  expect(messageQuestions().find((q) => q.subject === question.subject)).toBe(question);
  question.onAnswer?.(textMessage(db, raw.id)!, { type: 'noul', noul: 0.99 }, null);
  expect(tags.store.chips([raw.id]).get(raw.id)?.[0]?.tagId).toBe(id);
  tags.update(id, { ...input, jevQuestion: { ...input.jevQuestion, question: 'Changed?' } });
  expect(messageQuestions().find((q) => q.subject === question.subject)).not.toBe(question);
});
