// People in summary text: the model marks the names it writes ({{Name}}), core stores each as the person it is
// (<@id>), and a summary read for showing carries everyone's name as it is now.
import type { PluginDb } from '@plugin-sdk/core';
import { personRef, referencedPeople } from '../shared/people';
import { pointCitations, type Summary } from '../shared/types';

/** A name the model marked, as the prompt's {refs} asks: {{Name}}. */
const MARKED_NAME = /\{\{([^{}]+)\}\}/g;

/** Each name to the one person it is; a name two people share is left out, since it can't say which one is meant. */
export function peopleByName(pairs: Iterable<readonly [name: string, userId: string]>): Map<string, string> {
  const byName = new Map<string, string | null>();
  for (const [name, userId] of pairs) {
    const known = byName.get(name);
    byName.set(name, known === undefined || known === userId ? userId : null);
  }
  return new Map([...byName].filter((e): e is [string, string] => e[1] !== null));
}

/** `text` with each marked name `byName` knows as its person, and any other mark dropped to the bare name. */
export const linkMarked = (text: string, byName: ReadonlyMap<string, string>): string =>
  text.replace(MARKED_NAME, (_, name: string) => {
    const userId = byName.get(name.trim());
    return userId ? personRef(userId) : name;
  });

/** `text` without marks: the names as the model wrote them, for Jev, which reads the log's names. */
export const unmarked = (text: string): string => text.replace(MARKED_NAME, '$1');

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
