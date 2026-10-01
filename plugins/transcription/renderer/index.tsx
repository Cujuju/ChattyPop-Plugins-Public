// Transcription's renderer side: Settings → Transcription, and Transcribe in a message's right-click menu.
import { defineRendererPlugin } from '@plugin-sdk/renderer';
import { openSettingsAt, type MenuItem } from '@plugin-sdk/renderer/kit';
import { TRANSCRIPTION_TAB, TRANSCRIPT_NOTE, plugin } from '../shared';
import { requestTranscript, transcriptionReady } from './state';
import { TranscriptionSection } from './TranscriptionSection';

export default defineRendererPlugin(plugin, {
  settings: { [TRANSCRIPTION_TAB]: { body: TranscriptionSection } },
  messageMenu: {
    transcribe: {
      // Desktop windows only: the phone can't request a transcript or open Settings.
      calls: ['request'],
      // Audio with no transcript yet (or a failed one); before setup, the item leads to Settings.
      menu: (m, scope) => {
        const items: MenuItem[] = [];
        for (const a of scope.drawsAttachments ? m.attachments : []) {
          const state = a.notes.find((n) => n.pluginId === plugin.manifest.id && n.kind === TRANSCRIPT_NOTE)?.state;
          if (!(a.contentType ?? '').startsWith('audio/') || (state && state !== 'failed')) continue;
          const label = state === 'failed' ? 'Transcribe again' : 'Transcribe';
          // Rejects only when setup was removed after the menu opened.
          items.push(
            transcriptionReady()
              ? { label, icon: 'waveform', run: () => requestTranscript(a.id).catch(() => openSettingsAt(TRANSCRIPTION_TAB)) }
              : { label: 'Set up transcription…', icon: 'settings', run: () => openSettingsAt(TRANSCRIPTION_TAB) },
          );
        }
        return items;
      },
    },
  },
});
