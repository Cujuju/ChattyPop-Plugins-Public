// Ollama's core side: registers the local provider at the owner's address, read per request, and installs models.
import { defineCorePlugin, type ProviderReport } from '@plugin-sdk/core';
import { errorMessage } from '@plugin-sdk/shared';
import { INSTALLED_EVENT, PULLS_EVENT, plugin } from '../shared';
import { OllamaProvider, applyUnloadAfter } from './ollama';
import { ModelPulls } from './pulls';

export default defineCorePlugin(plugin, (ctx) => {
  const settings = () => ctx.preferences.get('settings');
  const provider = (model: string | null): OllamaProvider => new OllamaProvider(ctx.net.fetch, settings().ollamaUrl, model, settings().unloadAfterS);
  ctx.ai.registerProvider('ollama', {
    create: (choice) => provider(choice.model),
    status: async (choice): Promise<ProviderReport> => {
      try {
        const models = await provider(choice.model).listModels(); // local and cheap: never kept
        return { available: models.length > 0, detail: models.length ? `${models.length} model(s) installed` : 'No models installed', models };
      } catch (err) {
        // Not running or unreachable: a state Settings → AI shows, not a plugin failure.
        return { available: false, detail: errorMessage(err), models: null };
      }
    },
  });
  const pulls = new ModelPulls(
    ctx.net.fetch,
    () => settings().ollamaUrl,
    (list) => ctx.channels.emit(PULLS_EVENT, list),
    (model) => ctx.channels.emit(INSTALLED_EVENT, model),
    ctx.lifetime.signal,
  );
  ctx.channels.serve({
    pulls: () => pulls.list(),
    pull: (model) => pulls.pull(model),
    cancelPull: (model) => pulls.cancel(model),
  });
  let unloadAfterS = settings().unloadAfterS;
  ctx.preferences.onChange('settings', () => {
    const s = settings();
    if (s.unloadAfterS === unloadAfterS) return;
    unloadAfterS = s.unloadAfterS;
    // Unreachable: nothing it holds is loaded here, and the next request carries the new time.
    applyUnloadAfter(ctx.net.fetch, s.ollamaUrl, s.unloadAfterS).catch((err: unknown) => console.warn(`[ollama] Unload time not applied to loaded models: ${errorMessage(err)}`));
  });
  return () => pulls.dispose();
});
