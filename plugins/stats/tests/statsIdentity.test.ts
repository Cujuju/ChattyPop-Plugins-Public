import { statementRead } from '@chattypop/host-testing';
import { expect, it, onTestFinished, vi } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import statsCore from '../core';
import { attachPosterIdentities, readPosterIdentities, scopeSql } from '../core/stats';
import { ALICE, analyticsArchive } from './statsFixture';

it('attaches archived poster names and avatars in one read, with a fallback for missing profiles', async () => {
  const t = testPlugin(statsCore, { archive: analyticsArchive() });
  onTestFinished(() => t.dispose());
  const rows = [{ userId: 'u2', count: 0 }, { userId: ALICE.id, count: 0 }, { userId: 'missing', count: 0 }];
  const scope = (await scopeSql(statementRead(t.db), { scope: 'channel', channelId: 'c1', sinceTs: null }));
  const prepare = vi.spyOn(t.db, 'prepare');
  onTestFinished(() => prepare.mockRestore());
  const identities = (await readPosterIdentities(statementRead(t.db), scope, rows.map((row) => row.userId)));
  expect(attachPosterIdentities(rows, identities)).toEqual([
    { userId: 'u2', count: 0, name: 'Bob', avatar: null },
    { userId: ALICE.id, count: 0, name: 'Alice', avatar: ALICE.avatar },
    { userId: 'missing', count: 0, name: 'missing', avatar: null },
  ]);
  expect((await readPosterIdentities(statementRead(t.db), scope, []))).toEqual([]);
  expect(prepare).toHaveBeenCalledTimes(1);
});
