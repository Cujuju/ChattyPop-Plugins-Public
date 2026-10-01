// Rule-based filler check for summary input: no AI, no cost. Only summaries use it; the archive is never filtered.

/** Bump when the rules change: cached summaries made with the old rules are not reused. */
export const FILLER_RULES_VERSION = 1;

/**
 * Longest text (after links and emoji are removed) treated as a throwaway: "lol", "W", "yeah true", "facts".
 * Longer text usually carries a clause worth reading.
 */
export const FILLER_MAX_CHARS = 12;

const URL = /<?https?:\/\/\S+>?/g;
/** Discord custom emoji as stored in content: <:name:id> or <a:name:id>. */
const CUSTOM_EMOJI = /<a?:\w+:\d+>/g;
/** Pictographs plus the joiners, skin tones, variation selectors and flag letters that build them. */
const UNICODE_EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}‍️]/gu;
/** Digits or a question in short text usually mean a fact ("6pm", "$40") or a question ("you in?"). */
const CARRIES_FACT = /[\d?]/;

/**
 * True when a message adds nothing a summary needs: only links and emoji, or short text with no digits or
 * question mark. A short reply is kept, since it may be the answer ("no, Friday").
 */
export function isFiller(content: string, isReply: boolean): boolean {
  const rest = content.replace(URL, '').replace(CUSTOM_EMOJI, '').replace(UNICODE_EMOJI, '').trim();
  if (!rest) return true;
  return !isReply && rest.length <= FILLER_MAX_CHARS && !CARRIES_FACT.test(rest);
}
