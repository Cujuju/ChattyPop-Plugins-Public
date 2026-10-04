// Contract tests for jev summary.
import { describe, expect, it } from 'vitest';
import { checkCitations, skipFiller, type LogLine } from '../core/summaryJev';
import { FakeJev, type JevAnswer, type JevRequest } from '@chattypop/host-testing';

/** USD the fake reports per request. */
const COST_USD = 0.001;

/** 52 lines over two channels: B gets 7 of them, interleaved. Jev text is "<channel>:<ref>". */
function log(): LogLine[] {
  const lines: LogLine[] = [];
  let inB = 0;
  for (let i = 0; i < 52; i++) {
    const ch = i % 7 === 0 && inB++ < 7 ? 'B' : 'A';
    const ref = `m${i + 1}`;
    lines.push({ ref, citation: { messageId: String(i), channelId: ch, channelName: ch, ts: i }, text: `[${ref}] ${ch}`, plain: `${ch}:${ref}`, filler: false, people: [] });
  }
  return lines;
}

/** Jev stand-in: `answer` maps a request to answers (or throws). */
const fakeJev = (answer: JevAnswer): FakeJev => new FakeJev(answer, COST_USD);

const conversation = (r: JevRequest): string[] => (r.state as { conversation: string[] }).conversation;
const refOf = (r: JevRequest, q: string): string => conversation(r)[Number(q.slice(1))]!.split(':')[1]!;

describe('Jev summary filter fails open and never mixes channels', () => {
  const lines = log();
  // Refs divisible by 5 are filler (0.05); the batch holding m20 fails.
  const jev = fakeJev((r) => {
    if (Object.keys(r.questions).some((q) => refOf(r, q) === 'm20')) throw new Error('boom');
    return Object.fromEntries(Object.keys(r.questions).map((q) => [q, { type: 'noul', noul: Number(refOf(r, q).slice(1)) % 5 === 0 ? 0.05 : 0.9 }]));
  });

  it('judges every message once, per channel, with a small state', async () => {
    const f = await skipFiller(jev, lines, () => {});
    const judged = jev.requests.flatMap((r) => Object.keys(r.questions).map((q) => refOf(r, q)));
    expect(new Set(judged).size).toBe(lines.length);
    expect(judged).toHaveLength(lines.length);
    for (const r of jev.requests) expect(new Set(conversation(r).map((c) => c.split(':')[0])).size).toBe(1);
    expect(jev.requests.every((r) => conversation(r).length <= 26)).toBe(true);

    const failed = jev.requests.find((r) => Object.keys(r.questions).some((q) => refOf(r, q) === 'm20'))!;
    const failedRefs = new Set(Object.keys(failed.questions).map((q) => refOf(failed, q)));
    const kept = new Set(f.kept.map((l) => l.ref));
    expect([...failedRefs].every((r) => kept.has(r))).toBe(true);
    const dropped = lines.filter((l) => Number(l.ref.slice(1)) % 5 === 0 && !failedRefs.has(l.ref)).map((l) => l.ref);
    expect(dropped.every((r) => !kept.has(r))).toBe(true);
    expect(f.skipped).toBe(dropped.length);
  });

  it('keeps everything when Jev calls it all filler', async () => {
    const all = fakeJev((r) => Object.fromEntries(Object.keys(r.questions).map((q) => [q, { type: 'noul', noul: 0.01 }])));
    const f = await skipFiller(all, log().slice(0, 5), () => {});
    expect(f.kept).toHaveLength(5);
    expect(f.skipped).toBe(0);
  });
});

describe('Jev citation check', () => {
  it('maps verdicts, skips uncited bullets, and leaves failures unchecked', async () => {
    const jev = fakeJev((r) => {
      const claim = (r.state as { claim: string }).claim;
      if (claim === 'fail') throw new Error('down');
      return { relation: { type: 'choice', choice: claim === 'good' ? 'supports' : 'contradicts', probabilities: {}, confidence: 0.9 } };
    });
    const c = await checkCitations(jev, [{ text: 'good', refs: ['m3'] }, { text: 'bad', refs: ['m9 ', 'm2'] }, { text: 'none', refs: ['m999'] }, { text: 'fail', refs: ['m4'] }], log());
    expect(c.checks.map((x) => x?.verdict)).toEqual(['supported', 'contradicted', 'uncited', undefined]);
    expect(jev.requests).toHaveLength(3);
    const bad = jev.requests.find((r) => (r.state as { claim: string }).claim === 'bad')!.state as { cited_messages: string[]; context: string[] };
    expect(bad.cited_messages).toEqual(['A:m2', 'A:m9']);
    expect(bad.context.every((x) => x.startsWith('A:') && !bad.cited_messages.includes(x))).toBe(true);
  });
});
