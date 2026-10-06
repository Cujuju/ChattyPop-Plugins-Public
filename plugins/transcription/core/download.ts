import { spawn } from 'node:child_process';
import { createHash, type Hash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import type { PluginFetch } from '@plugin-sdk/core';
import type { Download } from './catalog';

/** The server honoured a Range request. */
const HTTP_PARTIAL_CONTENT = 206;

/** A download that can't succeed by retrying from where it stopped: its partial file is discarded. */
class CorruptDownload extends Error {}

async function hashFile(path: string, hash: Hash): Promise<void> {
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
}

/** Downloads through a resumable .part file; validates size/SHA-256 before rename. Cancellation or checksum failure discards partial data. */
export async function downloadVerified(d: Download, dest: string, onProgress: (fraction: number) => void, signal: AbortSignal, fetchImpl: PluginFetch): Promise<void> {
  await mkdir(dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  try {
    let start = existsSync(part) ? statSync(part).size : 0;
    if (start >= d.bytes) {
      await rm(part, { force: true });
      start = 0;
    }
    const res = await fetchImpl(d.url, { signal, ...(start ? { headers: { Range: `bytes=${start}-` } } : {}) });
    if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}.`);
    if (res.status !== HTTP_PARTIAL_CONTENT) start = 0; // the server sent the whole file
    const hash = createHash('sha256');
    if (start) await hashFile(part, hash);
    let received = start;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        hash.update(chunk);
        received += chunk.length;
        onProgress(Math.min(1, received / d.bytes));
        done(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body as WebReadableStream<Uint8Array>), meter, createWriteStream(part, { flags: start ? 'a' : 'w' }), { signal });
    if (received > d.bytes) throw new CorruptDownload(`Download too large: ${received} of ${d.bytes} bytes.`);
    if (received < d.bytes) throw new Error(`Download incomplete: ${received} of ${d.bytes} bytes; try again to resume.`);
    if (hash.digest('hex') !== d.sha256) throw new CorruptDownload('Download failed its checksum and was discarded.');
    await rename(part, dest);
  } catch (err) {
    if (err instanceof CorruptDownload || signal.aborted) await rm(part, { force: true });
    throw err;
  }
}

/** Windows 10+ ships bsdtar, which reads zip archives. */
const WINDOWS_TAR = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe');

/** Unpacks a zip into `dir` (Windows only); `signal` stops tar. */
export function extractZip(zip: string, dir: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(WINDOWS_TAR, ['-xf', zip, '-C', dir], { windowsHide: true, signal });
    let stderr = '';
    child.stderr.on('data', (b: Buffer) => (stderr += b.toString()));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Unpacking failed: ${stderr.trim() || `tar exited with ${code}`}`))));
  });
}
