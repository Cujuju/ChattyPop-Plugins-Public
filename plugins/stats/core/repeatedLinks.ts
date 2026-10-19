import type { ArchiveRead } from '@plugin-sdk/core';
import { REPEATED_LINK_MIN_SHARES, type RepeatedLink, type RepeatedLinksStats } from '../shared/repeatedLinks';
import { STATS_TOP, type ActivityQuery } from '../shared/types';
import { LINK_SHARES, attachPosterIdentities, readPosterIdentities, scopeSql } from './stats';
import { urlHost } from './domains';

/** Equal timestamps follow numeric snowflake order, as the Archive does. Only shares within the visible scope compete. */
export async function repeatedLinks(read: ArchiveRead, query: ActivityQuery): Promise<RepeatedLinksStats> {
  const scope = (await scopeSql(read, query));
  const rows = (await read(`WITH shares AS (
    SELECT l.url, m.author_id AS userId,
      ROW_NUMBER() OVER (PARTITION BY l.url ORDER BY m.ts, length(m.id), m.id) AS ordinal
    ${LINK_SHARES} WHERE ${scope.sql}
  ) SELECT url, userId, COUNT(*) AS shares, SUM(CASE WHEN ordinal >= ${REPEATED_LINK_MIN_SHARES} THEN 1 ELSE 0 END) AS reposts
    FROM shares GROUP BY url, userId ORDER BY url, userId`, [...scope.params])) as {
      url: string; userId: string; shares: number; reposts: number;
    }[];
  const urls = new Map<string, RepeatedLink>();
  const people = new Map<string, number>();
  for (const row of rows) {
    const url = urls.get(row.url) ?? { url: row.url, host: urlHost(row.url) ?? '', shares: 0, people: 0 };
    url.shares += row.shares;
    url.people++;
    urls.set(row.url, url);
    if (row.reposts) people.set(row.userId, (people.get(row.userId) ?? 0) + row.reposts);
  }
  const reposts = [...people].map(([userId, count]) => ({ userId, count }))
    .sort((a, b) => b.count - a.count || a.userId.localeCompare(b.userId)).slice(0, STATS_TOP);
  const identities = (await readPosterIdentities(read, scope, reposts.map((person) => person.userId)));
  return {
    urls: [...urls.values()].filter((url) => url.shares >= REPEATED_LINK_MIN_SHARES)
      .sort((a, b) => b.shares - a.shares || a.url.localeCompare(b.url)).slice(0, STATS_TOP),
    reposts: attachPosterIdentities(reposts, identities),
  };
}
