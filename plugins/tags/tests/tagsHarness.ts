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
import { tagRangeCount } from '../core/questions';
import { TagStore } from '../core/store';
import { tempDir } from '@chattypop/host-testing';
import type { ArchiveRead } from '@plugin-sdk/core';

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
  read?: ArchiveRead;
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
  let calls!: TagsCoreCalls;
  if (options.read) ctx.storage.read = options.read;
  const serve = ctx.channels.serve;
  ctx.channels.serve = (impl) => { calls = impl as TagsCoreCalls; serve(impl); };
  const stop = tagsCore.activate(ctx);
  const dispose = (): void => {
    if (reg.unloaded) return;
    reg.unloaded = true;
    reg.disposers.forEach((fn) => fn());
    stop?.();
  };
  cleanups.push(dispose);
  const store = new TagStore(db);
  return {
    calls,
    dispose,
    store,
    list: () => store.list(),
    create: calls.createTag,
    update: calls.updateTag,
    remove: calls.deleteTag,
    setManual: calls.setMessageTag,
    forMessage: (id: string) => store.chips([id]).get(id) ?? [],
    taggedMessages: (id: number, limit: number) => store.tagged(id, limit),
    range: calls.tagRange,
    rangeCount: (req: Parameters<typeof tagRangeCount>[1]) => tagRangeCount(db, req),
    applyByRule: (id: string, tagId: number) => store.applyRule(id, tagId),
  };
}
