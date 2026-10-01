// Tags' panel, message menu, channel range action, person section and rule views.
import { defineRendererPlugin } from '@plugin-sdk/renderer';
import { channelById, channelLabel, isThread, type MenuItem } from '@plugin-sdk/renderer/kit';
import { plugin } from '../shared';
import { TagsPanel } from './TagsPanel';
import { PersonTags } from './PersonTags';
import { ruleViews } from './rules';
import { templates } from './templates';
import { customTags, tags, setMessageTag, startNewTag, openTagRange } from './state';

export default defineRendererPlugin(
  plugin,
  {
    panels: { tags: { view: TagsPanel } },
    personSections: { tags: { Component: PersonTags } },
    messageMenu: {
      tags: {
        heading: 'Tags',
        // Toggles and New tag… change tags: desktop windows only.
        calls: ['setMessageTag', 'createTag'],
        menu: (m) => {
          // Your tags, toggled by hand; a hand choice outranks Jev's.
          const items: MenuItem[] = tags().map((t) => {
            const on = m.labels.some((l) => l.pluginId === plugin.manifest.id && l.key === String(t.id));
            return {
              label: t.name,
              icon: 'tag',
              checked: on,
              run: () => setMessageTag(m.id, t.id, !on),
            };
          });
          items.push({
            label: 'New tag…',
            icon: 'plus',
            run: startNewTag,
          });
          return items;
        },
      },
    },
    channels: {
      // The range runner: desktop windows only.
      calls: ['tagRangeCount', 'tagRange'],
      jevItems: (c) => {
        if (!customTags.on()) return [];
        // The range runner covers threads through their parent channel.
        const parent = isThread(c) && c.parentId ? channelById(c.parentId) : undefined;
        return [{
          label: 'Tag messages in this channel…',
          icon: 'tag',
          ...(parent ? { detail: `In ${channelLabel(parent)}, with its threads` } : {}),
          run: () => openTagRange(parent?.id ?? c.id),
        }];
      },
    },
    rules: ruleViews,
    ruleTemplates: templates,
    jevFeatures: {
      customTags: {
        group: 'Messages & search',
        hint: 'Tags from the Tags panel that have a Jev question: Jev applies them to new messages (tags set to do so) and to ranges you pick. Manual tags work without this.',
        perMessage: '1 question per message for each tag set to tag new messages',
      },
    },
  },
);
