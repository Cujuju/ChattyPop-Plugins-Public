// Summaries' timed rules: a timed summary input, the digest's runs and failure notice, and the old settings becoming rules.
import { describe, expect, it } from 'vitest';
import { newRuleAction, validateRuleInput } from '@shared/ruleSpec';
import type { TimedTrigger } from '@shared/ruleTime';
import { MS_PER_HOUR } from '@shared/units';
import { getSetting, setSetting, type Db } from '@core/db';
import { RuleSchedule } from '@core/rules/schedule';
import { ruleInput } from '@chattypop/host-testing';
import { CATCH_UP_RULE_NAME, DIGEST_RULE_NAME, migrateAutoSummaries as migrate } from '../core/autoSummaries';
import { normalizeSummarySettings, SUMMARY_FOCUS_MAX_CHARS } from '../shared/settings';
import { ruleRangeSpan } from '../shared/rules';
import { timedSummaryInput } from '../shared/timedRules';
import { startSummaries } from './summariesHarness';
import { summaryRuleHarness } from './summaryRuleHarness';

const migrateAutoSummaries = (db: Db, now: number, lastSeenAt: number) => migrate(startSummaries(db, { activate: false }).ctx, now, lastSeenAt);

/** Local times on Friday 25 Sep 2026. */
const at = (h: number, m = 0, day = 25): number => new Date(2026, 8, day, h, m).getTime();

describe('timed rules', () => {
  it('take a timed summary input as it is', () => {
    const daily: TimedTrigger = { kind: 'daily', at: '08:00', days: [0, 1, 2, 3, 4, 5, 6] };
    expect(() => validateRuleInput(timedSummaryInput('D', daily))).not.toThrow();
  });

  it('run once per due time over their Where, labelled by trigger, and report a failed summary with its channels', async () => {
    let now = at(8, 30);
    const h = summaryRuleHarness(() => now);
    const id = h.rules.create(
      ruleInput([newRuleAction('summaries.summarize')], {
        trigger: { kind: 'daily', at: '09:00', days: [0, 1, 2, 3, 4, 5, 6] },
        gates: { channelIds: ['c1'] },
      }),
    );
    const schedule = new RuleSchedule(
      h.db,
      h.engine,
      h.actions,
      now - MS_PER_HOUR,
      (e) => h.events.push(e),
      () => now,
    );
    await schedule.tick();
    expect(h.ranges.summaries).toEqual([]); // turned on after yesterday's 09:00: nothing due before today's
    now = at(9, 1);
    await schedule.tick();
    await schedule.tick();
    expect(h.ranges.summaries).toEqual([{ sinceTs: at(8, 30), untilTs: at(9, 1), channelIds: ['c1'] }]);
    expect(h.ranges.summaryTriggers).toEqual(['digest']);
    expect(h.rules.runs(id, 10).map((r) => [r.messageId, r.actions.map((a) => a.outcome)])).toEqual([[null, ['done']]]);

    h.ranges.answer = () => Promise.reject(new Error('provider down'));
    now = at(9, 1, 26);
    await schedule.tick();
    expect(h.summaryEvents).toContainEqual({ type: 'summary-auto-failed', trigger: 'digest', message: 'provider down', channelIds: ['c1'] });
  });

  it("read a picked time frame ending at the run, over their Where, with the rule's own options", async () => {
    let now = at(8, 30);
    const h = summaryRuleHarness(() => now);
    h.rules.create(
      ruleInput([{ ...newRuleAction('summaries.summarize'), config: { lookbackMs: MS_PER_HOUR, range: 'yesterday', length: 'brief' } }], {
        trigger: { kind: 'daily', at: '09:00', days: [0, 1, 2, 3, 4, 5, 6] },
        gates: { channelIds: ['c1'] },
      }),
    );
    const schedule = new RuleSchedule(h.db, h.engine, h.actions, now - MS_PER_HOUR, (e) => h.events.push(e), () => now);
    now = at(9, 1);
    await schedule.tick();
    await schedule.tick();
    expect(h.ranges.summaries).toEqual([{ sinceTs: at(0, 0, 24), untilTs: at(0, 0), channelIds: ['c1'] }]);
    expect(h.ranges.summaryOptions).toEqual([{ length: 'brief' }]);
  });

  it('turn each time frame into its span', () => {
    const until = at(9, 1);
    expect(ruleRangeSpan('today', until)).toEqual({ sinceTs: at(0, 0), untilTs: until });
    expect(ruleRangeSpan('yesterday', until)).toEqual({ sinceTs: at(0, 0, 24), untilTs: at(0, 0) });
    expect(ruleRangeSpan('3h', until)).toEqual({ sinceTs: until - 3 * MS_PER_HOUR, untilTs: until });
  });

  it("refuse options a run can't use", () => {
    const daily: TimedTrigger = { kind: 'daily', at: '08:00', days: [0, 1, 2, 3, 4, 5, 6] };
    const withConfig = (config: object) => {
      const input = timedSummaryInput('D', daily);
      input.spec.actions[0]!.config = { lookbackMs: MS_PER_HOUR, ...config };
      return input;
    };
    expect(() => validateRuleInput(withConfig({ range: '7d', grouping: 'channel', actionItems: false, focus: 'billing' }))).not.toThrow();
    for (const bad of [{ range: 'since' }, { length: 'huge' }, { provider: '' }, { skipObviousFiller: 1 }, { focus: 'x'.repeat(SUMMARY_FOCUS_MAX_CHARS + 1) }])
      expect(() => validateRuleInput(withConfig(bad))).toThrow();
  });
});

describe('catch-up and digest settings become rules', () => {
  const byName = (h: ReturnType<typeof summaryRuleHarness>, name: string) => h.rules.list().find((r) => r.name === name)!;

  it('keep their on/off, hours, time and progress, once', () => {
    const h = summaryRuleHarness();
    const now = at(12);
    setSetting(h.db, 'plugin.summaries.settings', { length: 'brief', catchUpAfterHours: 3, digestAt: null });
    setSetting(h.db, 'plugin.summaries.lastDigestAt', at(8));
    expect(migrateAutoSummaries(h.db, now, at(1))).toBe(true);
    const catchUp = byName(h, CATCH_UP_RULE_NAME);
    expect(catchUp).toMatchObject({
      enabled: true,
      armedAt: at(1),
      spec: { trigger: { type: 'timed', config: { kind: 'appStart', awayHours: 3 } } },
    });
    expect(byName(h, DIGEST_RULE_NAME)).toMatchObject({
      enabled: false,
      spec: { trigger: { type: 'timed', config: { kind: 'daily', at: '08:00', days: [0, 1, 2, 3, 4, 5, 6] } } },
    });
    // Saved as the preference normalizes it: the retired fields gone, the rest kept.
    expect(getSetting(h.db, 'plugin.summaries.settings')).toEqual(normalizeSummarySettings({ length: 'brief' }));

    h.rules.remove(catchUp.id);
    expect(migrateAutoSummaries(h.db, now, at(1))).toBe(false);
    expect(h.rules.list().some((r) => r.name === CATCH_UP_RULE_NAME)).toBe(false);
  });

  it('start both on when the settings were never changed, the digest counting its latest time as done', () => {
    const h = summaryRuleHarness();
    migrateAutoSummaries(h.db, at(12), at(1));
    expect(byName(h, CATCH_UP_RULE_NAME)).toMatchObject({
      enabled: true,
      spec: { trigger: { type: 'timed', config: { awayHours: 8 } }, actions: [{ type: 'summaries.summarize' }] },
    });
    expect(byName(h, DIGEST_RULE_NAME)).toMatchObject({ enabled: true, armedAt: at(8) });
  });
});
