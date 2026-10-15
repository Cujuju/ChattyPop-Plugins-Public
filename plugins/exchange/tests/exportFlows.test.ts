// The export calls a window makes: main picks the folder and waits for history, core writes.
import { readFileSync, readdirSync } from 'node:fs';
import { expect, it, onTestFinished } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import { testMainPlugin } from '@plugin-sdk/main/testing';
import type { HistoryResult } from '@plugin-sdk/main';
import { tempDir } from '@chattypop/host-testing';
import exchangeCore from '../core';
import exchangeMain from '../main';
import type { DceExport } from '../core/dce';
import type { ExportOptions } from '../shared/types';

const CH = 'c1';
const OTHER = 'c2';
const T0 = Date.UTC(2026, 8, 1);

/** The plugin's two sides over an archive of two channels, with `history` as sync's answer to a wait. */
async function exchange(history?: (channelIds: string[], sinceMs: number) => Promise<HistoryResult[]>) {
  const dir = tempDir();
  const core = testPlugin(exchangeCore, { archive: { channels: [{ id: CH }, { id: OTHER }] } });
  onTestFinished(() => core.dispose());
  const ids = core.archive.arrive([
    { channelId: CH, content: 'first', ts: T0 },
    { channelId: CH, content: 'second', ts: T0 + 1 },
    { channelId: CH, content: 'third', ts: T0 + 2 },
    { channelId: OTHER, content: 'elsewhere', ts: T0 + 3 },
  ]);
  const main = await testMainPlugin(exchangeMain, core, { dialogs: { pickFolder: async () => dir }, ...(history ? { history } : {}) });
  onTestFinished(() => main.stop());
  return { dir, ids, calls: main.client() };
}
const options = (over: Partial<ExportOptions> = {}): ExportOptions => ({ channelIds: [CH, OTHER], includeThreads: false, format: 'json', includeMedia: false, fetchFirst: true, sinceTs: T0, ...over });

it('fetches history back to the start of the range, then exports and names the channels that fell short', async () => {
  const asked: { channelIds: string[]; sinceMs: number }[] = [];
  const x = await exchange(async (channelIds, sinceMs) => {
    asked.push({ channelIds, sinceMs });
    return [{ channelId: CH, outcome: 'reached' }, { channelId: OTHER, outcome: 'stopped' }];
  });
  expect(await x.calls.exportChannels(options())).toMatchObject({ channelIds: [CH, OTHER], messages: 4, unfetchedChannelIds: [OTHER], cancelled: false });
  expect(asked).toEqual([{ channelIds: [CH, OTHER], sinceMs: T0 }]);
  // Nothing to fetch back to without a start, and nothing fetched unasked.
  await x.calls.exportChannels(options({ sinceTs: undefined }));
  await x.calls.exportChannels(options({ fetchFirst: false }));
  expect(asked).toHaveLength(1);
});

it('stops waiting for history when told to, writing nothing', async () => {
  let waiting = (): void => undefined;
  const asked = new Promise<void>((resolve) => (waiting = resolve));
  const x = await exchange(() => (waiting(), new Promise<HistoryResult[]>(() => undefined)));
  const running = x.calls.exportChannels(options());
  await asked;
  await x.calls.cancelExport();
  expect(await running).toMatchObject({ channelIds: [], messages: 0, cancelled: true });
  expect(readdirSync(x.dir)).toEqual([]);
  // The wait is over: another export may start.
  expect(await x.calls.exportChannels(options({ fetchFirst: false }))).toMatchObject({ messages: 4 });
});

it('refuses a second export while the first is still at its folder dialog, so Stop always reaches the running one', async () => {
  let pick = (_dir: string | null): void => undefined;
  const dir = tempDir();
  const core = testPlugin(exchangeCore, { archive: { channels: [{ id: CH }] } });
  onTestFinished(() => core.dispose());
  const main = await testMainPlugin(exchangeMain, core, { dialogs: { pickFolder: () => new Promise((r) => (pick = r)) } });
  onTestFinished(() => main.stop());
  const calls = main.client();
  const first = calls.exportChannels(options({ channelIds: [CH], fetchFirst: false }));
  await expect(calls.exportChannels(options({ channelIds: [CH], fetchFirst: false }))).rejects.toThrow('already running');
  pick(dir);
  expect(await first).toMatchObject({ cancelled: false });
});

it("writes the selected messages of a channel to one file, oldest first, whatever order they're given in", async () => {
  const x = await exchange();
  const [first, , third, elsewhere] = x.ids;
  const r = await x.calls.exportMessages({ channelId: CH, messageIds: [third!, first!, elsewhere!, 'gone'], format: 'json' });
  expect(r).toMatchObject({ messages: 2 });
  expect(readdirSync(x.dir)).toHaveLength(1);
  expect(r!.file).toMatch(/ \[c1\] selected [\dT.Z-]+\.json$/);
  const doc = JSON.parse(readFileSync(r!.file!, 'utf8')) as DceExport;
  expect(doc.messages.map((m) => m.content)).toEqual(['first', 'third']);
  expect(doc.messageCount).toBe(2);
  expect(await x.calls.exportMessages({ channelId: CH, messageIds: ['gone'], format: 'txt' })).toEqual({ file: null, messages: 0 });
  expect(readdirSync(x.dir)).toHaveLength(1);
});
