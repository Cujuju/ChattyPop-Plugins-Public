import { defineChannels, definePlugin, definePreference } from '@plugin-sdk/shared';
import type { AttachmentsCoreCalls } from './types';

export const ATTACHMENTS_PANEL = 'attachments';
/**
 * How much a tile's picture grows under the pointer; 1 is off. The most: a 128px tile at 512px, half a wide dialog; the
 * grid holds each zoom inside itself anyway. A quarter step reads as a change on a tile.
 */
export const HOVER_ZOOM = { min: 1, max: 4, step: 0.25 } as const;
const DEFAULT_HOVER_ZOOM = 1.5;
/** A typed or stored zoom on the field's steps and within its range; anything else is the default. */
export const hoverZoomOf = (v: unknown): number => typeof v === 'number' && Number.isFinite(v)
  ? Math.min(HOVER_ZOOM.max, Math.max(HOVER_ZOOM.min, Math.round(v / HOVER_ZOOM.step) * HOVER_ZOOM.step))
  : DEFAULT_HOVER_ZOOM;

export const plugin = definePlugin({
  manifest: { id: 'attachments', name: 'Attachments', version: '1.9.0', description: 'Browse archived files, see what uses disk space, compress media and delete local copies.' },
  channels: defineChannels<{ core: AttachmentsCoreCalls }>()({
    core: {
      page: { audiences: ['renderer'], writes: false },
      totals: { audiences: ['renderer'], writes: false },
      people: { audiences: ['renderer'], writes: false },
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
    hoverZoom: definePreference<number>({ default: DEFAULT_HOVER_ZOOM, normalize: hoverZoomOf }),
  },
});
export default plugin;
