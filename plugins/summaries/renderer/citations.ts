// Citation navigation through the newest summary's points.
import { createSignal } from 'solid-js';
import { openArchive } from '@plugin-sdk/renderer/kit';
import { latestSummary } from './state';
import { pointCitations } from '../shared/types';

/** Position in the current summary's citations (j/k); -1 before the first jump. */
export const [citationIndex, setCitationIndex] = createSignal(-1);

/** The summary citationIndex refers to. */
let citedSummaryId: number | undefined;

/** Steps through every citation of the latest summary, in reading order, opening each in the Archive. */
export function stepCitation(delta: 1 | -1): void {
  const summary = latestSummary();
  const cites = summary?.items.flatMap(pointCitations) ?? [];
  if (!summary || !cites.length) return;
  // A new summary starts again from its first citation.
  if (summary.id !== citedSummaryId) {
    citedSummaryId = summary.id;
    setCitationIndex(-1);
  }
  const next = Math.min(cites.length - 1, Math.max(0, citationIndex() + delta));
  setCitationIndex(next);
  const c = cites[next]!;
  void openArchive(c.channelId, c.messageId);
}
