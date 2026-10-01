// Summaries' main notices through the host's notification policy: privacy changes and the automatic-summary switch.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { DeliveredNotification } from '@shared/notifications';
import { privacyScopedIn } from '@shared/notices';
import { createMainContext, type MainPluginDeps } from '@main/plugins/context';
import { notificationService } from '@main/notifications';
import { notifyDesktop } from '@main/desktopNotifications';
import summariesMain from '../main';
import { plugin as summaries } from '../shared';

const state = vi.hoisted(() => ({
  toasts: [] as { options: { title: string; body: string } }[],
}));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    dialog: {},
    Notification: class extends EventEmitter {
      static isSupported = () => true;
      constructor(readonly options: { title: string; body: string }) {
        super();
      }
      show(): void {
        state.toasts.push(this);
        this.emit('show');
      }
    },
  };
});
vi.mock('@main/diagnostics', () => ({ diag: vi.fn() }));

/** Summaries' main side over the host's notification service; phone pushes are recorded, not sent. */
function harness() {
  let notifyAuto = true;
  let duringNotifyAuto = (): void => undefined;
  const pushed: DeliveredNotification[] = [];
  const win = { isDestroyed: () => false, show: vi.fn(), focus: vi.fn() } as unknown as BrowserWindow;
  const notifications = notificationService({
    settings: async () => ({ notifications: { desktop: true } }),
    desktop: (n) => notifyDesktop(win, n, vi.fn()),
    push: (n) => void pushed.push(n),
    privacyScoped: (kind) => privacyScopedIn([summaries], kind),
  });
  const deps = {
    notifications,
    core: {
      call: async (method: string) => method === 'pluginCall'
        ? (duringNotifyAuto(), { status: 'ok', value: notifyAuto })
        : [{ id: 'summaries', bundled: true, status: 'active' }],
    },
  } as unknown as MainPluginDeps;
  const summaryEvents = new Map<string, (payload: unknown) => unknown>();
  summariesMain.activate(createMainContext(summaries, deps, {
    serve: () => undefined,
    whileActive: () => undefined, stage: (apply: () => void) => apply(),
    on: (name, listener) => { summaryEvents.set(name, listener); },
  }));
  return {
    pushed,
    /** Core reported a privacy change (main's privacy-changed event). */
    privacyChanged: () => notifications.privacyChanged(),
    /** Runs while Summaries asks core whether automatic summaries notify the desktop. */
    duringNotifyAuto: (fn: () => void) => { duringNotifyAuto = fn; },
    quietSummaries: () => { notifyAuto = false; },
    summaryAdded: () => summaryEvents.get('added')!({ trigger: 'digest', actions: [], headline: 'Launch moved to Friday' }),
    summaryFailure: () => summaryEvents.get('failed')!({ trigger: 'digest', message: 'provider down' }),
  };
}

beforeEach(() => {
  state.toasts.length = 0;
});

describe('summary notifications', () => {
  it('shows no summary made before privacy mode changed while Summaries read its preference', async () => {
    const h = harness();
    h.duringNotifyAuto(h.privacyChanged);
    await h.summaryAdded();
    expect(h.pushed).toHaveLength(0);
    expect(state.toasts).toHaveLength(0);
    h.duringNotifyAuto(() => undefined);
    await h.summaryAdded();
    expect(state.toasts).toHaveLength(1);
  });

  it('keeps phone pushes independent of the automatic-summary desktop setting', async () => {
    const h = harness();
    h.quietSummaries();
    await h.summaryFailure();
    expect(state.toasts).toHaveLength(0);
    expect(h.pushed).toHaveLength(1);
  });
});
