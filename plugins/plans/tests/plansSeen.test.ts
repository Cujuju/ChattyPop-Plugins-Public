// The Plans panel's seen baseline: seeded from a successful read only, and once Plans can be read.
import { describe, expect, it, vi } from 'vitest';
import { PluginInactiveError } from '@shared/pluginCall';
import type { PlanItem } from '../shared/types';

// The client runtime, so effects and resources react as in a window (node resolves solid-js to its server build).
// A dynamic import, resolved from the checkout; createRequire would resolve from this folder. By variable: it has no types.
vi.mock('solid-js', () => {
  const client = 'solid-js/dist/solid.js';
  return import(client);
});

const env = vi.hoisted(() => ({
  on: false,
  emit: null as null | ((e: { type: string }) => void),
  list: null as null | (() => Promise<PlanItem[]>),
  stored: new Map<string, unknown>(),
}));

// The desktop's API: the plugin list says whether Plans is on, and core answers its list only while it is.
vi.stubGlobal('window', {
  chattypop: {
    onEvent: (listener: (e: { type: string }) => void) => {
      env.emit = listener;
      return () => undefined;
    },
    core: {
      getSetting: async (key: string) => env.stored.get(key),
      setSetting: async (key: string, value: unknown) => void env.stored.set(key, value),
      plugins: async () => [{ id: 'plans', bundled: true, status: env.on ? 'active' : 'disabled' }],
    },
    plugins: {
      callCore: async (pluginId: string, name: string) => {
        const inactive = { status: 'inactive', pluginId };
        if (!env.on || name !== 'list') return inactive;
        try {
          return { status: 'ok', value: await env.list!() };
        } catch (error) {
          if (error instanceof PluginInactiveError) return inactive;
          throw error;
        }
      },
    },
  },
});

/** Turns Plans on or off, as Settings → Plugins does: core's list changes and windows hear it. */
function setPlansOn(on: boolean): void {
  env.on = on;
  env.emit!({ type: 'plugins-changed' });
}

const plan = (messageId: string): PlanItem => ({
  messageId, channelId: 'c', channelName: 'c', kind: 'plan', title: messageId, whenTs: null, who: [], details: '', ts: 0,
});
const SEEN_KEY = 'plugin.plans.seen';
/** Lets awaited continuations and resource loads run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

describe('Plans seen baseline', () => {
  it('waits for Plans to be readable, keeps no baseline from an inactive read, and then counts only later arrivals', async () => {
    let existing = [plan('a'), plan('b')];
    env.list = async () => existing;
    // The app starts with Plans off: nothing to read, so no baseline yet.
    // A renderer module: imported by path so the node type-check doesn't follow it.
    const statePath = '../renderer/state.ts';
    const state = (await import(statePath)) as { unseenPlanCount(): number; plans: { refetch(): Promise<void> } };
    await settle();
    expect(env.stored.get(SEEN_KEY)).toBeUndefined();

    // Plans stops between the window checking it and core answering.
    env.list = async () => {
      throw new PluginInactiveError('plans');
    };
    setPlansOn(true);
    await settle();
    expect(env.stored.get(SEEN_KEY)).toBeUndefined();

    setPlansOn(false);
    await settle();
    env.list = async () => existing;
    setPlansOn(true);
    await settle();
    expect(env.stored.get(SEEN_KEY)).toEqual(['a:plan', 'b:plan']);

    existing = [...existing, plan('c')];
    await state.plans.refetch();
    await settle();
    expect(state.unseenPlanCount()).toBe(1);
  });
});
