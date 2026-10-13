import type { StatsPoster, StatsScope } from '../shared/types';

export interface PersonScope { scope: StatsScope; channelId: string | null }

/** Scope switches always reset; changing the shown channel resets channel and server views only. */
export function resetPerson(authorId: string | null, previous: PersonScope | undefined, next: PersonScope): string | null {
  if (!previous) return authorId;
  return previous.scope !== next.scope || (next.scope !== 'all' && previous.channelId !== next.channelId) ? null : authorId;
}

/** A completed scope/range picker read cannot retain a person absent from its bounded list. */
export const listedPerson = (authorId: string | null, posters: Pick<StatsPoster, 'userId'>[]): string | null =>
  authorId !== null && posters.some((poster) => poster.userId === authorId) ? authorId : null;
