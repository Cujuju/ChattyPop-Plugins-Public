// A comparison as Markdown, for review outside the app: the shared input, then each model's summary in column order.
import { MS_PER_S } from '@plugin-sdk/shared';
import { channelById, channelLabel, formatTokens, shortDateTime, usdText, weekdayDate, weekdayDateTime } from '@plugin-sdk/renderer/kit';
import type { Comparison } from '../shared/compare';
import { namedText } from '../shared/people';
import { pointCitations, type Citation, type Summary, type SummaryItem } from '../shared/types';
import { pointGroups } from './order';
import { FLAG_TEXT, flagOf } from './SummaryContent';
import { modelText } from './compareState';

const MD_TYPE = 'text/markdown';

const cite = (c: Citation): string => `#${c.channelName} ${shortDateTime(c.ts)}`;
const sources = (cs: Citation[]): string => (cs.length ? ` _(${cs.map(cite).join('; ')})_` : '');

/** A point's text with people named and its sources after it, and Jev's flag when it has one. */
function pointText(item: SummaryItem, s: Summary): string {
  const text = item.parts.map((p) => namedText(p.text, s.people)).join(' ');
  const flag = flagOf(item);
  return `${text}${sources(pointCitations(item))}${flag ? ` **[${FLAG_TEXT[flag]}]**` : ''}`;
}

/** One model's run details, as the Summary panel's small print gives them. */
function details(s: Summary): string {
  return [
    `${Math.round(s.durationMs / MS_PER_S)} s`,
    ...(s.usage ? [`${formatTokens(s.usage.inputTokens)} in`, `${formatTokens(s.usage.outputTokens)} out`] : []),
    ...(s.apiCostUsd !== null ? [`≈${usdText(s.apiCostUsd)} at API rates`] : []),
    ...(s.jevCostUsd !== null ? [`Jev ${usdText(s.jevCostUsd)}`] : []),
  ].join(' · ');
}

function summaryMarkdown(s: Summary): string[] {
  const out = [`_${details(s)}_`, '', `**${namedText(s.headline, s.people)}**`, ''];
  if (s.actions.length) out.push('### For you', '', ...s.actions.map((a) => `- ${pointText(a, s)}`), '');
  out.push('### Points', '');
  for (const g of pointGroups(s)) {
    if (g.channel) out.push(`#### #${g.channel}`, '');
    if (g.day !== null) out.push(`#### ${weekdayDate(g.day)}`, '');
    out.push(...g.items.map((item, i) => `${i + 1}. ${pointText(item, s)}`), '');
  }
  if (s.themes?.length) out.push('### Key themes', '', ...s.themes.map((t) => `- ${namedText(t.title, s.people)}${sources(t.citations)}`), '');
  return out;
}

export function comparisonMarkdown(c: Comparison): string {
  const out = [
    '# Summary comparison',
    '',
    `- Run: ${weekdayDateTime(c.createdAt)}`,
    `- Range: ${weekdayDateTime(c.sinceTs)} → ${weekdayDateTime(c.untilTs)}`,
    `- Messages every model read: ${c.messageCount}${c.skippedCount ? ` (${c.skippedCount} left out as filler or quiet)` : ''}`,
    `- Channels: ${c.channelIds.map((id) => { const ch = channelById(id); return ch ? channelLabel(ch) : id; }).join(', ')}`,
    ...(c.jevCostUsd !== null ? [`- Jev's shared steps: ${usdText(c.jevCostUsd)}`] : []),
    '',
  ];
  c.results.forEach((r, i) => {
    out.push(`## ${i + 1}. ${modelText(r.model)}`, '');
    out.push(...(r.summary ? summaryMarkdown(r.summary) : [`Failed: ${r.error}`, '']));
  });
  return out.join('\n');
}

const pad = (n: number): string => String(n).padStart(2, '0');
/** The file name: when the comparison ran, local time, sortable. */
function fileName(c: Comparison): string {
  const d = new Date(c.createdAt);
  return `summary-comparison-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.md`;
}

/** Saves the comparison as a .md file: the desktop asks where; a phone's browser saves or shares it. */
export function exportComparison(c: Comparison): void {
  const url = URL.createObjectURL(new Blob([comparisonMarkdown(c)], { type: MD_TYPE }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName(c);
  a.click();
  // After the click's task, once the download has the file.
  setTimeout(() => URL.revokeObjectURL(url));
}
