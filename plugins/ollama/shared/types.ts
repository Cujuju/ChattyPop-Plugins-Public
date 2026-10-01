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
