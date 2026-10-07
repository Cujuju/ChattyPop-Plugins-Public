// Settings → Image text and the message menu: engine and queue status from core, the settings, and the owner's requests.
import { STATUS_EVENT, plugin } from '../shared';
import type { EnginePick, ImageTextStatus } from '../shared/types';
import { coreClient, onEvent, pluginPreference, pluginResource } from '@plugin-sdk/renderer';
import { providerStatus } from '@plugin-sdk/renderer/kit';

/** Requests from Settings → Image text and the message menu, served to desktop and phone windows. */
const core = coreClient(plugin);

export const [imageTextSettings, , { patch: patchImageTextSettings }] = pluginPreference(plugin, 'settings');

/** Loaded while this window may call core's status; a failed load reads as unknown (null). */
const status = pluginResource(
  plugin,
  'status',
  () => {
    // Engine readiness follows the chosen engine and model, and the providers' models (one just installed): re-read
    // when either changes.
    imageTextSettings();
    providerStatus();
    return [];
  },
  null,
);
// The event carries no status: read it again.
onEvent(plugin, STATUS_EVENT, () => void status.refetch());

export const imageTextStatus = (): ImageTextStatus | null => status();

/** Reads the message's images again with pick, or Settings' engine (null). */
export const requestImageText = (messageId: string, pick: EnginePick | null): Promise<void> => core.request(messageId, pick);
export const retryFailedImageText = (): Promise<void> => core.retryFailed();
