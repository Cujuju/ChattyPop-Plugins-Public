// Registers translation queue/model, derived text, part notes, and Settings/menu calls.
import { defineCorePlugin, type CoreContext } from '@plugin-sdk/core';
import { errorMessage } from '@plugin-sdk/shared';
import { STATUS_EVENT, plugin } from '../shared';
import { autoFor, normalizeTranslatePick, type ProviderModels, type TranslatePick, type TranslationStatus, type TranslatorStatus } from '../shared/types';
import { TranslationQueue, type Translator } from './queue';
import { registerTranslationFilter } from './rules';
import { messageSources } from './sources';
import { counts, TRANSLATION_MIGRATIONS, translationNotes } from './store';
import { translateText } from './translate';

/** Coalesces status events while a catch-up queues many parts: each makes open Settings read the status again. */
const STATUS_EVENT_DELAY_MS = 500;

type Ctx = CoreContext<typeof plugin>;

/** A translator with `providerId` and `model` into Settings' language, or why it can't translate. */
function translatorOf(ctx: Ctx, providerId: string | null, model: string | null): Translator {
  if (!providerId || !model) return { unavailable: 'Choose a translation model: Settings → Translation.' };
  const why = ctx.ai.unavailable(providerId);
  if (why) return { unavailable: why };
  const provider = ctx.ai.provider(providerId);
  return {
    name: `${providerId} · ${model}`,
    translate: (text, channelId, signal) => translateText(provider, model, ctx.preferences.get('settings').translateLanguage, text, [channelId], signal),
  };
}

const statusOf = (t: Translator): TranslatorStatus => ('unavailable' in t ? { ready: false, detail: t.unavailable } : { ready: true, detail: t.name });

/** Every provider with all its models (listing reaches the provider: Ollama's server): the translation model's choices. */
async function providerModels(ctx: Ctx): Promise<ProviderModels[]> {
  return Promise.all(
    ctx.ai.providers().map(async (p) => {
      const base = { id: p.id, label: p.label, local: p.local ?? false };
      if (p.unavailable) return { ...base, unavailable: p.unavailable, models: [] };
      try {
        return { ...base, unavailable: null, models: await ctx.ai.provider(p.id).listModels() };
      } catch (err) {
        return { ...base, unavailable: errorMessage(err), models: [] };
      }
    }),
  );
}

export default defineCorePlugin(plugin, (ctx) => {
  ctx.storage.migrate(TRANSLATION_MIGRATIONS);
  const db = ctx.storage.db;
  registerTranslationFilter(ctx.rules, db);
  const settings = () => ctx.preferences.get('settings');
  const translator = (pick: TranslatePick | null): Translator => {
    const s = settings();
    return pick ? translatorOf(ctx, pick.provider, pick.model) : translatorOf(ctx, s.translateProvider, s.translateModel);
  };
  let statusTimer: NodeJS.Timeout | null = null;
  const statusChanged = (): void => {
    statusTimer ??= setTimeout(() => {
      statusTimer = null;
      ctx.channels.emit(STATUS_EVENT, null);
    }, STATUS_EVENT_DELAY_MS);
  };
  const queue = new TranslationQueue({
    db,
    sources: (ids) => messageSources(plugin.manifest.id, settings().translateLanguage, ctx.archive.parts.of(ids), ctx.archive.derivedText.ofParts(ids)),
    translator,
    auto: (kind) => autoFor(settings(), kind),
    lifetime: ctx.lifetime.signal,
    events: {
      changed: (messageId) => {
        ctx.archive.notes.changed([messageId]);
        statusChanged();
      },
      // Stores translations as part-specific derived text using job keys. Translation does not trigger another Jev language judgment.
      settled: (s) =>
        s.ok && s.text !== null
          ? ctx.archive.derivedText.settle(s.messageId, { key: String(s.seq), order: s.seq, text: s.text, queuedAt: s.requestedAt, part: s.part, askJev: false }, s.record)
          : ctx.archive.derivedText.settle(s.messageId, null, s.ok ? s.record : undefined),
    },
  });
  ctx.archive.derivedText.provide({ pending: (messageId) => queue.due(messageId) });
  ctx.archive.notes.provide((ids) => translationNotes(db, ids));
  // A plugin's text of a part arrived or changed (this plugin's own too, which sources leave out).
  ctx.archive.derivedText.onSettled((messageId) => queue.noted(messageId));
  // An embed's text arrived or changed.
  ctx.archive.parts.onShown((messageId) => queue.noted(messageId));
  // Automatic translation turned on, or the model or language changed: queue what's due and run what waits.
  ctx.preferences.onChange('settings', () => {
    queue.catchUp();
    queue.kick();
    statusChanged();
  });
  // A provider turned on or off: what can run changes, and so do Settings' provider lists.
  ctx.ai.onSettingsChange(() => {
    queue.kick();
    statusChanged();
  });
  ctx.channels.serve({
    status: async (): Promise<TranslationStatus> => ({ translator: statusOf(translator(null)), providers: await providerModels(ctx), counts: counts(db) }),
    // Normalized: a pick that isn't one is refused, not read as Settings' model.
    translate: (messageId, pick) => {
      const picked = pick === null ? null : normalizeTranslatePick(pick);
      if (pick !== null && !picked) throw new Error('Not a model Translation translates with.');
      queue.request(messageId, picked);
    },
    retryFailed: () => queue.retryFailed(),
  });
  // After activation returns: startup's work isn't held up by the lookback's texts.
  setImmediate(() => {
    if (ctx.lifetime.signal.aborted) return;
    queue.catchUp();
    queue.kick(); // jobs a quit interrupted
  });
  return () => {
    if (statusTimer) clearTimeout(statusTimer);
    queue.dispose();
  };
});
