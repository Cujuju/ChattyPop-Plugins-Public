// Transcription queue, tools and derived-text integration.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEvent } from '@shared/contract';
import { attachmentFileName } from '@shared/media';
import { VOICE_MESSAGE_FLAG } from '@shared/discord';
import { MS_PER_MIN } from '@shared/units';
import type { Archive } from '@core/archive';
import { registerAttachmentNotes } from '@core/attachmentNotes';
import { ARRIVAL, type Arrival } from '@core/arrival';
import type { Db } from '@core/db';
import { storeDerivedText } from '@core/derivedText';
import { attachmentStored } from '@core/mediaQueue';
import { adoptBundledData } from '@core/plugins/adoption';
import { archivePayloads } from '@core/plugins/archivePayloads';
import { messagePage } from '@core/queries/messages';
import { addedTextArrival, textMessage } from '@core/queries/messageText';
import { searchMessages } from '@core/queries/search';
import type { RuleMatcher } from '@core/rules/matcher';
import type { RuleService } from '@core/rules/ruleService';
import { fakeModel, fakeTool, hostRuleStack, nextTs, rawMessage, ruleInput, runsOf, seedArchive, tempDb, tempDir } from '@chattypop/host-testing';
import type { TranscriptAudioRequest, TranscriptionSettings } from '../shared/types';
import transcriptionShared from '../shared';
import { JOBS_TABLE } from '../core/schema';
import { transcriptNotes } from '../core/store';
import { Toolchain } from '../core/toolchain';
import { Transcriber, type TranscriberEvents, type TranscriptSettled } from '../core/transcriber';
import type { TranscriptResult } from '../core/whisper';

const MODEL = 'ggml-base.bin';
const SHA = 'a'.repeat(64);

let db: Db;
let archive: Archive;
let watcher: RuleMatcher;
let events: AppEvent[];
/** fetchAudio requests the transcriber sent main, and messages whose notes changed. */
let fetches: TranscriptAudioRequest[];
let notesChanged: string[];
let settings: TranscriptionSettings;
let spoken: Map<string, string>;
let attachmentsDir: string;
let transcriber: Transcriber;
/** What each Transcriber here is built with, as the plugin's setup builds it. */
let toolchain: Toolchain;
let io: TranscriberEvents;
let workDir: string;
let rules: RuleService;
let attachmentSeq = 0;

/** Fake whisper: the "speech" of each input file is set per test. */
const fakeRun = async (_tools: unknown, _model: string, input: string): Promise<TranscriptResult> => {
  const text = spoken.get(input);
  if (text === undefined) throw new Error('whisper-cli failed: bad audio');
  return { text, language: 'en', segments: [{ fromMs: 0, toMs: 1000, text }] };
};

/** Installs fake programs and a model so the toolchain reports ready. */
function installFakes(toolsDir: string): void {
  fakeTool(toolsDir, 'ffmpeg', 'bin');
  fakeTool(toolsDir, 'whisper-cli', 'Release');
  fakeModel(toolsDir, MODEL);
}

beforeEach(() => {
  db = tempDb();
  adoptBundledData(db, [transcriptionShared]);
  registerAttachmentNotes('transcription', 0, (ids) => transcriptNotes(db, ids));
  events = [];
  fetches = [];
  notesChanged = [];
  spoken = new Map();
  settings = { autoVoice: true, autoSince: Date.now() - MS_PER_MIN, model: MODEL };
  const emit = (e: AppEvent): void => void events.push(e);
  // As core wires it: every message text through the host's rules.
  ({ matcher: watcher, rules } = hostRuleStack(db, emit, () => null));
  archive = seedArchive(db, [{ id: 'c1' }], { onText: (m, a) => watcher.check(m, a) });
  const toolsDir = tempDir();
  installFakes(toolsDir);
  attachmentsDir = tempDir();
  toolchain = new Toolchain(
    toolsDir,
    () => undefined,
    () => Promise.reject(new Error('offline')),
  );
  // As the plugin and host wire it: a finished transcript is derived text for its message (an edit to the rules).
  const settled = (s: TranscriptSettled): void => {
    if (!s.ok) return;
    storeDerivedText(db, s.messageId, `transcription:${s.attachmentId}`, s.seq, s.text, s.record);
    const m = textMessage(db, s.messageId);
    if (m) watcher.check(m, addedTextArrival(db, s.messageId, s.requestedAt));
  };
  io = {
    changed: (id: string) => void notesChanged.push(id),
    fetchAudio: (r: TranscriptAudioRequest) => void fetches.push(r),
    settled,
  };
  workDir = join(toolsDir, 'work');
  transcriber = new Transcriber(db, (ids) => archivePayloads(db, ids), toolchain, () => settings, attachmentsDir, workDir, io, fakeRun);
});

/** A fake content hash, distinct per message. */
const sha = (messageId: string): string => (SHA + messageId).slice(-64);

/** A message with one audio attachment, stored on disk with `speech`; `voice` sets Discord's voice-message flag. */
function voiceMessage(
  speech: string | null,
  o: { voice?: boolean; ts?: number; content?: string; store?: boolean; seconds?: number; via?: Arrival } = {},
): { messageId: string; attachmentId: string } {
  const ts = o.ts ?? nextTs();
  const attachmentId = `a${++attachmentSeq}`;
  const m = rawMessage('c1', ts, o.content ?? '', {
    flags: o.voice === false ? 0 : VOICE_MESSAGE_FLAG,
    attachments: [
      {
        id: attachmentId,
        filename: 'voice-message.ogg',
        content_type: 'audio/ogg',
        url: `https://cdn.example/${attachmentId}`,
        duration_secs: o.seconds,
      },
    ],
  });
  archive.ingestMessages([m], o.via ?? ARRIVAL.gateway);
  if (o.store !== false) {
    const hash = sha(m.id);
    mkdirSync(join(attachmentsDir, hash.slice(0, 2)), { recursive: true });
    const path = join(attachmentsDir, hash.slice(0, 2), attachmentFileName(hash, 'voice-message.ogg'));
    writeFileSync(path, '');
    if (speech !== null) spoken.set(path, speech);
    attachmentStored(db, attachmentId, hash, 0);
  }
  return { messageId: m.id, attachmentId };
}

const transcript = (attachmentId: string) =>
  db.prepare(`SELECT state, text, priority, error FROM ${JOBS_TABLE} WHERE attachment_id = ?`).get(attachmentId) as
    { state: string; text: string | null; priority: number; error: string | null } | undefined;
/** Queued work is done once the drain loop stops; it starts synchronously, so absence of work is visible at once. */
const settle = (): Promise<void> => vi.waitFor(() => expect(transcriber.busy).toBe(false));

describe('automatic transcription', () => {
  it('transcribes a new voice message once stored', async () => {
    const { attachmentId } = voiceMessage('hello there');
    transcriber.attachmentStored(attachmentId);
    await settle();
    expect(transcript(attachmentId)).toMatchObject({ state: 'done', text: 'hello there', priority: 0 });
  });

  it('skips audio that is not a voice message, and voice messages sent before it was turned on', async () => {
    const plain = voiceMessage('song', { voice: false });
    const old = voiceMessage('old news', { ts: settings.autoSince! - 1 });
    transcriber.attachmentStored(plain.attachmentId);
    transcriber.attachmentStored(old.attachmentId);
    await settle();
    expect(transcript(plain.attachmentId)).toBeUndefined();
    expect(transcript(old.attachmentId)).toBeUndefined();
  });

  it('stops with the plugin: a job cut off settles nothing, and runs once when the plugin is back on', async () => {
    const { attachmentId, messageId } = voiceMessage('hello');
    transcriber.dispose();
    let started = 0;
    const hang: NonNullable<ConstructorParameters<typeof Transcriber>[7]> = (
      _tools,
      _model,
      _input,
      _workDir,
      signal,
    ) => {
      started++;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    };
    const off = new Transcriber(db, (ids) => archivePayloads(db, ids), toolchain, () => settings, attachmentsDir, workDir, io, hang);
    off.attachmentStored(attachmentId);
    await vi.waitFor(() => expect(started).toBe(1));
    off.dispose();
    await vi.waitFor(() => expect(off.busy).toBe(false));
    expect(transcript(attachmentId)?.state).toBe('running'); // left for the next start
    expect(textMessage(db, messageId)?.content).not.toContain('hello');
    const on = new Transcriber(db, (ids) => archivePayloads(db, ids), toolchain, () => settings, attachmentsDir, workDir, io, fakeRun);
    on.kick();
    await vi.waitFor(() => expect(on.busy).toBe(false));
    expect(transcript(attachmentId)).toMatchObject({ state: 'done', text: 'hello' });
    expect(started).toBe(1);
  });

  it('does nothing when switched off', async () => {
    settings = { ...settings, autoVoice: false };
    const { attachmentId } = voiceMessage('hi');
    transcriber.attachmentStored(attachmentId);
    await settle();
    expect(transcript(attachmentId)).toBeUndefined();
  });
});

describe('requested transcription', () => {
  it('transcribes any audio attachment, however old, and records a failure', async () => {
    const old = voiceMessage('from last year', { ts: Date.UTC(2025, 0, 1) });
    const broken = voiceMessage(null);
    transcriber.request(old.attachmentId);
    transcriber.request(broken.attachmentId);
    await settle();
    expect(transcript(old.attachmentId)).toMatchObject({ state: 'done', text: 'from last year', priority: 1 });
    expect(transcript(broken.attachmentId)).toMatchObject({ state: 'failed', error: 'whisper-cli failed: bad audio' });
  });

  it('asks main for audio the store no longer holds, then transcribes what it fetched', async () => {
    const { attachmentId } = voiceMessage(null, { ts: Date.UTC(2025, 0, 1), store: false });
    transcriber.request(attachmentId);
    await settle();
    expect(transcript(attachmentId)?.state).toBe('fetching');
    const ask = fetches[0];
    expect(ask).toMatchObject({ attachmentId, url: `https://cdn.example/${attachmentId}` });
    mkdirSync(join(ask!.path, '..'), { recursive: true });
    writeFileSync(ask!.path, '');
    spoken.set(ask!.path, 'fetched again');
    transcriber.audioFetched(ask!.requestId, null);
    await settle();
    expect(transcript(attachmentId)).toMatchObject({ state: 'done', text: 'fetched again' });
  });

  it('refuses before setup, and only audio', () => {
    const { attachmentId } = voiceMessage('x');
    expect(() => transcriber.request('missing')).toThrow('Only audio');
    settings = { ...settings, model: null };
    expect(() => transcriber.request(attachmentId)).toThrow('Set up transcription');
  });
});

describe('transcripts reach search, rules and the Archive', () => {
  it('search finds spoken words, listing a message once', async () => {
    const { attachmentId, messageId } = voiceMessage('meet at the lighthouse', { content: 'lighthouse plans' });
    transcriber.request(attachmentId);
    await settle();
    const hits = searchMessages(db, 'lighthouse', 10);
    expect(hits.map((h) => h.messageId)).toEqual([messageId]);
    expect(searchMessages(db, 'meet', 10).map((h) => h.messageId)).toEqual([messageId]);
  });

  it('a rule matches a transcript, and editing the rule keeps that run', async () => {
    const hits = join(tempDir(), 'hits.md');
    const watchFor = (name: string) =>
      ruleInput([{ id: 'file', type: 'file', config: { path: hits, format: 'markdown' } }], {
        match: { text: { pattern: 'boat', spec: null } },
        gates: { missed: true },
        name,
      });
    const id = rules.create(watchFor('boat'));
    // Sent after the rule was made, so the host fires it; an older message's history is the alerts plugin's.
    const { attachmentId, messageId } = voiceMessage('the boat leaves at noon');
    transcriber.request(attachmentId);
    await settle();
    const matched = () => runsOf({ rules }, id).map(([m]) => m);
    expect(matched()).toEqual([messageId]);
    expect(readFileSync(hits, 'utf8')).toContain('the boat leaves at noon');
    rules.update(id, watchFor('boats'));
    expect(matched()).toEqual([messageId]);
  });

  it('the Archive shows the transcript on its attachment', async () => {
    const { attachmentId } = voiceMessage('see you soon');
    transcriber.request(attachmentId);
    await settle();
    const [m] = messagePage(db, { channelId: 'c1', limit: 10 });
    expect(m?.attachments[0]?.notes).toEqual([
      { pluginId: 'transcription', kind: 'transcript', state: 'done', label: 'transcript · en', text: 'see you soon' },
    ]);
    expect(notesChanged).toContain(m?.id);
  });
});
