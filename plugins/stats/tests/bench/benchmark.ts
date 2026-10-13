import { testPlugin } from '@plugin-sdk/core/testing';
import { plugin } from '../../shared';
// Supplied by run.mjs: imports the requested revision, leaving absent historical sections absent.
// @ts-expect-error opt-in Vite virtual module
import functions from 'stats-bench-functions';
import { CHANNEL, seed } from './fixture';
import { measure, report } from './measure';

const QUERY = { scope: 'channel', channelId: CHANNEL, sinceTs: null } as const;
const SECTIONS = ['activityStats', 'peopleStats', 'repeatedLinks', 'emojiStats', 'wordStats', 'sentimentStats', 'conversationStats'];

export async function main(rows: number, section: string, profileDir: string) {
  if (!Number.isSafeInteger(rows) || rows <= 0) throw new Error('Rows must be a positive safe integer.');
  if (section !== 'all' && !SECTIONS.includes(section)) throw new Error(`Unknown section: ${section}`);
  const host = testPlugin(plugin, { archive: { channels: [{ id: CHANNEL }] } });
  try {
    report('seed', seed(host.db, rows));
    for (const name of SECTIONS.filter((name) => section === 'all' || section === name)) {
      if (!functions[name]) { report('unavailable', name); continue; }
      await measure(host.db, name, (db) => functions[name](db, QUERY), profileDir);
    }
  } finally { await host.dispose(); }
}
