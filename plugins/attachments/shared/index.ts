import { defineChannels, definePlugin, definePreference } from '@plugin-sdk/shared';
import type { AttachmentsCoreCalls } from './types';

export const ATTACHMENTS_PANEL = 'attachments';

export const plugin = definePlugin({
  manifest: { id: 'attachments', name: 'Attachments', version: '1.0.0', description: 'Browse archived files, see what uses disk space, compress media and delete local copies.' },
  channels: defineChannels<{ core: AttachmentsCoreCalls }>()({
    core: {
      page: { audiences: ['renderer'], writes: false },
      totals: { audiences: ['renderer'], writes: false },
      breakdown: { audiences: ['renderer'], writes: false },
      places: { audiences: ['renderer'], writes: false },
      sharedBy: { audiences: ['renderer'], writes: false },
    },
  }),
  panels: [{
    id: ATTACHMENTS_PANEL, title: 'Attachments', importance: 'secondary', dialog: true, after: 'links',
    iconPath: 'M21 11.5l-8.5 8.5a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.5-8.5',
  }],
  shortcuts: [{ key: 'f', hint: 'files', after: 'l' }],
  slots: {
    personTabs: [{ id: 'files', after: 'links' }],
    attachmentMenu: [{ id: 'compress', after: 'download' }, { id: 'free', after: 'attachments.compress' }],
  },
  preferences: {
    view: definePreference<'grid' | 'list'>({ default: 'grid', normalize: (v) => v === 'list' ? 'list' : 'grid' }),
    breakdown: definePreference<boolean>({ default: false, normalize: (v) => v === true }),
  },
});
export default plugin;
