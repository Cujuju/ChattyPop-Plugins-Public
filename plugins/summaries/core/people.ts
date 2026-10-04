// People in summary text: the log tags each person ({{p3}}), the model writes the tag wherever it names them, and core
// stores each as the person it is (<@id>), only for tags the log gave out. A summary read for showing carries names now.
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

/** Each name to the one person it is; a name two people share is left out, since it can't say which one is meant. */
export function peopleByName(pairs: Iterable<readonly [name: string, userId: string]>): Map<string, string> {
  const byName = new Map<string, string | null>();
  for (const [name, userId] of pairs) {
    const known = byName.get(name);
    byName.set(name, known === undefined || known === userId ? userId : null);
  }
  return new Map([...byName].filter((e): e is [string, string] => e[1] !== null));
}

/**
 * `text` with each tag the log gave out as its person. A mark holding a name (as a template from before tags asks) is
 * linked when one person in the log has it, else kept as the name; an unknown tag reads UNPLACED_PERSON.
 */
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

/**
 * `text`, written before names were marked, with each whole name in `byName` (case as written, not inside a longer word)
 * as its person; longer names first, so one containing another wins. Only the one-time pass over stored summaries uses it.
 */
export function linkNames(text: string, byName: ReadonlyMap<string, string>): string {
  const names = [...byName.keys()].filter((n) => n.trim()).sort((a, b) => b.length - a.length);
  if (!names.length) return text;
  const whole = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${names.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}_])`, 'gu');
  return text.replace(whole, (name) => personRef(byName.get(name)!));
}

const placeholders = (n: number): string => Array(n).fill('?').join(',');

/** Every text a summary shows. */
const textsOf = (s: Summary): string[] => [
  s.headline,
  ...[...s.items, ...s.actions].flatMap((i) => i.parts.map((p) => p.text)),
  ...(s.themes ?? []).map((t) => t.title),
];

/**
 * `s` with its cited messages' authors and every person's name now: their nickname in a server of its channels (when
 * its channels span servers, any one of theirs), else their display name. Read from the views privacy mode filters.
 */
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
