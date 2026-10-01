// Ollama's settings (preference plugin.ollama.settings): where its server listens and how long it keeps a model loaded.
import { isObj, textOrNull } from '@plugin-sdk/shared';

/** Ollama's own default listen address. */
export const OLLAMA_DEFAULT_URL = 'http://127.0.0.1:11434';

/** Ollama's `keep_alive` in seconds: 0 unloads right after a request, a negative value never unloads. */
export const UNLOAD_NEVER_S = -1;
/** The "Unload after" choices, in seconds (null: Ollama's own default, 5 minutes unless OLLAMA_KEEP_ALIVE says otherwise). */
export const UNLOAD_AFTER_CHOICES: readonly { value: number | null; label: string }[] = [
  { value: null, label: 'Ollama’s setting (5 minutes by default)' },
  { value: 0, label: 'Right after each request' },
  { value: 60, label: '1 minute' },
  { value: 15 * 60, label: '15 minutes' },
  { value: 60 * 60, label: '1 hour' },
  { value: UNLOAD_NEVER_S, label: 'Never' },
];

export interface OllamaSettings {
  ollamaUrl: string;
  /** How long Ollama keeps a model in memory after a request (`keep_alive`, seconds); null leaves it to Ollama. */
  unloadAfterS: number | null;
}

export const DEFAULT_OLLAMA_SETTINGS: OllamaSettings = { ollamaUrl: OLLAMA_DEFAULT_URL, unloadAfterS: null };

/** A blank or missing address is Ollama's default; an unlisted unload time is Ollama's own. */
export function normalizeOllamaSettings(v: unknown): OllamaSettings {
  const src = isObj(v) ? v : {};
  const unload = src['unloadAfterS'];
  return {
    ollamaUrl: textOrNull(src['ollamaUrl'], false) ?? OLLAMA_DEFAULT_URL,
    unloadAfterS: UNLOAD_AFTER_CHOICES.some((c) => c.value !== null && c.value === unload) ? (unload as number) : null,
  };
}
