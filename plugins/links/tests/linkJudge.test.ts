import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@core/db';
import { LinkJudge } from '../core/judge';
import { JUDGMENTS } from '../core/tables';
import { adoptLinks, linkFeed } from './linksHarness';
import { FakeJev, type JevRequest, rawMessage, seedArchive, settleAsync, tempDb } from '@chattypop/host-testing';
import { ARRIVAL } from '@core/arrival';
import { aiSources, scopedDecider } from '@core/ai/readScope';

const OPEN = '200000000000000001';
const PRIVATE = '200000000000000002';

/** Answers per link URL, read from the link each question carries: a URL with "scam" in it is bad. */
function byUrl(req: JevRequest): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const [id, q] of Object.entries(req.questions)) {
    const bad = (q.instructions as { link: { url: string } }).link.url.includes('scam');
    if (id.startsWith('category_')) answers[id] = { type: 'choice', choice: bad ? 'shopping' : 'video', probabilities: {}, confidence: 1 };
    if (id.startsWith('flagged_')) answers[id] = { type: 'noul', noul: bad ? 0.95 : 0.05 };
    if (id.startsWith('worth_')) answers[id] = { type: 'score', score: bad ? 0.2 : 3.6, legend: {}, probabilities: {}, confidence: 1 };
  }
  return answers;
}

let db: Db;
let jev: FakeJev;
let judge: LinkJudge;
beforeEach(() => {
  db = adoptLinks(tempDb());
  const a = seedArchive(db, [{ id: OPEN }, { id: PRIVATE }]);
  a.setChannelPolicy(PRIVATE, { localAiOnly: true });
  const now = Date.now();
  a.ingestMessages([
    rawMessage(OPEN, now - 3000, 'watch https://youtu.be/abc123'),
    rawMessage(OPEN, now - 2000, 'free money https://scam.example/win'),
    rawMessage(PRIVATE, now - 1000, 'our plan https://docs.example/plan'),
  ], ARRIVAL.gateway);
  jev = new FakeJev(byUrl);
  Object.assign(jev.on, { 'links.linkCategories': true, 'links.linkSafety': true, 'links.linkWorth': true });
  // As ctx.jev.decider and ctx.ai.sources hand them out: the host checks each request's reads.
  const decider = (f: string) => {
    const d = jev.forPlugin('links')(f);
    return d && scopedDecider(d, () => db);
  };
  judge = new LinkJudge(db, decider, () => {}, aiSources(() => db, () => false));
});

describe('link judgments (#61–#63)', () => {
  it('asks about all pending links in one request, each question carrying its link, never for local-only channels', async () => {
    judge.kick();
    await settleAsync();
    expect(jev.requests).toHaveLength(1);
    expect(Object.keys(jev.requests[0]!.questions).sort()).toEqual(['category_l0', 'category_l1', 'flagged_l0', 'flagged_l1', 'worth_l0', 'worth_l1']);
    // Each question carries its own link; no link sits in a state every question reads.
    expect(jev.requests[0]!.state).toEqual({});
    expect(jev.requests[0]!.questions['flagged_l0']!.instructions).toMatchObject({ link: { url: 'https://scam.example/win' }, question: expect.stringContaining('`link`') });
    judge.kick();
    await settleAsync();
    expect(jev.requests).toHaveLength(1);
  });

  it('asks only the newly enabled question later', async () => {
    Object.assign(jev.on, { 'links.linkSafety': false, 'links.linkWorth': false });
    judge.kick();
    await settleAsync();
    jev.on['links.linkWorth'] = true;
    judge.kick();
    await settleAsync();
    expect(jev.requests.slice(1).map((r) => Object.keys(r.questions).sort())).toEqual([['worth_l0', 'worth_l1']]);
  });

  it('feeds the Links view: category, flag, worth sort and hide-flagged', async () => {
    judge.kick();
    await settleAsync();
    const byWorth = linkFeed(db, { limit: 10, sort: 'worth' });
    expect(byWorth.map((l) => [l.category, l.flagged])).toEqual([
      ['video', false],
      ['shopping', true],
      [null, false], // the local-only channel's link: never judged
    ]);
    expect(linkFeed(db, { limit: 10, hideFlagged: true }).some((l) => l.flagged)).toBe(false);
    const [first] = byWorth;
    const next = linkFeed(db, { limit: 10, sort: 'worth', after: { ts: first!.ts, id: first!.id, worth: first!.worth! } });
    expect(next.map((l) => l.category)).toEqual(['shopping', null]);
  });

  it('drops judgments whose link left the index when the host rebuilds it', async () => {
    judge.kick();
    await settleAsync();
    db.prepare("DELETE FROM links WHERE url LIKE '%scam%'").run();
    judge.prune();
    expect(db.prepare(`SELECT url FROM ${JUDGMENTS}`).pluck().all()).toEqual(db.prepare("SELECT url FROM links WHERE url LIKE '%youtu%'").pluck().all());
  });
});
