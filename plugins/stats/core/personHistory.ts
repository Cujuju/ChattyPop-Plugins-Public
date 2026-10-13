import type { PluginDb } from '@plugin-sdk/core';
import { PERSON_SILENCE_DAYS, QUIET_MIN_MESSAGES, type PeopleStats, type PersonHistory } from '../shared/personHistory';
import { STATS_TOP, everyoneQuery, type ActivityQuery, type StatsPoster } from '../shared/types';
import { personDays } from './personDays';
import { dayStreaks, personDayStreaks } from './streaks';
import { shiftLocalDay } from './query';
import { voiceStats } from './voice';

/** One whole-scope author/day read supplies both historical lists and the selected range's streaks. */
export function personHistory(db: PluginDb, query: ActivityQuery, rows = personDays(db, { ...everyoneQuery(query), sinceTs: null }, query.sinceTs)): PersonHistory {
  const people = new Map<string, { poster: StatsPoster; dates: string[] }>();
  let archivedSince: number | null = null;
  let lastDay: string | null = null;
  for (const row of rows) {
    archivedSince = Math.min(archivedSince ?? row.firstTs, row.firstTs);
    if (lastDay === null || row.start > lastDay) lastDay = row.start;
    if (query.authorId != null && row.userId !== query.authorId) continue;
    const person = people.get(row.userId) ?? { poster: { userId: row.userId, name: row.name, avatar: row.avatar, count: 0 }, dates: [] };
    person.poster.count += row.count;
    if (row.name < person.poster.name) person.poster.name = row.name;
    person.dates.push(row.start);
    people.set(row.userId, person);
  }
  const streaks = personDayStreaks(rows.filter((row) => row.rangeCount > 0 && (query.authorId == null || row.userId === query.authorId)));
  const quiet: PersonHistory['quiet'] = [];
  const returned: PersonHistory['returned'] = [];
  if (lastDay !== null) {
    const threshold = shiftLocalDay(lastDay, -PERSON_SILENCE_DAYS);
    for (const { poster, dates } of people.values()) {
      const lastSeen = dates.at(-1)!;
      if (poster.count >= QUIET_MIN_MESSAGES && lastSeen < threshold) quiet.push({ ...poster, lastSeen });
      const current = dayStreaks(dates, false).current!;
      const priorIndex = dates.indexOf(current.start) - 1;
      if (current.start < threshold || priorIndex < 0) continue;
      const silenceDays = dayStreaks([dates[priorIndex]!, current.start]).gap?.days ?? 0;
      if (silenceDays >= PERSON_SILENCE_DAYS) returned.push({ ...poster, silenceDays, returned: current.start });
    }
  }
  return {
    archivedSince, lastDay, streaks,
    quiet: quiet.sort((a, b) => b.count - a.count || a.userId.localeCompare(b.userId)).slice(0, STATS_TOP),
    returned: returned.sort((a, b) => b.silenceDays - a.silenceDays || a.userId.localeCompare(b.userId)).slice(0, STATS_TOP),
  };
}

/** A single section request shares the history read; each feature retains its own core computation and standalone call. */
export function peopleStats(db: PluginDb, query: ActivityQuery): PeopleStats {
  const rows = personDays(db, { ...everyoneQuery(query), sinceTs: null }, query.sinceTs);
  const stats: PeopleStats = { history: personHistory(db, query, rows), voice: voiceStats(db, query, rows) };
  if (query.authorId != null) {
    const counts = new Map<string, StatsPoster>();
    for (const row of rows) {
      if (!row.rangeCount) continue;
      const person = counts.get(row.userId) ?? { userId: row.userId, name: row.name, avatar: row.avatar, count: 0 };
      person.count += row.rangeCount;
      if (row.name < person.name) person.name = row.name;
      counts.set(row.userId, person);
    }
    const poster = counts.get(query.authorId);
    stats.person = poster ? { poster, rank: 1 + [...counts.values()].filter((p) => p.count > poster.count).length } : null;
  }
  return stats;
}
