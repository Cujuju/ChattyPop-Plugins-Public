const WORDS = new Intl.Segmenter('en', { granularity: 'word' });
const CODE_BLOCK = /```[\s\S]*?(?:```|$)/g;
const URL = /\b(?:https?:\/\/|www\.)[^\s<>]+/giu;
const MENTION = /<(?:@!?|@&|#)\d+>/g;
export const CUSTOM_EMOJI = /<(a?):([a-zA-Z0-9_]+):(\d+)>/g;

export function tokenize(content: string): string[] {
  const prose = content.replace(CODE_BLOCK, ' ').replace(URL, ' ').replace(MENTION, ' ').replace(CUSTOM_EMOJI, ' ');
  return [...WORDS.segment(prose)].filter((segment) => segment.isWordLike).map((segment) => segment.segment.toLowerCase());
}
