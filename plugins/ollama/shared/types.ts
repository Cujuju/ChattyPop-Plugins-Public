// Model downloads (Ollama's /api/pull) as Settings → AI shows them.

/** A model being downloaded, or one whose download failed (kept until it's tried again). */
export interface OllamaPull {
  model: string;
  state: 'downloading' | 'failed';
  /** Ollama's step ("pulling manifest", "verifying sha256 digest", …). */
  step: string;
  /** Bytes so far and in all, over every layer seen so far; 0 before the first layer reports. */
  completed: number;
  total: number;
  error: string | null;
}

/** A vision model suggested for installing: measured on this archive's screenshots and charts (#196). */
export const SUGGESTED_VISION_MODEL = { id: 'qwen3-vl:8b-instruct', note: 'reads images in seconds; 6.1 GB' } as const;

/** A model offered as a one-click install. */
export interface SuggestedModel {
  /** The name Ollama pulls it by. */
  id: string;
  /** What it is for, in a few words. */
  note: string;
  /** Its download size in bytes (the sum of its layers in Ollama's registry). */
  bytes: number;
}

/** Models commonly installed, the image reader first, then smallest to largest. Names and sizes from Ollama's registry, 2026-10-10. */
export const SUGGESTED_MODELS: readonly SuggestedModel[] = [
  { id: SUGGESTED_VISION_MODEL.id, note: 'Reads images in seconds', bytes: 6_140_415_424 },
  { id: 'llama3.2', note: 'Smallest; quick text', bytes: 2_019_392_628 },
  { id: 'gemma3:4b', note: 'Small and fast; text and images', bytes: 3_350_272_259 },
  { id: 'qwen3:8b', note: 'General text, with thinking', bytes: 5_225_387_677 },
  { id: 'gemma3:12b', note: 'More capable; text and images', bytes: 8_164_039_587 },
  { id: 'gpt-oss:20b', note: 'Strongest of these; wants 16 GB of memory or more', bytes: 13_793_441_427 },
];

/** Ollama lists a model pulled without a tag as `<name>:latest`. */
const DEFAULT_TAG = ':latest';

/** The suggestions still worth offering: not installed, and with no download running or failed (its own row shows that). */
export function suggestionsToOffer(installed: readonly string[], pulling: readonly string[]): SuggestedModel[] {
  const have = new Set([...installed, ...pulling].flatMap((name) => [name, name.endsWith(DEFAULT_TAG) ? name.slice(0, -DEFAULT_TAG.length) : name]));
  return SUGGESTED_MODELS.filter((m) => !have.has(m.id));
}
