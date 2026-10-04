// Transcription's core side: the queue and toolchain, transcripts as derived text and notes on their parts, and the calls Settings, the message menu and main make.
import { defineCorePlugin } from '@plugin-sdk/core';
import { FETCH_AUDIO, STATUS_EVENT, plugin } from '../shared';
import { TRANSCRIPTION_MIGRATIONS } from './schema';
import { setupTranscription } from './setup';
import { transcriptNotes, transcriptParts } from './store';
import { newTranscriptionSession } from './transcriber';

/** Downloads main is making, installs and the scratch folder: kept for the core process across off and on. */
const session = newTranscriptionSession();

export default defineCorePlugin(plugin, (ctx) => {
  ctx.storage.migrate(TRANSCRIPTION_MIGRATIONS);
  ctx.archive.derivedText.tagParts(transcriptParts(ctx.storage.db));
  const t = setupTranscription({
    db: ctx.storage.db,
    archive: { payloads: ctx.archive.payloads, parts: (ids) => ctx.archive.parts.of(ids) },
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
      changed: (messageId) => ctx.archive.notes.changed([messageId]),
      fetchAudio: (request) => ctx.channels.emit(FETCH_AUDIO, request),
      // A transcript is its message's derived text of its part, read after the content in the order its job was queued.
      settled: (s) =>
        s.ok
          ? ctx.archive.derivedText.settle(s.messageId, { key: s.key, order: s.seq, text: s.text, queuedAt: s.requestedAt, part: s.part }, s.record)
          : ctx.archive.derivedText.settle(s.messageId, null),
    },
  });
  ctx.archive.derivedText.provide({ pending: (messageId) => t.due(messageId) });
  ctx.archive.notes.provide((ids) => transcriptNotes(ctx.storage.db, ids));
  ctx.archive.onAttachmentStored((id) => t.attachmentStored(id));
  ctx.archive.parts.onShown((messageId) => t.shown(messageId));
  ctx.preferences.onChange('settings', () => t.settingChanged());
  ctx.channels.serve(t.calls);
  // Main's download reports are handled while off too: media it fetched is kept for the job.
  ctx.completions.handle('audioFetched', { key: (requestId) => String(requestId) }, ([requestId, error], f) =>
    t.audioFetched(requestId, error, { db: f.db, failed: (messageId) => f.settle(messageId, null) }),
  );
  return () => t.dispose();
});
