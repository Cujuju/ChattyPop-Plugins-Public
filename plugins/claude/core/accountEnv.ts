import type { ProviderAccount } from '@plugin-sdk/core';

export const API_KEY_ENV = 'ANTHROPIC_API_KEY';
const CREDENTIAL_ENVS = [API_KEY_ENV, 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'] as const;
const CLIENT_APP_ID = 'chattypop/0.1';
/** Where Claude Code sends API requests, and extra headers it adds to each (`Name: value` lines). */
export const BASE_URL_ENV = 'ANTHROPIC_BASE_URL';
export const CUSTOM_HEADERS_ENV = 'ANTHROPIC_CUSTOM_HEADERS';
/** The proxy reads its client key here; Claude Code's own sign-in keeps the Authorization header. */
const PROXY_KEY_HEADER = 'X-Api-Key';

/** Linked sign-ins ignore inherited payment credentials; the machine account preserves its environment. A proxy replaces any inherited address. */
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
  const proxy = account.proxy?.() ?? null;
  if (proxy) {
    env[BASE_URL_ENV] = proxy.url;
    if (proxy.key) env[CUSTOM_HEADERS_ENV] = `${PROXY_KEY_HEADER}: ${proxy.key}`;
    else delete env[CUSTOM_HEADERS_ENV];
  }
  return env;
}
