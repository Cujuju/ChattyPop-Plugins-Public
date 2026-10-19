import type { ArchiveRead } from '@plugin-sdk/core';
// Summary logs assign person tags; core converts known tags to stored mentions. Display resolves current names.
import type { PluginDb } from '@plugin-sdk/core';
import { personRef, referencedPeople } from '../shared/people';
import { pointCitations, type Summary } from '../shared/types';

/** A mark in model text, as the prompt's {refs} asks: {{p3}}. */
const MARK = /\{\{([^{}]+)\}\}/g;
const TAG_PREFIX = 'p';
const TAG = new RegExp(`^${TAG_PREFIX}\\d+$`);
/** Written for a tag the log never gave out: who the model meant is unknown. */
const UNPLACED_PERSON = 'someone';

/** The `n`th person tagged in a log (from 1). */
export const personTag = (n: number): string => `${TAG_PREFIX}${n}`;
/** A tag as the log shows it after the person's name, and as the model writes it. */
export const markedTag = (tag: string): string => `{{${tag}}}`;

/** A person in a run's log: their tag, user id and name as the log spells it. */
export interface TaggedPerson {
  tag: string;
  userId: string;
  name: string;
}

export const peopleByTag = (people: Iterable<TaggedPerson>): Map<string, TaggedPerson> => new Map([...people].map((p) => [p.tag, p]));

/** Maps unique names to people; excludes names shared by multiple people. */
export function peopleByName(pairs: Iterable<readonly [name: string, userId: string]>): Map<string, string> {
  const byName = new Map<string, string | null>();
  for (const [name, userId] of pairs) {
    const known = byName.get(name);
    byName.set(name, known === undefined || known === userId ? userId : null);
  }
  return new Map([...byName].filter((e): e is [string, string] => e[1] !== null));
}

/** Converts known tags to mentions. Legacy names link only when unique in the log; unknown tags become UNPLACED_PERSON. */
export const linkMarked = (text: string, byTag: ReadonlyMap<string, TaggedPerson>, byName: ReadonlyMap<string, string>): string =>
  text.replace(MARK, (_, mark: string) => {
    const m = mark.trim();
    const userId = byTag.get(m)?.userId ?? byName.get(m);
    return userId ? personRef(userId) : TAG.test(m) ? UNPLACED_PERSON : m;
  });

/** `text` with each mark as the name the log spells, for Jev, which reads the log's names. */
export const unmarked = (text: string, byTag: ReadonlyMap<string, TaggedPerson>): string =>
  text.replace(MARK, (_, mark: string) => {
    const m = mark.trim();
    return byTag.get(m)?.name ?? (TAG.test(m) ? UNPLACED_PERSON : m);
  });

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replaces whole, case-sensitive names with mentions, longest first. Used when the owner identifies a person. */
export function linkNames(text: string, byName: ReadonlyMap<string, string>): string {
  const names = [...byName.keys()].filter((n) => n.trim()).sort((a, b) => b.length - a.length);
  return names.length ? text.replace(wholeWords(names), (name) => personRef(byName.get(name)!)) : text;
}

/** Matches whole words, preferring the first listed match when starts coincide. */
const wholeWords = (words: readonly string[]): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}_])(?:${words.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}_])`, 'gu');

const placeholders = (n: number): string => Array(n).fill('?').join(',');

/** Every text a summary shows. */
const textsOf = (s: Summary): string[] => [
  s.headline,
  ...[...s.items, ...s.actions].flatMap((i) => i.parts.map((p) => p.text)),
  ...(s.themes ?? []).map((t) => t.title),
];

/** Resolves cited authors and people through privacy-filtered views, preferring a nickname from a summary channel's server over display names. */
export function withPeople(db: PluginDb, s: Summary): Summary {
  const messageIds = [...new Set([...s.items, ...s.actions].flatMap(pointCitations).concat((s.themes ?? []).flatMap((t) => t.citations)).map((c) => c.messageId))];
  const authors: Record<string, string> = messageIds.length
    ? Object.fromEntries(db.prepare(`SELECT id, author_id FROM archive_messages WHERE id IN (${placeholders(messageIds.length)})`).raw().all(...messageIds) as [string, string][])
    : {};
  const userIds = [...new Set([...textsOf(s).flatMap(referencedPeople), ...Object.values(authors)])];
  const people: Record<string, string> = userIds.length
    ? Object.fromEntries(db.prepare(
        `SELECT u.id, COALESCE((SELECT n.name FROM archive_names n WHERE n.user_id = u.id AND n.name IS NOT NULL
           AND n.channel_id IN (${placeholders(s.channelIds.length)}) LIMIT 1), u.display_name)
         FROM archive_users u WHERE u.id IN (${placeholders(userIds.length)})`,
      ).raw().all(...s.channelIds, ...userIds) as [string, string][])
    : {};
  return { ...s, people, authors };
}

export async function withPeopleRead(read: ArchiveRead, s: Summary): Promise<Summary> {
  return (await withPeoplePageRead(read, [s]))[0]!;
}

/** Two reads per page; the correlated nickname lookup keeps each summary's exact channel preference. */
export async function withPeoplePageRead(read: ArchiveRead, summaries: Summary[]): Promise<Summary[]> {
  if (!summaries.length) return [];
  const citations = summaries.map((s) => [...new Set([...s.items, ...s.actions].flatMap(pointCitations)
    .concat((s.themes ?? []).flatMap((t) => t.citations)).map((c) => c.messageId))]);
  const ids = [...new Set(citations.flat())];
  const allAuthors = new Map((ids.length ? await read<{ id: string; authorId: string }>(
    'SELECT id, author_id AS authorId FROM archive_messages WHERE id IN (SELECT value FROM json_each(?))', [JSON.stringify(ids)]) : [])
    .map((r) => [r.id, r.authorId]));
  const authors = citations.map((ids) => Object.fromEntries(ids.flatMap((id) => allAuthors.has(id) ? [[id, allAuthors.get(id)!]] : [])));
  const requests = summaries.map((s, index) => ({ index, channels: s.channelIds,
    users: [...new Set([...textsOf(s).flatMap(referencedPeople), ...Object.values(authors[index]!)])] }));
  const rows = await read<{ index: number; id: string; name: string }>(`SELECT CAST(json_extract(s.value, '$.index') AS INTEGER) AS "index", u.id,
    COALESCE((SELECT n.name FROM archive_names n WHERE n.user_id = u.id AND n.name IS NOT NULL
      AND n.channel_id IN (SELECT value FROM json_each(json_extract(s.value, '$.channels'))) LIMIT 1), u.display_name) AS name
    FROM json_each(?) s JOIN archive_users u ON u.id IN (SELECT value FROM json_each(json_extract(s.value, '$.users')))`, [JSON.stringify(requests)]);
  const people = summaries.map(() => ({} as Record<string, string>));
  for (const row of rows) people[row.index]![row.id] = row.name;
  return summaries.map((s, index) => ({ ...s, people: people[index]!, authors: authors[index]! }));
}
