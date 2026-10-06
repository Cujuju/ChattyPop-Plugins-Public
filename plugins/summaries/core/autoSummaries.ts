// #96: migrates catch-up/digest settings to timed rules, preserving activation, timing, and progress.
import type { CoreContext } from '@plugin-sdk/core';
import { plugin } from '../shared';
import { clampInt, isObj } from '@plugin-sdk/shared';
import { timedSummaryInput } from '../shared/timedRules';
import { ALL_DAYS, DEFAULT_AWAY_HOURS, DEFAULT_DAILY_AT, TIMED_HOURS_MAX, TIMED_HOURS_MIN, lastDailyDue, timedTriggerError, type TimedTrigger } from '@plugin-sdk/shared';

export const CATCH_UP_RULE_NAME = 'Catch me up';
export const DIGEST_RULE_NAME = 'Daily digest';


/** Creates legacy automatic-summary rules once. Unchanged settings enable both; null settings create disabled rules. Returns whether rules were created. */
export function migrateAutoSummaries(ctx: CoreContext<typeof plugin>, now: number, lastSeenAt: number): boolean {
  if (ctx.preferences.get('autoMigrated')) return false;
  // The retired fields are read from the stored value: the preference's normalizer drops them.
  const raw = ctx.preferences.stored('settings');
  const src = isObj(raw) ? raw : {};
  const awayHours = src['catchUpAfterHours'] === null ? null : clampInt(src['catchUpAfterHours'], TIMED_HOURS_MIN, TIMED_HOURS_MAX, DEFAULT_AWAY_HOURS);
  const daily: TimedTrigger = { kind: 'daily', at: typeof src['digestAt'] === 'string' ? src['digestAt'] : DEFAULT_DAILY_AT, days: [...ALL_DAYS] };
  if (timedTriggerError(daily)) daily.at = DEFAULT_DAILY_AT;
  const digestOn = src['digestAt'] !== null;
  const lastDigest = ctx.preferences.get('lastDigestAt');

  ctx.rules.import([
    {
      input: timedSummaryInput(CATCH_UP_RULE_NAME, { kind: 'appStart', awayHours: awayHours ?? DEFAULT_AWAY_HOURS }, awayHours !== null),
      // Armed before this session, so this start can already catch up.
      armedAt: Math.min(lastSeenAt, now),
    },
    {
      input: timedSummaryInput(DIGEST_RULE_NAME, daily, digestOn),
      // It covers from the last digest; one never run counts the latest due time as done, as the old schedule did.
      armedAt: lastDigest ?? lastDailyDue(now, daily.at, daily.days),
    },
  ], () => {
    // Saved normalized, which leaves the retired fields out.
    if (isObj(raw)) ctx.preferences.set('settings', ctx.preferences.get('settings'));
    ctx.preferences.set('lastDigestAt', null);
    ctx.preferences.set('autoMigrated', true);
  });
  return true;
}
