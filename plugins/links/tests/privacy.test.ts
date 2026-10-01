// The Links feed in privacy mode: a link first shared in a hidden channel is gone too.
import { beforeEach, describe, expect, it } from 'vitest';
import { SETTINGS_KEYS } from '@shared/settings';
import { MS_PER_MIN, MS_PER_S } from '@shared/units';
import type { Archive } from '@core/archive';
import { ARRIVAL } from '@core/arrival';
import { setSetting, type Db } from '@core/db';
import { rawMessage, seedArchive, tempDb } from '@chattypop/host-testing';
import { adoptLinks, linkFeed } from './linksHarness';

const OPEN_GUILD = { id: '100000000000000001', name: 'Open Server' };
const SECRET_GUILD = { id: '100000000000000002', name: 'Secret Server' };
const GENERAL = '200000000000000001';
const MODS = '200000000000000002';
const MODS_THREAD = '300000000000000001';
const SECRET_CHANNEL = '200000000000000003';

let db: Db;
let archive: Archive;
const setMode = (on: boolean): void => setSetting(db, SETTINGS_KEYS.privacyMode, on);
const at = (n: number): number => Date.now() - MS_PER_MIN + n * MS_PER_S;

beforeEach(() => {
  db = adoptLinks(tempDb());
  archive = seedArchive(
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

describe('the links feed in privacy mode', () => {
  beforeEach(() => {
    archive.ingestMessages([
      rawMessage(GENERAL, at(1), 'plain hello'),
      rawMessage(GENERAL, at(2), `see <#${MODS}> hello`),
      rawMessage(GENERAL, at(3), `hello https://discord.com/channels/${SECRET_GUILD.id}/${SECRET_CHANNEL}/1`),
      rawMessage(GENERAL, at(4), 'hello https://example.com/shared'),
      rawMessage(MODS, at(5), 'hello from mods https://example.com/mods'),
    ], ARRIVAL.gateway);
  });

  it('lists every shared link while off', () => {
    expect(linkFeed(db, { limit: 10 })).toHaveLength(2); // Discord's own links aren't listed
  });

  it('drops a link first shared in a hidden channel', () => {
    setMode(true);
    expect(linkFeed(db, { limit: 10 }).map((l) => l.url)).toEqual(['https://example.com/shared']);
  });
});
