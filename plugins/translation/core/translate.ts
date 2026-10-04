// One translation: a text model translates a part's text into the owner's language, unless it already is.
import type { PluginProvider } from '@plugin-sdk/core';
import { MS_PER_MIN } from '@plugin-sdk/shared';

/**
 * One translation, including loading the model the first time. Assumption: a local model translates a screenshot's or
 * voice message's few hundred tokens in well under Image text's per-image allowance, which this matches.
 */
const TRANSLATE_TIMEOUT_MS = 3 * MS_PER_MIN;
/**
 * The answer's cap: twice Image text's vision reading cap (2048), since a translation out of CJK text takes more
 * tokens than its source; a model padding its JSON stops here instead of at the timeout.
 */
const TRANSLATE_MAX_OUTPUT_TOKENS = 4096;

const SYSTEM = 'You translate text from a chat (read from images, transcribed from audio, or a link preview), and reply with JSON only.';
// The model names the language and always translates; code decides whether it was needed. Measured (qwen3-vl:8b-instruct):
// asked to judge "needed" itself, a small model answered false even for wholly Japanese text.
const SCHEMA = {
  type: 'object',
  properties: { language: { type: 'string' }, translation: { type: 'string' } },
  required: ['language', 'translation'],
};

const prompt = (language: string, text: string): string =>
  [
    `In "language", name in English the language of the text below, ignoring numbers, tickers and symbols. If part of it is in ${language} and part in another language, name the other language.`,
    `In "translation", give the whole text in ${language}, line by line, keeping numbers, tickers and links as written.`,
    '',
    'Text:',
    text,
  ].join('\n');

/**
 * The model named `named` for text whose target is `target`: the same language, so no translation. A target with a
 * variant ("Chinese (Simplified)") matches its base name; so text in another variant of it isn't translated.
 */
const sameLanguage = (named: string, target: string): boolean => {
  const base = (l: string): string => l.replace(/\(.*\)/, '').trim().toLowerCase();
  return base(named) === base(target);
};

/** `text` in `language` with `model`; null when it needn't be translated. `reads`: its message's channel (the AI read scope). */
export async function translateText(provider: PluginProvider, model: string, language: string, text: string, reads: string[], signal: AbortSignal): Promise<string | null> {
  const r = await provider.complete({
    system: SYSTEM,
    prompt: prompt(language, text),
    schema: SCHEMA,
    model,
    maxOutputTokens: TRANSLATE_MAX_OUTPUT_TOKENS,
    reads,
    signal: AbortSignal.any([signal, AbortSignal.timeout(TRANSLATE_TIMEOUT_MS)]),
  });
  const json = (r.json ?? {}) as { language?: unknown; translation?: unknown };
  const named = typeof json.language === 'string' ? json.language : '';
  const translation = typeof json.translation === 'string' ? json.translation.trim() : '';
  // Unchanged text (only numbers and tickers) adds nothing.
  return translation && translation !== text.trim() && !sameLanguage(named, language) ? translation : null;
}
