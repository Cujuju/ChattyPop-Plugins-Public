// The real Alerts activation over a test database, exposing synchronous served calls for rule fixtures.
import { ProviderRegistry } from '@core/ai/registry';
import { afterEach } from 'vitest';
import type { AppEvent } from '@shared/contract';
import { DEFAULT_AI_SETTINGS } from '@shared/settings';
import type { DecisionProvider } from '@core/ai/decisions';
import { Archive } from '@core/archive';
import { setSetting, type Db } from '@core/db';
import { adoptBundledData } from '@core/plugins/adoption';
import { migrateArchiveRefs } from '@core/plugins/archiveRefs';
import { ALERT_MIGRATIONS } from '../core/schema';
import { emptyRegistrations } from '@core/plugins/api';
import { CompletionLedger } from '@core/plugins/completions';
import { createCoreContext } from '@core/plugins/context';
import { RuleKinds } from '@core/rules/kinds';
import { activateAlerts } from '../core';
import { ALERT_EVENT_DEBOUNCE_MS, type AlertCooldowns } from '../core/notifier';
import { sleep } from '@shared/async';
import { plugin, type AlertsCoreCalls } from '../shared';
import { builtinRules } from '../core/managed';
import { jevFeatureOn, type JevFeature, type JevSettings } from '@shared/settings';
import { stampedName } from '@shared/bundledTypes';
import { tempDir } from '@chattypop/host-testing';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((dispose) => dispose());
});

/** Adopts the old tables and applies Alerts' schema steps, as app startup and activation do. */
export function adoptAlerts(db: Db): Db {
  adoptBundledData(db, [plugin]);
  migrateArchiveRefs(db, plugin, ALERT_MIGRATIONS);
  return db;
}

/** One archive's notification cooldowns, as one core process keeps them across off/on. */
const cooldowns = new WeakMap<Db, AlertCooldowns>();
const cooldownsOf = (db: Db): AlertCooldowns => {
  if (!cooldowns.has(db)) cooldowns.set(db, new Map());
  return cooldowns.get(db)!;
};

/** Activates the shipped plugin through the host context; no service implementation is replaced. */
export function startAlerts(db: Db, options: {
  now?: () => number;
  emit?: (event: AppEvent) => void;
  kinds?: RuleKinds;
  jev?: (feature: JevFeature) => DecisionProvider | null;
  catchUp?: () => void;
  /** Continues a gapless previous activation (CoreContext.session.resumed). */
  resumed?: boolean;
} = {}) {
  adoptAlerts(db);
  const reg = emptyRegistrations();
  const kinds = options.kinds ?? new RuleKinds();
  const emit = options.emit ?? (() => undefined);
  const ctx = createCoreContext(
    plugin,
    0,
    {
      db,
      emit,
      changed: () => undefined,
      ai: async () => ({ text: '' }),
      decider: () => null,
      bundled: {
        rules: kinds,
        ready: () => db,
        archive: () => new Archive(db),
        mediaDir: tempDir(),
        attachmentsDir: tempDir(),
        pluginData: {
          root: tempDir(),
          unmoved: {},
        },
        storeText: () => undefined,
        storeLinkText: () => undefined, storeLinkImages: () => undefined,
        saveSetting: (key, value) => setSetting(db, key, value),
        aiSettings: () => DEFAULT_AI_SETTINGS,
        providers: new ProviderRegistry(() => undefined),
        decider: (feature) => options.jev?.(feature) ?? null,
        catchUp: options.catchUp ?? (() => undefined),
        now: Date.now,
      },
    },
    reg,
    {
      self: () => null,
      textPending: () => false,
      textSettled: () => undefined,
      resumed: options.resumed,
    },
    (fn) => fn(),
    new CompletionLedger(plugin.channels),
  );
  const activation = activateAlerts(ctx, options.now, cooldownsOf(db));
  kinds.changed();
  const dispose = (): void => {
    if (reg.unloaded) return;
    reg.unloaded = true;
    reg.disposers.forEach((fn) => fn());
    activation.dispose();
    kinds.changed();
  };
  cleanups.push(dispose);
  const calls = Object.fromEntries(reg.calls) as unknown as AlertsCoreCalls;

  return {
    calls,
    pending: activation.pending,
    dispose,
    syncBuiltins: (settings: JevSettings) => ctx.rules.managed.sync(builtinRules((f) => jevFeatureOn(settings, stampedName(plugin.manifest.id, f)))),
  };
}

/** Slack past the alert debounce for the timer to fire and emit. */
const ALERT_SETTLE_MARGIN_MS = 50;
/** Waits out the alert event debounce, so notifications have been emitted. */
export const settleAlerts = (): Promise<void> => sleep(ALERT_EVENT_DEBOUNCE_MS + ALERT_SETTLE_MARGIN_MS);
