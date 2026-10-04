// The one-time pass that links people in summaries stored before names were marked (#291): each name the run's log
// held becomes its person, so old summaries show live names and open profiles as new ones do.
import type { ArchiveReplyReader, PluginDb } from '@plugin-sdk/core';
import type { SummaryItem, SummaryTheme } from '../shared/types';
import { linkNames, peopleByName } from './people';
import { SUMMARIES_TABLE } from './schema';
import { readLog } from './summaryLog';

interface UnlinkedRow {
  id: number;
  channel_ids: string;
  since_ts: number;
  until_ts: number;
  headline: string;
  items_json: string;
  actions_json: string;
  themes_json: string | null;
}

/** No reply flags: the pass reads the log for its names only, never filtering it. */
const NO_REPLY_FLAGS: ArchiveReplyReader = () => new Map();

/** A stored point list (either shape: parts, or one text from before parts) with `link` applied to each text. */
const linkedPoints = (json: string, link: (t: string) => string): string =>
  JSON.stringify((JSON.parse(json) as (SummaryItem | { text: string })[]).map((i) =>
    'parts' in i ? { ...i, parts: i.parts.map((p) => ({ ...p, text: link(p.text) })) } : { ...i, text: link(i.text) },
  ));

/**
 * Links every unlinked summary, one per tick so startup stays responsive; returns how many it linked. A name is matched
 * as the log spells it now: someone renamed since the run, or a name written another way, stays plain text.
 */
export async function linkStoredPeople(db: PluginDb, aborted: () => boolean): Promise<number> {
  const ids = db.prepare(`SELECT id FROM ${SUMMARIES_TABLE} WHERE people_linked = 0`).pluck().all() as number[];
  const read = db.prepare(`SELECT id, channel_ids, since_ts, until_ts, headline, items_json, actions_json, themes_json FROM ${SUMMARIES_TABLE} WHERE id = ? AND people_linked = 0`);
  const write = db.prepare(`UPDATE ${SUMMARIES_TABLE} SET headline = ?, items_json = ?, actions_json = ?, themes_json = ?, people_linked = 1 WHERE id = ? AND people_linked = 0`);
  let linked = 0;
  for (const id of ids) {
    await new Promise((resolve) => setImmediate(resolve));
    if (aborted() || !db.open) break;
    const r = read.get(id) as UnlinkedRow | undefined;
    if (!r) continue;
    const lines = readLog(db, NO_REPLY_FLAGS, JSON.parse(r.channel_ids) as string[], r.since_ts, r.until_ts, 'overall');
    const byName = peopleByName(lines.flatMap((l) => l.people));
    const link = (text: string): string => linkNames(text, byName);
    const themes = r.themes_json && JSON.stringify((JSON.parse(r.themes_json) as SummaryTheme[]).map((t) => ({ ...t, title: link(t.title) })));
    linked += write.run(link(r.headline), linkedPoints(r.items_json, link), linkedPoints(r.actions_json, link), themes, r.id).changes;
  }
  return linked;
}
