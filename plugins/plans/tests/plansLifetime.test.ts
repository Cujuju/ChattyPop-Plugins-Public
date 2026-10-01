// Plans' activation lifetime: extractions it was running when turned off, and a provider that stalls.
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { PluginDescriptor } from '@plugin-sdk/shared';
import type { CorePlugin, LlmProvider } from '@plugin-sdk/core';
import { testPlugin, type TestOptions } from '@plugin-sdk/core/testing';
import type { CompletionRequest, CompletionResult } from '@core/ai/types';
import { messageQuestions } from '@core/jev/messageQuestions';
import plansCore from '../core';
import { PLAN_EXTRACTION_DEADLINE_MS } from '../core/plans';
import { PLAN_SUBJECT } from '../shared';
import { PLANS_TABLE } from '../core/schema';

/** Starts `core` under the test harness with channel c1 archived, and disposes it after the test. */
function start<D extends PluginDescriptor>(core: CorePlugin<D>, o: TestOptions<D> = {}) {
  const t = testPlugin(core, { ...o, archive: { channels: [{ id: 'c1' }], ...o.archive } });
  onTestFinished(() => t.dispose());
  return t;
}

/** Claude as the default provider, answering through `complete`. */
const claude = (complete: LlmProvider['complete'], maxInputChars = 100_000) => ({
  providers: [{ id: 'claude', provider: { id: 'claude', maxInputChars, complete, listModels: async () => [] } }],
});

/** A request someone else answers later. */
interface Held<T> {
  signal: AbortSignal | undefined;
  answer(value: T): void;
}

describe('Plans turned off mid-extraction', () => {
  const plan = { type: 'choice' as const, choice: 'plan', probabilities: { plan: 0.99 }, confidence: 1 };
  const EXTRACTED = { title: 'Game night', when: null, who: [], details: '' };

  it('keeps the running and the queued hit, and extracts both when Plans is back on', async () => {
    const requests: Held<CompletionResult>[] = [];
    const t = start(plansCore, { ai: claude((req) => new Promise<CompletionResult>((resolve) => requests.push({ signal: req.signal, answer: resolve }))) });
    // Jev's hits are archived messages; the extraction reads their text from the archive. The harness doesn't run Jev's
    // per-message matcher, so the test answers the registered question as it would.
    const hits: string[] = [];
    const hit = () => {
      const [id] = t.archive.arrive([{ channelId: 'c1', ts: Date.now() + hits.length, content: 'game night friday?' }]);
      hits.push(id!);
      return { id: id!, channelId: 'c1', authorId: 'u1', ts: Date.now(), content: 'game night friday?', linked: '' };
    };
    const question = () => messageQuestions().find((q) => q.subject === PLAN_SUBJECT)!;
    question().onAnswer!(hit(), plan, null);
    question().onAnswer!(hit(), plan, null);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    await t.off();
    expect(requests[0]!.signal?.aborted).toBe(true);
    requests[0]!.answer({ text: '', json: EXTRACTED }); // too late: its activation ended
    await t.on();
    for (const n of [2, 3]) {
      await vi.waitFor(() => expect(requests).toHaveLength(n));
      requests[n - 1]!.answer({ text: '', json: EXTRACTED });
    }
    await vi.waitFor(() => expect(t.db.prepare(`SELECT message_id FROM ${PLANS_TABLE} ORDER BY message_id`).pluck().all()).toEqual([...hits].sort()));
  });
});

describe('Plans with a stalled provider', () => {
  const plan = { type: 'choice' as const, choice: 'plan', probabilities: { plan: 0.99 }, confidence: 1 };

  it('drops the stalled extraction at its deadline and extracts the next hit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const asked: (AbortSignal | undefined)[] = [];
      // The first call stalls, ignoring its signal; later ones answer at once.
      const complete = (req: CompletionRequest) => (asked.push(req.signal), asked.length === 1 ? new Promise<CompletionResult>(() => undefined) : Promise.resolve({ text: '', json: { title: 'Game night', when: null, who: [], details: '' } }));
      const t = start(plansCore, { ai: claude(complete) });
      const question = () => messageQuestions().find((q) => q.subject === PLAN_SUBJECT)!;
      const ids = [0, 1].map((i) => {
        const content = i === 0 ? 'game night friday?' : 'game night saturday?';
        const [id] = t.archive.arrive([{ channelId: 'c1', ts: Date.now() + i, content }]);
        question().onAnswer!({ id: id!, channelId: 'c1', authorId: 'u1', ts: Date.now(), content, linked: '' }, plan, null);
        return id!;
      });
      await vi.waitFor(() => expect(asked).toHaveLength(1));
      await vi.advanceTimersByTimeAsync(PLAN_EXTRACTION_DEADLINE_MS);
      await vi.waitFor(() => expect(t.db.prepare(`SELECT message_id FROM ${PLANS_TABLE}`).pluck().all()).toEqual([ids[1]]));
      expect(asked[0]?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
