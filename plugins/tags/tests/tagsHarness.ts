// The real Tags activation over a test database, exposing synchronous served calls for rule fixtures.
import { ProviderRegistry } from '@core/ai/registry';
import { afterEach } from 'vitest';
import type { AppEvent } from '@shared/contract';
import { DEFAULT_AI_SETTINGS } from '@shared/settings';
import type { DecisionProvider } from '@core/ai/decisions';
import { Archive } from '@core/archive';
import { setSetting, type Db } from '@core/db';
import { adoptBundledData } from '@core/plugins/adoption';
import { emptyRegistrations } from '@core/plugins/api';
import { CompletionLedger } from '@core/plugins/completions';
import { createCoreContext } from '@core/plugins/context';
import { RuleKinds } from '@core/rules/kinds';
import tagsCore from '../core';
import { plugin, type TagsCoreCalls } from '../shared';
import { TagStore } from '../core/store';
import { tempDir } from '@chattypop/host-testing';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((dispose) => dispose());
});

/** Adopts the old tables exactly as app startup does. */
export function adoptTags(db: Db): Db {
  adoptBundledData(db, [plugin]);
  return db;
}

/** Activates the shipped plugin through the host context; no service implementation is replaced. */
export function startTags(db: Db, options: {
  emit?: (event: AppEvent) => void;
  kinds?: RuleKinds;
  jev?: () => DecisionProvider | null;
  catchUp?: () => void;
} = {}) {
  adoptTags(db);
  const reg = emptyRegistrations();
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
        rules: options.kinds ?? new RuleKinds(),
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
        decider: () => options.jev?.() ?? null,
        catchUp: options.catchUp ?? (() => undefined),
        now: Date.now,
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
  const stop = tagsCore.activate(ctx);
  const dispose = (): void => {
    if (reg.unloaded) return;
    reg.unloaded = true;
    reg.disposers.forEach((fn) => fn());
    stop?.();
  };
  cleanups.push(dispose);
  const calls = Object.fromEntries(reg.calls) as unknown as TagsCoreCalls;
  const store = new TagStore(db);
  return {
    calls,
    dispose,
    store,
    list: calls.tags,
    create: calls.createTag,
    update: calls.updateTag,
    remove: calls.deleteTag,
    setManual: calls.setMessageTag,
    forMessage: calls.messageTags,
    taggedMessages: calls.taggedMessages,
    range: calls.tagRange,
    rangeCount: calls.tagRangeCount,
    applyByRule: (id: string, tagId: number) => store.applyRule(id, tagId),
  };
}
