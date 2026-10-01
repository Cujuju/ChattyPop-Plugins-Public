// Plans' renderer side: the Plans & decisions panel and its unseen count on the top bar.
import { defineRendererPlugin } from '@plugin-sdk/renderer';
import { PLANS_PANEL, plugin } from '../shared';
import { PlansPanel } from './PlansPanel';
import { markPlansSeen, unseenPlanCount } from './state';

export default defineRendererPlugin(plugin, {
  panels: { [PLANS_PANEL]: { view: PlansPanel, unread: { count: unseenPlanCount, markSeen: markPlansSeen } } },
  jevFeatures: {
    planDetection: {
      group: 'Messages & search',
      hint: 'Jev spots plans and decisions; your AI provider extracts the details.',
      perMessage: '1 question per message, plus an AI-provider call per plan',
    },
  },
});
