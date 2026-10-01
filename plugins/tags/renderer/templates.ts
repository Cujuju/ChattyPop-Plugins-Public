// The tag rule starting point.
import { newPluginAction, type RuleTemplate } from '@plugin-sdk/shared';
import { plugin } from '../shared';

/** Views of the descriptor's rule templates, by local id. */
export const templates = {
  tags: {
    title: 'Tag messages',
    flow: ['Keywords or content', 'Tag'],
    hint: 'Put one of your tags on matching messages.',
    make: () => ({
      actions: [newPluginAction(plugin, 'tags.apply')],
      missed: true,
    }),
  },
} satisfies Readonly<Record<string, RuleTemplate>>;
