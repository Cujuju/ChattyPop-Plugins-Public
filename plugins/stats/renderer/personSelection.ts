import type { StatsPlace, StatsPoster } from '../shared/types';

/** Moving to another place resets the person; the first observation keeps them. */
export function resetPerson(authorId: string | null, previous: StatsPlace | null | undefined, next: StatsPlace | null): string | null {
  if (previous === undefined) return authorId;
  return previous?.by === next?.by && previous?.id === next?.id ? authorId : null;
}

/** A completed place/range picker read cannot retain a person absent from its bounded list. */
export const listedPerson = (authorId: string | null, posters: Pick<StatsPoster, 'userId'>[]): string | null =>
  authorId !== null && posters.some((poster) => poster.userId === authorId) ? authorId : null;
