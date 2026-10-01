// OpenRouter's core side: registers the provider, paid by the host's key that lists the chosen model.
import { defineCorePlugin, sessionModels, type ProviderReport } from '@plugin-sdk/core';
import { errorMessage } from '@plugin-sdk/shared';
import { plugin } from '../shared';
import { DEFAULT_MODEL, OpenRouterProvider, listOpenRouterModels } from './openrouter';

export default defineCorePlugin(plugin, (ctx) => {
  const keys = ctx.ai.openRouterKeys;
  const models = sessionModels(() => listOpenRouterModels(ctx.net.fetch));
  ctx.ai.registerProvider('openrouter', {
    create: (choice) => new OpenRouterProvider(ctx.net.fetch, keys, choice.model ?? DEFAULT_MODEL),
    status: async (choice, refresh): Promise<ProviderReport> => {
      try {
        const listed = await models(refresh);
        const model = choice.model ?? DEFAULT_MODEL;
        const key = keys.forModel(model);
        if (key) return { available: true, detail: `Paid by key ${key.label}`, models: listed };
        const detail = keys.count() ? `No key pays for ${model}. Add it to a key below.` : 'Add an OpenRouter key to use OpenRouter';
        return { available: false, detail, models: listed };
      } catch (err) {
        // OpenRouter unreachable: a state Settings → AI shows, not a plugin failure.
        return { available: false, detail: errorMessage(err), models: null };
      }
    },
  });
});
