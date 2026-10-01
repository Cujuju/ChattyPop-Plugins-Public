// Summaries' desktop notices.
import { describe, expect, it } from 'vitest';
import { summaryNotices } from '../main/notices';
import type { Summary } from '../shared/types';

const request = { kind: 'summary', target: null };

describe('notices', () => {
  it('notices automatic summaries and their failures, never manual runs', () => {
    expect(summaryNotices({ type: 'summary-auto-failed', trigger: 'digest', message: 'no model' })).toEqual([{ ...request, title: 'Daily digest failed', body: 'no model' }]);
    expect(summaryNotices({ type: 'summary-auto-failed', trigger: 'manual', message: 'x' })).toEqual([]);
  });

  it('names the channels a run read or its rule named, so muting them all mutes the notice', () => {
    const summary = { trigger: 'rule', actions: [], headline: 'h', channelIds: ['c1', 'c2'] } as unknown as Summary;
    expect(summaryNotices({ type: 'summary-added', summary })).toEqual([{ ...request, title: 'Rule summary', body: 'h', aboutChannels: ['c1', 'c2'] }]);
    expect(summaryNotices({ type: 'summary-auto-failed', trigger: 'rule', message: 'm', channelIds: ['c1'] })).toEqual([{ ...request, title: 'Rule summary failed', body: 'm', aboutChannels: ['c1'] }]);
  });
});
