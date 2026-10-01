// Alerts' panel, bell, companion section, settings and rule contributions.
import { Show } from 'solid-js';
import { defineRendererPlugin } from '@plugin-sdk/renderer';
import { jevSwitch, RuleBadge } from '@plugin-sdk/renderer/kit';
import { plugin } from '../shared';
import { AlertsPanel } from './AlertsPanel';
import { AlertsBell } from './Bell';
import { ruleUnread, unreadAlertCount } from './state';
import { alertMatchViews } from './matchViews';
import { actionViews } from './notifyView';
import { templates } from './templates';
import { ALERT_FEATURE_INFO } from './features';

const aimedAtMe = jevSwitch(plugin, 'aimedAtMe');
const unansweredQuestions = jevSwitch(plugin, 'unansweredQuestions');

export default defineRendererPlugin(
  plugin,
  {
    panels: { alerts: { view: AlertsPanel } },
    unread: { alerts: { count: unreadAlertCount } },
    topBar: { bell: { Component: AlertsBell } },
    phoneSections: {
      inbox: {
        label: 'Alerts',
        overview: { noun: 'alerts' },
        section: 'alerts',
        Component: AlertsPanel,
        badge: unreadAlertCount,
      },
    },
    notificationKinds: {
      alert: {
      label: 'Rule alerts',
      desktop: {
        subject: 'live alerts',
        note: 'Alerts always arrive in the Alerts inbox either way.',
        hint: 'When off, alerts still arrive in the Alerts inbox and the bell shows unread ones. Jev → “Notify only for urgent alerts” narrows which alerts notify.',
      },
      },
    },
    jevFeatures: ALERT_FEATURE_INFO,
    ruleTemplates: templates,
    rules: {
      match: alertMatchViews,
      actions: actionViews,
      managedControls: {
        aimed_at_me: { feature: 'aimedAtMe', locked: aimedAtMe.locked, setEnabled: aimedAtMe.set },
        open_questions: { feature: 'unansweredQuestions', locked: unansweredQuestions.locked, setEnabled: unansweredQuestions.set },
      },
      ruleBadge: (rule) => (
        <Show when={ruleUnread(rule.id)}>
          <RuleBadge title={`${ruleUnread(rule.id)} unread alerts`}>{ruleUnread(rule.id)}</RuleBadge>
        </Show>
      ),
      activity: (rule) => ruleUnread(rule.id) ? `${ruleUnread(rule.id)} unread alerts` : null,
    },
  },
);
