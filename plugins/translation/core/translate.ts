// One translation: a text model translates a part's text into the owner's language block by block, unless it already is.
import type { PluginProvider } from '@plugin-sdk/core';
import { MS_PER_MIN } from '@plugin-sdk/shared';

/** Per-block timeout, including initial model loading; matches Image text's allowance. */
const TRANSLATE_TIMEOUT_MS = 3 * MS_PER_MIN;
/** A block's output cap is twice vision's cap (2048), bounding padded responses. */
const TRANSLATE_MAX_OUTPUT_TOKENS = 4096;

const SYSTEM = 'You translate text from a chat (read from images, transcribed from audio, or a link preview), and reply with JSON only.';
// The model names the source language and translates; code decides whether translation was needed.
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

/** Matches model-named language to the target's base name; target variants are treated as the same language. */
const sameLanguage = (named: string, target: string): boolean => {
  const base = (l: string): string => l.replace(/\(.*\)/, '').trim().toLowerCase();
  return base(named) === base(target);
};

/** A markdown link's target and a bare URL: their letters are no words. */
const LINK_TARGET = /\]\([^)]*\)/g;
const BARE_URL = /https?:\/\/\S+/g;
/** A quoted line's marker. */
const QUOTE_MARK = /^\s*>\s?/;

const hasWords = (line: string): boolean => /\p{L}/u.test(line.replace(LINK_TARGET, ']').replace(BARE_URL, ''));

/** Consecutive lines with words under one quote marker ('' when unquoted), the marker taken off each. */
interface Block {
  quote: string;
  lines: string[];
}

/**
 * The text's lines in order: one without words as it is, runs of the others as blocks. A model names one language
 * per request, so each block is its own request: a quoted post in another language is found beside the owner's.
 */
function blocksOf(text: string): (string | Block)[] {
  const out: (string | Block)[] = [];
  for (const line of text.split('\n')) {
    if (!hasWords(line)) {
      out.push(line);
      continue;
    }
    const quote = QUOTE_MARK.exec(line)?.[0] ?? '';
    const last = out.at(-1);
    if (typeof last === 'object' && last.quote === quote) last.lines.push(line.slice(quote.length));
    else out.push({ quote, lines: [line.slice(quote.length)] });
  }
  return out;
}

/** What every block of one translation is asked with. */
interface Ask {
  provider: PluginProvider;
  model: string;
  language: string;
  reads: string[];
  signal: AbortSignal;
}

/** One block in the language; null when it needn't be translated. */
async function translateBlock(ask: Ask, text: string): Promise<string | null> {
  const r = await ask.provider.complete({
    system: SYSTEM,
    prompt: prompt(ask.language, text),
    schema: SCHEMA,
    model: ask.model,
    maxOutputTokens: TRANSLATE_MAX_OUTPUT_TOKENS,
    reads: ask.reads,
    signal: AbortSignal.any([ask.signal, AbortSignal.timeout(TRANSLATE_TIMEOUT_MS)]),
  });
  const json = (r.json ?? {}) as { language?: unknown; translation?: unknown };
  const named = typeof json.language === 'string' ? json.language : '';
  const translation = typeof json.translation === 'string' ? json.translation.trim() : '';
  // Unchanged text (only numbers and tickers) adds nothing.
  return translation && translation !== text.trim() && !sameLanguage(named, ask.language) ? translation : null;
}

/**
 * `text` in `language` with `model`: its blocks in another language translated, the rest as written; null when none
 * needed it. `reads`: its message's channel (the AI read scope).
 */
export async function translateText(provider: PluginProvider, model: string, language: string, text: string, reads: string[], signal: AbortSignal): Promise<string | null> {
  const ask: Ask = { provider, model, language, reads, signal };
  const out: string[] = [];
  let translated = false;
  for (const b of blocksOf(text)) {
    if (typeof b === 'string') {
      out.push(b);
      continue;
    }
    const source = b.lines.join('\n');
    const translation = await translateBlock(ask, source);
    translated ||= translation !== null;
    out.push(...(translation ?? source).split('\n').map((l) => b.quote + l));
  }
  return translated ? out.join('\n').trim() : null;
}
