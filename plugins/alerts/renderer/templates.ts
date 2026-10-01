// Alert rule starting points.
import { newPluginAction, type RuleTemplate } from '@plugin-sdk/shared';
import { plugin } from '../shared';

/** The threshold a new yes/no question starts at: Jev at least as sure as not. */
const DEFAULT_YES_PROBABILITY = 0.5;

// Alert rules take missed messages too: an alert is how the owner catches up on what came while ChattyPop was closed.
/** Views of the descriptor's rule templates, by local id. */
export const templates = {
  words: {
    title: 'Alert me about words',
    flow: ['Keywords', 'Alert'],
    hint: 'Words or phrases you pick, in the channels you pick.',
    make: () =>
      ({
        match: [{ type: 'text', config: { pattern: '', spec: null } }],
        actions: [newPluginAction(plugin, 'alerts.notify')],
        missed: true,
      }),
  },
  subject: {
    title: 'Alert me about a subject',
    flow: ['Meaning · Jev', 'Alert'],
    hint: 'Describe it in plain words; Jev finds messages about it without your keywords.',
    make: () => ({ actions: [newPluginAction(plugin, 'alerts.notify')], missed: true }),
  },
  jev: {
    title: 'Ask Jev about each message',
    flow: ['Jev question', 'Alert'],
    hint: 'A yes/no, pick-one or score question, e.g. “Does it announce a sale?”',
    make: () =>
      ({
        match: [
          {
            type: 'jev',
            config: { type: 'noul', question: '', yes: '', no: '', minProbability: DEFAULT_YES_PROBABILITY },
          },
        ],
        actions: [newPluginAction(plugin, 'alerts.notify')],
        missed: true,
      }),
  },
} satisfies Readonly<Record<string, RuleTemplate>>;
