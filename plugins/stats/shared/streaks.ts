export interface DayRun {
  days: number;
  start: string;
  end: string;
}

export interface StreakStats {
  longest: DayRun | null;
  /** The consecutive run ending on this scope's last active local date. */
  current: DayRun | null;
  /** Inactive dates strictly between two active dates; endpoints are the first and last inactive dates. */
  gap: DayRun | null;
}

export interface PersonStreak extends DayRun {
  userId: string;
}
