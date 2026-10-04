// People named in summary text: stored as Discord user refs (<@id>), so each shows the name they have now.

/** A person in stored summary text: Discord's user mention form. */
const PERSON_REF = /<@(\d+)>/g;

export const personRef = (userId: string): string => `<@${userId}>`;

/** The user ids `text` names. */
export const referencedPeople = (text: string): string[] => [...text.matchAll(PERSON_REF)].map((m) => m[1]!);

/** A stretch of summary text: plain text, or a person. */
export type TextRun = string | { userId: string };

/** `text` split into its plain stretches and the people between them, in order. */
export function textRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let at = 0;
  for (const m of text.matchAll(PERSON_REF)) {
    if (m.index > at) runs.push(text.slice(at, m.index));
    runs.push({ userId: m[1]! });
    at = m.index + m[0].length;
  }
  if (at < text.length) runs.push(text.slice(at));
  return runs;
}

/** `text` with each person written as their name in `names` (user id → name), for plain-text uses such as notifications. */
export const namedText = (text: string, names: Readonly<Record<string, string>>): string =>
  text.replace(PERSON_REF, (raw, id: string) => names[id] ?? raw);
