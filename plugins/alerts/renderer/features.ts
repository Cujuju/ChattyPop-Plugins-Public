// Alert Jev switches' Settings rows: what each does and its cost (their names are the descriptor's).
import type { JevFeatureView } from '@plugin-sdk/renderer';
import type { AlertFeature } from '../shared/queries';

export const ALERT_FEATURE_INFO = {
  urgentToasts: {
    group: 'Alerts',
    hint: 'Jev rates each live alert’s urgency; only urgent ones pop a Windows notification, the rest wait in the inbox. If Jev can’t answer, alerts notify as usual.',
    perMessage: '1 question, only for live messages that alert',
  },
  aimedAtMe: {
    group: 'Alerts',
    hint: 'Turns on the built-in “Aimed at you” rule. Replies to you and @mentions always count; Jev guesses the rest, which proved unreliable.',
    perMessage: '1 question per message',
  },
  unansweredQuestions: {
    group: 'Alerts',
    hint: 'Turns on the built-in “Open questions” rule for questions others ask in chat. A Discord reply to one marks it answered.',
    perMessage: '1 question per message',
  },
  dedupeAlerts: {
    group: 'Alerts',
    hint: 'Before a notification, Jev compares the alert with the rule’s last one from the past few hours; a repeat stays in the inbox quietly.',
  },
} as const satisfies Record<AlertFeature, JevFeatureView>;
