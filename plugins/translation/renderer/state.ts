// Settings → Translation and the message menu: the model and queue status from core, the settings, and the owner's requests.
import { STATUS_EVENT, plugin } from '../shared';
import type { TranslatePick, TranslationStatus } from '../shared/types';
import { coreClient, onEvent, pluginPreference, pluginResource } from '@plugin-sdk/renderer';
import { providerStatus } from '@plugin-sdk/renderer/kit';

/** Requests from Settings → Translation and the message menu, served to desktop and phone windows. */
const core = coreClient(plugin);

export const [translationSettings, , { patch: patchTranslationSettings }] = pluginPreference(plugin, 'settings');

/** Loaded while this window may call core's status; a failed load reads as unknown (null). */
const status = pluginResource(
  plugin,
  'status',
  () => {
    // Readiness follows the chosen model, and the providers' models (one just installed): re-read when either changes.
    translationSettings();
    providerStatus();
    return [];
  },
  null,
);
// The event carries no status: read it again.
onEvent(plugin, STATUS_EVENT, () => void status.refetch());

export const translationStatus = (): TranslationStatus | null => status();

/** Translates every part of the message with text, with `pick` or Settings' model (null). */
export const translateMessage = (messageId: string, pick: TranslatePick | null): Promise<void> => core.translate(messageId, pick);
export const retryFailedTranslations = (): Promise<void> => core.retryFailed();
