// Settings → Transcription and transcripts in the Archive: the toolchain status core pushes, and the owner's requests.
import { STATUS_EVENT, plugin } from '../shared';
import type { AutoKind, ToolBuild, TranscriptionStatus } from '../shared/types';
import { desktopCoreClient, onEvent, pluginPreference, pluginResource } from '@plugin-sdk/renderer';

/** Installing and requesting: Settings → Transcription's and the attachment menu's calls, served to desktop windows only. */
const desktop = desktopCoreClient(plugin);

export const [transcriptionSettings, setTranscriptionSettings, { patch: patchTranscriptionSettings }] = pluginPreference(plugin, 'settings');

/** Loaded while this window may call core's status; a failed load reads as unknown (null). */
const status = pluginResource(plugin, 'status', () => [], null);
onEvent(plugin, STATUS_EVENT, (s) => status.mutate(s));
/** Looks for the programs again (e.g. after installing one outside ChattyPop). */
export const recheckTranscription = (): Promise<void> => status.refetch();

export const transcriptionStatus = (): TranscriptionStatus | null => status();
/** Programs and the chosen model are installed. */
export const transcriptionReady = (): boolean => transcriptionStatus()?.ready ?? false;

export const installTranscriptionItem = (id: string, build: ToolBuild | null = null): Promise<void> => desktop.install(id, build);
export const cancelTranscriptionItem = (id: string): Promise<void> => desktop.cancel(id);
export const deleteTranscriptionModel = (id: string): Promise<void> => desktop.deleteModel(id);
/** Every audio and video part of the message not transcribed or in progress. */
export const requestTranscripts = (messageId: string): Promise<void> => desktop.request(messageId, null);

/** Turning a kind's automatic transcription on starts from now: core stamps the time when its `since` is empty. */
export function setAuto(kind: AutoKind, on: boolean): void {
  const s = transcriptionSettings();
  patchTranscriptionSettings({ auto: { ...s.auto, [kind]: on }, since: { ...s.since, [kind]: null } });
}
