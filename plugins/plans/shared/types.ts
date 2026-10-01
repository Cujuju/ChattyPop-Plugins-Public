// A plan or decision as the Plans & decisions panel lists it.

export type PlanKind = 'plan' | 'decision';

/** A plan or decision from a message (#67): what, when (plans; null if unstated), who, and details. */
export interface PlanItem {
  messageId: string;
  channelId: string;
  channelName: string;
  kind: PlanKind;
  title: string;
  whenTs: number | null;
  who: string[];
  details: string;
  /** When the message was sent. */
  ts: number;
}
