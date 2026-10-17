/** Literal, case-insensitive query segments; no HTML or regular expressions from file text. */
export function textHighlights(text: string, query: string): { text: string; matched: boolean }[] {
  const needle = query.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!needle) return [{ text, matched: false }];
  const lower = text.toLowerCase(), parts: { text: string; matched: boolean }[] = [];
  let start = 0, hit = lower.indexOf(needle);
  while (hit >= 0) {
    if (hit > start) parts.push({ text: text.slice(start, hit), matched: false });
    start = hit + needle.length;
    parts.push({ text: text.slice(hit, start), matched: true });
    hit = lower.indexOf(needle, start);
  }
  if (start < text.length) parts.push({ text: text.slice(start), matched: false });
  return parts;
}
