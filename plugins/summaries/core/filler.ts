// Rule-based filler check for summary input: no AI, no cost. Only summaries use it; the archive is never filtered.

/** Bump when the rules change: cached summaries made with the old rules are not reused. */
export const FILLER_RULES_VERSION = 1;

/** Maximum filler-text length after stripping links and emoji. */
export const FILLER_MAX_CHARS = 12;

const URL = /<?https?:\/\/\S+>?/g;
/** Discord custom emoji as stored in content: <:name:id> or <a:name:id>. */
const CUSTOM_EMOJI = /<a?:\w+:\d+>/g;
/** Pictographs plus the joiners, skin tones, variation selectors and flag letters that build them. */
const UNICODE_EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}‍️]/gu;
/** Digits and question marks exempt short text from filler filtering. */
const CARRIES_FACT = /[\d?]/;

/** Detects link/emoji-only or short digit/question-free filler. Keeps short replies because they may answer earlier messages. */
export function isFiller(content: string, isReply: boolean): boolean {
  const rest = content.replace(URL, '').replace(CUSTOM_EMOJI, '').replace(UNICODE_EMOJI, '').trim();
  if (!rest) return true;
  return !isReply && rest.length <= FILLER_MAX_CHARS && !CARRIES_FACT.test(rest);
}
