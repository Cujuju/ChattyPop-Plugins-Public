// Alerts in privacy mode: hidden channels leave views, counts and mark-all-read.
import { beforeEach, describe, expect, it } from 'vitest';
import { SETTINGS_KEYS } from '@shared/settings';
import { archivePayloads } from '@core/plugins/archivePayloads';
import { setSetting, type Db } from '@core/db';
import { arrivedLive, seedArchive, tempDb } from '@chattypop/host-testing';
import { alertItems, markAlertsRead, unreadCounts } from '../core/queries';
import { alertRule, ruleStack } from './ruleHarness';

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

describe('alerts in privacy mode', () => {
  it('leave views, counts and mark-all-read', () => {
    const { matcher: w, rules } = ruleStack(db, () => {}, () => null);
    w.setSelf({ id: 'me', username: 'me' });
    rules.create(alertRule({ text: { pattern: 'hello', spec: null } }));
    const now = Date.now();
    w.check({ id: 'a1', channelId: GENERAL, authorId: 'u2', ts: now, content: 'hello there', linked: '' }, arrivedLive());
    w.check({ id: 'a2', channelId: MODS_THREAD, authorId: 'u2', ts: now, content: 'hello mods', linked: '' }, arrivedLive());
    setMode(true);
    expect(alertItems(db, (ids) => archivePayloads(db, ids), { limit: 10 }).map((a) => a.channelId)).toEqual([GENERAL]);
    expect(Object.values(unreadCounts(db))[0]).toBe(1);
    markAlertsRead(db, null);
    setMode(false);
    expect(alertItems(db, (ids) => archivePayloads(db, ids), { limit: 10, unreadOnly: true }).map((a) => a.channelId)).toEqual([MODS_THREAD]);
  });
});
