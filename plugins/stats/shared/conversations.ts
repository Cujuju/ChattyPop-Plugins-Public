import { MS_PER_MIN } from '@plugin-sdk/shared';
import type { ActivityQuery, StatsPoster } from './types';

/** A thirty-minute lull ends a run, allowing ordinary reply delays without joining separate sessions. */
export const CONVERSATION_GAP_MINUTES = 30;
export const CONVERSATION_GAP_MS = CONVERSATION_GAP_MINUTES * MS_PER_MIN;
/** Fifty strongest pairs give the bounded graph enough ties and keep the ranked list finite. */
export const CONVERSATION_PAIRS = 50;

export interface ConversationPerson extends Omit<StatsPoster, 'count'> {
  exchanges: number;
}

export interface ConversationPair {
  first: ConversationPerson;
  second: ConversationPerson;
  exchanges: number;
}

export interface ConversationStats {
  query: ActivityQuery;
  messages: number;
  conversations: number;
  pairedConversations: number;
  pairs: ConversationPair[];
  /** Total exchanges with all partners, before the pair ranking is truncated. */
  people: ConversationPerson[];
}
