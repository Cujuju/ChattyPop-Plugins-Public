// Archive import (DiscordChatExporter JSON) and export (DCE-compatible JSON, an HTML page, plain text, Markdown or CSV).
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { attachmentFileName, DM_GROUP_NAME, DM_GUILD_ID, errorMessage, type RawMessage } from '@plugin-sdk/shared';
import { ARRIVAL, type Importer, type PluginDb, parseRawJson, storedAttachmentPath } from '@plugin-sdk/core';
import type { ExchangeResult, ExportProgress, ExportRequest, ExportResult } from '../shared/types';
import { dceToRaw, isDceExport, rawToDce, type DceExport } from './dce';
import { FORMAT_WRITERS, type ExportHead } from './formats';

/** Messages per ingest transaction during import. */
const IMPORT_BATCH = 500;
/** DCE writes DMs under this pseudo-guild. */
const DCE_DM_GUILD_ID = '0';
/** DCE channel type names → Discord channel types. */
const DCE_CHANNEL_TYPES: Record<string, number> = {
  GuildTextChat: 0,
  DirectTextChat: 1,
  DirectGroupTextChat: 3,
  GuildNewsChat: 5,
  GuildNewsThread: 10,
  GuildPublicThread: 11,
  GuildPrivateThread: 12,
  GuildForum: 15,
};
const DCE_TYPE_NAMES = Object.fromEntries(Object.entries(DCE_CHANNEL_TYPES).map(([k, v]) => [v, k]));
/** Characters Windows forbids in file names. */
const UNSAFE_FILE_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
/** Longest readable part of a file name: with its id, extension and media-folder suffix it stays under NTFS's 255. */
const FILE_NAME_TEXT_MAX = 180;
/** A file being written; renamed once whole, so a stopped or failed export never replaces an earlier one. */
const PARTIAL_SUFFIX = '.partial';
/** Messages read, mapped and appended at a time: memory holds one page, and core gets a turn after each. */
const EXPORT_PAGE = 1000;

/** Imports each validated DCE file atomically; skips failures. Archives channels, records changed messages as revisions, and preserves local attachment paths as metadata. */
export function importDceFiles(archive: Importer, paths: string[]): ExchangeResult {
  const result: ExchangeResult = { channelIds: [], messages: 0, skippedFiles: [] };
  for (const path of paths) {
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      result.skippedFiles.push(path);
      continue;
    }
    if (!isDceExport(data)) {
      result.skippedFiles.push(path);
      continue;
    }
    const x = data;
    try {
      result.messages += archive.atomically(() => importOne(archive, x));
      result.channelIds.push(x.channel.id);
    } catch (err) {
      console.warn('[exchange] import failed:', errorMessage(err));
      result.skippedFiles.push(path);
    }
  }
  return result;
}

function importOne(archive: Importer, x: DceExport): number {
  const isDm = x.guild.id === DCE_DM_GUILD_ID;
  const guildId = isDm ? DM_GUILD_ID : x.guild.id;
  archive.upsertGuilds([{ id: guildId, name: isDm ? DM_GROUP_NAME : x.guild.name }]);
  archive.upsertChannels(guildId, [
    { id: x.channel.id, name: x.channel.name, type: DCE_CHANNEL_TYPES[x.channel.type ?? ''] ?? 0, parent_id: x.channel.categoryId ?? null },
  ]);
  archive.setOptIn(x.channel.id, true);
  let inserted = 0;
  for (let i = 0; i < x.messages.length; i += IMPORT_BATCH) {
    inserted += archive.ingestMessages(x.messages.slice(i, i + IMPORT_BATCH).map((m) => dceToRaw(m, x.channel.id)), ARRIVAL.import).inserted;
  }
  return inserted;
}

interface ChannelRow {
  id: string;
  name: string;
  kind: number;
  parentId: string | null;
  /** A thread's or forum post's channel. */
  parentName: string | null;
  guildId: string | null;
  guildName: string | null;
}
/** A message's place in the order pages are read: time, then id. */
interface PagePlace {
  ts: number;
  idLength: number;
  id: string;
}
interface MessageRow {
  id: string;
  ts: number;
  raw: string | Buffer;
}
const BEFORE_FIRST: PagePlace = { ts: -1, idLength: 0, id: '' };

/** How a running export reports and is stopped. */
export interface ExportRun {
  progress(p: ExportProgress): void;
  /** True once the export should stop; read before each channel and each page. */
  stopped(): boolean;
}
const UNWATCHED: ExportRun = { progress: () => undefined, stopped: () => false };

class ExportStopped extends Error {}

const safeName = (s: string): string => s.replace(UNSAFE_FILE_CHARS, '_').slice(0, FILE_NAME_TEXT_MAX).trim() || 'channel';
const coreTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * Writes each channel with a message in range to req.dir as `server - channel [id]` (a thread as `server - channel - thread [id]`),
 * with an optional attachment folder. A message stored behind a page already written is left out.
 */
export async function exportChannels(db: PluginDb, attachmentsDir: string, req: ExportRequest, run: ExportRun = UNWATCHED): Promise<ExportResult> {
  const result: ExportResult = { channelIds: [], messages: 0, emptyChannelIds: [], failedChannelIds: [], cancelled: false };
  const channel = db.prepare(
    `SELECT c.id, c.name, c.kind, c.parent_id AS parentId, CASE WHEN c.is_thread THEN p.name END AS parentName, c.guild_id AS guildId, g.name AS guildName
     FROM archive_all_channels c LEFT JOIN archive_all_guilds g ON g.id = c.guild_id LEFT JOIN archive_all_channels p ON p.id = c.parent_id WHERE c.id = ?`,
  );
  const threadsOf = db.prepare('SELECT id FROM archive_all_channels WHERE parent_id = ? AND is_thread ORDER BY length(id), id');
  const page = db.prepare(
    `SELECT id, ts, raw_json AS raw FROM archive_all_messages
     WHERE channel_id = ? AND raw_json IS NOT NULL AND ts >= ? AND ts <= ? AND (ts, length(id), id) > (?, ?, ?)
     ORDER BY ts, length(id), id LIMIT ${EXPORT_PAGE}`,
  );
  const stored = db.prepare("SELECT sha256 FROM archive_all_attachments WHERE id = ? AND status = 'stored'");
  const since = req.sinceTs ?? 0;
  const until = req.untilTs ?? Number.MAX_SAFE_INTEGER;
  // Each chosen channel with the threads exported for it; a thread reached twice is written once.
  const chosen = req.channelIds.map((id) => ({ id, members: [id, ...(req.includeThreads ? (threadsOf.all(id) as { id: string }[]).map((t) => t.id) : [])] }));
  const targets = [...new Set(chosen.flatMap((pick) => pick.members))];
  /** Channels whose export ran to its end, with whether it left nothing (no message in range). */
  const nothingIn = new Map<string, boolean>();
  const progress: ExportProgress = { channelsDone: 0, channelsTotal: targets.length, messages: 0 };
  mkdirSync(req.dir, { recursive: true });

  /** Writes one channel's file; resolves with its message count, 0 when nothing is in range (no file). */
  const exportOne = async (c: ChannelRow): Promise<number> => {
    const base = `${safeName([c.guildName ?? 'Discord', c.parentName, c.name].filter(Boolean).join(' - '))} [${c.id}]`;
    const filesDir = `${base}_files`;
    const attachmentUrl = (a: { id: string; filename: string; url: string }): string => {
      if (!req.includeMedia) return a.url;
      const row = stored.get(a.id) as { sha256: string } | undefined;
      if (!row) return a.url;
      const name = attachmentFileName(row.sha256, a.filename);
      const src = storedAttachmentPath(attachmentsDir, row.sha256, a.filename);
      if (!existsSync(src)) return a.url;
      mkdirSync(join(req.dir, filesDir), { recursive: true });
      copyFileSync(src, join(req.dir, filesDir, name));
      // URL-encodes HTML attachment paths so # and % retain filename meaning. Other formats keep plain paths.
      return req.format === 'html' ? [filesDir, name].map(encodeURIComponent).join('/') : `${filesDir}/${name}`;
    };
    const read = (after: PagePlace): MessageRow[] => page.all(c.id, since, until, after.ts, after.idLength, after.id) as MessageRow[];
    let rows = read(BEFORE_FIRST);
    if (!rows.length) return 0;
    const head: ExportHead = {
      guild: c.guildId === DM_GUILD_ID ? { id: DCE_DM_GUILD_ID, name: 'Direct Messages' } : { id: c.guildId ?? DCE_DM_GUILD_ID, name: c.guildName ?? '' },
      channel: { id: c.id, type: DCE_TYPE_NAMES[c.kind] ?? 'GuildTextChat', categoryId: c.parentId, name: c.name },
      exportedAt: new Date().toISOString(),
    };
    const writer = FORMAT_WRITERS[req.format](head);
    const file = join(req.dir, `${base}.${req.format}`);
    const partial = `${file}${PARTIAL_SUFFIX}`;
    const fd = openSync(partial, 'w');
    let written = 0;
    try {
      writeSync(fd, writer.head);
      for (;;) {
        writeSync(fd, rows.map((r) => writer.message(rawToDce(parseRawJson<RawMessage>(r.raw)!, attachmentUrl))).join(''));
        written += rows.length;
        run.progress({ ...progress, messages: progress.messages + written });
        if (rows.length < EXPORT_PAGE) break;
        await coreTurn();
        if (run.stopped()) throw new ExportStopped();
        const last = rows.at(-1)!;
        rows = read({ ts: last.ts, idLength: last.id.length, id: last.id });
        if (!rows.length) break;
      }
      writeSync(fd, writer.foot(written));
    } catch (err) {
      closeSync(fd);
      rmSync(partial, { force: true });
      throw err;
    }
    closeSync(fd);
    renameSync(partial, file);
    return written;
  };

  for (const id of targets) {
    if (run.stopped()) break;
    const c = channel.get(id) as ChannelRow | undefined;
    try {
      const written = c ? await exportOne(c) : 0;
      if (written) result.channelIds.push(id);
      progress.messages += written;
      nothingIn.set(id, !written);
    } catch (err) {
      if (err instanceof ExportStopped) break;
      console.warn('[exchange] export failed:', errorMessage(err));
      result.failedChannelIds.push(id);
      nothingIn.set(id, false);
    }
    progress.channelsDone++;
    run.progress({ ...progress });
    await coreTurn();
  }
  result.cancelled = nothingIn.size < targets.length;
  // A chosen channel is empty when neither it nor any thread exported for it had a message in range.
  result.emptyChannelIds = chosen.filter((pick) => pick.members.every((id) => nothingIn.get(id) === true)).map((pick) => pick.id);
  result.messages = progress.messages;
  return result;
}
