// Claude's core side: registers the provider; ChattyPop never touches Claude credentials (law 5).
import { defineCorePlugin, signedInCli } from '@plugin-sdk/core';
import { plugin } from '../shared';
import { CLAUDE_CLI, ClaudeProvider } from './claude';

export default defineCorePlugin(plugin, (ctx) => {
  ctx.ai.registerProvider('claude', signedInCli(CLAUDE_CLI, new ClaudeProvider()));
});
