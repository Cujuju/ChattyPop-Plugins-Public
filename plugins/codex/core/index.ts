// Codex's core side: registers the provider over one warm app-server, stopped when the plugin turns off (law 5).
import { defineCorePlugin, signedInCli } from '@plugin-sdk/core';
import { plugin } from '../shared';
import { CODEX_CLI, CodexProvider } from './codex';
import { checkApiKey } from './checkApiKey';

export default defineCorePlugin(plugin, (ctx) => {
  const key = () => ctx.ai.apiKey('codex');
  const codex = new CodexProvider((model, usage) => ctx.ai.apiCost(model, usage), key);
  ctx.ai.registerProvider('codex', signedInCli(CODEX_CLI, codex, { apiKey: key, check: (value) => checkApiKey(ctx.net.fetch, value) }));
  return () => codex.dispose();
});
