import type { ProviderAccount } from '@plugin-sdk/core';

export const API_KEY_ENV = 'ANTHROPIC_API_KEY';
const CREDENTIAL_ENVS = [API_KEY_ENV, 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'] as const;
const CLIENT_APP_ID = 'chattypop/0.1';

/** Linked sign-ins ignore inherited payment credentials; the machine account preserves its environment. */
export function accountEnv(account: ProviderAccount, key = account.apiKey()): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: CLIENT_APP_ID };
  if (account.auth === 'apiKey') {
    if (!key) throw new Error('Add an API key to use this account.');
    env[API_KEY_ENV] = key;
  } else if (account.auth === 'signIn') {
    if (!account.dir) throw new Error('Linked Claude account has no config folder.');
    for (const name of CREDENTIAL_ENVS) delete env[name];
    env.CLAUDE_CONFIG_DIR = account.dir;
  }
  return env;
}
