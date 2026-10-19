import { Worker } from 'node:worker_threads';
import { SNOWFLAKE_ID, type RawMessage } from '@plugin-sdk/shared';
import { dceToRaw, isDceExport, type DceExport } from './dce';

type Header = Omit<DceExport, 'messages'>;
const IMPORT_BATCH = 128; // Bound each validated packet and its Core deserialization turn.
const IMPORT_PACKET_BYTES = 512 * 1024; // Wide messages get their own packet instead of a large multi-message clone.

/** This function and the supplied validators run wholly in an owned worker, in source and installed builds. */
async function importWorker() {
  const { parentPort, workerData }: typeof import('node:worker_threads') = require('node:worker_threads');
  const { readFile }: typeof import('node:fs/promises') = require('node:fs/promises');
  const validate = new Function(`return (${workerData.validate})`)();
  const map = new Function(`return (${workerData.map})`)();
  const ack = () => new Promise<void>((resolve) => parentPort!.once('message', () => resolve()));
  const send = async (packet: unknown) => { const received = ack(); parentPort!.postMessage(packet); await received; };
  try {
    const doc = JSON.parse(await readFile(workerData.path, 'utf8'));
    if (!validate(doc, new RegExp(workerData.snowflake))) throw new Error('Not a DiscordChatExporter file');
    // Every field is validated before the first metadata or message write.
    await send({ kind: 'header', header: { guild: doc.guild, channel: doc.channel, exportedAt: doc.exportedAt, messageCount: doc.messageCount } });
    let messages: RawMessage[] = [], bytes = 0;
    for (const m of doc.messages) {
      const raw = map(m, doc.channel.id), size = Buffer.byteLength(JSON.stringify(raw));
      if (messages.length && (messages.length >= workerData.rows || bytes + size > workerData.bytes)) {
        await send({ kind: 'batch', messages }); messages = []; bytes = 0;
      }
      messages.push(raw); bytes += size;
    }
    if (messages.length) await send({ kind: 'batch', messages });
    parentPort!.postMessage({ kind: 'done' });
  } catch (error) {
    parentPort!.postMessage({ kind: 'error', message: (error as Error).message });
  }
}

/** Backpressure permits one validated packet on Core; errors retain already committed ingest slices for re-import. */
export async function readDceFile(path: string, head: (header: Header) => void, batch: (messages: RawMessage[]) => Promise<void>): Promise<Header> {
  const worker = new Worker(`(${importWorker.toString()})()`, { eval: true,
    workerData: { path, validate: isDceExport.toString(), map: dceToRaw.toString(), snowflake: SNOWFLAKE_ID.source, rows: IMPORT_BATCH, bytes: IMPORT_PACKET_BYTES } });
  let header: Header | undefined;
  try {
    return await new Promise<Header>((resolve, reject) => {
      worker.on('error', reject);
      worker.on('exit', (code) => reject(new Error(`Import reader exited before completion (${code})`)));
      worker.on('message', (packet) => {
        void (async () => {
          if (packet.kind === 'error') throw new Error(packet.message);
          if (packet.kind === 'done') { if (!header) throw new Error('Import reader omitted its header'); resolve(header); return; }
          if (packet.kind === 'header') { header = packet.header; head(header!); }
          else if (packet.kind === 'batch') await batch(packet.messages);
          else throw new Error('Unexpected import packet');
          worker.postMessage('next');
        })().catch(reject);
      });
    });
  } finally { await worker.terminate(); }
}
