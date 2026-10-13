import type { PersonStreak } from './streaks';
import type { StatsPoster } from './types';
import type { VoiceStats } from './voice';

/** Ten messages distinguish established posters from brief visits in the quiet list. */
export const QUIET_MIN_MESSAGES = 10;
/** Thirty local days define a meaningful silence and the window for recent returns. */
export const PERSON_SILENCE_DAYS = 30;

export interface PersonHistory {
  archivedSince: number | null;
  lastDay: string | null;
  /** The selected range's longest streaks, derived from the same whole-scope day read. */
  streaks: PersonStreak[];
  quiet: (StatsPoster & { lastSeen: string })[];
  returned: (StatsPoster & { silenceDays: number; returned: string })[];
}

/** People fetches both independent computations together to share their author/day SQL read. */
export interface PeopleStats {
  history: PersonHistory;
  voice: VoiceStats;
  /** Competition rank in the selected scope/range; ties share a rank. Present only for a person query. */
  person?: { poster: StatsPoster; rank: number } | null;
}
