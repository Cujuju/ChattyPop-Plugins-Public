// Built-in Jev queries behind alerts. Defaults are the tuned originals (see each cut-off's note).
import { MESSAGE_SEES, type JevFeatureDecl, type JevQueryDecl } from '@plugin-sdk/shared';

/** Built-in alert cut-offs start at 0.7: precision first, since a false alert costs attention. */
const ALERT_AT = 0.7;

/** Alerts' Settings → Jev switches, keyed as they were before Alerts was a plugin (adopted as alerts.<key>), after rules by meaning. */
export const ALERT_FEATURES = [
  { key: 'urgentToasts', label: 'Notify only for urgent alerts', default: false, after: 'topicMeaning' },
  { key: 'aimedAtMe', label: 'Alert when a message is aimed at me', default: false, after: 'alerts.urgentToasts' },
  { key: 'unansweredQuestions', label: 'Open questions inbox', default: false, after: 'alerts.aimedAtMe' },
  { key: 'dedupeAlerts', label: 'Don’t notify twice for the same event', default: false, after: 'alerts.unansweredQuestions' },
] as const satisfies readonly JevFeatureDecl[];
export type AlertFeature = (typeof ALERT_FEATURES)[number]['key'];

// Placed where they were listed when Alerts was built in: after the host's rules-by-meaning query, in this order.
export const ALERT_QUERIES: readonly JevQueryDecl<AlertFeature>[] = [
  {
    id: 'alerts.aimed',
    after: 'rules.meaning',
    subject: 'aimed',
    group: 'Alerts',
    label: 'Aimed at you',
    features: ['aimedAtMe'],
    sees: `${MESSAGE_SEES} Replies to you and @mentions count without asking.`,
    vars: ['`me`: your display names and mention token'],
    use: 'decision',
    condition: 'Alert',
    perMessage: true,
    defaults: {
      type: 'noul',
      question:
        'Is `message` addressed to `me` or asking `me` something, with or without an @mention? Read `earlier` and `replying_to` only to see who `message` answers.',
      yes: '`message` speaks to `me` directly, asks `me` a question, or answers something `me` said.',
      no: '`message` speaks to someone else or to everyone, or only mentions `me` in passing.',
      minProbability: ALERT_AT,
    },
  },
  {
    id: 'alerts.openQuestion',
    after: 'alerts.aimed',
    subject: 'question',
    group: 'Alerts',
    label: 'Open questions',
    features: ['unansweredQuestions'],
    sees: MESSAGE_SEES,
    use: 'decision',
    condition: 'Alert',
    perMessage: true,
    defaults: {
      type: 'noul',
      question: 'Does `message` ask the chat a real question, wanting information, help or an opinion? Read `earlier` and `replying_to` only to understand what `message` refers to.',
      yes: '`message` asks something its author wants answered.',
      no: '`message` is a statement, a joke, a reaction, or a rhetorical question.',
      minProbability: ALERT_AT,
    },
  },
  {
    id: 'alerts.urgency',
    after: 'alerts.openQuestion',
    group: 'Alerts',
    label: 'Urgent enough to notify',
    features: ['urgentToasts'],
    sees: `${MESSAGE_SEES} Asked only for live messages that alert.`,
    use: 'decision',
    condition: 'Notify',
    defaults: {
      type: 'score',
      question: 'How urgent is `message` for a busy person who follows this chat?',
      levels: [
        'Not urgent: chat, jokes, reactions, links or opinions.',
        'Worth reading later: news, plans or questions without a deadline.',
        'Needs attention now: a direct request, a deadline, a time-limited chance, or something going wrong.',
      ],
      // Between the top two levels: the score sits closer to "needs attention now" than "read later".
      minScore: 1.5,
    },
  },
  {
    id: 'alerts.sameEvent',
    after: 'alerts.urgency',
    group: 'Alerts',
    label: 'Repeat of the last alert',
    features: ['dedupeAlerts'],
    sees: '`message` (the new alert) and `previous` (the topic’s last alert in the past 6 hours).',
    use: 'decision',
    condition: 'Treat as a repeat',
    defaults: {
      type: 'noul',
      question: 'Is `message` about the same event or news as `previous`?',
      yes: '`message` reports, repeats or discusses the same happening as `previous`.',
      no: '`message` is about a different happening, even if the subject is similar.',
      minProbability: ALERT_AT,
    },
  },
];
