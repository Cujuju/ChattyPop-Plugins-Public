// Transcription's core side: the queue and toolchain, transcripts as derived text and attachment notes, and the calls Settings, the message menu and main make.
import { defineCorePlugin } from '@plugin-sdk/core';
import { FETCH_AUDIO, STATUS_EVENT, plugin } from '../shared';
import { setupTranscription } from './setup';
import { transcriptNotes } from './store';
import { newTranscriptionSession } from './transcriber';

/** Downloads main is making, installs and the scratch folder: kept for the core process across off and on. */
const session = newTranscriptionSession();

export default defineCorePlugin(plugin, (ctx) => {
  const t = setupTranscription({
    db: ctx.storage.db,
    payloads: ctx.archive.payloads,
    toolsDir: ctx.storage.dataDir,
    fetch: ctx.net.fetch,
    attachmentsDir: ctx.archive.attachmentsDir,
    session,
    lifetime: ctx.lifetime.signal,
    reports: {
      dispatch: (requestId, send) => ctx.completions.dispatch('audioFetched', String(requestId), send),
      withdraw: (requestId) => ctx.completions.withdraw('audioFetched', String(requestId)),
    },
    settings: { get: () => ctx.preferences.get('settings'), set: (v) => ctx.preferences.set('settings', v) },
    statusChanged: (status) => ctx.channels.emit(STATUS_EVENT, status),
    events: {
      changed: (messageId) => ctx.archive.attachmentNotes.changed([messageId]),
      fetchAudio: (request) => ctx.channels.emit(FETCH_AUDIO, request),
      // A transcript is its message's derived text, read after the content in the order its job was queued.
      settled: (s) =>
        s.ok
          ? ctx.archive.derivedText.settle(s.messageId, { key: s.attachmentId, order: s.seq, text: s.text, queuedAt: s.requestedAt }, s.record)
          : ctx.archive.derivedText.settle(s.messageId, null),
    },
  });
  ctx.archive.derivedText.provide({ pending: (messageId) => t.due(messageId) });
  ctx.archive.attachmentNotes.provide((ids) => transcriptNotes(ctx.storage.db, ids));
  ctx.archive.onAttachmentStored((id) => t.attachmentStored(id));
  ctx.preferences.onChange('settings', () => t.settingChanged());
  ctx.channels.serve(t.calls);
  // Main's download reports are handled while off too: audio it fetched is kept for the job.
  ctx.completions.handle('audioFetched', { key: (requestId) => String(requestId) }, ([requestId, error], f) =>
    t.audioFetched(requestId, error, { db: f.db, failed: (messageId) => f.settle(messageId, null) }),
  );
  return () => t.dispose();
});
