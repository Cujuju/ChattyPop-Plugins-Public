import { cliAccounts, defineCorePlugin } from '@plugin-sdk/core';
import { plugin } from '../shared';
import { CODEX_CLI, CodexProvider } from './codex';
import { checkApiKey } from './checkApiKey';
import * as accounts from './accounts';

export default defineCorePlugin(plugin, (ctx) => {
  const providers = new Map<string, CodexProvider>();
  const provider = (account: import('@plugin-sdk/core').ProviderAccount): CodexProvider => {
    let kept = providers.get(account.id);
    if (!kept) { kept = new CodexProvider((model, usage) => ctx.ai.apiCost(model, usage), account); providers.set(account.id, kept); }
    return kept;
  };
  const impl = cliAccounts({
    cli: CODEX_CLI, provider,
    checkApiKey: (key) => checkApiKey(ctx.net.fetch, key),
    signedIn: (account) => accounts.signedIn(provider(account).connection),
    linkAccount: (account, io) => accounts.linkAccount(provider(account).connection, io),
    signOut: async (account) => {
      providers.delete(account.id);
      try { await accounts.signOut(provider(account).connection); } finally { providers.delete(account.id); }
    },
  });
  ctx.ai.registerProvider('codex', { ...impl,
    removeAccount: async (account) => { try { await impl.removeAccount!(account); } finally { providers.delete(account.id); } },
    dispose: () => { impl.dispose!(); providers.clear(); },
  });
});
