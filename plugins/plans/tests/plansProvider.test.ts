// Tests Plans' provider migration, selected model, and missing-provider behavior.
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { LlmProvider } from '@plugin-sdk/core';
import { testPlugin, type TestOptions } from '@plugin-sdk/core/testing';
import type { CompletionRequest } from '@core/ai/types';
import { messageQuestions } from '@core/jev/messageQuestions';
import plansCore, { NO_PLAN_PROVIDER } from '../core';
import { PLAN_SUBJECT } from '../shared';
import { PLANS_TABLE } from '../core/schema';

type Options = TestOptions<typeof plansCore.plugin>;
const plan = { type: 'choice' as const, choice: 'plan', probabilities: { plan: 0.99 }, confidence: 1 };
const EXTRACTED = { title: 'Game night', when: null, who: [], details: '' };

/** Plans with Claude running (its requests recorded), channel c1 archived; disposed after the test. */
function start(o: Options = {}) {
  const asked: CompletionRequest[] = [];
  const complete: LlmProvider['complete'] = async (req) => (asked.push(req), { text: '', json: EXTRACTED });
  const t = testPlugin(plansCore, {
    ...o,
    archive: { channels: [{ id: 'c1' }] },
    ai: { providers: [{ id: 'claude', provider: { id: 'claude', maxInputChars: 100_000, complete, listModels: async () => [] } }] },
  });
  onTestFinished(() => t.dispose());
  /** Settings → AI as the owner saved them. */
  const saveAi = (ai: unknown) => t.db.prepare(`UPDATE settings SET value = ? WHERE key = 'ai'`).run(JSON.stringify(ai));
  /** Jev finds a plan in a new message (the harness doesn't run Jev's matcher, so the test answers the question). */
  const hit = (): string => {
    const content = 'game night friday?';
    const [id] = t.archive.arrive([{ channelId: 'c1', ts: Date.now(), content }]);
    messageQuestions().find((q) => q.subject === PLAN_SUBJECT)!.onAnswer!({ id: id!, channelId: 'c1', authorId: 'u1', ts: Date.now(), content, linked: '' }, plan, null);
    return id!;
  };
  const extracted = () => t.db.prepare(`SELECT message_id FROM ${PLANS_TABLE}`).pluck().all();
  return { t, asked, saveAi, hit, extracted };
}

describe("Plans' provider", () => {
  it('starts from the global default it had before each feature chose its own', async () => {
    const h = start({ profile: { settings: { ai: { defaultProvider: 'claude' } } } });
    expect(h.t.preferences.get('settings')).toEqual({ defaultProvider: 'claude' });
    const id = h.hit();
    await vi.waitFor(() => expect(h.extracted()).toEqual([id]));
  });

  it('is asked with the model and effort picked for it in Settings → AI', async () => {
    const h = start({ preferences: { settings: { defaultProvider: 'claude' } } });
    h.saveAi({ providers: { claude: { enabled: true, model: 'opus', effort: 'high' } } });
    h.hit();
    await vi.waitFor(() => expect(h.asked).toHaveLength(1));
    expect(h.asked[0]).toMatchObject({ model: 'opus', effort: 'high' });
  });

  it('none chosen, or turned off: the hit is dropped, saying where to choose or why', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    onTestFinished(() => warn.mockRestore());
    const h = start();
    h.hit();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(`[plans] not extracted: ${NO_PLAN_PROVIDER}`));
    h.t.preferences.set('settings', { defaultProvider: 'claude' });
    h.saveAi({ providers: { claude: { enabled: false } } });
    h.hit();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[plans\] not extracted: claude: Turned off/)));
    expect(h.asked).toEqual([]);
    expect(h.extracted()).toEqual([]);
  });
});
