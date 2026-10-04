// The owner names a person in a stored summary that the model's tags didn't (a first name, another spelling).
import type { PluginDb } from '@plugin-sdk/core';
import type { SummaryItem, SummaryTheme } from '../shared/types';
import { personRef } from '../shared/people';
import { linkNames } from './people';
import { SUMMARIES_TABLE } from './schema';

interface TextRow {
  headline: string;
  items_json: string;
  actions_json: string;
  themes_json: string | null;
}

/** A stored point list (either shape: parts, or one text from before parts) with `link` applied to each text. */
const linkedPoints = (json: string, link: (t: string) => string): string =>
  JSON.stringify((JSON.parse(json) as (SummaryItem | { text: string })[]).map((i) =>
    'parts' in i ? { ...i, parts: i.parts.map((p) => ({ ...p, text: link(p.text) })) } : { ...i, text: link(i.text) },
  ));

/** Each whole-word `written` in summary `id` becomes `userId`. Returns how many it linked; none for a person the archive doesn't know. */
export function linkPerson(db: PluginDb, id: number, written: string, userId: string): number {
  if (!written.trim() || !db.prepare('SELECT 1 FROM archive_users WHERE id = ?').get(userId)) return 0;
  const r = db.prepare(`SELECT headline, items_json, actions_json, themes_json FROM ${SUMMARIES_TABLE} WHERE id = ?`).get(id) as TextRow | undefined;
  if (!r) return 0;
  const ref = personRef(userId);
  const refs = (text: string): number => text.split(ref).length - 1;
  let linked = 0;
  const link = (text: string): string => {
    const out = linkNames(text, new Map([[written, userId]]));
    linked += refs(out) - refs(text);
    return out;
  };
  const themes = r.themes_json && JSON.stringify((JSON.parse(r.themes_json) as SummaryTheme[]).map((t) => ({ ...t, title: link(t.title) })));
  const [headline, items, actions] = [link(r.headline), linkedPoints(r.items_json, link), linkedPoints(r.actions_json, link)];
  if (linked) db.prepare(`UPDATE ${SUMMARIES_TABLE} SET headline = ?, items_json = ?, actions_json = ?, themes_json = ? WHERE id = ?`).run(headline, items, actions, themes, id);
  return linked;
}
