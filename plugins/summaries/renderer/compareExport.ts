// A comparison as one HTML page for review outside the app: what every model read, then a column per model.
// Its styles use the theme's tokens, copied with their values as they are now, so the page looks like the app.
import { MS_PER_S } from '@plugin-sdk/shared';
import { channelById, channelLabel, countText, shortDateTime, weekdayDate, weekdayDateTime } from '@plugin-sdk/renderer/kit';
import type { Comparison } from '../shared/compare';
import { namedText } from '../shared/people';
import { pointCitations, type Citation, type Summary, type SummaryItem } from '../shared/types';
import { pointGroups } from './order';
import { FLAG_TEXT, flagOf, usageParts } from './SummaryContent';
import { modelText, rangeText, totalsText } from './compareState';

const HTML_TYPE = 'text/html';

/** The tokens the page's styles read. */
const TOKENS = [
  '--cp-surface-1', '--cp-surface-2', '--cp-border-subtle', '--cp-border-w', '--cp-text-1', '--cp-text-2', '--cp-text-muted', '--cp-danger',
  '--cp-font-sans', '--cp-text-xs', '--cp-text-md', '--cp-text-base', '--cp-text-lg', '--cp-text-xl', '--cp-weight-semibold',
  '--cp-space-2', '--cp-space-3', '--cp-space-4', '--cp-space-5', '--cp-space-6', '--cp-radius-md', '--cp-leading-normal',
  '--cp-leading-relaxed', '--cp-compare-col-min-w',
] as const;

const STYLES = `
body { margin: 0; padding: var(--cp-space-6); background: var(--cp-surface-1); color: var(--cp-text-1);
  font-family: var(--cp-font-sans); font-size: var(--cp-text-base); line-height: var(--cp-leading-relaxed); }
h1 { margin: 0 0 var(--cp-space-3); font-size: var(--cp-text-xl); }
h2 { margin: 0; font-size: var(--cp-text-md); }
h3 { margin: var(--cp-space-5) 0 var(--cp-space-3); color: var(--cp-text-muted); font-size: var(--cp-text-xs); text-transform: uppercase; }
h4 { margin: var(--cp-space-4) 0 var(--cp-space-2); color: var(--cp-text-muted); font-size: var(--cp-text-xs); }
ul, ol { margin: 0; padding-left: var(--cp-space-6); }
li { margin-bottom: var(--cp-space-3); color: var(--cp-text-2); }
.meta, .details, .src { color: var(--cp-text-muted); font-size: var(--cp-text-xs); line-height: var(--cp-leading-normal); }
.meta { margin: 0 0 var(--cp-space-6); }
.cols { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(var(--cp-compare-col-min-w), 1fr);
  gap: var(--cp-space-5); align-items: start; overflow-x: auto; }
.col { padding: var(--cp-space-4) var(--cp-space-5); border: var(--cp-border-w) solid var(--cp-border-subtle);
  border-radius: var(--cp-radius-md); background: var(--cp-surface-2); }
.headline { margin: var(--cp-space-4) 0; font-size: var(--cp-text-lg); font-weight: var(--cp-weight-semibold); }
.flag, .error { color: var(--cp-danger); }
`;

/** Text as HTML text: summaries quote messages, which may hold markup. */
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const cite = (c: Citation): string => `#${c.channelName} ${shortDateTime(c.ts)}`;
const sources = (cs: Citation[]): string => (cs.length ? ` <span class="src">(${esc(cs.map(cite).join('; '))})</span>` : '');

/** A point with people named, its sources after it, and Jev's flag when it has one. */
function point(item: SummaryItem, s: Summary): string {
  const flag = flagOf(item);
  const text = item.parts.map((p) => namedText(p.text, s.people)).join(' ');
  return `<li>${esc(text)}${sources(pointCitations(item))}${flag ? ` <strong class="flag">${esc(FLAG_TEXT[flag])}</strong>` : ''}</li>`;
}

function column(s: Summary): string {
  const details = [`${countText(s.messageCount, 'message')}`, `${Math.round(s.durationMs / MS_PER_S)} s`, ...usageParts(s)].join(' · ');
  const out = [`<p class="details">${esc(details)}</p>`, `<p class="headline">${esc(namedText(s.headline, s.people))}</p>`];
  if (s.actions.length) out.push('<h3>For you</h3>', `<ul>${s.actions.map((a) => point(a, s)).join('')}</ul>`);
  out.push('<h3>Points</h3>');
  for (const g of pointGroups(s)) {
    if (g.channel) out.push(`<h4>#${esc(g.channel)}</h4>`);
    if (g.day !== null) out.push(`<h4>${esc(weekdayDate(g.day))}</h4>`);
    out.push(`<ol>${g.items.map((item) => point(item, s)).join('')}</ol>`);
  }
  if (s.themes?.length) {
    out.push('<h3>Key themes</h3>', `<ul>${s.themes.map((t) => `<li>${esc(namedText(t.title, s.people))}${sources(t.citations)}</li>`).join('')}</ul>`);
  }
  return out.join('\n');
}

/** Named channels, then how many the directory doesn't name (DMs among them), rather than their raw ids. */
function channelsText(ids: string[]): string {
  const named = ids.flatMap((id) => {
    const ch = channelById(id);
    return ch ? [channelLabel(ch)] : [];
  });
  const rest = ids.length - named.length;
  return [...named, ...(rest ? [countText(rest, 'other channel')] : [])].join(', ');
}

export function comparisonHtml(c: Comparison): string {
  const root = getComputedStyle(document.documentElement);
  const vars = TOKENS.map((t) => `${t}: ${root.getPropertyValue(t).trim()};`).join(' ');
  const title = `Summary comparison, ${weekdayDateTime(c.createdAt)}`;
  const meta = [
    rangeText(c.sinceTs, c.untilTs),
    `${countText(c.messageCount, 'message')} every model read${c.skippedCount ? ` (${c.skippedCount} left out as filler or quiet)` : ''}`,
    totalsText(c),
    channelsText(c.channelIds),
  ].filter(Boolean);
  const cols = c.results.map(
    (r) => `<section class="col"><h2>${esc(modelText(r.model))}</h2>\n${r.summary ? column(r.summary) : `<p class="error">${esc(r.error ?? '')}</p>`}</section>`,
  );
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>:root { ${vars} }${STYLES}</style></head>
<body><h1>${esc(title)}</h1><p class="meta">${meta.map(esc).join('<br>')}</p>
<div class="cols">${cols.join('\n')}</div></body></html>
`;
}

const pad = (n: number): string => String(n).padStart(2, '0');
/** The file name: when the comparison ran, local time, sortable. */
function fileName(c: Comparison): string {
  const d = new Date(c.createdAt);
  return `summary-comparison-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.html`;
}

/** Saves the comparison as an .html file: the desktop asks where; a phone's browser saves or shares it. */
export function exportComparison(c: Comparison): void {
  const url = URL.createObjectURL(new Blob([comparisonHtml(c)], { type: HTML_TYPE }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName(c);
  a.click();
  // After the click's task, once the download has the file.
  setTimeout(() => URL.revokeObjectURL(url));
}
