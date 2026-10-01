// Summary notice text shared by desktop and phone delivery.
import type { Notice } from '@plugin-sdk/main';
import type { SummaryEvent } from '../shared/types';
import type { SummaryTrigger } from '../shared/settings';

const AUTO_RUN_NAME: Record<Exclude<SummaryTrigger, 'manual'>, string> = { 'catch-up': 'Catch-up summary', digest: 'Daily digest', rule: 'Rule summary' };

/** Automatic run notices before the plugin's delivery preference. */
export function summaryNotices(e: SummaryEvent): Notice<'summary'>[] {
  if (e.type === 'summary-added' && e.summary.trigger !== 'manual') {
    const name = AUTO_RUN_NAME[e.summary.trigger];
    const title = e.summary.actions.length ? `${name} · ${e.summary.actions.length} for you` : name;
    return [{ kind: 'summary', title, body: e.summary.headline, open: null }];
  }
  if (e.type === 'summary-auto-failed' && e.trigger !== 'manual') {
    return [{ kind: 'summary', title: `${AUTO_RUN_NAME[e.trigger]} failed`, body: e.message, open: null }];
  }
  return [];
}
