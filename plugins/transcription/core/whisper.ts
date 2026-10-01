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

/** Any input ffmpeg reads (Discord voice messages are Ogg Opus); video streams are dropped. */
export const ffmpegArgs = (input: string, wav: string): string[] => [
  '-nostdin',
  '-hide_banner',
  '-loglevel',
  'error',
  '-i',
  input,
  '-vn',
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
    await run(tools.ffmpeg, ffmpegArgs(input, wav), signal);
    await run(tools['whisper-cli'], whisperArgs(model, wav, out), signal);
    return parseWhisperJson(await readFile(`${out}.json`, 'utf8'));
  } finally {
    await rm(dir, { recursive: true, force: true });
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
      else reject(new Error(`${basename(command)} failed: ${last || `exit code ${code}`}`));
    });
  });
}
