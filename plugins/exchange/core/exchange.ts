// Archive import (DiscordChatExporter JSON) and export (DCE-compatible JSON, or a standalone HTML page).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { attachmentFileName, DM_GROUP_NAME, DM_GUILD_ID, errorMessage, type RawMessage } from '@plugin-sdk/shared';
import { ARRIVAL, type Importer, type PluginDb, parseRawJson, storedAttachmentPath } from '@plugin-sdk/core';
import type { ExchangeResult, ExportRequest } from '../shared/types';
import { dceToRaw, isDceExport, rawToDce, type DceExport } from './dce';
import { renderHtml } from './exportHtml';

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
  guildId: string | null;
  guildName: string | null;
}

const safeName = (s: string): string => s.replace(UNSAFE_FILE_CHARS, '_').trim() || 'channel';

/** Exports each channel to req.dir using server - channel [id] names, with an optional attachment folder. */
export function exportChannels(db: PluginDb, attachmentsDir: string, req: ExportRequest): ExchangeResult {
  const result: ExchangeResult = { channelIds: [], messages: 0, skippedFiles: [] };
  const channel = db.prepare(
    `SELECT c.id, c.name, c.kind, c.parent_id AS parentId, c.guild_id AS guildId, g.name AS guildName
     FROM archive_all_channels c LEFT JOIN archive_all_guilds g ON g.id = c.guild_id WHERE c.id = ?`,
  );
  const messages = db.prepare(
    `SELECT raw_json AS raw FROM archive_all_messages WHERE channel_id = ? AND raw_json IS NOT NULL AND ts >= ? AND ts <= ? ORDER BY ts, length(id), id`,
  );
  const stored = db.prepare("SELECT sha256 FROM archive_all_attachments WHERE id = ? AND status = 'stored'");
  mkdirSync(req.dir, { recursive: true });
  for (const id of req.channelIds) {
    const c = channel.get(id) as ChannelRow | undefined;
    if (!c) continue;
    const base = safeName(`${c.guildName ?? 'Discord'} - ${c.name} [${c.id}]`);
    const filesDir = `${base}_files`;
    const raws = (messages.all(id, req.sinceTs ?? 0, req.untilTs ?? Number.MAX_SAFE_INTEGER) as { raw: string | Buffer }[]).map(
      (r) => parseRawJson<RawMessage>(r.raw)!,
    );
    const attachmentUrl = (a: { id: string; filename: string; url: string }): string => {
      if (!req.includeMedia) return a.url;
      const row = stored.get(a.id) as { sha256: string } | undefined;
      if (!row) return a.url;
      const name = attachmentFileName(row.sha256, a.filename);
      const src = storedAttachmentPath(attachmentsDir, row.sha256, a.filename);
      if (!existsSync(src)) return a.url;
      mkdirSync(join(req.dir, filesDir), { recursive: true });
      copyFileSync(src, join(req.dir, filesDir, name));
      // URL-encodes HTML attachment paths so # and % retain filename meaning. DCE JSON keeps plain paths.
      return req.format === 'html' ? [filesDir, name].map(encodeURIComponent).join('/') : `${filesDir}/${name}`;
    };
    const doc: DceExport = {
      guild: c.guildId === DM_GUILD_ID ? { id: DCE_DM_GUILD_ID, name: 'Direct Messages' } : { id: c.guildId ?? DCE_DM_GUILD_ID, name: c.guildName ?? '' },
      channel: { id: c.id, type: DCE_TYPE_NAMES[c.kind] ?? 'GuildTextChat', categoryId: c.parentId, name: c.name },
      exportedAt: new Date().toISOString(),
      messages: raws.map((r) => rawToDce(r, attachmentUrl)),
      messageCount: raws.length,
    };
    const file = join(req.dir, `${base}.${req.format}`);
    writeFileSync(file, req.format === 'json' ? JSON.stringify(doc, null, 2) : renderHtml(doc));
    result.channelIds.push(id);
    result.messages += raws.length;
  }
  return result;
}
