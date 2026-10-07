import { describe, expect, it, vi } from 'vitest';
import type { ProviderId } from '@shared/settings';
import { ProviderRegistry } from '@core/ai/registry';
import { assertProviderMayRead } from '@core/ai/readScope';
import { PLAN_QUERY } from '../shared';
import { parseWhen, planList, planQuestion } from '../core/plans';
import { PENDING_TABLE, PLANS_MIGRATIONS, PLANS_TABLE } from '../core/schema';
import { openDb } from '@core/db';
import { adoptBundledData } from '@core/plugins/adoption';
import { pluginDb } from '@core/plugins/pluginDb';
import { migratePlugin } from '@core/plugins/api';
import plansShared from '../shared';
import { jevQuery } from '@core/jev/queries';

/** The plans query's default threshold. */
const PLAN_AT = (jevQuery(PLAN_QUERY) as { minProbability: number }).minProbability;
import { rawMessage, seedArchive, settleAsync, tempDb } from '@chattypop/host-testing';
import { ARRIVAL } from '@core/arrival';

// The provider plugins this plugin asks: stand-ins, since only the plugin under check is in the registry.
vi.mock('virtual:bundled-plugins/shared', async (build) => (await import('@chattypop/host-testing/fixtureProviders')).withFixtureProviders(build));

const answer = (choice: string, p: number) => ({ type: 'choice' as const, choice, probabilities: { [choice]: p }, confidence: 1 });

function setup(provider: ProviderId) {
  const db = tempDb();
  const a = seedArchive(db, [{ id: 'open' }, { id: 'priv' }]);
  a.setChannelPolicy('priv', { localAiOnly: true });
  adoptBundledData(db, [plansShared]);
  migratePlugin(db, plansShared.manifest.id, PLANS_MIGRATIONS);
  const prompts: string[] = [];
  const q = planQuestion({
    db,
    provider: () => ({
      // As ctx.ai.provider's completions send it: the host checks the declared reads against the chosen provider.
      complete: async (req) => {
        assertProviderMayRead(db, new ProviderRegistry(() => undefined), provider, req.reads);
        prompts.push(req.prompt);
        return { json: { title: 'Game night', when: '2026-10-02T19:00:00-07:00', who: ['Ana', 'Bo'], details: 'At Ana’s' } };
      },
    }),
    changed: () => {},
  });
  const msg = (channelId: string, ms: number, content: string) => {
    const m = rawMessage(channelId, ms, content);
    a.ingestMessages([m], ARRIVAL.gateway);
    return { id: m.id, channelId, authorId: 'u1', ts: ms, content, linked: '' };
  };
  return { db, q, prompts, msg };
}

describe('plans and decisions (#67)', () => {
  it('extracts a confident plan with a code-checked date', async () => {
    const { db, q, prompts, msg } = setup('claude');
    q.onAnswer!(msg('open', Date.UTC(2026, 8, 28), 'game night friday 7 at Ana’s?'), answer('plan', PLAN_AT + 0.1), null);
    q.onAnswer!(msg('open', Date.UTC(2026, 8, 28, 1), 'maybe'), answer('plan', PLAN_AT - 0.2), null);
    q.onAnswer!(msg('open', Date.UTC(2026, 8, 28, 2), 'lol'), answer('neither', 0.99), null);
    await settleAsync();
    expect(prompts).toHaveLength(1);
    expect(planList(db, 10)).toEqual([
      expect.objectContaining({ kind: 'plan', title: 'Game night', whenTs: Date.parse('2026-10-02T19:00:00-07:00'), who: ['Ana', 'Bo'] }),
    ]);
  });

  it('never sends a local-only channel to a hosted provider, but does to Ollama', async () => {
    const hosted = setup('claude');
    hosted.q.onAnswer!(hosted.msg('priv', Date.UTC(2026, 8, 28), 'we decided: ship monday'), answer('decision', 0.9), null);
    await settleAsync();
    expect(hosted.prompts).toHaveLength(0);
    const local = setup('ollama');
    local.q.onAnswer!(local.msg('priv', Date.UTC(2026, 8, 28), 'we decided: ship monday'), answer('decision', 0.9), null);
    await settleAsync();
    expect(local.prompts).toHaveLength(1);
  });

  it("drops a hit, saying why, while no provider is chosen or it can't run", async () => {
    const { db, msg } = setup('claude');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const reason = 'claude: Turned off in Settings → AI providers.';
    const q = planQuestion({ db, provider: () => reason, changed: () => {} });
    q.onAnswer!(msg('open', Date.UTC(2026, 8, 28), 'game night friday 7?'), answer('plan', PLAN_AT + 0.1), null);
    await settleAsync();
    expect(warn).toHaveBeenCalledWith(`[plans] not extracted: ${reason}`);
    expect(db.prepare(`SELECT COUNT(*) FROM ${PENDING_TABLE}`).pluck().get()).toBe(0);
    expect(planList(db, 10)).toEqual([]);
    warn.mockRestore();
  });

  it('keeps a hit whose extraction a quit interrupted, and extracts it at the next start', async () => {
    const { db, q, prompts, msg } = setup('claude');
    const stalled = planQuestion({ db, provider: () => ({ complete: () => new Promise<never>(() => undefined) }), changed: () => {} });
    stalled.onAnswer!(msg('open', Date.UTC(2026, 8, 28), 'game night friday 7?'), answer('plan', PLAN_AT + 0.1), null);
    await settleAsync();
    expect(prompts).toEqual([]);
    // The next start: `q` stands for the plugin's activation in the new core process.
    const next = planQuestion({ db, provider: () => ({ complete: async (req) => (prompts.push(req.prompt), { json: { title: 'Game night', when: null, who: [], details: '' } }) }), changed: () => {} });
    expect(next.subject).toBe(q.subject);
    await settleAsync();
    expect(prompts).toHaveLength(1);
    expect(planList(db, 10)).toEqual([expect.objectContaining({ kind: 'plan', title: 'Game night' })]);
    // Extracted: a later start owes nothing.
    planQuestion({ db, provider: () => ({ complete: async (req) => (prompts.push(req.prompt), { json: {} }) }), changed: () => {} });
    await settleAsync();
    expect(prompts).toHaveLength(1);
  });

  it('keeps every hit pending when the archive closes mid-extraction, and never leaves a failure unhandled', async () => {
    const { db, msg } = setup('claude');
    const file = db.name;
    const lifetime = new AbortController();
    let answer1: (r: { json?: unknown }) => void = () => undefined;
    // The activation's database, as the plugin gets it: writes refuse once the activation ended.
    const fenced = pluginDb(() => db, () => !lifetime.signal.aborted, 'plans');
    const held = planQuestion({ db: fenced, provider: () => ({ complete: () => new Promise((r) => (answer1 = r)) }), changed: () => {} });
    held.onAnswer!(msg('open', Date.UTC(2026, 8, 28), 'game night friday 7?'), answer('plan', PLAN_AT + 0.1), null);
    held.onAnswer!(msg('open', Date.UTC(2026, 8, 28, 1), 'we decided: tacos'), answer('decision', PLAN_AT + 0.1), null);
    await settleAsync();
    // The host ends activations, then closes the archive (an archive move).
    lifetime.abort();
    db.close();
    answer1({ json: { title: 'Game night', when: null, who: [], details: '' } });
    await settleAsync();
    const reopened = openDb(file);
    expect(reopened.prepare(`SELECT COUNT(*) FROM ${PENDING_TABLE}`).pluck().get()).toBe(2);
    // Closed with the activation still live: the failure is caught and the hit stays pending.
    let answer2: (r: { json?: unknown }) => void = () => undefined;
    planQuestion({ db: reopened, provider: () => ({ complete: () => new Promise((r) => (answer2 = r)) }), changed: () => {} });
    await settleAsync();
    reopened.close();
    answer2({ json: { title: 'Game night', when: null, who: [], details: '' } });
    await settleAsync();
    expect(openDb(file).prepare(`SELECT COUNT(*) FROM ${PENDING_TABLE}`).pluck().get()).toBe(2);
  });

  it('parses dates in code: invalid → null, date-only → that local day', () => {
    expect(parseWhen('next friday')).toBeNull();
    expect(parseWhen(null)).toBeNull();
    expect(parseWhen('2026-10-02')).toBe(new Date(2026, 9, 2).getTime());
  });

  it('rejects impossible calendar dates and times instead of rolling them over; accepts real ones with an offset', () => {
    for (const bad of ['2026-02-30', '2026-04-31T10:00:00Z', '2026-02-30T10:00:00+01:00', '2025-02-29', '2026-02-28T24:00:00', '2026-01-01T10:60', 'March 3 2026']) {
      expect(parseWhen(bad), bad).toBeNull();
    }
    expect(parseWhen('2028-02-29')).toBe(new Date(2028, 1, 29).getTime());
    expect(parseWhen('2026-10-02T18:30:00+02:00')).toBe(Date.UTC(2026, 9, 2, 16, 30));
    expect(parseWhen('2026-10-02T18:30Z')).toBe(Date.UTC(2026, 9, 2, 18, 30));
    expect(parseWhen('2026-10-02T18:30:15.250')).toBe(new Date(2026, 9, 2, 18, 30, 15, 250).getTime());
  });
});
