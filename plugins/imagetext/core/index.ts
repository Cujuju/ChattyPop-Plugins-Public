// Image text's core side: the queue, its engines, image text as derived text and attachment notes, and the calls
// Settings, the message menu and main make.
import { join } from 'node:path';
import { defineCorePlugin, IS_WINDOWS, type CoreContext } from '@plugin-sdk/core';
import { errorMessage } from '@plugin-sdk/shared';
import { FETCH_IMAGE, STATUS_EVENT, plugin } from '../shared';
import { normalizePick, type EnginePick, type EngineStatus, type ImageTextStatus, type VisionProvider } from '../shared/types';
import { ImageReader, newImageTextSession, type Engine } from './reader';
import { counts, IMAGE_TEXT_MIGRATIONS, imageNotes } from './store';
import { readWithVision } from './vision';
import { WindowsOcr } from './windowsOcr';

/** Coalesces status events while a catch-up queues many images: each makes open Settings read the status again. */
const STATUS_EVENT_DELAY_MS = 500;
/** Images main downloaded; cleared as each job ends. */
const WORK_DIR = 'work';

/** Downloads main is making: kept for the core process across off and on. */
const session = newImageTextSession();

type Ctx = CoreContext<typeof plugin>;

/** The vision engine for providerId and model (Settings' when null), or why it can't run. */
function visionEngine(ctx: Ctx, providerId: string | null, model: string | null): Engine {
  if (!providerId || !model) return { unavailable: 'Choose a vision model: Settings → Image text.' };
  const why = ctx.ai.unavailable(providerId);
  if (why) return { unavailable: why };
  const provider = ctx.ai.provider(providerId);
  return { name: `vision:${providerId}:${model}`, read: async (path, channelId, signal) => readWithVision(provider, model, path, [channelId], signal) };
}

/** Settings' vision provider and model. */
const settingsVision = (ctx: Ctx): Engine => {
  const s = ctx.preferences.get('settings');
  return visionEngine(ctx, s.visionProvider, s.visionModel);
};

/** Providers declared to read images, each with its models that do (listing reaches the provider: Ollama's server). */
async function visionProviders(ctx: Ctx): Promise<VisionProvider[]> {
  return Promise.all(
    ctx.ai
      .providers()
      .filter((p) => p.images)
      .map(async (p): Promise<VisionProvider> => {
        if (p.unavailable) return { id: p.id, label: p.label, unavailable: p.unavailable, models: [] };
        try {
          const models = await ctx.ai.provider(p.id).listModels();
          return { id: p.id, label: p.label, unavailable: null, models: models.filter((m) => m.images).map((m) => ({ id: m.id, label: m.label })) };
        } catch (err) {
          return { id: p.id, label: p.label, unavailable: errorMessage(err), models: [] };
        }
      }),
  );
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
  ctx.ai.onSettingsChange(() => reader.kick()); // a vision provider turned on
  const engineStatus = async (): Promise<{ windows: EngineStatus; vision: EngineStatus }> => {
    const vision = settingsVision(ctx);
    return { windows: await ocr.status(), vision: 'unavailable' in vision ? { ready: false, detail: vision.unavailable } : { ready: true, detail: vision.name.split(':').slice(1).join(' · ') } };
  };
  ctx.channels.serve({
    status: async (): Promise<ImageTextStatus> => ({ ...(await engineStatus()), providers: await visionProviders(ctx), counts: counts(db) }),
    // Normalized: a pick that isn't one is refused, not read as Settings' engine.
    request: (messageId, pick) => {
      const picked = pick === null ? null : normalizePick(pick);
      if (pick !== null && !picked) throw new Error('Not an engine image text reads with.');
      reader.request(messageId, picked);
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
