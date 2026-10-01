// Reading order of a run's points: chronological, under day or channel headings.
import { pointCitations, type Summary, type SummaryItem } from '../shared/types';

export interface PointGroup {
  /** Channel the points are about (channel grouping), else null. */
  channel: string | null;
  /** Local midnight of the day the points start (overall grouping of a run spanning days), else null. */
  day: number | null;
  items: SummaryItem[];
}

/** Local midnight of a time. */
export const dayOf = (ms: number): number => new Date(ms).setHours(0, 0, 0, 0);

/** The run's range crosses midnight, so a time alone doesn't say which day. */
export const spansDays = (s: Pick<Summary, 'sinceTs' | 'untilTs'>): boolean => dayOf(s.sinceTs) !== dayOf(s.untilTs);

/** Points with the time each started (earliest citation); an uncited point takes the time of the one before it, or `from`. */
function started(items: SummaryItem[], from: number): { item: SummaryItem; ts: number }[] {
  let prev = from;
  return items.map((item) => {
    const cites = pointCitations(item);
    const ts = cites.length ? Math.min(...cites.map((c) => c.ts)) : prev;
    prev = ts;
    return { item, ts };
  });
}

/** Points in the order their conversations started; ties keep the model's order. */
function chronological(items: SummaryItem[], from: number): { item: SummaryItem; ts: number }[] {
  return started(items, from)
    .map((p, i) => ({ ...p, i }))
    .sort((a, b) => a.ts - b.ts || a.i - b.i);
}

/**
 * A run's points in reading order. Channel grouping: channels in order of first activity, points chronological within.
 * Overall: chronological, headed by day when the run spans days.
 */
export function pointGroups(s: Pick<Summary, 'items' | 'grouping' | 'sinceTs' | 'untilTs'>): PointGroup[] {
  const points = chronological(s.items, s.sinceTs);
  if (s.grouping === 'channel') {
    const byChannel = new Map<string | null, SummaryItem[]>();
    let channel: string | null = null;
    for (const { item } of points) {
      channel = pointCitations(item)[0]?.channelName ?? channel;
      byChannel.set(channel, [...(byChannel.get(channel) ?? []), item]);
    }
    return [...byChannel].map(([ch, items]) => ({ channel: ch, day: null, items }));
  }
  if (!spansDays(s)) return [{ channel: null, day: null, items: points.map((p) => p.item) }];
  const groups: PointGroup[] = [];
  for (const { item, ts } of points) {
    const day = dayOf(ts);
    const last = groups.at(-1);
    if (last?.day === day) last.items.push(item);
    else groups.push({ channel: null, day, items: [item] });
  }
  return groups;
}
