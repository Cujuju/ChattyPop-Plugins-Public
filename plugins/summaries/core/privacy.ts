// Privacy filtering and redaction of stored summary results.
import { type Privacy } from '@plugin-sdk/core';
import type { Citation, Summary, SummaryItem, SummaryTheme } from '../shared/types';

/** What stays of something citing messages: all of it while it cites none (nothing to hide) or any visible one, minus hidden citations. */
function visibleCitations(citations: Citation[], p: Privacy): Citation[] | null {
  const visible = citations.filter((c) => !p.hiddenChannels.has(c.channelId));
  return citations.length && !visible.length ? null : visible;
}

/** A point's parts that stay, redacted; the point goes when none do. */
function shownPoints(points: SummaryItem[], p: Privacy): SummaryItem[] {
  return points.flatMap((point) => {
    const parts = point.parts.flatMap((part) => {
      const citations = visibleCitations(part.citations, p);
      return citations ? [{ text: p.redact(part.text), citations }] : [];
    });
    return parts.length ? [{ ...point, parts }] : [];
  });
}

function shownThemes(themes: SummaryTheme[], p: Privacy): SummaryTheme[] {
  return themes.flatMap((t) => {
    const citations = visibleCitations(t.citations, p);
    return citations ? [{ ...t, title: p.redact(t.title), citations }] : [];
  });
}

/** A summary as privacy mode shows it: hidden channels' citations and the parts citing only them gone, hidden names redacted. */
export function shownSummary(s: Summary, p: Privacy): Summary {
  if (!p.active) return s;
  return {
    ...s,
    channelIds: s.channelIds.filter((id) => !p.hiddenChannels.has(id)),
    headline: p.redact(s.headline),
    items: shownPoints(s.items, p),
    actions: shownPoints(s.actions, p),
    themes: s.themes && shownThemes(s.themes, p),
  };
}
