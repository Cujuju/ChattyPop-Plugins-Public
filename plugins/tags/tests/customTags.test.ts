// Owner tag manual choices, automatic questions and range runs through the Tags plugin.
import { beforeEach, describe, expect, it } from 'vitest';
import type { AppEvent } from '@shared/contract';
import { tagSubject, type TagInput } from '../shared/types';
import type { CustomJevQuestion } from '@shared/jevQuestion';
import { MS_PER_DAY } from '@shared/units';
import type { Archive } from '@core/archive';
import type { Db } from '@core/db';
import { messageQuestions } from '@core/jev/messageQuestions';
import { messagePage } from '@core/queries/messages';
import { startTags } from './tagsHarness';
import { FakeJev, hostRuleStack, nextTs, rawMessage, seedArchive, settleAsync, tempDb } from '@chattypop/host-testing';
import { ARRIVAL } from '@core/arrival';

const YES: CustomJevQuestion = { type: 'noul', question: 'Does `message` mention a stock?', yes: '', no: '', minProbability: 0.8 };
const tagInput = (over: Partial<TagInput> = {}): TagInput => ({ name: 'Stocks', jevQuestion: YES, auto: false, ...over });

let db: Db;
let jev: FakeJev;
let events: AppEvent[];
let archive: Archive;
let tags: ReturnType<typeof startTags>;

beforeEach(() => {
  db = tempDb();
  jev = new FakeJev();
  events = [];
  const emit = (e: AppEvent): void => void events.push(e);
  const { matcher: w } = hostRuleStack(db, emit, jev.forFeature);
  tags = startTags(db, { emit, jev: () => jev.on['tags.customTags'] ? jev : null, catchUp: () => w.catchUpJudgments() });
  archive = seedArchive(db, [{ id: 'c1' }], { onText: (m, a) => w.check(m, a) });
});

const chipsOf = (id: string) => messagePage(db, { channelId: 'c1', limit: 50 }).find((m) => m.id === id)?.labels.filter((l) => l.pluginId === 'tags') ?? [];

describe('#78 manual tags', () => {
  it('a manual add or removal sticks: Jev never overrides it', () => {
    const id = tags.create(tagInput({ jevQuestion: null, name: 'Mine' }));
    const q = tags.create(tagInput());
    const m = rawMessage('c1', nextTs(), 'NVDA to the moon');
    archive.ingestMessages([m], ARRIVAL.gateway);
    tags.setManual(m.id, id, true);
    expect(chipsOf(m.id)).toEqual([{ subject: tagSubject(id), text: 'Mine', pluginId: 'tags', key: String(id), variant: 'manual', title: 'Your tag, added by you' }]);
    tags.setManual(m.id, q, false); // removed by hand before Jev saw it
    const store = (tags as unknown as { store: { applyJev: (m: string, t: number, v: number | null) => boolean } }).store;
    expect(store.applyJev(m.id, q, 0.95)).toBe(false);
    expect(store.applyJev(m.id, id, null)).toBe(false);
    expect(tags.forMessage(m.id).map((c) => c.name)).toEqual(['Mine']);
    expect(events.some((e) => e.type === 'plugin-event' && e.pluginId === 'tags' && e.name === 'changed' && (e.payload as { messageIds: string[] | null }).messageIds?.includes(m.id))).toBe(true);
  });

  it('rejects a duplicate name, an overlong name, and auto without a question', () => {
    tags.create(tagInput());
    expect(() => tags.create(tagInput({ name: 'stocks' }))).toThrow(/already exists/);
    expect(() => tags.create(tagInput({ name: 'x'.repeat(40) }))).toThrow(/characters/);
    expect(() => tags.create(tagInput({ name: 'M', jevQuestion: null, auto: true }))).toThrow(/Jev question/);
  });
});

describe('#78 Jev tags on new messages', () => {
  it('an auto tag rides the per-message request only while custom tags are on', async () => {
    const id = tags.create(tagInput({ auto: true }));
    archive.ingestMessages([rawMessage('c1', nextTs(), 'first')], ARRIVAL.gateway);
    await settleAsync();
    expect(jev.requests).toHaveLength(0); // customTags off
    jev.on['tags.customTags'] = true;
    jev.values = { [tagSubject(id)]: 0.9 };
    const m = rawMessage('c1', nextTs(), 'bought more AAPL');
    archive.ingestMessages([m], ARRIVAL.gateway);
    await settleAsync();
    expect(Object.keys(jev.requests.at(-1)!.questions)).toContain(tagSubject(id));
    expect(chipsOf(m.id)).toEqual([{ subject: tagSubject(id), text: 'Stocks', pluginId: 'tags', key: String(id), variant: 'jev', title: 'Your tag, applied by Jev (a model’s estimate)' }]);
  });

  it('below the threshold no tag; a changed question drops Jev tags but keeps manual ones; delete unregisters', async () => {
    jev.on['tags.customTags'] = true;
    const id = tags.create(tagInput({ auto: true }));
    jev.values = { [tagSubject(id)]: 0.5 };
    const low = rawMessage('c1', nextTs(), 'maybe stocks');
    archive.ingestMessages([low], ARRIVAL.gateway);
    await settleAsync();
    expect(chipsOf(low.id)).toEqual([]);
    jev.values = { [tagSubject(id)]: 0.95 };
    const hit = rawMessage('c1', nextTs(), 'TSLA calls');
    const hand = rawMessage('c1', nextTs(), 'my pick');
    archive.ingestMessages([hit, hand], ARRIVAL.gateway);
    await settleAsync();
    tags.setManual(hand.id, id, true);
    jev.values = {};
    tags.update(id, tagInput({ auto: true, jevQuestion: { ...YES, question: 'Does `message` name a ticker?' } }));
    await settleAsync();
    expect(chipsOf(hit.id)).toEqual([]);
    expect(chipsOf(hand.id)).toHaveLength(1);
    tags.remove(id);
    expect(messageQuestions().some((q) => q.subject === tagSubject(id))).toBe(false);
  });
});

describe('#78 range tagging', () => {
  it('asks each message in the range once with the chosen tags, applies matches and counts them', async () => {
    jev.on['tags.customTags'] = true;
    const a = tags.create(tagInput());
    const b = tags.create(tagInput({ name: 'Crypto', jevQuestion: { ...YES, question: 'Crypto?' } }));
    const manual = tags.create(tagInput({ name: 'Manual', jevQuestion: null }));
    const old = Date.now() - 30 * MS_PER_DAY; // older than the live lookback: range runs still reach it
    const msgs = [rawMessage('c1', old, 'SPY puts'), rawMessage('c1', old + 1, 'BTC dip'), rawMessage('c1', old + 2, 'lunch?')];
    archive.ingestMessages(msgs, ARRIVAL.gateway);
    jev.costUsd = 0.00003;
    jev.answer = (req) => {
      const text = (req.state as { message: string }).message;
      return { [tagSubject(a)]: { type: 'noul', noul: text.includes('SPY') ? 0.9 : 0.1 }, [tagSubject(b)]: { type: 'noul', noul: text.includes('BTC') ? 0.9 : 0.1 } };
    };
    const req = { channelId: 'c1', tagIds: [a, b, manual], scope: { kind: 'between' as const, fromTs: old, toTs: old + 3 } };
    expect(tags.rangeCount(req)).toBe(3);
    const r = await tags.range(req);
    expect(r).toMatchObject({ asked: 3, applied: 2, failed: 0 });
    expect(r.costUsd).toBeCloseTo(0.00009);
    expect(jev.requests).toHaveLength(3);
    expect(Object.keys(jev.requests[0]!.questions).sort()).toEqual([tagSubject(a), tagSubject(b)].sort());
    expect(tags.taggedMessages(a, 10).map((t) => t.content)).toEqual(['SPY puts']);
    expect(tags.taggedMessages(b, 10).map((t) => t.content)).toEqual(['BTC dip']);
    const stored = db.prepare('SELECT COUNT(*) AS n FROM jev_judgments WHERE subject IN (?, ?)').get(tagSubject(a), tagSubject(b)) as { n: number };
    expect(stored.n).toBe(6);
  });

  it('latest N caps the count; refuses manual-only picks and local-only channels without asking', async () => {
    jev.on['tags.customTags'] = true;
    const q = tags.create(tagInput());
    const manual = tags.create(tagInput({ name: 'Manual', jevQuestion: null }));
    archive.ingestMessages(Array.from({ length: 5 }, (_, i) => rawMessage('c1', Date.now() - MS_PER_DAY * 2 + i, `m${i}`)), ARRIVAL.gateway);
    expect(tags.rangeCount({ channelId: 'c1', tagIds: [q], scope: { kind: 'latest', count: 2 } })).toBe(2);
    await expect(tags.range({ channelId: 'c1', tagIds: [manual], scope: { kind: 'latest', count: 2 } })).rejects.toThrow(/Jev question/);
    db.prepare("UPDATE channels SET local_ai_only = 1 WHERE id = 'c1'").run();
    await expect(tags.range({ channelId: 'c1', tagIds: [q], scope: { kind: 'latest', count: 2 } })).rejects.toThrow(/local AI only/);
    expect(jev.requests).toEqual([]);
  });
});
