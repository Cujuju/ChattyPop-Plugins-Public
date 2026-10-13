const WORDS = new Intl.Segmenter('en', { granularity: 'word' });
const CODE_BLOCK = /```[\s\S]*?(?:```|$)/g;
const MASKED_LINK = /\[[^\]\r\n]*\]\((?:<[^>\r\n]*>|(?:[^()\r\n]|\([^()\r\n]*\))*)\)/g;
const URL = /\b(?:https?:\/\/|www\.)[^\s<>]+/giu;
const MENTION = /<(?:@!?|@&|#)\d+>/g;
export const CUSTOM_EMOJI = /<(a?):([a-zA-Z0-9_]+):(\d+)>/g;

export function tokenize(content: string): string[] {
  const prose = content.replace(CODE_BLOCK, ' ').replace(MASKED_LINK, ' ').replace(URL, ' ')
    .replace(MENTION, ' ').replace(CUSTOM_EMOJI, ' ').replace(/[\u2018\u2019]/g, "'");
  const words: string[] = [];
  for (const segment of WORDS.segment(prose)) if (segment.isWordLike) words.push(segment.segment.toLowerCase());
  return words;
}
