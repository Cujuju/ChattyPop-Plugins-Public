// A comparison as one page for review outside the app: a snapshot of its details and columns as the app draws them, sources shown.
import { channelById, channelLabel, countText, exportHtmlPage, exportPdfPage, look, snapshotPage, weekdayDateTime } from '@plugin-sdk/renderer/kit';
import type { Comparison } from '../shared/compare';
import { ComparisonColumns, ComparisonMeta } from './ComparisonParts';
import { META } from './SummaryContent';
import styles from './Summary.module.css';

/** Named channels, then how many the directory doesn't name (DMs among them), rather than their raw ids. */
function channelsText(ids: string[]): string {
  const named = ids.flatMap((id) => {
    const ch = channelById(id);
    return ch ? [channelLabel(ch)] : [];
  });
  const rest = ids.length - named.length;
  return [...named, ...(rest ? [countText(rest, 'other channel')] : [])].join(', ');
}

const titleOf = (c: Comparison): string => `Summary comparison, ${weekdayDateTime(c.createdAt)}`;

/** The exported page's content: its title, what every model read, then the columns with their sources. */
function ComparisonExport(props: { comparison: Comparison }) {
  return (
    <section class={styles.compare} data-section="summary">
      <p class={look.text} data-size="xl" data-weight="semibold" data-tone="primary">
        {titleOf(props.comparison)}
      </p>
      <ComparisonMeta comparison={props.comparison} />
      <p class={`${styles.meta} ${look.text}`} {...META}>
        {channelsText(props.comparison.channelIds)}
      </p>
      <ComparisonColumns comparison={props.comparison} sourcesOpen />
    </section>
  );
}

const px = (root: CSSStyleDeclaration, token: string): number => parseFloat(root.getPropertyValue(token));

/** The page's width: every column at the theme's reading measure, side by side, inside the page's margin. */
function pageWidth(columns: number): number {
  const root = getComputedStyle(document.documentElement);
  return columns * px(root, '--cp-compare-export-col-w') + (columns - 1) * px(root, '--cp-space-4') + 2 * px(root, '--cp-snapshot-margin');
}

const pad = (n: number): string => String(n).padStart(2, '0');
/** The file name: when the comparison ran, local time, sortable. */
function fileName(c: Comparison, ext: 'html' | 'pdf'): string {
  const d = new Date(c.createdAt);
  return `summary-comparison-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.${ext}`;
}

/** The comparison as a page and the width it is laid out at. */
async function comparisonPage(c: Comparison): Promise<{ html: string; width: number }> {
  const width = pageWidth(Math.max(1, c.results.length));
  return { html: await snapshotPage(() => <ComparisonExport comparison={c} />, { title: titleOf(c), width }), width };
}

/** Saves the comparison as an .html file on the desktop; the phone opens it in its browser. Call within the tap that asked. */
export function exportComparison(c: Comparison): Promise<void> {
  return exportHtmlPage(comparisonPage(c).then(({ html }) => ({ html, fileName: fileName(c, 'html') })));
}

/** Saves the comparison as a one-page PDF the desktop draws; the phone opens it in its browser. Call within the tap that asked. */
export function exportComparisonPdf(c: Comparison): Promise<void> {
  return exportPdfPage(comparisonPage(c).then(({ html, width }) => ({ html, width, fileName: fileName(c, 'pdf') })));
}
