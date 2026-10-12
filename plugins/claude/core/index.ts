import { cliAccounts, defineCorePlugin } from '@plugin-sdk/core';
import { plugin } from '../shared';
import { CLAUDE_CLI, ClaudeProvider } from './claude';
import { checkApiKey } from './checkApiKey';
import { signedIn, linkAccount, signOut } from './accounts';

export default defineCorePlugin(plugin, (ctx) => {
  ctx.ai.registerProvider('claude', cliAccounts({
    cli: CLAUDE_CLI,
    provider: (account) => new ClaudeProvider(account),
    checkApiKey: (key) => checkApiKey(ctx.net.fetch, key),
    signedIn, linkAccount, signOut,
  }));
});
