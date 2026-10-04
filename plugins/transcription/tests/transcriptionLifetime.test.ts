// Transcription across off and on: a retired activation's continuations, main's download reports, and installs.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { VOICE_MESSAGE_FLAG } from '@shared/discord';
import { MS_PER_MIN } from '@shared/units';

/** The next mkdir waits for `release`: an activation turned off while it awaits. */
const io = vi.hoisted(() => ({ hold: null as Promise<void> | null, extract: null as Promise<void> | null, log: [] as string[] }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...fs,
    mkdir: async (...args: Parameters<typeof fs.mkdir>) => {
      const held = io.hold;
      io.hold = null;
      await held;
      return fs.mkdir(...args);
    },
  };
});
// Downloads land at once; unpacking waits for `io.extract` and, like tar close to its end, finishes whatever the signal says.
vi.mock('../core/download', () => ({
  downloadVerified: async (_d: unknown, dest: string) => {
    io.log.push('download');
    mkdirSync(join(dest, '..'), { recursive: true });
    writeFileSync(dest, 'zip');
  },
  extractZip: async (_zip: string, dir: string) => {
    await io.extract;
    const { exeName } = await import('@core/ai/resolveCli');
    writeFileSync(join(dir, exeName('ffmpeg')), '');
    io.log.push('unpacked');
  },
}));

const { ARRIVAL } = await import('@core/arrival');
const { adoptBundledData } = await import('@core/plugins/adoption');
const { migratePlugin } = await import('@core/plugins/api');
const { messageParts } = await import('@core/messageParts');
const { archivePayloads } = await import('@core/plugins/archivePayloads');
const { IS_WINDOWS } = await import('@core/ai/resolveCli');
const transcriptionShared = (await import('../shared')).default;
const { AUDIO_FETCHES_MAX } = await import('../shared');
const { DEFAULT_TRANSCRIPTION_SETTINGS } = await import('../shared/types');
const transcriptionCore = (await import('../core')).default;
const { JOBS_TABLE, TRANSCRIPTION_MIGRATIONS } = await import('../core/schema');
const { Toolchain } = await import('../core/toolchain');
const { DOWNLOAD_REPORT_MAX_MS, Transcriber, newTranscriptionSession } = await import('../core/transcriber');
const { fakeModel, fakeTool, rawMessage, seedArchive, tempDb, tempDir } = await import('@chattypop/host-testing');
const { testPlugin } = await import('@plugin-sdk/core/testing');
type TranscriberEvents = import('../core/transcriber').TranscriberEvents;
type TranscriptMediaRequest = import('../shared/types').TranscriptMediaRequest;
type TranscriptResult = import('../core/whisper').TranscriptResult;

const MODEL = 'ggml-base.bin';

describe('the transcript queue across off and on', () => {
  let db: ReturnType<typeof tempDb>;
  let attachmentId: string;
  let fetches: TranscriptMediaRequest[];
  let events: TranscriberEvents;
  let toolchain: InstanceType<typeof Toolchain>;
  let workDir: string;
  const spoken = new Map<string, string>();
  const run = async (_tools: unknown, _model: string, input: string): Promise<TranscriptResult> => {
    const text = spoken.get(input) ?? 'unknown';
    return { text, language: 'en', segments: [{ fromMs: 0, toMs: 1, text }] };
  };
  const settings = () => ({ ...DEFAULT_TRANSCRIPTION_SETTINGS, auto: { ...DEFAULT_TRANSCRIPTION_SETTINGS.auto, voice: false }, model: MODEL });
  const messageOf = (id: string): string => db.prepare('SELECT message_id FROM archive_all_attachments WHERE id = ?').pluck().get(id) as string;
  const state = () => db.prepare(`SELECT state FROM ${JOBS_TABLE} WHERE attachment_id = ?`).pluck().get(attachmentId);
  /** A transcriber for one activation, sharing the core process's session. */
  const activation = (session: ReturnType<typeof newTranscriptionSession>, lifetime: AbortController, on: TranscriberEvents = events) =>
    new Transcriber(db, { payloads: (ids) => archivePayloads(db, ids), parts: (ids) => messageParts(db, ids) }, toolchain, settings, tempDir(), workDir, on, run, session, lifetime.signal);
  /** Main downloads the requested audio. */
  const download = (r: TranscriptMediaRequest, text: string): void => {
    mkdirSync(join(r.path, '..'), { recursive: true });
    writeFileSync(r.path, '');
    spoken.set(r.path, text);
  };

  beforeEach(() => {
    db = tempDb();
    adoptBundledData(db, [transcriptionShared]);
    migratePlugin(db, 'transcription', TRANSCRIPTION_MIGRATIONS);
    attachmentId = `a${Date.now()}`;
    // A voice message whose audio the store doesn't hold: main downloads it for the job.
    seedArchive(db, [{ id: 'c1' }]).ingestMessages([rawMessage('c1', Date.now() - MS_PER_MIN, '', {
      flags: VOICE_MESSAGE_FLAG,
      attachments: [{ id: attachmentId, filename: 'voice-message.ogg', content_type: 'audio/ogg', url: `https://cdn.example/${attachmentId}` }],
    })], ARRIVAL.gateway);
    fetches = [];
    events = { changed: () => undefined, fetchAudio: (r) => void fetches.push(r), settled: (s) => void (s.ok && s.record()) };
    const toolsDir = tempDir();
    fakeTool(toolsDir, 'ffmpeg', 'bin');
    fakeTool(toolsDir, 'whisper-cli', 'Release');
    fakeModel(toolsDir, MODEL);
    toolchain = new Toolchain(toolsDir, () => undefined, () => Promise.reject(new Error('offline')));
    workDir = join(toolsDir, 'work');
  });

  it("never rewrites a job the next activation finished, when the retired one's await returns", async () => {
    const session = newTranscriptionSession();
    let release!: () => void;
    io.hold = new Promise((r) => (release = r));
    const oldLife = new AbortController();
    const old = activation(session, oldLife);
    old.request(messageOf(attachmentId), null);
    oldLife.abort();
    old.dispose();
    const fresh = activation(session, new AbortController());
    fresh.kick();
    await vi.waitFor(() => expect(fetches).toHaveLength(1));
    download(fetches[0]!, 'hello');
    fresh.audioFetched(fetches[0]!.requestId, null);
    await vi.waitFor(() => expect(state()).toBe('done'));
    release();
    await vi.waitFor(() => expect(old.busy).toBe(false));
    expect(state()).toBe('done');
  });

  it('finishes a job from a download main reports after the plugin was turned off and on, without asking again', async () => {
    const session = newTranscriptionSession();
    const oldLife = new AbortController();
    const old = activation(session, oldLife);
    old.request(messageOf(attachmentId), null);
    await vi.waitFor(() => expect(fetches).toHaveLength(1));
    oldLife.abort();
    old.dispose();
    const fresh = activation(session, new AbortController());
    fresh.kick();
    await vi.waitFor(() => expect(fresh.busy).toBe(false));
    expect(state()).toBe('fetching');
    download(fetches[0]!, 'reported late');
    fresh.audioFetched(fetches[0]!.requestId, null);
    await vi.waitFor(() => expect(state()).toBe('done'));
    expect(fetches).toHaveLength(1);
    expect(db.prepare(`SELECT text FROM ${JOBS_TABLE} WHERE attachment_id = ?`).pluck().get(attachmentId)).toBe('reported late');
  });

  it('ignores a report of a download it never asked for', async () => {
    const t = activation(newTranscriptionSession(), new AbortController());
    t.request(messageOf(attachmentId), null);
    await vi.waitFor(() => expect(fetches).toHaveLength(1));
    t.audioFetched(fetches[0]!.requestId + 1, 'from an earlier run');
    expect(state()).toBe('fetching');
  });

  it('fails a job whose download main never reports at its deadline, and ignores a report after it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const settled: boolean[] = [];
      const t = activation(newTranscriptionSession(), new AbortController(), { ...events, settled: (s) => void settled.push(s.ok) });
      t.request(messageOf(attachmentId), null);
      await vi.waitFor(() => expect(fetches).toHaveLength(1));
      await vi.advanceTimersByTimeAsync(DOWNLOAD_REPORT_MAX_MS);
      expect(state()).toBe('failed');
      expect(settled).toEqual([false]);
      download(fetches[0]!, 'too late');
      t.audioFetched(fetches[0]!.requestId, null);
      expect(state()).toBe('failed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails an unreported download at its deadline through the activation running by then', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const session = newTranscriptionSession();
      const oldLife = new AbortController();
      const old = activation(session, oldLife);
      old.request(messageOf(attachmentId), null);
      await vi.waitFor(() => expect(fetches).toHaveLength(1));
      oldLife.abort();
      old.dispose();
      const settled: boolean[] = [];
      activation(session, new AbortController(), { ...events, settled: (s) => void settled.push(s.ok) });
      await vi.advanceTimersByTimeAsync(DOWNLOAD_REPORT_MAX_MS);
      expect(state()).toBe('failed');
      expect(settled).toEqual([false]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks main for at most AUDIO_FETCHES_MAX downloads at once; a report lets the next one go', async () => {
    const more = Array.from({ length: AUDIO_FETCHES_MAX }, (_, i) => `${attachmentId}-${i}`);
    seedArchive(db, [{ id: 'c1' }]).ingestMessages(more.map((id, i) => rawMessage('c1', Date.now() - MS_PER_MIN + i + 1, '', {
      flags: VOICE_MESSAGE_FLAG,
      attachments: [{ id, filename: 'voice-message.ogg', content_type: 'audio/ogg', url: `https://cdn.example/${id}` }],
    })), ARRIVAL.gateway);
    const t = activation(newTranscriptionSession(), new AbortController());
    for (const id of [attachmentId, ...more]) t.request(messageOf(id), null);
    await vi.waitFor(() => expect(fetches).toHaveLength(AUDIO_FETCHES_MAX));
    await vi.waitFor(() => expect(t.busy).toBe(false));
    expect(fetches).toHaveLength(AUDIO_FETCHES_MAX);
    t.audioFetched(fetches[0]!.requestId, 'gone');
    await vi.waitFor(() => expect(fetches).toHaveLength(AUDIO_FETCHES_MAX + 1));
  });

  it("takes main's download report while the plugin is off", async () => {
    const t = testPlugin(transcriptionCore);
    onTestFinished(() => t.dispose());
    await t.off();
    await expect(t.client('main').audioFetched(1, null)).resolves.toBeUndefined();
  });
});

describe.runIf(IS_WINDOWS)('a program install when the plugin turns off while unpacking', () => {
  const ffmpeg = (t: InstanceType<typeof Toolchain>) => t.status(null).tools.find((x) => x.id === 'ffmpeg')?.state;
  const toolchainIn = (dir: string, installs: Map<string, Promise<void>>) => new Toolchain(dir, () => undefined, () => Promise.reject(new Error('unused')), installs);

  it('installs nothing', async () => {
    const dir = tempDir();
    const installs = new Map<string, Promise<void>>();
    let unpack!: () => void;
    io.extract = new Promise((r) => (unpack = r));
    const old = toolchainIn(dir, installs);
    old.install('ffmpeg', 'cpu');
    await vi.waitFor(() => expect(ffmpeg(old)).toBe('installing'));
    old.dispose();
    unpack();
    await vi.waitFor(() => expect(ffmpeg(old)).not.toBe('installing'));
    expect(existsSync(join(dir, 'ffmpeg'))).toBe(false);
  });

  it("starts the next activation's install only after the retired one cleaned up", async () => {
    const dir = tempDir();
    const installs = new Map<string, Promise<void>>();
    let unpack!: () => void;
    io.extract = new Promise((r) => (unpack = r));
    io.log.length = 0;
    const old = toolchainIn(dir, installs);
    old.install('ffmpeg', 'cpu');
    await vi.waitFor(() => expect(ffmpeg(old)).toBe('installing'));
    old.dispose();
    const fresh = toolchainIn(dir, installs);
    fresh.install('ffmpeg', 'cpu');
    unpack();
    await vi.waitFor(() => expect(installs.size).toBe(0));
    expect(io.log).toEqual(['download', 'unpacked', 'download', 'unpacked']);
    expect(existsSync(join(dir, 'ffmpeg', 'build.txt'))).toBe(true);
  });
});
