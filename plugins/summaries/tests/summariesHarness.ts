// The real Summaries activation over a test database, exposing synchronous served calls for rule fixtures.
import { ProviderRegistry } from '@core/ai/registry';
import { afterEach } from 'vitest';
import type { AppEvent } from '@shared/contract';
import { DEFAULT_AI_SETTINGS, type AiSettings } from '@shared/settings';
import type { DecisionProvider } from '@core/ai/decisions';
import { Archive } from '@core/archive';
import { getSetting, setSetting, type Db } from '@core/db';
import { isObj } from '@shared/normalize';
import { pluginSettingKey } from '@shared/bundledTypes';
import { adoptBundledData } from '@core/plugins/adoption';
import { migrateArchiveRefs } from '@core/plugins/archiveRefs';
import { emptyRegistrations } from '@core/plugins/api';
import { CompletionLedger } from '@core/plugins/completions';
import { createCoreContext } from '@core/plugins/context';
import { RuleKinds } from '@core/rules/kinds';
import { activateSummaries } from '../core';
import { SUMMARY_MIGRATIONS } from '../core/schema';
import { plugin, type SummaryCalls } from '../shared';
import { DEFAULT_SUMMARY_SETTINGS, type SummarySettings } from '../shared/settings';
import type { JevFeature } from '@shared/settings';
import { tempDir } from '@chattypop/host-testing';
import type { SummaryProviders } from '../core/providers';
import type { CompletionRequest, LlmProvider } from '@core/ai/types';
import type { ProviderId } from '@shared/settings';
import { declaredProvider, declaredProviders } from '@shared/aiProviders';
import { aiSources } from '@core/ai/readScope';

/** The fake completion provider's prompt budget: large enough that test logs are never chunked. */
const FAKE_PROVIDER_MAX_INPUT_CHARS = 100_000;

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((dispose) => dispose());
});

/** Adopts the old tables and migrates them exactly as app startup and activation do. */
export function adoptSummaries(db: Db): Db {
  adoptBundledData(db, [plugin]);
  migrateArchiveRefs(db, plugin, SUMMARY_MIGRATIONS);
  return db;
}

/** The provider these tests summarize with, as the owner picks it in Settings → Summaries. */
const TEST_PROVIDER: ProviderId = 'claude';

/** Summaries' default preferences with TEST_PROVIDER picked. */
export const TEST_PREFS: SummarySettings = { ...DEFAULT_SUMMARY_SETTINGS, defaultProvider: TEST_PROVIDER };

/** Picks TEST_PROVIDER for Summaries unless the test stored a choice. */
function chooseProvider(db: Db): void {
  const key = pluginSettingKey(plugin.manifest.id, 'settings');
  const saved = getSetting(db, key);
  const prefs = isObj(saved) ? saved : {};
  if (!Object.hasOwn(prefs, 'defaultProvider')) setSetting(db, key, { ...prefs, defaultProvider: TEST_PROVIDER });
}

/** Activates the shipped plugin through the host context; no service implementation is replaced. */
export function startSummaries(db: Db, options: {
  now?: () => number;
  emit?: (event: AppEvent) => void;
  kinds?: RuleKinds;
  jev?: (feature: JevFeature) => DecisionProvider | null;
  catchUp?: () => void;
  activate?: boolean;
  lastSeenAt?: number;
  providers?: ProviderRegistry;
  aiSettings?: () => AiSettings;
} = {}) {
  adoptSummaries(db);
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
        aiSettings: options.aiSettings ?? (() => DEFAULT_AI_SETTINGS),
        providers: options.providers ?? new ProviderRegistry(() => undefined),
        decider: (feature) => options.jev?.(feature) ?? null,
        catchUp: options.catchUp ?? (() => undefined),
        now: options.now ?? Date.now,
        lastSeenAt: () => options.lastSeenAt ?? Date.now(),
      },
    },
    reg,
    {
      self: () => null,
      textPending: () => false,
      textSettled: () => undefined,
    },
    (fn) => fn(),
    new CompletionLedger(plugin.channels),
  );
  if (options.activate !== false) activateSummaries(ctx);
  kinds.changed();
  const dispose = (): void => {
    if (reg.unloaded) return;
    reg.unloaded = true;
    reg.disposers.forEach((fn) => fn());
    kinds.changed();
  };
  cleanups.push(dispose);
  const calls = Object.fromEntries(reg.calls) as unknown as SummaryCalls;

  return {
    calls,
    ctx,
    dispose,
  };
}

/** Provider registry returns json(req,settings) and records requests. decider supplies Jev; sources enforce db channel policy. */
export function fakeRegistry(
  db: () => Db,
  json: (req: CompletionRequest, s: AiSettings) => unknown,
  decider: SummaryProviders['decider'] = () => null,
): { calls: CompletionRequest[]; registry: SummaryProviders } {
  const calls: CompletionRequest[] = [];
  const get = (id: ProviderId, s: AiSettings): LlmProvider => ({
    id,
    maxInputChars: FAKE_PROVIDER_MAX_INPUT_CHARS,
    complete: async (req) => {
      calls.push(req);
      return { text: '', json: json(req, s) };
    },
    listModels: async () => [],
  });
  // Locality as this build declares it.
  const isLocal = (id: ProviderId): boolean => declaredProvider(id)?.local === true;
  const localNames = (): string[] => declaredProviders().filter((d) => d.local).map((d) => d.displayName);
  return { calls, registry: { get, decider, permitted: aiSources(db, isLocal).permitted, localNames } };
}
