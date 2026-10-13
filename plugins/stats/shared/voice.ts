import type { ActivityStats, StatsPoster } from './types';

/** Eight people keep the comparable strips readable in the People section. */
export const VOICE_PEOPLE = 8;

export interface VoiceStats {
  bucket: ActivityStats['bucket'];
  buckets: ActivityStats['buckets'];
  people: { poster: StatsPoster; counts: number[] }[];
  /** All strips use the highest share reached by any displayed person. */
  maxShare: number;
}

export const voiceShare = (count: number, messages: number): number => messages ? count / messages : 0;
