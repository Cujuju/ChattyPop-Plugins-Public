// Summaries' desktop notices.
import { describe, expect, it } from 'vitest';
import { summaryNotices } from '../main/notices';

describe('notices', () => {
  it('notices automatic summaries and their failures, never manual runs', () => {
    expect(summaryNotices({ type: 'summary-auto-failed', trigger: 'digest', message: 'no model' })).toEqual([{ kind: 'summary', title: 'Daily digest failed', body: 'no model', open: null }]);
    expect(summaryNotices({ type: 'summary-auto-failed', trigger: 'manual', message: 'x' })).toEqual([]);
  });
});
