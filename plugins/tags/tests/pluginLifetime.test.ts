// A Tags range run when Tags turns off: queued Jev requests are never sent, and answered ones keep their cost.
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { PluginDescriptor } from '@plugin-sdk/shared';
import type { CorePlugin } from '@plugin-sdk/core';
import { testPlugin, type TestOptions } from '@plugin-sdk/core/testing';
import { MS_PER_MIN } from '@shared/units';
import { JevProvider, type JevRoute } from '@core/ai/jev';
import tagsCore from '../core';

/** Starts `core` under the test harness with channel c1 archived, and disposes it after the test. */
function start<D extends PluginDescriptor>(core: CorePlugin<D>, o: TestOptions<D> = {}) {
  const t = testPlugin(core, { ...o, archive: { channels: [{ id: 'c1' }], ...o.archive } });
  onTestFinished(() => t.dispose());
  return t;
}

describe('a Tags range run when Tags turns off', () => {
  const RANGE = 8;
  /** Jev's shared cap on requests in flight (jev.ts MAX_IN_FLIGHT). */
  const IN_FLIGHT = 4;
  const COST_USD = 0.01;
  const route: JevRoute = { label: 'test', endpoint: 'https://jev.test/decide', wireModel: 'jev', headers: {}, errorText: () => 'failed', cost: (u) => u?.cost ?? null };
  afterEach(() => vi.unstubAllGlobals());

  it('stops queued requests from being sent and keeps what the answered ones cost', async () => {
    const sent: { questions: Record<string, unknown>; reply(): void }[] = [];
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
      const body = JSON.parse(String(init.body)) as { questions: Record<string, unknown> };
      init.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      sent.push({
        questions: body.questions,
        reply: () => resolve(new Response(JSON.stringify({ answers: Object.fromEntries(Object.keys(body.questions).map((k) => [k, { noul: 0.1 }])), usage: { cost: COST_USD } }))),
      });
    }));
    // The real Jev client over a stubbed network: it holds the in-flight cap.
    const jev = new JevProvider(() => undefined).via(route);
    const messages = Array.from({ length: RANGE }, (_, i) => ({ channelId: 'c1', ts: Date.now() - MS_PER_MIN + i, content: `talk ${i}` }));
    const t = start(tagsCore, { archive: { messages }, ai: { jev, switches: { customTags: true } } });
    const tags = t.client('renderer');
    const tagId = await tags.createTag({ name: 'Trading', auto: false, jevQuestion: { type: 'noul', question: 'Trading?', yes: '', no: '', minProbability: 0.5 } });
    const run = tags.tagRange({ channelId: 'c1', tagIds: [tagId], scope: { kind: 'latest', count: RANGE } });
    await vi.waitFor(() => expect(sent).toHaveLength(IN_FLIGHT));
    sent[0]!.reply();
    await vi.waitFor(() => expect(sent).toHaveLength(IN_FLIGHT + 1));
    await t.off();
    const result = await run;
    expect(sent).toHaveLength(IN_FLIGHT + 1);
    expect(result).toMatchObject({ asked: RANGE, costUsd: COST_USD });
  });
});
