import { expect, it, onTestFinished } from 'vitest';
import { defineCorePlugin, type ArchiveRead } from '@plugin-sdk/core';
import { testPlugin } from '@plugin-sdk/core/testing';
import core from '../core';
import { plugin } from '../shared';

it('admits live lexical work through the archive worker', async () => {
  const folds: string[] = [];
  const wrapped = defineCorePlugin(plugin, (ctx) => core.activate({ ...ctx, storage: { ...ctx.storage,
    read: ((sql, params, options) => { if (options?.fold) folds.push(options.fold.source); return ctx.storage.read(sql, params, options); }) as ArchiveRead,
  } }));
  const t = testPlugin(wrapped, { archive: { channels: [{ id: 'c1' }], messages: [{ channelId: 'c1', ts: 1, content: 'good pizza' }] } });
  onTestFinished(() => t.dispose());
  const c = t.client('renderer');
  expect((await c.wordStats({ scope: 'all', channelId: null, sinceTs: null })).totalWords).toBe(2);
  expect((await c.sentimentStats({ scope: 'all', channelId: null, sinceTs: null })).classes.positive).toBe(1);
  expect(folds.length).toBeGreaterThan(0);
  expect(await t.read('SELECT 1 AS n')).toEqual([{ n: 1 }]);
});
