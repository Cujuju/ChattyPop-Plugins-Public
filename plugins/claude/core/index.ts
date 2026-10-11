// Claude's core side: sign-in or an owner API key supplied through the child environment.
import { defineCorePlugin, signedInCli } from '@plugin-sdk/core';
import { plugin } from '../shared';
import { CLAUDE_CLI, ClaudeProvider } from './claude';
import { checkApiKey } from './checkApiKey';

export default defineCorePlugin(plugin, (ctx) => {
  const key = () => ctx.ai.apiKey('claude');
  ctx.ai.registerProvider('claude', signedInCli(CLAUDE_CLI, new ClaudeProvider(key), { apiKey: key, check: (value) => checkApiKey(ctx.net.fetch, value) }));
});
