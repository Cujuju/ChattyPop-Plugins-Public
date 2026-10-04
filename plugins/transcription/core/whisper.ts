// One transcription: ffmpeg decodes the audio to 16 kHz mono WAV, whisper-cli writes JSON segments.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { basename, join } from 'node:path';
import type { ToolPaths } from './toolchain';

/** whisper.cpp reads 16 kHz mono PCM only. */
const WHISPER_SAMPLE_RATE = 16_000;
/** The end of a program's error output kept for the failure message. */
const STDERR_TAIL_CHARS = 2000;
/** The input's first audio stream: a video's sound. */
const AUDIO_STREAM = '0:a:0';
/** ffmpeg's error when AUDIO_STREAM is absent (a video without sound), as ffmpeg 8.0 words it. */
const NO_AUDIO_STREAM = /matches no streams/;
/** A transcript's failure when its media has no sound to transcribe. */
export const NO_SOUND = 'no sound';

export interface TranscriptSegment {
  fromMs: number;
  toMs: number;
  text: string;
}

export interface TranscriptResult {
  text: string;
  /** As whisper detected it; null when not reported. */
  language: string | null;
  segments: TranscriptSegment[];
}

/** Any input ffmpeg reads (voice messages are Ogg Opus, videos MP4 or WebM): its first audio stream only. */
export const ffmpegArgs = (input: string, wav: string): string[] => [
  '-nostdin',
  '-hide_banner',
  '-loglevel',
  'error',
  '-i',
  input,
  '-map',
  AUDIO_STREAM,
  '-ac',
  '1',
  '-ar',
  String(WHISPER_SAMPLE_RATE),
  '-c:a',
  'pcm_s16le',
  '-y',
  wav,
];

/** Language auto-detected; one thread per core; JSON written to `<outBase>.json`; progress output off. */
export const whisperArgs = (model: string, wav: string, outBase: string): string[] => [
  '-m',
  model,
  '-f',
  wav,
  '-l',
  'auto',
  '-t',
  String(availableParallelism()),
  '-oj',
  '-of',
  outBase,
  '-np',
];

/** whisper-cli's `-oj` output: `result.language` and `transcription[]` with `offsets` in ms. */
export function parseWhisperJson(json: string): TranscriptResult {
  const v = JSON.parse(json) as { result?: { language?: unknown }; transcription?: { offsets?: { from?: unknown; to?: unknown }; text?: unknown }[] };
  const segments = (Array.isArray(v.transcription) ? v.transcription : [])
    .map((s) => ({ fromMs: Number(s.offsets?.from) || 0, toMs: Number(s.offsets?.to) || 0, text: typeof s.text === 'string' ? s.text.trim() : '' }))
    .filter((s) => s.text);
  return { text: segments.map((s) => s.text).join(' '), language: typeof v.result?.language === 'string' ? v.result.language : null, segments };
}

/** Transcribes `input` in a scratch folder under `workDir`, removed afterwards. */
export async function transcribe(tools: ToolPaths, model: string, input: string, workDir: string, signal: AbortSignal): Promise<TranscriptResult> {
  const dir = await mkdtemp(join(workDir, 'job-'));
  try {
    const wav = join(dir, 'audio.wav');
    const out = join(dir, 'transcript');
    await run(tools.ffmpeg, ffmpegArgs(input, wav), signal).catch((err: unknown) => {
      throw err instanceof ProgramFailed && NO_AUDIO_STREAM.test(err.stderr) ? new Error(NO_SOUND) : err;
    });
    await run(tools['whisper-cli'], whisperArgs(model, wav, out), signal);
    return parseWhisperJson(await readFile(`${out}.json`, 'utf8'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A program exited with an error; `stderr`: the end of its error output. */
class ProgramFailed extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
  }
}

function run(command: string, args: string[], signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, signal, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (b: Buffer) => (stderr = (stderr + b.toString()).slice(-STDERR_TAIL_CHARS)));
    child.on('error', reject);
    child.on('close', (code) => {
      const last = stderr.trim().split(/\r?\n/).pop();
      if (code === 0) resolve();
      else reject(new ProgramFailed(`${basename(command)} failed: ${last || `exit code ${code}`}`, stderr));
    });
  });
}
