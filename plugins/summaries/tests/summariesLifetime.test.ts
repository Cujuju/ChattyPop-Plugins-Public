// Summaries' activation lifetime: a run in progress when Summaries turns off sends nothing more and settles inactive.
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { PluginDescriptor } from '@plugin-sdk/shared';
import type { CorePlugin, LlmProvider } from '@plugin-sdk/core';
import { testPlugin, type TestOptions } from '@plugin-sdk/core/testing';
import { PluginInactiveError } from '@shared/pluginCall';
import { MS_PER_MIN } from '@shared/units';
import type { CompletionRequest, CompletionResult } from '@core/ai/types';
import summariesCore from '../core';
import { DEFAULT_SUMMARY_SETTINGS } from '../shared/settings';


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

describe('Summaries turned off mid-run', () => {
  /** Small enough that the seeded range needs several chunk requests, then a merge. */
  const CHUNK_CHARS = 120;
  const DRAFT = { headline: 'h', items: [{ parts: [{ text: 'p', refs: [] }] }] };

  it('sends no further model request, and the run settles as inactive', async () => {
    const requests: Held<CompletionResult>[] = [];
    // Ignores its signal, as a CLI provider mid-request may: the answer still arrives after the abort.
    const complete = (req: CompletionRequest) => new Promise<CompletionResult>((resolve) => requests.push({ signal: req.signal, answer: resolve }));
    const messages = Array.from({ length: 6 }, (_, i) => ({ channelId: 'c1', ts: Date.now() - MS_PER_MIN + i, content: `message ${i} ${'x'.repeat(60)}` }));
    const t = start(summariesCore, { archive: { messages }, ai: claude(complete, CHUNK_CHARS), preferences: { settings: { ...DEFAULT_SUMMARY_SETTINGS, defaultProvider: 'claude' } } });
    const run = t.client('renderer').summarize({ sinceTs: 0 });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    await t.off();
    expect(requests[0]!.signal?.aborted).toBe(true);
    requests[0]!.answer({ text: JSON.stringify(DRAFT), json: DRAFT });
    await expect(run).rejects.toBeInstanceOf(PluginInactiveError);
    expect(requests).toHaveLength(1);
  });
});
