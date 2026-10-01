// The Links activation's lifetime: Jev it was handed is cancelled when it turns off, and late answers are dropped.
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { PluginDescriptor } from '@plugin-sdk/shared';
import type { CorePlugin } from '@plugin-sdk/core';
import { testPlugin, type TestOptions } from '@plugin-sdk/core/testing';
import { MS_PER_MIN } from '@shared/units';
import type { DecisionProvider, DecisionRequest, DecisionResult, Question } from '@core/ai/decisions';
import linksCore from '../core';
import { JUDGMENTS, X_POSTS } from '../core/tables';

/** Starts `core` under the test harness with channel c1 archived, and disposes it after the test. */
function start<D extends PluginDescriptor>(core: CorePlugin<D>, o: TestOptions<D> = {}) {
  const t = testPlugin(core, { ...o, archive: { channels: [{ id: 'c1' }], ...o.archive } });
  onTestFinished(() => t.dispose());
  return t;
}

/** A request someone else answers later. */
interface Held<T> {
  signal: AbortSignal | undefined;
  answer(value: T): void;
}

/** Jev whose every request waits until the test answers it. */
function heldJev(): DecisionProvider & { held: Held<Record<string, unknown>>[] } {
  const held: Held<Record<string, unknown>>[] = [];
  return {
    model: 'held-jev',
    maxInputChars: 64_000,
    held,
    decide: <Q extends Record<string, Question>>(req: DecisionRequest<Q>) =>
      new Promise<DecisionResult<Q>>((resolve) => held.push({ signal: req.signal, answer: (answers) => resolve({ answers: answers as DecisionResult<Q>['answers'], costUsd: null }) })),
  };
}

describe('Links turned off and on while Jev answers', () => {
  const worth = (score: number) => ({ worth_l0: { type: 'score', score, legend: {}, probabilities: {}, confidence: 1 } });

  it("keeps the new activation's judgment: the retired one's late answer is dropped", async () => {
    const jev = heldJev();
    const t = start(linksCore, {
      archive: { messages: [{ channelId: 'c1', ts: Date.now() - MS_PER_MIN, content: 'read https://example.com/post' }] },
      ai: { jev, switches: { linkWorth: true } },
    });
    const judged = () => t.db.prepare<[], number>(`SELECT worth FROM ${JUDGMENTS}`).pluck().get();
    await vi.waitFor(() => expect(jev.held).toHaveLength(1));
    await t.off();
    await t.on();
    await vi.waitFor(() => expect(jev.held).toHaveLength(2));
    jev.held[1]!.answer(worth(4));
    await vi.waitFor(() => expect(judged()).toBe(4));
    expect(jev.held[0]!.signal?.aborted).toBe(true);
    jev.held[0]!.answer(worth(0));
    await new Promise((r) => setImmediate(r));
    expect(judged()).toBe(4);
  });
});

describe('Links X posts across off and on', () => {
  it("pauses queued fetches when Links turns off, then fetches them and posts shared meanwhile when it's back on", async () => {
    const asked: { id: string; signal: AbortSignal | null | undefined; answer(): void }[] = [];
    const network = (url: URL, init: RequestInit) => new Promise<Response>((resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      const id = url.pathname.split('/').pop()!;
      // A post with no text: stored as fetched, with nothing for the link index.
      asked.push({ id, signal: init.signal, answer: () => resolve(new Response(JSON.stringify({ status: { url, text: '', author: { name: 'a', screen_name: 'a', avatar_url: null } } }))) });
    });
    const t = start(linksCore, { network });
    const share = (id: string) => t.archive.arrive([{ channelId: 'c1', content: `look https://x.com/a/status/${id}` }]);
    share('1');
    share('2');
    await vi.waitFor(() => expect(asked.map((a) => a.id)).toEqual(['1']));
    await t.off();
    expect(asked[0]!.signal?.aborted).toBe(true);
    share('3');
    await t.on();
    for (const id of ['1', '2', '3']) {
      await vi.waitFor(() => expect(asked.at(-1)?.id).toBe(id));
      asked.at(-1)!.answer();
    }
    await vi.waitFor(() => expect(t.db.prepare(`SELECT status_id FROM ${X_POSTS} WHERE state = 'ok' ORDER BY status_id`).pluck().all()).toEqual(['1', '2', '3']));
  });
});
