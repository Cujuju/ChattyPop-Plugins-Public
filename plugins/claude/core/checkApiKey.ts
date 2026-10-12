import type { CoreContext } from '@plugin-sdk/core';

const MODELS_URL = 'https://api.anthropic.com/v1/models?limit=1';
const ANTHROPIC_VERSION = '2023-06-01';
/** Bounds a Settings key check when the vendor cannot be reached. */
const KEY_CHECK_TIMEOUT_MS = 10_000;
const REJECTED = new Set([401, 403]);

export async function checkApiKey(send: CoreContext['net']['fetch'], key: string): Promise<void> {
  let response: Response;
  try {
    response = await send(MODELS_URL, { headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION }, signal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS) });
  } catch {
    throw new Error('Anthropic key check failed: could not reach Anthropic.');
  }
  await response.body?.cancel();
  if (!response.ok) throw new Error(REJECTED.has(response.status) ? 'Anthropic rejected that key.' : `Anthropic key check failed: HTTP ${response.status}`);
}
