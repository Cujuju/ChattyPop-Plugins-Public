import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IS_WINDOWS, exeName, findExecutable } from '@core/ai/resolveCli';
import type { PluginFetch } from '@core/plugins/net';
import { MODELS } from '../core/catalog';
import { downloadVerified } from '../core/download';
import { Toolchain } from '../core/toolchain';
import { NO_SOUND, ffmpegArgs, parseWhisperJson, transcribe, whisperArgs } from '../core/whisper';
import { fakeModel, fakeTool, tempDir } from '@chattypop/host-testing';

const bytes = Buffer.from('model weights');
const download = { url: 'https://example.test/model.bin', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
const serve = (body: Buffer): PluginFetch => async () => new Response(new Uint8Array(body));
/** For toolchains these tests never download with. */
const offline: PluginFetch = () => Promise.reject(new Error('offline'));
const never = new AbortController().signal;

describe('verified downloads', () => {
  it('moves a file into place only after its size and checksum match', async () => {
    const dest = join(tempDir(), 'models', 'model.bin');
    const progress: number[] = [];
    await downloadVerified(download, dest, (f) => progress.push(f), never, serve(bytes));
    expect(readFileSync(dest)).toEqual(bytes);
    expect(progress.at(-1)).toBe(1);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });

  it('discards a download that fails its checksum', async () => {
    const dest = join(tempDir(), 'model.bin');
    await expect(downloadVerified(download, dest, () => undefined, never, serve(Buffer.from('model weightz')))).rejects.toThrow('checksum');
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });

  it('resumes a dropped download from where it stopped', async () => {
    const dest = join(tempDir(), 'model.bin');
    const cut = 5;
    await expect(downloadVerified(download, dest, () => undefined, never, serve(bytes.subarray(0, cut)))).rejects.toThrow('incomplete');
    expect(readFileSync(`${dest}.part`)).toEqual(bytes.subarray(0, cut));
    let range: string | null = null;
    const ranged = (async (_url: string, init?: RequestInit) => {
      range = new Headers(init?.headers).get('Range');
      return new Response(new Uint8Array(bytes.subarray(cut)), { status: 206 });
    }) as typeof fetch;
    await downloadVerified(download, dest, () => undefined, never, ranged);
    expect(range).toBe(`bytes=${cut}-`);
    expect(readFileSync(dest)).toEqual(bytes);
  });

  it('starts over when the server ignores the range, and a cancel leaves nothing', async () => {
    const dest = join(tempDir(), 'model.bin');
    await expect(downloadVerified(download, dest, () => undefined, never, serve(bytes.subarray(0, 5)))).rejects.toThrow('incomplete');
    await downloadVerified(download, dest, () => undefined, never, serve(bytes)); // 200 with the whole file
    expect(readFileSync(dest)).toEqual(bytes);

    const other = join(tempDir(), 'model.bin');
    const abort = new AbortController();
    abort.abort();
    await expect(downloadVerified(download, other, () => undefined, abort.signal, serve(bytes))).rejects.toThrow();
    expect(existsSync(`${other}.part`)).toBe(false);
  });
});

describe('toolchain', () => {
  let dir: string;
  let pathDir: string;
  beforeEach(() => {
    dir = tempDir();
    pathDir = tempDir();
    vi.stubEnv('PATH', pathDir);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is ready only with both programs and the chosen model', () => {
    const t = new Toolchain(dir, () => undefined, offline);
    const model = MODELS[0]!.id;
    expect(t.status(model).ready).toBe(false);
    fakeTool(dir, 'whisper-cli', 'Release');
    writeFileSync(join(pathDir, exeName('ffmpeg')), '');
    fakeModel(dir, model);
    const s = t.status(model);
    expect(s.ready).toBe(true);
    expect(s.tools.map((x) => [x.id, x.state, x.source])).toEqual([
      ['ffmpeg', 'ready', 'path'],
      ['whisper-cli', 'ready', 'app'],
    ]);
    expect(s.models.find((m) => m.id === model)?.state).toBe('ready');
    expect(s.models.map((m) => m.score)).toEqual(MODELS.map((m) => m.score));
    expect(s.tools.map((x) => x.score)).toEqual([null, null]);
    expect(t.status(MODELS[1]!.id).ready).toBe(false);
  });

  it.runIf(IS_WINDOWS)('offers whisper.cpp as GPU and CPU builds, and reports which is installed', () => {
    const t = new Toolchain(dir, () => undefined, offline);
    const whisper = () => t.status(null).tools.find((x) => x.id === 'whisper-cli')!;
    expect(whisper().builds.map((b) => b.build).sort()).toEqual(['cpu', 'gpu']);
    expect(t.status(null).tools.find((x) => x.id === 'ffmpeg')!.builds.map((b) => b.build)).toEqual(['cpu']);
    expect(() => t.install('ffmpeg', 'gpu')).toThrow('no gpu build');
    fakeTool(dir, 'whisper-cli');
    expect(whisper().build).toBe('cpu'); // no marker: an older install, the CPU build
    writeFileSync(join(dir, 'whisper-cli', 'build.txt'), 'gpu');
    expect(whisper()).toMatchObject({ state: 'ready', source: 'app', build: 'gpu' });
  });

  it('downloads a model in the background, reporting progress and failure', async () => {
    const changes: number[] = [];
    const t = new Toolchain(dir, () => changes.push(1), serve(Buffer.from('not the model')));
    const model = MODELS[0]!.id;
    t.install(model, null);
    expect(t.status(model).models[0]?.state).toBe('downloading');
    await vi.waitFor(() => expect(t.status(model).models[0]?.state).toBe('failed'));
    const item = t.status(model).models[0]!;
    expect(item.error).toMatch(/incomplete|checksum/);
    expect(changes.length).toBeGreaterThan(0);
  });
});

describe('whisper', () => {
  it('decodes to 16 kHz mono WAV and asks whisper for JSON with the language detected', () => {
    expect(ffmpegArgs('in.ogg', 'out.wav')).toEqual(expect.arrayContaining(['-i', 'in.ogg', '-ac', '1', '-ar', '16000', 'out.wav']));
    const args = whisperArgs('model.bin', 'out.wav', 'result');
    expect(args).toEqual(expect.arrayContaining(['-m', 'model.bin', '-f', 'out.wav', '-l', 'auto', '-oj', '-of', 'result']));
  });

  it('reads segments and language from its JSON', () => {
    const json = JSON.stringify({
      result: { language: 'en' },
      transcription: [
        { offsets: { from: 0, to: 1500 }, text: ' Hello there.' },
        { offsets: { from: 1500, to: 3000 }, text: ' ' },
        { offsets: { from: 3000, to: 4200 }, text: ' See you soon.' },
      ],
    });
    expect(parseWhisperJson(json)).toEqual({
      text: 'Hello there. See you soon.',
      language: 'en',
      segments: [
        { fromMs: 0, toMs: 1500, text: 'Hello there.' },
        { fromMs: 3000, toMs: 4200, text: 'See you soon.' },
      ],
    });
  });
});

/** ffmpeg on PATH, to check what the pinned build is asked to do on real files; skipped without one. */
const FFMPEG = findExecutable('ffmpeg');

describe.runIf(FFMPEG)('ffmpeg on videos', () => {
  /** A one-second MP4 made by ffmpeg's own sources: a test picture, with a tone when `sound`. */
  const video = (sound: boolean): string => {
    const path = join(tempDir(), sound ? 'sound.mp4' : 'silent.mp4');
    const tone = sound ? ['-f', 'lavfi', '-i', 'sine=duration=1', '-c:a', 'aac'] : [];
    const made = spawnSync(FFMPEG!, ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=64x64:rate=10', ...tone, '-c:v', 'mpeg4', '-shortest', '-y', path]);
    expect(made.status).toBe(0);
    return path;
  };

  it("decodes a video's sound to WAV", () => {
    const wav = join(tempDir(), 'out.wav');
    expect(spawnSync(FFMPEG!, ffmpegArgs(video(true), wav)).status).toBe(0);
    expect(existsSync(wav)).toBe(true);
  });

  it('fails a video without sound as no sound', async () => {
    const tools = { ffmpeg: FFMPEG!, 'whisper-cli': 'never-run' };
    await expect(transcribe(tools, 'model.bin', video(false), tempDir(), never)).rejects.toThrow(NO_SOUND);
  });
});
