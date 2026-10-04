// Transcription's renderer side: Settings → Transcription, and Transcribe in a message's right-click menu.
import { defineRendererPlugin } from '@plugin-sdk/renderer';
import { embedVideoHasSound, mediaKind, type AttachmentNote } from '@plugin-sdk/shared';
import { openSettingsAt, type MenuItem } from '@plugin-sdk/renderer/kit';
import { TRANSCRIPTION_TAB, TRANSCRIPT_NOTE, plugin } from '../shared';
import { requestTranscripts, transcriptionReady } from './state';
import { TranscriptionSection } from './TranscriptionSection';

export default defineRendererPlugin(plugin, {
  settings: { [TRANSCRIPTION_TAB]: { body: TranscriptionSection } },
  messageMenu: {
    transcribe: {
      // Desktop windows only: the phone can't request a transcript or open Settings.
      calls: ['request'],
      // A message's audio and video with no transcript yet (or a failed one); before setup, the item leads to Settings.
      menu: (m, scope) => {
        if (!scope.drawsAttachments) return [];
        const transcript = (notes: readonly AttachmentNote[]) => notes.find((n) => n.pluginId === plugin.manifest.id && n.kind === TRANSCRIPT_NOTE)?.state;
        const attachments = m.attachments.filter((a) => mediaKind(a) === 'audio' || mediaKind(a) === 'video').map((a) => transcript(a.notes));
        const embeds = m.embeds.filter((e) => e.videoUrl && embedVideoHasSound(e.type)).map((e) => transcript(e.notes ?? []));
        const open = [...attachments, ...embeds].filter((state) => !state || state === 'failed');
        if (!open.length) return [];
        if (!transcriptionReady()) return [{ label: 'Set up transcription…', icon: 'settings', run: () => openSettingsAt(TRANSCRIPTION_TAB) }];
        const label = open.every((state) => state === 'failed') ? 'Transcribe again' : 'Transcribe';
        // Rejects only when setup was removed after the menu opened.
        const item: MenuItem = { label, icon: 'waveform', run: () => requestTranscripts(m.id).catch(() => openSettingsAt(TRANSCRIPTION_TAB)) };
        return [item];
      },
    },
  },
});
