// Summaries' filler Jev query: what the app reads from it, and an edited threshold driving the filler skip.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jevQueryDef, validateJevQuery } from '@shared/jevQueries';
import type { CustomJevQuestion } from '@shared/jevQuestion';
import { setJevQueryOverrides } from '@core/jev/queries';
import { FakeJev } from '@chattypop/host-testing';
import { skipFiller, type LogLine } from '../core/summaryJev';

const def = (id: string) => jevQueryDef(id)!;

beforeEach(() => setJevQueryOverrides({}));
afterEach(() => setJevQueryOverrides({}));

describe('Jev query catalog', () => {
  it('locks what the app reads: the filler question keeps its placeholder', () => {
    expect(() => validateJevQuery(def('summaries.filler'), { ...def('summaries.filler').defaults, question: 'Is it filler?' })).toThrow(/\{k\}/);
  });
});

describe('edited queries drive the features', () => {
  const line = (i: number): LogLine => ({
    ref: `m${i}`,
    citation: { messageId: `m${i}`, channelId: 'c1', channelName: 'general', ts: i },
    text: `m${i}`,
    plain: `u: line ${i}`,
    filler: false,
  });

  it('summary filler: a stricter keep threshold drops more', async () => {
    const jev = new FakeJev();
    jev.values = { q0: 0.3, q1: 0.9 };
    expect((await skipFiller(jev, [line(0), line(1)], () => undefined)).skipped).toBe(0);
    setJevQueryOverrides({ 'summaries.filler': { ...def('summaries.filler').defaults, minProbability: 0.5 } as CustomJevQuestion });
    const r = await skipFiller(jev, [line(0), line(1)], () => undefined);
    expect(r.kept.map((l) => l.ref)).toEqual(['m1']);
    expect(jev.requests.at(-1)!.questions.q0).toMatchObject({ instructions: expect.stringContaining('conversation[0]') });
  });
});
