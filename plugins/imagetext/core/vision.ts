// The vision engine: a model that reads images (an AI provider declared with `images`) transcribes an image's text and
// names the tickers a chart or trading screen shows.
import { readFile } from 'node:fs/promises';
import type { PluginProvider } from '@plugin-sdk/core';
import { MS_PER_MIN } from '@plugin-sdk/shared';

/**
 * One image, including loading the model into memory the first time. Assumption: far above a local 8B vision model's
 * seconds per image on a desktop GPU; a CPU-only machine may need the retry.
 */
const VISION_TIMEOUT_MS = 3 * MS_PER_MIN;
/**
 * The answer's cap: a dense screenshot's text is a few hundred tokens (measured, Qwen3-VL 8B on this archive), and a
 * model that pads its JSON answer (seen: thousands of newlines) stops here instead of running to the timeout.
 */
const VISION_MAX_OUTPUT_TOKENS = 2048;

const SYSTEM = 'You read images posted in a chat and reply with JSON only.';
const PROMPT = [
  'Transcribe all legible text in this image, line by line in reading order, exactly as written.',
  'If it shows a price chart, a quote, an order or another trading screen, list in "tickers" the symbol of each instrument it shows (for example TSLA, BTC, ES); otherwise leave "tickers" empty.',
].join('\n');
const SCHEMA = {
  type: 'object',
  properties: { text: { type: 'string' }, tickers: { type: 'array', items: { type: 'string' } } },
  required: ['text', 'tickers'],
};

/** Leading bytes of the image formats Discord and X serve, and their media types. */
const SIGNATURES: readonly { bytes: readonly (number | null)[]; type: string }[] = [
  { bytes: [0x89, 0x50, 0x4e, 0x47], type: 'image/png' },
  { bytes: [0xff, 0xd8, 0xff], type: 'image/jpeg' },
  { bytes: [0x47, 0x49, 0x46, 0x38], type: 'image/gif' },
  // RIFF....WEBP
  { bytes: [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50], type: 'image/webp' },
];

export const mediaTypeOf = (b: Uint8Array): string | null =>
  SIGNATURES.find((s) => s.bytes.every((x, i) => x === null || b[i] === x))?.type ?? null;

export interface VisionReading {
  text: string;
  tickers: string[];
}

/** Reads the image at `path` with `model`; `reads`: the channel the image was posted in (the AI read scope). */
export async function readWithVision(provider: PluginProvider, model: string, path: string, reads: string[], signal: AbortSignal): Promise<VisionReading> {
  const bytes = await readFile(path);
  const mediaType = mediaTypeOf(bytes);
  if (!mediaType) throw new Error('Not an image format the vision model reads.');
  const r = await provider.complete({
    system: SYSTEM,
    prompt: PROMPT,
    images: [{ mediaType, data: bytes.toString('base64') }],
    schema: SCHEMA,
    model,
    maxOutputTokens: VISION_MAX_OUTPUT_TOKENS,
    reads,
    signal: AbortSignal.any([signal, AbortSignal.timeout(VISION_TIMEOUT_MS)]),
  });
  const json = (r.json ?? {}) as { text?: unknown; tickers?: unknown };
  return {
    text: typeof json.text === 'string' ? json.text.trim() : '',
    tickers: Array.isArray(json.tickers) ? json.tickers.filter((t): t is string => typeof t === 'string') : [],
  };
}
