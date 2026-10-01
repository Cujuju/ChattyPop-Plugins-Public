// The summarize rule action over a message's range: lookback, hourly floor, rule prompts, empty ranges.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ACTION_LOOKBACK_MS, type RuleAction } from '@shared/rules';
import { newRuleAction } from '@shared/ruleSpec';
import { ARRIVAL } from '@core/arrival';
import { ruleInput, runsOf } from '@chattypop/host-testing';
import { EmptyRangeError } from '../core/summarize';
import { summaryRuleHarness, type SummaryRuleHarness } from './summaryRuleHarness';

/** More runs than any test here makes. */
const RUNS_READ = 100;

let h: SummaryRuleHarness;
beforeEach(() => {
  h = summaryRuleHarness();
});

const summarize = (): RuleAction => newRuleAction('summaries.summarize');
/** Each run's outcome details, oldest first, once `count` runs have recorded their one action. */
async function settled(id: number, count: number): Promise<(string | null)[]> {
  await vi.waitFor(() => expect(h.rules.runs(id, RUNS_READ).filter((r) => r.actions.length === 1)).toHaveLength(count));
  return h.rules
    .runs(id, RUNS_READ)
    .reverse()
    .map((r) => r.actions[0]!.detail);
}

describe('rule summarize and plugin actions', () => {
  it("summarizes the message's channel over the time before it, then waits out its hourly floor", async () => {
    const id = h.rules.create(ruleInput([summarize()]));
    const m = h.say('big news');
    await settled(id, 1);
    h.say('more news');
    const details = await settled(id, 2);
    const ts = h.db.prepare('SELECT ts FROM messages WHERE id = ?').pluck().get(m.id) as number;
    expect(h.ranges.summaries).toEqual([{ sinceTs: ts - DEFAULT_ACTION_LOOKBACK_MS, untilTs: ts, channelIds: ['c1'] }]);
    expect(details[0]).toBe('answered');
    expect(details[1]).toMatch(/at most once per hour/);
    expect(runsOf(h, id).map((r) => r[2])).toEqual([['done'], ['skipped']]);
  });

  it("passes a rule's own prompts to its summary", async () => {
    const own = { summarize: `Only the decisions. {refs}`, merge: null };
    const id = h.rules.create(
      ruleInput([
        {
          ...newRuleAction('summaries.summarize'),
          config: { lookbackMs: DEFAULT_ACTION_LOOKBACK_MS, prompts: own },
        } as RuleAction,
        summarize(),
      ]),
    );
    h.say('big news');
    await vi.waitFor(() => expect(h.rules.runs(id, 1)[0]?.actions).toHaveLength(2));
    expect(h.ranges.summaryPrompts).toEqual([own, undefined]);
  });

  it("doesn't run on a missed message by default; an empty range is skipped", async () => {
    const id = h.rules.create(ruleInput([summarize()]));
    h.say('fetched', { via: ARRIVAL.sync }); // no action runs on backfill: the rule doesn't fire at all
    h.ranges.answer = () => Promise.reject(new EmptyRangeError());
    const live = h.say('live');
    expect(await settled(id, 1)).toEqual([new EmptyRangeError().message]);
    expect(runsOf(h, id)).toEqual([[live.id, true, ['skipped']]]);
    expect(h.ranges.summaries).toHaveLength(1);
  });
});
