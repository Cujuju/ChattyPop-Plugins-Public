// Summaries under privacy mode: hidden channels and servers leave a stored summary as shown.
import { beforeEach, describe, expect, it } from 'vitest';
import { SETTINGS_KEYS } from '@shared/settings';
import { setSetting, type Db } from '@core/db';
import { REDACTED_CHANNEL, REDACTED_SERVER, privacy } from '@core/queries/privacy';
import { seedArchive, tempDb } from '@chattypop/host-testing';
import { shownSummary } from '../core/privacy';
import type { Summary } from '../shared/types';

const OPEN_GUILD = { id: '100000000000000001', name: 'Open Server' };
const SECRET_GUILD = { id: '100000000000000002', name: 'Secret Server' };
const GENERAL = '200000000000000001';
const MODS = '200000000000000002';
const MODS_THREAD = '300000000000000001';
const SECRET_CHANNEL = '200000000000000003';

let db: Db;
const setMode = (on: boolean): void => setSetting(db, SETTINGS_KEYS.privacyMode, on);

beforeEach(() => {
  db = tempDb();
  const archive = seedArchive(
    db,
    [
      { id: GENERAL, name: 'general', guildId: OPEN_GUILD.id },
      { id: MODS, name: 'mod-chat', guildId: OPEN_GUILD.id },
      { id: SECRET_CHANNEL, name: 'lobby', guildId: SECRET_GUILD.id },
    ],
    { guilds: [OPEN_GUILD, SECRET_GUILD] },
  );
  archive.upsertThreads([{ id: MODS_THREAD, name: 'side talk', type: 11, parent_id: MODS, last_message_id: null }], 0);
  archive.setChannelPolicy(MODS, { hideInPrivacy: true });
  archive.setGuildHideInPrivacy(SECRET_GUILD.id, true);
});

describe('summaries in privacy mode', () => {
  const cite = (channelId: string, channelName: string) => ({ messageId: 'm', channelId, channelName, ts: 0 });
  const summary: Summary = {
    id: 1,
    createdAt: 0,
    provider: 'claude',
    model: null,
    sinceTs: 0,
    untilTs: 1,
    channelIds: [GENERAL, MODS],
    messageCount: 2,
    skippedCount: 0,
    durationMs: 0,
    headline: 'Plans in #general and #mod-chat; Secret Server is quiet',
    items: [
      { parts: [{ text: 'Mods argued in mod-chat', citations: [cite(MODS, 'mod-chat')] }] },
      { parts: [{ text: 'Both rooms (general, mod-chat) agreed', citations: [cite(GENERAL, 'general'), cite(MODS, 'mod-chat')] }] },
      { parts: [{ text: 'Uncited point about mod-chats', citations: [] }] },
      {
        parts: [
          { text: 'General planned', citations: [cite(GENERAL, 'general')] },
          { text: 'then mods vetoed it', citations: [cite(MODS, 'mod-chat')] },
        ],
      },
    ],
    actions: [],
    grouping: 'overall',
    trigger: 'manual',
    usage: null,
    apiCostUsd: null,
    apiCostEstimated: false,
    jevCostUsd: null,
    themes: [{ title: 'mod-chat drama', citations: [cite(MODS, 'mod-chat')] }],
  };

  it('are unchanged while off', () => {
    expect(shownSummary(summary, privacy(db))).toBe(summary);
  });

  it('lose hidden citations, and the parts and points citing only them, and redact hidden names as whole names', () => {
    setMode(true);
    const s = shownSummary(summary, privacy(db));
    expect(s.channelIds).toEqual([GENERAL]);
    expect(s.headline).toBe(`Plans in #general and ${REDACTED_CHANNEL}; ${REDACTED_SERVER} is quiet`);
    expect(s.items.map((i) => i.parts.map((p) => p.text))).toEqual([
      [`Both rooms (general, ${REDACTED_CHANNEL}) agreed`],
      ['Uncited point about mod-chats'],
      ['General planned'],
    ]);
    expect(s.items[0]!.parts[0]!.citations.map((c) => c.channelId)).toEqual([GENERAL]);
    expect(s.themes).toEqual([]);
  });
});

