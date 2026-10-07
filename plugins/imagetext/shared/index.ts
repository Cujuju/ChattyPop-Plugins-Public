// Reads message images locally into part-specific derived text consumed by rules, Jev, Trading labels, search, and Translation.
import { defineChannels, definePlugin, definePreference } from '@plugin-sdk/shared';
import { decodeNoArgs, decodeRequest } from './calls';
import { DEFAULT_IMAGE_TEXT_SETTINGS, normalizeImageTextSettings, type EnginePick, type ImageFetchRequest, type ImageTextStatus } from './types';

export const manifest = {
  id: 'imagetext',
  name: 'Image text',
  version: '1.7.3',
  description: 'Reads the text in screenshots and charts on this computer, so rules, Jev, labels and search see it.',
};

/** Settings tab id. */
export const IMAGE_TEXT_TAB = 'imagetext' as const;
/** Plugin event: queue counts or an engine's state changed; payload ImageTextStatus. */
export const STATUS_EVENT = 'status' as const;
/** Core → main: download an image the store doesn't hold (ImageFetchRequest); main answers with imageFetched. */
export const FETCH_IMAGE = 'fetchImage' as const;
/** AttachmentNote.kind of an image's text. */
export const IMAGE_TEXT_NOTE = 'image-text';
/** Maximum concurrent main-process image downloads. Further jobs wait for completion reports. */
export const IMAGE_FETCHES_MAX = 4;

/** Core's calls: from Settings and the message menu, and main's answer to FETCH_IMAGE. */
export interface ImageTextCoreCalls {
  /** Engines, vision models and the queue. */
  status(): Promise<ImageTextStatus>;
  /** Prioritizes rereading all message images with pick or Settings' engine. Throws if the engine is unavailable. */
  request(messageId: string, pick: EnginePick | null): void;
  /** Queues again every image that failed. */
  retryFailed(): void;
  /** Main's answer to FETCH_IMAGE `requestId`: the image is at the requested path, or `error`. */
  imageFetched(requestId: number, error: string | null): void;
}

export interface ImageTextEvents {
  [STATUS_EVENT]: null;
  [FETCH_IMAGE]: ImageFetchRequest;
}

export const plugin = definePlugin({
  manifest,
  channels: defineChannels<{ core: ImageTextCoreCalls; events: ImageTextEvents }>()({
    core: {
      status: { audiences: ['renderer', 'phone'], writes: false, decode: decodeNoArgs },
      request: { audiences: ['renderer', 'phone'], writes: true, decode: decodeRequest },
      retryFailed: { audiences: ['renderer', 'phone'], writes: true, decode: decodeNoArgs },
      imageFetched: { audiences: ['main'], completion: { max: IMAGE_FETCHES_MAX } },
    },
    events: { [STATUS_EVENT]: ['renderer', 'phone'], [FETCH_IMAGE]: ['main'] },
  }),
  settings: [
    // A picture: its frame, a hill line and the sun.
    { id: IMAGE_TEXT_TAB, label: 'Image text', tab: { after: 'summaries', iconPath: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M16 9.5a1.5 1.5 0 1 0-.01 0' } },
  ],
  /** Settings → Image text. */
  preferences: { settings: definePreference({ default: DEFAULT_IMAGE_TEXT_SETTINGS, normalize: normalizeImageTextSettings }) },
  slots: { messageMenu: [{ id: 'readImages', after: 'copy' }] },
});
export default plugin;
