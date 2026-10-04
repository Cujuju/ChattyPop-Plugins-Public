// Image text's core side: the queue, its engines and translators, image text as derived text and attachment notes, and the calls
// Settings, the message menu and main make.
import { join } from 'node:path';
import { defineCorePlugin, IS_WINDOWS, type CoreContext } from '@plugin-sdk/core';
import { errorMessage } from '@plugin-sdk/shared';
import { FETCH_IMAGE, STATUS_EVENT, plugin } from '../shared';
import { HOSTED_VISION_OFF, normalizePick, normalizeTranslatePick, type EnginePick, type EngineStatus, type ImageTextStatus, type ProviderModels, type TranslatePick } from '../shared/types';
import { ImageReader, newImageTextSession, type Engine } from './reader';
import { counts, IMAGE_TEXT_MIGRATIONS, imageNotes } from './store';
import { translateText, type Translator } from './translate';
import { readWithVision } from './vision';
import { WindowsOcr } from './windowsOcr';

/** Coalesces status events while a catch-up queues many images: each makes open Settings read the status again. */
const STATUS_EVENT_DELAY_MS = 500;
/** Images main downloaded; cleared as each job ends. */
const WORK_DIR = 'work';

/** Downloads main is making: kept for the core process across off and on. */
const session = newImageTextSession();

type Ctx = CoreContext<typeof plugin>;

/** Why a provider, local or not, may not be sent images under Settings; null when it may. */
const hostedVisionBlock = (ctx: Ctx, local: boolean): string | null => (local || ctx.preferences.get('settings').hostedVision ? null : HOSTED_VISION_OFF);

/** Why `providerId` can't read images now: it can't run, or it is hosted and hosted vision is off. */
const visionUnavailable = (ctx: Ctx, providerId: string): string | null => ctx.ai.unavailable(providerId) ?? hostedVisionBlock(ctx, ctx.ai.isLocal(providerId));

/** The vision engine for providerId and model (Settings' when null), or why it can't run. */
function visionEngine(ctx: Ctx, providerId: string | null, model: string | null): Engine {
  if (!providerId || !model) return { unavailable: 'Choose a vision model: Settings → Image text.' };
  const why = visionUnavailable(ctx, providerId);
  if (why) return { unavailable: why };
  const provider = ctx.ai.provider(providerId);
  return { name: `vision:${providerId}:${model}`, read: async (path, channelId, signal) => readWithVision(provider, model, path, [channelId], signal) };
}

/** Settings' vision provider and model. */
const settingsVision = (ctx: Ctx): Engine => {
  const s = ctx.preferences.get('settings');
  return visionEngine(ctx, s.visionProvider, s.visionModel);
};

/** A translator with `providerId` and `model` into Settings' language, or why it can't translate. */
function translatorOf(ctx: Ctx, providerId: string | null, model: string | null): Exclude<Translator, null> {
  if (!providerId || !model) return { unavailable: 'Choose a translation model: Settings → Translation.' };
  const why = ctx.ai.unavailable(providerId);
  if (why) return { unavailable: why };
  const provider = ctx.ai.provider(providerId);
  return {
    name: `${providerId}:${model}`,
    translate: (text, channelId, signal) => translateText(provider, model, ctx.preferences.get('settings').translateLanguage, text, [channelId], signal),
  };
}

/** Settings' translation model. */
const settingsTranslator = (ctx: Ctx): Exclude<Translator, null> => {
  const s = ctx.preferences.get('settings');
  return translatorOf(ctx, s.translateProvider, s.translateModel);
};

const statusOf = (e: { name: string } | { unavailable: string }): EngineStatus =>
  'unavailable' in e ? { ready: false, detail: e.unavailable } : { ready: true, detail: e.name.split(':').join(' · ') };

/**
 * Every provider with all its models, listed once (listing reaches the provider: Ollama's server): the translation
 * model's choices, and, of those declared to read images, their models that do: the vision engine's.
 */
async function providerModels(ctx: Ctx): Promise<{ vision: ProviderModels[]; text: ProviderModels[] }> {
  const listed = await Promise.all(
    ctx.ai.providers().map(async (p) => {
      const base = { id: p.id, label: p.label, local: p.local ?? false };
      if (p.unavailable) return { images: p.images, all: { ...base, unavailable: p.unavailable, models: [] }, vision: [] };
      try {
        const models = await ctx.ai.provider(p.id).listModels();
        return { images: p.images, all: { ...base, unavailable: null, models }, vision: models.filter((m) => m.images) };
      } catch (err) {
        return { images: p.images, all: { ...base, unavailable: errorMessage(err), models: [] }, vision: [] };
      }
    }),
  );
  // A hosted provider lists its vision models while hosted vision is off, so the owner sees what turning it on offers.
  const vision = listed
    .filter((l) => l.images)
    .map((l) => ({ ...l.all, unavailable: l.all.unavailable ?? hostedVisionBlock(ctx, l.all.local), models: l.vision }));
  return { vision, text: listed.map((l) => l.all) };
}
export default defineCorePlugin(plugin, (ctx) => {
  ctx.storage.migrate(IMAGE_TEXT_MIGRATIONS);
  const db = ctx.storage.db;
  const settings = () => ctx.preferences.get('settings');
  const ocr = new WindowsOcr(ctx.storage.dataDir);
  const windowsEngine = (): Engine =>
    IS_WINDOWS
      ? { name: 'windows', read: (path, _channelId, signal) => ocr.read(path, signal).then((text) => ({ text, tickers: [] })) }
      : { unavailable: 'Windows OCR runs only on Windows.' };
  const engine = (pick: EnginePick | null): Engine => {
    if (pick) return pick.engine === 'vision' ? visionEngine(ctx, pick.provider, pick.model) : windowsEngine();
    return settings().engine === 'vision' ? settingsVision(ctx) : windowsEngine();
  };
  // A job's pick, or Settings' automatic translation when it is on.
  const translator = (pick: TranslatePick | null): Translator => (pick ? translatorOf(ctx, pick.provider, pick.model) : settings().translate ? settingsTranslator(ctx) : null);
  let statusTimer: NodeJS.Timeout | null = null;
  const statusChanged = (): void => {
    statusTimer ??= setTimeout(() => {
      statusTimer = null;
      ctx.channels.emit(STATUS_EVENT, null);
    }, STATUS_EVENT_DELAY_MS);
  };
  const reader = new ImageReader({
    db,
    images: (ids) => ctx.archive.images.of(ids),
    engine,
    translator,
    auto: () => settings().auto,
    attachmentsDir: ctx.archive.attachmentsDir,
    workDir: join(ctx.storage.dataDir, WORK_DIR),
    session,
    lifetime: ctx.lifetime.signal,
    reports: {
      dispatch: (requestId, send) => ctx.completions.dispatch('imageFetched', String(requestId), send),
      withdraw: (requestId) => ctx.completions.withdraw('imageFetched', String(requestId)),
    },
    events: {
      changed: (messageId) => {
        ctx.archive.attachmentNotes.changed([messageId]);
        statusChanged();
      },
      fetchImage: (request) => ctx.channels.emit(FETCH_IMAGE, request),
      // An image's text is its message's derived text, read after the content in the order its job was queued. Keyed by
      // job: derived text keys are unique across messages, and two messages may show the same image.
      settled: (s) =>
        s.ok && s.text !== null
          ? ctx.archive.derivedText.settle(s.messageId, { key: String(s.seq), order: s.seq, text: s.text, queuedAt: s.requestedAt, askJev: settings().askJev }, s.record)
          : ctx.archive.derivedText.settle(s.messageId, null, s.ok ? s.record : undefined),
    },
  });
  ctx.archive.derivedText.provide({ pending: (messageId) => reader.due(messageId) });
  ctx.archive.attachmentNotes.provide((ids) => imageNotes(db, ids));
  ctx.archive.images.onShown((messageId) => reader.shown(messageId));
  ctx.archive.onAttachmentStored(() => reader.kick());
  // Automatic reading turned on, or the engine changed (a model chosen): queue what's due and run what waits.
  ctx.preferences.onChange('settings', () => {
    reader.catchUp();
    reader.kick();
    statusChanged();
  });
  // A provider turned on or off: what can run changes, and so do Settings' engine, translator and provider lists.
  ctx.ai.onSettingsChange(() => {
    reader.kick();
    statusChanged();
  });
  const vision = (): EngineStatus => {
    const e = settingsVision(ctx);
    // Its name less the engine's ('vision:'): provider · model.
    return 'unavailable' in e ? statusOf(e) : statusOf({ name: e.name.split(':').slice(1).join(':') });
  };
  ctx.channels.serve({
    status: async (): Promise<ImageTextStatus> => {
      const [windows, models] = await Promise.all([ocr.status(), providerModels(ctx)]);
      return { windows, vision: vision(), providers: models.vision, translator: statusOf(settingsTranslator(ctx)), translateProviders: models.text, counts: counts(db) };
    },
    // Normalized: a pick that isn't one is refused, not read as Settings' engine.
    request: (messageId, pick) => {
      const picked = pick === null ? null : normalizePick(pick);
      if (pick !== null && !picked) throw new Error('Not an engine image text reads with.');
      reader.request(messageId, picked);
    },
    // Null: Settings' translation model, used now whether or not automatic translation is on.
    translate: (messageId, pick) => {
      const picked = pick === null ? null : normalizeTranslatePick(pick);
      if (pick !== null && !picked) throw new Error('Not a model image text translates with.');
      const s = settings();
      const chosen = picked ?? (s.translateProvider && s.translateModel ? { provider: s.translateProvider, model: s.translateModel } : null);
      if (!chosen) throw new Error('Choose a translation model: Settings → Translation.');
      reader.translate(messageId, chosen);
    },
    retryFailed: () => reader.retryFailed(),
  });
  // Main's download reports are handled while off too: an image it fetched is kept for the job.
  ctx.completions.handle('imageFetched', { key: (requestId) => String(requestId) }, ([requestId, error], f) =>
    reader.imageFetched(requestId, error, { db: f.db, failed: (messageId) => f.settle(messageId, null) }),
  );
  // After activation returns: startup's work isn't held up by the lookback's images.
  setImmediate(() => {
    if (ctx.lifetime.signal.aborted) return;
    reader.catchUp();
    reader.kick(); // jobs a quit interrupted
  });
  return () => {
    if (statusTimer) clearTimeout(statusTimer);
    reader.dispose();
    ocr.dispose();
  };
});
