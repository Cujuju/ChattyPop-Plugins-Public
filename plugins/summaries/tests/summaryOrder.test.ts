// Contract tests for summary order.
import { describe, expect, it } from 'vitest';
import type { Citation, SummaryItem } from '../shared/types';
import { MS_PER_HOUR } from '@shared/units';
import { pointGroups, spansDays } from '../renderer/order';

const FRI = new Date(2026, 8, 25).getTime();
const SAT = new Date(2026, 8, 26).getTime();
const at = (day: number, h: number): number => day + h * MS_PER_HOUR;
const cite = (ts: number, channelName = 'general'): Citation => ({ messageId: String(ts), channelId: channelName, channelName, ts });
const point = (text: string, ...citations: Citation[]): SummaryItem => ({ parts: [{ text, citations }] });
const texts = (groups: ReturnType<typeof pointGroups>): string[][] => groups.map((g) => g.items.map((i) => i.parts[0]!.text));

describe('summary point order', () => {
  it('orders points by when they started, with day headings when the run spans days', () => {
    const items = [
      point('sat dawn', cite(at(SAT, 5))),
      point('uncited follows sat dawn'),
      point('fri noon', cite(at(FRI, 15)), cite(at(FRI, 12))),
      point('fri morning', cite(at(FRI, 9))),
    ];
    const groups = pointGroups({ items, grouping: 'overall', sinceTs: at(FRI, 8), untilTs: at(SAT, 8) });
    expect(groups.map((g) => g.day)).toEqual([FRI, SAT]);
    expect(texts(groups)).toEqual([['fri morning', 'fri noon'], ['sat dawn', 'uncited follows sat dawn']]);
  });

  it('has no day heading within one day, and puts a leading uncited point at the start', () => {
    const items = [point('uncited'), point('late', cite(at(FRI, 15))), point('early', cite(at(FRI, 10)))];
    const groups = pointGroups({ items, grouping: 'overall', sinceTs: at(FRI, 9), untilTs: at(FRI, 16) });
    expect(groups).toEqual([{ channel: null, day: null, items: [items[0], items[2], items[1]] }]);
  });

  it('orders channels by first activity and points chronologically within each', () => {
    const items = [
      point('releases late', cite(at(FRI, 14), 'releases')),
      point('general late', cite(at(FRI, 13))),
      point('general early', cite(at(FRI, 9))),
      point('releases early', cite(at(FRI, 10), 'releases')),
    ];
    const groups = pointGroups({ items, grouping: 'channel', sinceTs: at(FRI, 8), untilTs: at(FRI, 16) });
    expect(groups.map((g) => g.channel)).toEqual(['general', 'releases']);
    expect(texts(groups)).toEqual([['general early', 'general late'], ['releases early', 'releases late']]);
  });

  it('spans days only when the range crosses local midnight', () => {
    expect(spansDays({ sinceTs: at(FRI, 8), untilTs: at(FRI, 23) })).toBe(false);
    expect(spansDays({ sinceTs: at(FRI, 23), untilTs: at(SAT, 1) })).toBe(true);
  });
});
