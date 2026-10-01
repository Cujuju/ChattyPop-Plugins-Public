// Search re-rank as a plugin (#65, #156): its ranker orders the top hits Jev may read by Jev's answers, leaves the rest
// in place, and changes nothing while its switch or the plugin is off; the owner's pre-plugin switch is adopted.
import { describe, expect, it, onTestFinished } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import type { SearchHit } from '@shared/contract';
import { aiSettingsFrom } from '@shared/aiProviders';
import { normalizeAiSettings } from '@shared/aiSettings';
import { SETTINGS_KEYS } from '@shared/settings';
import { getSetting, setSetting } from '@core/db';
import { adoptBundledData } from '@core/plugins/adoption';
import { rankSearch } from '@core/searchRankers';
import rerankCore from '../core';
import { RERANK_TOP } from '../core/rerank';
import { plugin as rerank } from '../shared';
import { FakeJev, type JevRequest, tempDb } from '@chattypop/host-testing';

const STAMPED = 'rerank.searchRerank';
/** The first message's time; each later one a millisecond on, so ids follow list order. */
const T0 = 1_700_000_000_000;

/** An archive of `channels` (each message's channel, in order) with `priv` local-AI-only, and the plugin over it. */
function start(channels: readonly string[], answer: (req: JevRequest) => Record<string, unknown>, on = true) {
  const jev = new FakeJev(answer);
  const t = testPlugin(rerankCore, {
    archive: {
      channels: [{ id: 'open' }, { id: 'priv', localOnly: true }],
      messages: channels.map((channelId, i) => ({ channelId, ts: T0 + i, content: `message ${i + 1}` })),
    },
    ai: { jev, switches: { searchRerank: on } },
  });
  onTestFinished(() => t.dispose());
  const ids = t.db.prepare<[], string>('SELECT id FROM archive_all_messages ORDER BY ts').pluck().all();
  const hits: SearchHit[] = ids.map((messageId, i) => ({ messageId, channelId: channels[i]!, channelName: channels[i]!, authorName: 'Alice', ts: T0 + i, snippet: `m${i + 1}`, mentions: {} }));
  const sent = (): string[] => jev.requests.flatMap((r) => Object.values((r.state as { candidates: Record<string, string> }).candidates));
  const order = (out: readonly SearchHit[] | null): string[] | null => out?.map((o) => hits.find((x) => x.messageId === o.messageId)!.snippet) ?? null;
  return { t, jev, hits, sent, order };
}

const noul = (p: number) => ({ type: 'noul', noul: p });

describe('search re-rank', () => {
  it('orders the hits Jev may read by its answers; local-only hits keep their places, unsent', async () => {
    // c0 = the first sendable hit (weak), c1 = the second (strong).
    const h = start(['open', 'priv', 'open'], () => ({ c0: noul(0.1), c1: noul(0.9) }));
    const out = await rankSearch('plans', h.hits);
    expect(h.order(out)).toEqual(['m3', 'm2', 'm1']);
    expect(out![0]!.relevance).toBe(0.9);
    expect(out![1]!.relevance).toBeUndefined();
    expect(h.sent()).toEqual(['Alice in #open: message 1', 'Alice in #open: message 3']);
    expect(h.t.status().error).toBeNull();
  });

  it("takes a hit's channel from the archive, so one claiming a readable channel for a local-only message isn't sent", async () => {
    const h = start(['open', 'priv', 'open'], () => ({ c0: noul(0.1), c1: noul(0.9) }));
    const claimed = h.hits.map((x) => ({ ...x, channelId: 'open' }));
    expect(h.order(await rankSearch('plans', claimed))).toEqual(['m3', 'm2', 'm1']);
    expect(h.sent().some((s) => s.includes('message 2'))).toBe(false);
  });

  it("sends only the archive's text: a caller's channel name and snippet never reach Jev, and empty text stays empty", async () => {
    const h = start(['open', 'open'], () => ({ c0: noul(0.1), c1: noul(0.9) }));
    h.t.db.prepare("UPDATE messages SET content = '' WHERE id = ?").run(h.hits[0]!.messageId);
    const forged = h.hits.map((x) => ({ ...x, channelName: 'secret name', authorName: 'secret author', snippet: 'secret snippet' }));
    await rankSearch('plans', forged);
    expect(h.sent()).toEqual(['Alice in #open: ', 'Alice in #open: message 2']);
  });

  it('keeps full-text order among equal answers, and puts hits Jev left unanswered after the answered, in order', async () => {
    const h = start(['open', 'open', 'open', 'open'], () => ({ c1: noul(0.8), c3: noul(0.8) }));
    const out = await rankSearch('plans', h.hits);
    expect(h.order(out)).toEqual(['m2', 'm4', 'm1', 'm3']);
    expect(out!.map((o) => o.relevance)).toEqual([0.8, 0.8, undefined, undefined]);
  });

  it(`judges only the top ${RERANK_TOP}; the rest keep their places, unsent`, async () => {
    const count = RERANK_TOP + 2;
    // The last judged hit is the strongest.
    const h = start(Array.from({ length: count }, () => 'open'), (req) =>
      Object.fromEntries(Object.keys(req.questions).map((k) => [k, noul(k === `c${RERANK_TOP - 1}` ? 0.9 : 0.1)])),
    );
    const out = await rankSearch('plans', h.hits);
    const names = h.hits.map((x) => x.snippet);
    expect(h.order(out)).toEqual([names[RERANK_TOP - 1], ...names.slice(0, RERANK_TOP - 1), ...names.slice(RERANK_TOP)]);
    expect(h.sent()).toHaveLength(RERANK_TOP);
  });

  it('changes nothing, asking nothing, while its switch is off, for a filters-only search, or while the plugin is off', async () => {
    const off = start(['open', 'open'], () => ({ c0: noul(0.1), c1: noul(0.9) }), false);
    expect(await rankSearch('plans', off.hits)).toBeNull();
    await off.t.off();
    const on = start(['open', 'open'], () => ({ c0: noul(0.1), c1: noul(0.9) }));
    expect(await rankSearch('', on.hits)).toBeNull();
    await on.t.off();
    expect(await rankSearch('plans', on.hits)).toBeNull();
    expect([...off.jev.requests, ...on.jev.requests]).toEqual([]);
  });
});

describe('the re-rank switch', () => {
  /** Settings → AI as a profile from before this plugin stores it: earlier plugins' switches stamped, this one not. */
  const STORED_AI = {
    defaultProvider: 'claude',
    providers: { claude: { enabled: true, model: null, effort: null }, ollama: { enabled: false, model: null, effort: null } },
    jevConnection: 'openrouter',
    jev: {
      topicMeaning: true, catchUpBadges: false, keepImportant: true, searchRerank: true, messageTags: false, suggestChannels: false,
      pluginDecide: false, messageCheck: true, messageClasses: false, ruleQuestions: false,
      'alerts.urgentToasts': true, 'summaries.keyThemes': true, 'links.linkWorth': false, 'plans.planDetection': true, 'tags.customTags': true,
    },
  };

  it("keeps the owner's value under its stamped key, once, and leaves every other switch as stored", () => {
    const db = tempDb();
    setSetting(db, SETTINGS_KEYS.ai, STORED_AI);
    adoptBundledData(db, [rerank]);
    const once = getSetting(db, SETTINGS_KEYS.ai) as typeof STORED_AI;
    adoptBundledData(db, [rerank]);
    expect(getSetting(db, SETTINGS_KEYS.ai)).toEqual(once);
    const { searchRerank: _adopted, ...others } = STORED_AI.jev;
    expect(once.jev).toEqual({ ...others, [STAMPED]: true });
    expect(aiSettingsFrom(once).jev[STAMPED]).toBe(true);
  });

  it('survives a build without the plugin unadopted, and is off by default once it is installed', () => {
    expect(normalizeAiSettings(STORED_AI).jev).toMatchObject({ searchRerank: true });
    expect(aiSettingsFrom({}).jev[STAMPED]).toBe(false);
  });
});
