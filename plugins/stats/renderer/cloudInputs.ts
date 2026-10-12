import { CLOUD_WORDS, type WordCount } from '../shared/text';
import { fitViewBox } from './viewBox';

/** A multiple of 32 matches d3-cloud's bitmap rows; the drawing stays twice as wide as tall. */
export const CLOUD_WIDTH = 1024;
export const CLOUD_HEIGHT = CLOUD_WIDTH / 2;
/** This font span gives frequent words prominence while leaving room for sixty entries. */
export const CLOUD_FONT_MIN = CLOUD_WIDTH / 64;
export const CLOUD_FONT_MAX = CLOUD_WIDTH / 14;
/** Small gaps keep adjacent glyphs distinct without opening large holes. */
export const CLOUD_PADDING = CLOUD_WIDTH / 512;
/** A little space around the placed bounds keeps the outer glyphs clear of the viewport. */
export const CLOUD_VIEWBOX_PADDING = CLOUD_WIDTH / 64;

export interface CloudWord {
  text: string;
  count: number;
  share: number;
  size: number;
  x?: number;
  y?: number;
}

/** d3-cloud bounds use layout coordinates, matching the renderer's centre-translated group. */
export function cloudViewBox(bounds: readonly { x: number; y: number }[] | null): string {
  return fitViewBox(bounds, CLOUD_VIEWBOX_PADDING, { width: CLOUD_WIDTH, height: CLOUD_HEIGHT });
}

/** Square-root scaling leaves less frequent words readable beside the leading word. */
export function cloudInputs(words: WordCount[]): CloudWord[] {
  const ranked = words.filter((word) => word.count > 0).slice().sort((a, b) => b.count - a.count || a.word.localeCompare(b.word)).slice(0, CLOUD_WORDS);
  const max = ranked[0]?.count ?? 0;
  return ranked.map(({ word, count }) => ({
    text: word, count, share: count / max,
    size: CLOUD_FONT_MIN + (CLOUD_FONT_MAX - CLOUD_FONT_MIN) * Math.sqrt(count / max),
  }));
}
