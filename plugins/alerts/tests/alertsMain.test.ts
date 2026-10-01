// Host Alerts enter the generic delivery service once, separately from ordinary event broadcasting.
import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import type { AlertItem } from '../shared/types';
import type { CoreEventDeps } from '@main/coreEvents';
import { routeCoreEvents } from '@main/coreEvents';
import { createMainContext, type MainPluginDeps } from '@main/plugins/context';
import alertsMain from '../main';
import { plugin } from '../shared';
import { notifyDesktop } from '@main/desktopNotifications';

vi.mock('electron', () => ({ dialog: {} }));
vi.mock('@main/desktopNotifications', () => ({ notifyDesktop: vi.fn() }));
vi.mock('@main/diagnostics', () => ({ diag: vi.fn() }));

it('routes an eligible alert burst to desktop and push once, without reading settings for non-notices', async () => {
  const bus = new EventEmitter();
  const call = vi.fn(async (method: string) => method === 'plugins'
    ? [{ id: 'alerts', bundled: true, status: 'active' }]
    : undefined);
  const core = Object.assign(bus, { call });
  const send = vi.fn();
  const notify = vi.fn();
  const broadcast = vi.fn();
  const sinks = routeCoreEvents({
    core,
    win: {
      isDestroyed: () => false,
      webContents: { send },
    },
    panelWindows: { windows: () => [] },
    downloader: { kick: vi.fn() },
    phone: {
      broadcast,
      notify,
    },
  } as unknown as CoreEventDeps);
  alertsMain.activate(createMainContext(plugin, {
    core,
    notifications: sinks.notifications,
  } as unknown as MainPluginDeps, {
    serve: () => undefined,
    whileActive: () => undefined, stage: (apply: () => void) => apply(),
    on: (name, fn) => {
      bus.on('event', (event) => {
        if (event.type === 'plugin-event' && event.pluginId === 'alerts' && event.name === name)
          void fn(event.payload);
      });
    },
  }));
  bus.emit('event', {
    type: 'plugin-event',
    pluginId: 'alerts',
    name: 'changed',
    payload: null,
  });
  expect(call).not.toHaveBeenCalled();
  expect(notify).not.toHaveBeenCalled();
  const alert = (id: number): AlertItem => ({
    id,
    ruleId: 1,
    sourceName: 'Drops',
    messageId: `m${id}`,
    channelId: 'channel',
    channelName: 'General',
    authorId: 'author',
    authorName: 'Author',
    authorAvatar: null,
    ts: 0,
    snippet: 'A drop',
    mentions: {},
    readAt: null,
    matchKind: 'pattern',
    probability: null,
    duplicateOf: null,
  });
  bus.emit('event', {
    type: 'plugin-event',
    pluginId: 'alerts',
    name: 'notify',
    payload: [1, 2, 3, 4].map(alert),
  });
  await vi.waitFor(() => expect(notifyDesktop).toHaveBeenCalledOnce());
  expect(notify).toHaveBeenCalledExactlyOnceWith({
    title: '4 new alerts',
    body: 'Drops',
    kind: 'alerts.alert',
    target: {
      kind: 'message',
      channelId: 'channel',
      messageId: 'm1',
    },
  });
  expect(vi.mocked(notifyDesktop).mock.calls[0]![1]).toEqual(notify.mock.calls[0]![0]);
  expect(broadcast).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenCalledTimes(1); // notification payloads are main-only
});
