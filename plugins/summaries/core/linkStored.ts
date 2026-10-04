// The one-time passes that link people in summaries stored before names were marked (#291): each name the run's log
// held becomes its person, then each shortened name only one of them can be (#303), so old summaries show live names
// and open profiles as new ones do.
import type { ArchiveReplyReader, PluginDb } from '@plugin-sdk/core';
import type { SummaryItem, SummaryTheme } from '../shared/types';
import { leadsNotWords, linkNames, peopleByLead, peopleByName } from './people';
import { PEOPLE_LINKED, PEOPLE_LINKED_ALL, SUMMARIES_TABLE } from './schema';
import { readLog } from './summaryLog';

interface UnlinkedRow {
  id: number;
  people_linked: number;
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

/** A stored point list's texts (either shape). */
const pointTexts = (json: string): string[] =>
  (JSON.parse(json) as (SummaryItem | { text: string })[]).flatMap((i) => ('parts' in i ? i.parts.map((p) => p.text) : [i.text]));

/**
 * Brings every summary through the passes it hasn't had, one per tick so startup stays responsive; returns how many it
 * changed. Names are matched as the log spells them now: whole names, then leads (a name before its decoration, as a
 * summary shortens it) that only one person in the log has and the summary doesn't use as a word. Someone renamed since
 * the run, or named another way (a nickname), stays plain text.
 */
export async function linkStoredPeople(db: PluginDb, aborted: () => boolean): Promise<number> {
  const ids = db.prepare(`SELECT id FROM ${SUMMARIES_TABLE} WHERE people_linked < ${PEOPLE_LINKED_ALL}`).pluck().all() as number[];
  const read = db.prepare(`SELECT id, people_linked, channel_ids, since_ts, until_ts, headline, items_json, actions_json, themes_json FROM ${SUMMARIES_TABLE} WHERE id = ?`);
  const write = db.prepare(`UPDATE ${SUMMARIES_TABLE} SET headline = ?, items_json = ?, actions_json = ?, themes_json = ?, people_linked = ${PEOPLE_LINKED_ALL}
                            WHERE id = ? AND people_linked = ?`);
  let linked = 0;
  for (const id of ids) {
    await new Promise((resolve) => setImmediate(resolve));
    if (aborted() || !db.open) break;
    const r = read.get(id) as UnlinkedRow | undefined;
    if (!r || r.people_linked >= PEOPLE_LINKED_ALL) continue;
    const lines = readLog(db, NO_REPLY_FLAGS, JSON.parse(r.channel_ids) as string[], r.since_ts, r.until_ts, 'overall');
    const pairs = lines.flatMap((l) => l.people.map((p) => [p.name, p.userId] as const));
    const byName = r.people_linked < PEOPLE_LINKED.names ? peopleByName(pairs) : new Map<string, string>();
    const titles = r.themes_json ? (JSON.parse(r.themes_json) as SummaryTheme[]).map((t) => t.title) : [];
    const byLead = leadsNotWords(peopleByLead(pairs), [r.headline, ...pointTexts(r.items_json), ...pointTexts(r.actions_json), ...titles]);
    const link = (text: string): string => linkNames(linkNames(text, byName), byLead);
    const themes = r.themes_json && JSON.stringify((JSON.parse(r.themes_json) as SummaryTheme[]).map((t) => ({ ...t, title: link(t.title) })));
    linked += write.run(link(r.headline), linkedPoints(r.items_json, link), linkedPoints(r.actions_json, link), themes, r.id, r.people_linked).changes;
  }
  return linked;
}
