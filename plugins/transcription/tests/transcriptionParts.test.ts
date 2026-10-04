// Transcripts of every audio and video part: video attachments, embeds' videos, per-kind automatic switches, notes and
// derived text by part.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { attachmentFileName } from '@shared/media';
import { VOICE_MESSAGE_FLAG } from '@shared/discord';
import { MS_PER_MIN } from '@shared/units';
import type { Archive } from '@core/archive';
import { registerPartNotes } from '@core/attachmentNotes';
import { ARRIVAL } from '@core/arrival';
import type { Db } from '@core/db';
import { storeDerivedText } from '@core/derivedText';
import { attachmentStored } from '@core/mediaQueue';
import { messageParts, partKey } from '@core/messageParts';
import { adoptBundledData } from '@core/plugins/adoption';
import { migratePlugin } from '@core/plugins/api';
import { archivePayloads } from '@core/plugins/archivePayloads';
import { messagePage } from '@core/queries/messages';
import { testPlugin } from '@plugin-sdk/core/testing';
import { fakeModel, fakeTool, nextTs, rawMessage, seedArchive, tempDb, tempDir } from '@chattypop/host-testing';
import { DEFAULT_TRANSCRIPTION_SETTINGS, normalizeTranscriptionSettings, type AutoKind, type TranscriptMediaRequest, type TranscriptionSettings } from '../shared/types';
import transcriptionShared from '../shared';
import transcriptionCore from '../core';
import { JOBS_TABLE, TRANSCRIPTION_MIGRATIONS } from '../core/schema';
import { transcriptNotes } from '../core/store';
import { Toolchain } from '../core/toolchain';
import { Transcriber } from '../core/transcriber';
import type { TranscriptResult } from '../core/whisper';

const MODEL = 'ggml-base.bin';
/** An FxTwitter post's video, as Discord's media proxy serves it (an embed's video.proxy_url). */
const PROXIED_VIDEO = 'https://images-ext-1.discordapp.net/external/abc/https/api.fxtwitter.com/2/go';

let db: Db;
let archive: Archive;
let settings: TranscriptionSettings;
let fetches: TranscriptMediaRequest[];
let spoken: Map<string, string>;
let attachmentsDir: string;
let transcriber: Transcriber;

const fakeRun = async (_tools: unknown, _model: string, input: string): Promise<TranscriptResult> => {
  const text = spoken.get(input);
  if (text === undefined) throw new Error('whisper-cli failed: bad audio');
  return { text, language: 'ja', segments: [{ fromMs: 0, toMs: 1000, text }] };
};

/** Automatic transcription of `kinds` only, covering what was sent from a minute ago. */
const autoFor = (...kinds: AutoKind[]): TranscriptionSettings => {
  const d = DEFAULT_TRANSCRIPTION_SETTINGS;
  const since = Date.now() - MS_PER_MIN;
  return {
    model: MODEL,
    auto: { voice: kinds.includes('voice'), audio: kinds.includes('audio'), video: kinds.includes('video'), embedVideo: kinds.includes('embedVideo') },
    since: { ...d.since, ...Object.fromEntries(kinds.map((k) => [k, since])) },
  };
};

beforeEach(() => {
  db = tempDb();
  adoptBundledData(db, [transcriptionShared]);
  migratePlugin(db, 'transcription', TRANSCRIPTION_MIGRATIONS);
  registerPartNotes('transcription', 0, (ids) => transcriptNotes(db, ids));
  archive = seedArchive(db, [{ id: 'c1' }]);
  fetches = [];
  spoken = new Map();
  settings = autoFor();
  attachmentsDir = tempDir();
  const toolsDir = tempDir();
  fakeTool(toolsDir, 'ffmpeg', 'bin');
  fakeTool(toolsDir, 'whisper-cli', 'Release');
  fakeModel(toolsDir, MODEL);
  const toolchain = new Toolchain(toolsDir, () => undefined, () => Promise.reject(new Error('offline')));
  const reads = { payloads: (ids: readonly string[]) => archivePayloads(db, ids), parts: (ids: readonly string[]) => messageParts(db, ids) };
  transcriber = new Transcriber(db, reads, toolchain, () => settings, attachmentsDir, join(toolsDir, 'work'), {
    changed: () => undefined,
    fetchAudio: (r) => void fetches.push(r),
    // As core settles it: derived text under the job's key, naming its part.
    settled: (s) => void (s.ok && storeDerivedText(db, s.messageId, `transcription:${s.key}`, s.seq, s.text, s.record, s.part)),
  }, fakeRun);
});

/** A message with one attachment of `contentType`, stored on disk with `speech` unless `store` is false. */
function withAttachment(contentType: string, filename: string, speech: string, o: { voice?: boolean; store?: boolean } = {}): { messageId: string; attachmentId: string } {
  const ts = nextTs();
  const attachmentId = `a${ts}`;
  const m = rawMessage('c1', ts, '', { flags: o.voice ? VOICE_MESSAGE_FLAG : 0, attachments: [{ id: attachmentId, filename, content_type: contentType, url: `https://cdn.example/${attachmentId}` }] });
  archive.ingestMessages([m], ARRIVAL.gateway);
  if (o.store !== false) {
    const hash = `${'b'.repeat(64)}${m.id}`.slice(-64);
    mkdirSync(join(attachmentsDir, hash.slice(0, 2)), { recursive: true });
    const path = join(attachmentsDir, hash.slice(0, 2), attachmentFileName(hash, filename));
    writeFileSync(path, '');
    spoken.set(path, speech);
    attachmentStored(db, attachmentId, hash, 0);
  }
  return { messageId: m.id, attachmentId };
}

/** A message whose embed shows a video (`type` rich: a fetched post; gifv: a GIF). */
function withEmbedVideo(type = 'rich'): string {
  const m = rawMessage('c1', nextTs(), 'https://fxtwitter.com/a/status/1', {
    embeds: [{ type, url: 'https://fxtwitter.com/a/status/1', description: 'a post', video: { url: 'https://api.fxtwitter.com/2/go', proxy_url: PROXIED_VIDEO, width: 640, height: 360 } }],
  } as never);
  archive.ingestMessages([m], ARRIVAL.gateway);
  return m.id;
}

const job = (messageId: string) =>
  db.prepare(`SELECT seq, part_key AS part, kind, state, text, error FROM ${JOBS_TABLE} WHERE message_id = ?`).get(messageId) as
    { seq: number; part: string; kind: string; state: string; text: string | null; error: string | null } | undefined;
const settle = (): Promise<void> => vi.waitFor(() => expect(transcriber.busy).toBe(false));
/** Main downloads the requested media, which says `speech`. */
const download = (r: TranscriptMediaRequest, speech: string): void => {
  mkdirSync(join(r.path, '..'), { recursive: true });
  writeFileSync(r.path, '');
  spoken.set(r.path, speech);
};

describe("an embed's video", () => {
  it('is fetched by main through the media proxy and transcribed; its note and derived text are of its part', async () => {
    settings = autoFor('embedVideo');
    const messageId = withEmbedVideo();
    transcriber.shown(messageId);
    await vi.waitFor(() => expect(fetches).toHaveLength(1));
    expect(fetches[0]).toMatchObject({ kind: 'embed', url: PROXIED_VIDEO });
    expect(job(messageId)).toMatchObject({ part: partKey.embed(PROXIED_VIDEO), kind: 'video', state: 'fetching' });
    download(fetches[0]!, 'こんにちは');
    transcriber.audioFetched(fetches[0]!.requestId, null);
    await vi.waitFor(() => expect(job(messageId)?.state).toBe('done'));
    const part = partKey.embed(PROXIED_VIDEO);
    expect(db.prepare('SELECT source, part, text FROM derived_texts WHERE message_id = ?').all(messageId)).toEqual([
      { source: `transcription:job-${job(messageId)!.seq}`, part, text: 'こんにちは' },
    ]);
    const [m] = messagePage(db, { channelId: 'c1', limit: 10 });
    expect(m?.embeds[0]?.notes).toEqual([{ pluginId: 'transcription', part, kind: 'transcript', state: 'done', label: 'video transcription · ja', text: 'こんにちは' }]);
  });

  it('fails with the reason when main cannot fetch it', async () => {
    const messageId = withEmbedVideo();
    transcriber.request(messageId, partKey.embed(PROXIED_VIDEO));
    await vi.waitFor(() => expect(fetches).toHaveLength(1));
    transcriber.audioFetched(fetches[0]!.requestId, 'HTTP 404');
    expect(job(messageId)).toMatchObject({ state: 'failed', error: 'It could not be downloaded: HTTP 404' });
  });

  it("a GIF's is not transcribed, on request or automatically", async () => {
    settings = autoFor('embedVideo');
    const messageId = withEmbedVideo('gifv');
    transcriber.shown(messageId);
    await settle();
    expect(job(messageId)).toBeUndefined();
    expect(() => transcriber.request(messageId, null)).toThrow('no audio or video');
  });
});

describe('a video attachment', () => {
  it('is transcribed automatically once stored while video files are on', async () => {
    settings = autoFor('video');
    const { messageId, attachmentId } = withAttachment('video/mp4', 'clip.mp4', 'from the clip');
    transcriber.attachmentStored(attachmentId);
    await settle();
    expect(job(messageId)).toMatchObject({ part: partKey.attachment(attachmentId), kind: 'video', state: 'done', text: 'from the clip' });
    expect(db.prepare('SELECT source, part FROM derived_texts WHERE message_id = ?').get(messageId)).toEqual({ source: `transcription:${attachmentId}`, part: partKey.attachment(attachmentId) });
  });

  it('keeps its message pending while its file downloads', () => {
    settings = autoFor('video');
    const { messageId } = withAttachment('video/mp4', 'clip.mp4', '', { store: false });
    expect(transcriber.due(messageId)).toBe(true);
    settings = autoFor('voice');
    expect(transcriber.due(messageId)).toBe(false);
  });
});

describe('automatic transcription per kind', () => {
  it('queues each kind only while its switch is on, and only what was sent since', async () => {
    settings = autoFor('voice');
    const audio = withAttachment('audio/mpeg', 'song.mp3', 'la la');
    const video = withAttachment('video/mp4', 'clip.mp4', 'hi');
    const embed = withEmbedVideo();
    const voice = withAttachment('audio/ogg', 'voice-message.ogg', 'hello', { voice: true });
    for (const id of [audio, video, voice]) transcriber.attachmentStored(id.attachmentId);
    transcriber.shown(embed);
    await settle();
    expect([audio, video, voice].map((a) => job(a.messageId)?.state)).toEqual([undefined, undefined, 'done']);
    expect(job(embed)).toBeUndefined();
    // Audio files turned on now: earlier ones are left for requests.
    settings = { ...autoFor('voice', 'audio'), since: { ...autoFor().since, voice: settings.since.voice, audio: Date.now() + MS_PER_MIN } };
    transcriber.attachmentStored(audio.attachmentId);
    await settle();
    expect(job(audio.messageId)).toBeUndefined();
    settings = autoFor('audio');
    transcriber.attachmentStored(audio.attachmentId);
    await settle();
    expect(job(audio.messageId)?.state).toBe('done');
  });

  it('reads settings saved before per-kind switches as voice messages', () => {
    expect(normalizeTranscriptionSettings({ autoVoice: false, autoSince: 123, model: MODEL })).toEqual({
      auto: { ...DEFAULT_TRANSCRIPTION_SETTINGS.auto, voice: false },
      since: { ...DEFAULT_TRANSCRIPTION_SETTINGS.since, voice: 123 },
      model: MODEL,
    });
    expect(normalizeTranscriptionSettings({ autoSince: 5 }).auto.voice).toBe(DEFAULT_TRANSCRIPTION_SETTINGS.auto.voice);
  });
});

describe('the plugin', () => {
  it('stamps when each kind turned on, and refuses a request that names no message part', async () => {
    const before = Date.now();
    const saved = { ...autoFor('video', 'embedVideo'), since: { ...DEFAULT_TRANSCRIPTION_SETTINGS.since, video: 5 } };
    const t = testPlugin(transcriptionCore, { preferences: { settings: saved } });
    onTestFinished(() => t.dispose());
    const since = t.preferences.get('settings').since;
    expect(since.video).toBe(5);
    expect(since.embedVideo).toBeGreaterThanOrEqual(before);
    expect([since.voice, since.audio]).toEqual([null, null]);
    await expect(t.client('renderer').request(5 as never, null)).rejects.toThrow('Not a message part');
  });
});
