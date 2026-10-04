import type { ModelScore } from '../shared/types';

// Pinned downloads for local transcription. Every file is verified by SHA-256 before use; bump a pin by replacing
// its URL, size and hash together (hashes: Hugging Face tree API lfs.oid, GitHub release asset digest).

export interface Download {
  url: string;
  bytes: number;
  sha256: string;
}

export interface ModelEntry extends Download {
  /** Also the stored file name. */
  id: string;
  label: string;
  description: string;
  score: ModelScore;
}

/** ggerganov/whisper.cpp model repo revision (2026-09-25); resolve/<revision> URLs never change content. */
const HF_REVISION = '5359861c739e955e79d9a303bcbc70fb988958b1';
const hf = (file: string): string => `https://huggingface.co/ggerganov/whisper.cpp/resolve/${HF_REVISION}/${file}`;

// Scores, measured 2026-09-25 with whisper.cpp b5130 run exactly as ChattyPop runs it (-l auto):
// - accuracy: 100 − mean word error rate of 100 AMI meeting utterances (ihm test, casual speech) and 99 LibriSpeech
//   test-other utterances (3 per speaker, read speech). Lowercased, punctuation and fillers (um, uh, mm…) removed.
// - speed: seconds of voice message per second of wall time over real Discord voice messages (20 on GPU, 6 on CPU),
//   one run per message with ffmpeg decode and model load included. RTX 3090 (gpu) / Ryzen 9 5950X, 32 threads (cpu).
// Speeds are that PC's; other hardware differs. Rounded to two significant figures.
/** Multilingual models only (language is auto-detected), smallest first. */
export const MODELS: readonly ModelEntry[] = [
  { id: 'ggml-base.bin', label: 'Base', description: 'Smallest and least accurate; fine for clear speech.', score: { accuracy: 78, speed: { gpu: 23, cpu: 9.8 } }, url: hf('ggml-base.bin'), bytes: 147951465, sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe' },
  { id: 'ggml-small.bin', label: 'Small', description: 'A little more accurate than Base.', score: { accuracy: 81, speed: { gpu: 16, cpu: 4 } }, url: hf('ggml-small.bin'), bytes: 487601967, sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b' },
  { id: 'ggml-medium-q5_0.bin', label: 'Medium (quantized)', description: 'Clearly more accurate than Small, but slow.', score: { accuracy: 86, speed: { gpu: 10, cpu: 1.7 } }, url: hf('ggml-medium-q5_0.bin'), bytes: 539212467, sha256: '19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f' },
  { id: 'ggml-large-v3-turbo-q5_0.bin', label: 'Turbo (quantized)', description: 'Recommended: as accurate as Large, and fast.', score: { accuracy: 88, speed: { gpu: 20, cpu: 1.8 } }, url: hf('ggml-large-v3-turbo-q5_0.bin'), bytes: 574041195, sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2' },
  { id: 'ggml-large-v3-turbo.bin', label: 'Turbo', description: 'Same accuracy as Turbo (quantized); three times the download.', score: { accuracy: 88, speed: { gpu: 14, cpu: 1.5 } }, url: hf('ggml-large-v3-turbo.bin'), bytes: 1624555275, sha256: '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69' },
  { id: 'ggml-large-v3-q5_0.bin', label: 'Large (quantized)', description: 'As accurate as Turbo, and much slower.', score: { accuracy: 88, speed: { gpu: 6.8, cpu: 0.8 } }, url: hf('ggml-large-v3-q5_0.bin'), bytes: 1081140203, sha256: 'd75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1' },
];

export type ToolId = 'ffmpeg' | 'whisper-cli';

export interface ToolEntry {
  id: ToolId;
  label: string;
  description: string;
  /** Executable inside the zip (found by name, since archive layouts differ). */
  exe: string;
  /** Windows builds: `gpu` is used when an NVIDIA GPU is present. */
  cpu: Download;
  gpu?: Download;
}

/** Windows x64 builds: whisper.cpp release b5130 (v1.9.4), ffmpeg 9.0.2 essentials (gyan.dev via GyanD/codexffmpeg). */
export const TOOLS: readonly ToolEntry[] = [
  {
    id: 'ffmpeg',
    label: 'ffmpeg',
    description: 'Converts voice messages, audio and video into audio whisper reads.',
    exe: 'ffmpeg',
    cpu: {
      url: 'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip',
      bytes: 114768076,
      sha256: '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba',
    },
  },
  {
    id: 'whisper-cli',
    label: 'whisper.cpp',
    description: 'Runs the speech-to-text model on this computer.',
    exe: 'whisper-cli',
    cpu: {
      url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip',
      bytes: 8573270,
      sha256: 'f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c',
    },
    // Bundles the CUDA 12.4 runtime; needs an NVIDIA driver that supports CUDA 12.
    gpu: {
      url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-cublas-12.4.0-bin-x64.zip',
      bytes: 674539285,
      sha256: 'af520ddd034d985b55dfeea3e465ed93653ba2aee1a55e865033edc548c272a7',
    },
  },
];

export const modelEntry = (id: string | null): ModelEntry | undefined => MODELS.find((m) => m.id === id);
