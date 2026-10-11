import type { CoreContext } from '@plugin-sdk/core';

const MODELS_URL = 'https://api.openai.com/v1/models';
/** Bounds a Settings key check when the vendor cannot be reached. */
const KEY_CHECK_TIMEOUT_MS = 10_000;
const REJECTED = new Set([401, 403]);

export async function checkApiKey(send: CoreContext['net']['fetch'], key: string): Promise<void> {
  let response: Response;
  try {
    response = await send(MODELS_URL, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS) });
  } catch {
    throw new Error('OpenAI key check failed: could not reach OpenAI.');
  }
  await response.body?.cancel();
  if (!response.ok) throw new Error(REJECTED.has(response.status) ? 'OpenAI rejected that key.' : `OpenAI key check failed: HTTP ${response.status}`);
}
