// Contract tests for summary options.
import { archivePayloads } from '@core/plugins/archivePayloads';
import { adoptSummaries } from './summariesHarness';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SummaryEvent } from '../shared/types';
import { DEFAULT_SUMMARY_SETTINGS, normalizeSummarySettings, withOwnPrompts, type SummarySettings } from '../shared/settings';
import { DEFAULT_SUMMARY_PROMPTS, NO_PROMPT_OVERRIDES, SUMMARY_PROMPT_MAX_CHARS, fillSummaryPrompt, summaryPromptError } from '../shared/prompts';
import { MS_PER_DAY } from '@shared/units';
import { Summarizer } from '../core/summarize';
import { partialText } from '../core/summaryPrompt';
import { SUMMARIES_TABLE } from '../core/schema';
import type { Db } from '@core/db';
import { fakeRegistry, TEST_PREFS } from './summariesHarness';
import { rawMessage, seedArchive, tempDb } from '@chattypop/host-testing';
import { ARRIVAL } from '@core/arrival';
import { aiSettingsFrom } from '@shared/aiProviders';

// The provider plugins this plugin asks: stand-ins, since only the plugin under check is in the registry.
vi.mock('virtual:bundled-plugins/shared', async (build) => (await import('@chattypop/host-testing/fixtureProviders')).withFixtureProviders(build));

/** A fresh profile's AI settings: Claude is the default. */
const FRESH_AI = aiSettingsFrom({});

const GENERAL = '200000000000000001';
const RELEASES = '200000000000000002';
const BOB = { id: '400000000000000001', username: 'bob', global_name: 'Bob' };

/** Answers every call with a bullet in two parts citing the first and second log refs and, when the schema asks for them, an action. */
const fakeProvider = () =>
  fakeRegistry(() => db, (req) => {
    const [first = '', second = ''] = [...req.prompt.matchAll(/\[(m\d+)\]/g)].map((m) => m[1]!);
    const wantsActions = (req.schema?.['required'] as string[]).includes('actions');
    const parts = [{ text: 'one thread', refs: [first] }, { text: 'another', refs: [second] }];
    return { headline: 'h', items: [{ parts }], ...(wantsActions ? { actions: [{ text: 'Reply to Bob', refs: [first] }] } : {}) };
  });

let db: Db;
beforeEach(() => {
  db = adoptSummaries(tempDb());
  const archive = seedArchive(db, [
    { id: GENERAL, name: 'general' },
    { id: RELEASES, name: 'releases' },
  ]);
  const t0 = Date.now() - 2 * MS_PER_DAY;
  archive.ingestMessages([
    rawMessage(GENERAL, t0, 'morning all'),
    rawMessage(RELEASES, t0 + 1000, 'v2 ships friday', { author: BOB }),
    rawMessage(GENERAL, t0 + MS_PER_DAY, `<@${BOB.id}> can you review the PR?`),
  ], ARRIVAL.gateway);
});

/** One fixed range for every run, so only the options differ between runs. */
const SINCE = Date.now() - 3 * MS_PER_DAY;
const run = (s: Summarizer, prefs: Partial<SummarySettings> = {}) => s.run({ sinceTs: SINCE }, FRESH_AI, { ...TEST_PREFS, ...prefs }, 'manual');

describe('summary options reach the prompt and the stored run', () => {
  it('names mentions, dates a multi-day log, asks for and stores actions', async () => {
    const { calls, registry } = fakeProvider();
    const events: SummaryEvent[] = [];
    const s = new Summarizer(db, (ids) => archivePayloads(db, ids), registry, (e) => events.push(e), () => ['Alice']);
    const summary = await run(s, { focus: 'release dates' });

    const [call] = calls;
    expect(call!.prompt).toContain('Alice {{p1}}: @Bob {{p2}} can you review');
    expect(call!.prompt).toMatch(/\[m1\] #general \w{3} \w{3} \d{2} \d{2}:\d{2} Alice \{\{p1\}\}: morning all/);
    expect(call!.system).toContain('"Alice"');
    expect(call!.system).toContain('release dates');
    expect(summary.actions).toEqual([{ parts: [{ text: 'Reply to Bob', citations: [expect.objectContaining({ channelName: 'general' })] }] }]);
    // Each part keeps its own sources.
    expect(summary.items[0]!.parts.map((p) => [p.text, p.citations.map((c) => c.channelName)])).toEqual([['one thread', ['general']], ['another', ['releases']]]);
    expect(summary.trigger).toBe('manual');
    expect(events.filter((e) => e.type === 'summary-added')).toEqual([{ type: 'summary-added', summary }]);
  });

  it('leaves actions out of the schema when off, and groups the log by channel', async () => {
    const { calls, registry } = fakeProvider();
    const s = new Summarizer(db, (ids) => archivePayloads(db, ids), registry, () => {});
    const summary = await run(s, { actionItems: false, grouping: 'channel' });
    expect(calls[0]!.schema!['required']).toEqual(['headline', 'items']);
    expect(summary.actions).toEqual([]);
    expect(summary.grouping).toBe('channel');
    // Both #general messages before #releases, chronological within each.
    expect([...calls[0]!.prompt.matchAll(/#(\w+)/g)].map((m) => m[1])).toEqual(['general', 'general', 'releases']);
  });

  it('reuses a cached run only when the options match', async () => {
    const { calls, registry } = fakeProvider();
    const s = new Summarizer(db, (ids) => archivePayloads(db, ids), registry, () => {});
    const a = await run(s);
    expect((await run(s)).id).toBe(a.id);
    expect(calls).toHaveLength(1);
    expect((await run(s, { length: 'brief' })).id).not.toBe(a.id);
    expect(calls).toHaveLength(2);
  });

  it("sends the owner's template with its placeholders filled, and doesn't reuse a run made with another", async () => {
    const { calls, registry } = fakeProvider();
    const s = new Summarizer(db, (ids) => archivePayloads(db, ids), registry, () => {});
    const a = await run(s);
    const template = 'Summarize tersely.\n{bullets}\n\n{refs}\n{focus}\nPlain words only.';
    const b = await run(s, { prompts: { summarize: template, merge: null } });
    expect(b.id).not.toBe(a.id);
    expect(calls[1]!.system).toBe(
      `Summarize tersely.\nthen 6-14 bullets on the most important conversations, in the order they started.\n\nWrite each bullet as one or more parts in order. A part is the sentences about one thread (one exchange, or the same people on one sub-topic) with the refs (like "m12") of the messages it covers; start a new part when the bullet moves to another thread. Use only refs that appear in the log.\nEach person in the log has a tag after their name, like {{p3}}. Everywhere you name a person (headline, bullets, actions, themes), write their tag in place of their name, exactly as the log shows it: {{p3}}.\nPlain words only.`,
    );
  });

  it('shows the merge call each part next to its refs', () => {
    const draft = { headline: 'h', items: [{ parts: [{ text: 'A said x.', refs: ['m1', 'm2'] }, { text: 'B said y.', refs: ['m5'] }] }], actions: [{ text: 'Reply', refs: ['m2'] }] };
    expect(partialText(draft, 1, () => 'general', 'channel')).toBe('Part 1: h\n- #general: A said x. [m1, m2] B said y. [m5]\nActions:\n- Reply [m2]');
  });

  it('reads a run stored before points had parts as one part per point', async () => {
    const { registry } = fakeProvider();
    const s = new Summarizer(db, (ids) => archivePayloads(db, ids), registry, () => {});
    const a = await run(s);
    const cite = a.items[0]!.parts[0]!.citations[0]!;
    const legacy = [{ text: 'whole point', citations: [cite], check: { verdict: 'supported', confidence: 1 } }];
    db.prepare(`UPDATE ${SUMMARIES_TABLE} SET items_json = ?, actions_json = ? WHERE id = ?`).run(JSON.stringify(legacy), JSON.stringify([{ text: 'act', citations: [] }]), a.id);
    const [read] = s.page({ limit: 1 });
    expect(read!.items).toEqual([{ parts: [{ text: 'whole point', citations: [cite] }], check: { verdict: 'supported', confidence: 1 } }]);
    expect(read!.actions).toEqual([{ parts: [{ text: 'act', citations: [] }] }]);
  });

  it("layers a rule's own prompts over the owner's, a null part following the owner's", () => {
    const owner = { ...TEST_PREFS, prompts: { summarize: 'Owner. {refs}', merge: 'Owner merge. {refs}' } };
    expect(withOwnPrompts(owner, undefined)).toBe(owner);
    expect(withOwnPrompts(owner, { summarize: 'Rule. {refs}', merge: null }).prompts).toEqual({ summarize: 'Rule. {refs}', merge: 'Owner merge. {refs}' });
  });

  it('shows the same instructions a run sends', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); // the prompt states the time to the minute
    try {
      const { calls, registry } = fakeProvider();
      const s = new Summarizer(db, (ids) => archivePayloads(db, ids), registry, () => {}, () => ['Alice']);
      const prefs = { ...TEST_PREFS, focus: 'release dates', grouping: 'channel' as const };
      const shown = s.prompts(FRESH_AI, prefs);
      await run(s, prefs);
      expect(calls[0]!.system).toBe(shown.summarize);
      expect(shown.merge).toContain('release dates');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('summary settings', () => {
  it('normalizes anything into a valid object', () => {
    expect(normalizeSummarySettings('junk')).toEqual(DEFAULT_SUMMARY_SETTINGS);
    const n = normalizeSummarySettings({ length: 'huge', catchUpAfterHours: 9999, digestAt: '25:00', focus: `  ${'x'.repeat(900)} `, defaultRange: 'last' });
    expect(n.length).toBe(DEFAULT_SUMMARY_SETTINGS.length);
    expect(n).not.toHaveProperty('catchUpAfterHours'); // #96: catch-up and digest are timed rules now
    expect(n).not.toHaveProperty('digestAt');
    expect(n.focus).toHaveLength(500);
    expect(n.defaultRange).toBe('last');
    expect(n.prompts).toEqual(NO_PROMPT_OVERRIDES);
    // A stored template that lost {refs} or names an unknown placeholder falls back to the default.
    expect(normalizeSummarySettings({ prompts: { summarize: 'No refs.', merge: '{refs} {bogus}' } }).prompts).toEqual(NO_PROMPT_OVERRIDES);
    expect(normalizeSummarySettings({ prompts: { summarize: 'Mine. {refs}' } }).prompts).toEqual({ summarize: 'Mine. {refs}', merge: null });
  });

  it('checks a template, and drops a line whose placeholders all came out empty', () => {
    expect(summaryPromptError(DEFAULT_SUMMARY_PROMPTS.summarize)).toBeNull();
    expect(summaryPromptError(DEFAULT_SUMMARY_PROMPTS.merge)).toBeNull();
    expect(summaryPromptError('  ')).toMatch(/Write the prompt/);
    expect(summaryPromptError('No citations.')).toMatch(/Keep \{refs\}/);
    expect(summaryPromptError('{refs} {bogus}')).toMatch(/\{bogus\} isn't a placeholder/);
    expect(summaryPromptError(`{refs}${'x'.repeat(SUMMARY_PROMPT_MAX_CHARS)}`)).toMatch(/under/);
    const values = { now: 'NOW', bullets: '', depth: '', refs: 'REFS', actions: '', focus: '', themes: '' };
    expect(fillSummaryPrompt('A {now}\n{focus} {themes}\n\nB {refs}\n{actions}', values)).toBe('A NOW\n\nB REFS');
  });
});
