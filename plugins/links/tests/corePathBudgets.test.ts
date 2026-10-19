import { AsyncLocalStorage, createHook } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { compressRawJson } from '@core/db';
import { archiveAsync } from '@core/plugins/archiveAsync';
import { archiveRead } from '@core/plugins/pluginDb';
import { closeArchiveReads } from '@core/reads/archiveReads';
import { embedsFrom, normalizeUrl } from '@plugin-sdk/core';
import { tempDb, seedArchive } from '@chattypop/host-testing';
import { linkPage } from '../core/feed';
import { adoptLinks, linksSql } from './linksHarness';
import { JUDGMENTS } from '../core/tables';

/** The measured first-page size, with enough repeat shares to expose archive-sized Core projection. */
const PAGE_ROWS = 50;
const SHARES_PER_LINK = 400;
/** Jev request size; the benchmark contrasts full candidate discovery with the bounded background reply. */
const DISCOVERY_ROWS = 8;

async function coreWork<T>(fn: () => Promise<T>) {
  const scope = new AsyncLocalStorage<boolean>();
  const turns = new Map<number, number>();
  let active = true, synchronousMs = 0, longestTurnMs = 0;
  const add = (ms: number) => { if (active) { synchronousMs += ms; longestTurnMs = Math.max(longestTurnMs, ms); } };
  const hook = createHook({ before(id) { if (scope.getStore()) turns.set(id, performance.now()); },
    after(id) { const start = turns.get(id); if (start !== undefined) { turns.delete(id); add(performance.now() - start); } } });
  hook.enable();
  const start = performance.now();
  try {
    const value = await scope.run(true, () => { const turn = performance.now(); try { return fn(); } finally { add(performance.now() - turn); } });
    return { value, synchronousMs, longestTurnMs, elapsedMs: performance.now() - start };
  } finally { active = false; hook.disable(); }
}

describe('Links Core work budget fixture', () => {
  it('folds repeat-share previews in the helper and returns complete first/warm pages', async () => {
    const db = adoptLinks(tempDb()); seedArchive(db, [{ id: 'c' }]);
    db.prepare("INSERT INTO users (id, username) VALUES ('u', 'User')").run();
    const message = db.prepare("INSERT INTO messages (id, channel_id, author_id, ts, content, raw_json) VALUES (?, 'c', 'u', ?, '', ?)");
    const link = db.prepare("INSERT INTO links (id, url, platform, first_message_id, first_channel_id, first_author_id, first_ts) VALUES (?, ?, 'other', ?, 'c', 'u', ?)");
    const share = db.prepare('INSERT INTO message_links (message_id, link_id) VALUES (?, ?)');
    const ids: string[] = [];
    db.transaction(() => {
      for (let index = 0; index < PAGE_ROWS; index++) {
        const url = `https://example.com/${index}`;
        const payload = compressRawJson(JSON.stringify({ embeds: [{ type: 'rich', url, title: `Card ${index}` }] }));
        for (let n = 0; n < SHARES_PER_LINK; n++) {
          const ts = index * SHARES_PER_LINK + n;
          const id = String(1_000_000_000_000_000_000n + BigInt(ts)); ids.push(id);
          message.run(id, ts, payload);
          if (n === 0) link.run(index + 1, url, id, ts);
          share.run(id, index + 1);
        }
      }
    })();
    const host = archiveAsync(() => db, () => true), read = archiveRead(() => db);
    try {
      const pendingSql = `SELECT l.id, l.url, l.title, l.description, l.site, l.metadata_channel_ids AS metadataChannels,
        l.first_channel_id AS channelId, (SELECT content FROM archive_messages WHERE id = l.first_message_id) AS content, j.asked
        FROM (${linksSql(undefined, 'hosted')}) l LEFT JOIN ${JUDGMENTS} j ON j.url = l.url
        WHERE l.first_ts >= ? ORDER BY l.first_ts DESC`;
      const beforeDiscovery = performance.now();
      const candidates = db.prepare(pendingSql).all(0);
      const discoverySyncMs = performance.now() - beforeDiscovery;
      const discoveryStart = performance.now();
      const discovery = read(`${pendingSql} LIMIT ?`, [0, DISCOVERY_ROWS], { priority: 'background' });
      const discoveryDispatchMs = performance.now() - discoveryStart;
      expect(await discovery).toHaveLength(DISCOVERY_ROWS);
      process.stdout.write(JSON.stringify({ discovery: true, legacyRows: candidates.length, replyRows: DISCOVERY_ROWS, discoverySyncMs, discoveryDispatchMs }) + '\n');
      // Legacy projection returned every share's payload to Core before grouping and selecting the cards.
      const details = await host.payloads(ids);
      const start = performance.now();
      const shares = new Map<number, string[]>();
      ids.forEach((id, index) => { const key = Math.floor(index / SHARES_PER_LINK); shares.set(key, [...(shares.get(key) ?? []), id]); });
      const legacy = [...shares].map(([index, own]) => embedsFrom(details.get(own[0]!)?.embedsJson ?? null)
        .find((embed) => embed.url !== null && normalizeUrl(embed.url) === `https://example.com/${index}`));
      const legacyCoreMs = performance.now() - start;
      expect(legacy).toHaveLength(PAGE_ROWS);
      for (const phase of ['first', 'warm']) {
        const result = await coreWork(() => linkPage(read, host.linkPreviews, host.messages, { limit: PAGE_ROWS }, linksSql));
        expect(result.value).toHaveLength(PAGE_ROWS);
        expect(result.value.every((row) => row.embed?.title && row.message && row.shares === SHARES_PER_LINK)).toBe(true);
        const { value: _value, ...timing } = result;
        process.stdout.write(JSON.stringify({ phase, rows: PAGE_ROWS, shareRows: ids.length, legacyCoreMs, legacyPayloadRows: details.size, previewRows: PAGE_ROWS, ...timing }) + '\n');
      }
    } finally { await closeArchiveReads(db); db.close(); }
  });
});
