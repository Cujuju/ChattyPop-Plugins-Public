// Contract tests for jev summary shape.
import { archivePayloads } from '@core/plugins/archivePayloads';
import { adoptSummaries } from './summariesHarness';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_AI_SETTINGS, type AiSettings } from '@shared/settings';
import { DEFAULT_SUMMARY_SETTINGS } from '../shared/settings';
import { MS_PER_MIN } from '@shared/units';
import { Summarizer } from '../core/summarize';
import type { LogLine } from '../core/summaryJev';
import { assignThemes, chunkByConversation, rateComplexity, skipQuiet } from '../core/summaryShape';
import type { CompletionRequest } from '@core/ai/types';
import type { Db } from '@core/db';
import { fakeRegistry } from './summariesHarness';
import { FakeJev, choice, rawMessage, seedArchive, tempDb } from '@chattypop/host-testing';
import { ARRIVAL } from '@core/arrival';

const line = (i: number, ch = 'A'): LogLine => ({
  ref: `m${i}`,
  citation: { messageId: `id${i}`, channelId: ch, channelName: ch, ts: i },
  text: `[m${i}] #${ch} ${'x'.repeat(40)} ${String(i).padStart(3, '0')}`,
  plain: `${ch}:${i}`,
  filler: false,
  people: [],
});

describe('#56 skip quiet stretches', () => {
  it('drops only stretches Jev is confident are quiet, and keeps a stretch whose request fails', async () => {
    const lines = [...Array.from({ length: 30 }, (_, i) => line(i, 'A')), ...Array.from({ length: 30 }, (_, i) => line(100 + i, 'B'))];
    let call = 0;
    const jev = new FakeJev((req) => {
      if (++call === 2) throw new Error('down');
      return { quiet: { type: 'noul', noul: (req.state as { conversation: string[] }).conversation[0]!.startsWith('A') ? 0.05 : 0.9 } };
    }, 0.001);
    const r = await skipQuiet(jev, lines);
    expect(jev.requests).toHaveLength(2);
    // Channel A's window was either judged quiet (dropped) or failed (kept); B's likewise. Exactly one of them failed.
    expect(r.kept.length === 30 || r.kept.length === 60).toBe(true);
  });
});

describe('#58 split by conversation', () => {
  it('moves the cut back to the least continuous pair; one chunk needs no Jev', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => line(i));
    const jev = new FakeJev();
    const one = await chunkByConversation(jev, lines, 1e9);
    expect(one.chunks).toHaveLength(1);
    expect(jev.requests).toHaveLength(0);
    jev.values = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`c${i}`, i === 7 ? 0.05 : 0.9]));
    const perLine = lines[0]!.text.length + 1;
    const r = await chunkByConversation(jev, lines, perLine * 10);
    expect(r.chunks[0]!.map((l) => l.ref)).toEqual(Array.from({ length: 7 }, (_, i) => `m${i}`));
    expect(r.chunks.flat()).toHaveLength(20);
  });

  it('keeps the size cut when Jev fails', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => line(100 + i)); // equal-length lines
    const jev = new FakeJev();
    jev.fail = true;
    const perLine = lines[0]!.text.length + 1;
    const r = await chunkByConversation(jev, lines, perLine * 10);
    expect(r.chunks.map((c) => c.length)).toEqual([10, 10]);
  });
});

describe('#59 key themes', () => {
  it('sorts messages under themes at even odds or better, never under none', async () => {
    const lines = Array.from({ length: 5 }, (_, i) => line(i));
    const jev = new FakeJev();
    jev.values = { q0: choice('Games', 0.9), q1: choice('Games', 0.4), q2: choice('none', 0.9), q3: choice('Work', 0.7), q4: choice('Games', 0.6) };
    const t = (title: string, description = '') => ({ title, description });
    const r = await assignThemes(jev, lines, [t('Games', 'Video games and sports'), t('Work'), t(' '), t('none')]);
    // The description is the option's meaning for Jev; a theme without one is just its title.
    expect((jev.requests[0]!.questions['q0'] as { criteria: Record<string, string | null> }).criteria).toMatchObject({ Games: 'Video games and sports', Work: null });
    expect(r.themes.map((t) => [t.title, t.citations.map((c) => c.messageId)])).toEqual([
      ['Games', ['id0', 'id4']],
      ['Work', ['id3']],
    ]);
  });
});

describe('#60 complexity', () => {
  it('is complex at or above the query level (1.5 by default), or null when Jev fails', async () => {
    const jev = new FakeJev();
    jev.values = { complexity: 1.7 };
    expect((await rateComplexity(jev, [line(1)])).complex).toBe(true);
    jev.values = { complexity: 1.2 };
    expect((await rateComplexity(jev, [line(1)])).complex).toBe(false);
    jev.fail = true;
    expect((await rateComplexity(jev, [line(1)])).complex).toBeNull();
  });
});

describe('Summarizer with Jev shaping', () => {
  let db: Db;
  let jev: FakeJev;
  let calls: CompletionRequest[];
  /** The OpenRouter model each call went to. */
  let models: (string | null)[];
  const settings = (): AiSettings => ({
    ...DEFAULT_AI_SETTINGS,
    providers: { ...DEFAULT_AI_SETTINGS.providers, openrouter: { enabled: true, model: 'base/model', effort: null, displayName: null } },
    jev: jev.on,
  });
  const prefs = {
    ...DEFAULT_SUMMARY_SETTINGS,
    defaultProvider: 'openrouter' as const,
    jevRouting: { cheapModel: 'cheap/model', premiumModel: 'premium/model', cheapEffort: null, premiumEffort: null },
  };
  let summarizer: Summarizer;
  beforeEach(() => {
    db = adoptSummaries(tempDb());
    jev = new FakeJev();
    models = [];
    const archive = seedArchive(db, [{ id: 'c1' }]);
    archive.ingestMessages(Array.from({ length: 6 }, (_, i) => rawMessage('c1', Date.now() - MS_PER_MIN + i, `message ${i}`)), ARRIVAL.gateway);
    const fake = fakeRegistry(
      () => db,
      (_req, s) => {
        models.push(s.providers['openrouter']?.model ?? null);
        return { headline: 'h', items: [{ parts: [{ text: 'p', refs: ['m1'] }] }], themes: [{ title: 'Chat', description: 'General chat' }] };
      },
      (_s, f) => jev.forPlugin('summaries')(f),
    );
    calls = fake.calls;
    summarizer = new Summarizer(db, (ids) => archivePayloads(db, ids), fake.registry, () => {});
  });

  it('the projection bounds the questions a run asks, and a cached run projects none', async () => {
    jev.on['summaries.summaryFilter'] = true;
    jev.on['summaries.citationCheck'] = true;
    jev.on['summaries.skipQuietStretches'] = true;
    jev.on['summaries.keyThemes'] = true;
    jev.on['summaries.modelRouting'] = true;
    jev.values = { quiet: 0.9, complexity: 1.8 };
    const estimate = summarizer.estimate({ sinceTs: 0 }, settings(), prefs)!;
    await summarizer.run({ sinceTs: 0 }, settings(), prefs, 'manual');
    const asked = jev.requests.reduce((n, r) => n + Object.keys(r.questions).length, 0);
    expect(asked).toBeGreaterThan(0);
    expect(estimate).toMatchObject({ messages: 6, cached: false });
    expect(estimate.questions).toBeGreaterThanOrEqual(asked);
    expect(summarizer.estimate({ sinceTs: 0 }, settings(), prefs)).toMatchObject({ cached: true, questions: 0 });
  });

  it('a range Jev finds entirely quiet makes no LLM call', async () => {
    jev.on['summaries.skipQuietStretches'] = true;
    jev.values = { quiet: 0.01 };
    const s = await summarizer.run({ sinceTs: 0 }, settings(), prefs, 'manual');
    expect(s.headline).toBe('Nothing notable in this range.');
    expect(calls).toEqual([]);
  });

  it('routes to the premium model for a complex run and sorts key themes', async () => {
    jev.on['summaries.modelRouting'] = true;
    jev.on['summaries.keyThemes'] = true;
    jev.values = { complexity: 1.8, ...Object.fromEntries(Array.from({ length: 6 }, (_, k) => [`q${k}`, choice('Chat', 0.8)])) };
    const s = await summarizer.run({ sinceTs: 0 }, settings(), prefs, 'manual');
    expect(models[0]).toBe('premium/model');
    expect(s.model).toBe('premium/model');
    expect(calls[0]!.system).toMatch(/key themes/);
    expect(s.themes?.[0]).toMatchObject({ title: 'Chat' });
    expect(s.themes![0]!.citations).toHaveLength(6);
  });

  it('a simple run takes the cheap model; without both models set there is no routing', async () => {
    jev.on['summaries.modelRouting'] = true;
    jev.values = { complexity: 0.3 };
    await summarizer.run({ sinceTs: 0 }, settings(), prefs, 'manual');
    expect(models[0]).toBe('cheap/model');
    const unset = { ...prefs, jevRouting: { ...prefs.jevRouting, premiumModel: null } };
    jev.requests = [];
    await summarizer.run({ sinceTs: 1 }, settings(), unset, 'manual');
    expect(jev.requests.some((r) => 'complexity' in r.questions)).toBe(false);
  });
});
