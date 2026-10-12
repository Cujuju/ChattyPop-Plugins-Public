import { MS_PER_S } from '@plugin-sdk/shared';

export interface StatsSqlScope {
  sql: string;
  params: (string | number)[];
}

/** SQLite time modifiers turning a millisecond column into local time. */
export const local = (ts: string): string => `${ts} / ${MS_PER_S}, 'unixepoch', 'localtime'`;
