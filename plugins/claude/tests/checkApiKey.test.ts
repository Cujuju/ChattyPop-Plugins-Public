import { describe, expect, it, vi } from 'vitest';
import { checkApiKey } from '../core/checkApiKey';

const KEY = 'test-key';
describe('Anthropic key validation', () => {
  it('uses the declared model endpoint, version and a bounded signal', async () => {
    const fetch = vi.fn(async () => new Response('{}'));
    await checkApiKey(fetch, KEY);
    expect(fetch).toHaveBeenCalledWith('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01' }, signal: expect.any(AbortSignal),
    });
  });
  it.each([401, 403, 429, 500])('reports HTTP %s without reading a vendor error body', async (status) => {
    const fetch = async () => new Response(KEY, { status });
    await expect(checkApiKey(fetch, KEY)).rejects.toThrow(status === 401 || status === 403 ? 'Anthropic rejected that key.' : `Anthropic key check failed: HTTP ${status}`);
  });
  it('does not echo a transport error containing the key', async () => {
    const fetch = async (): Promise<Response> => { throw new Error(KEY); };
    await expect(checkApiKey(fetch, KEY)).rejects.toThrow('Anthropic key check failed: could not reach Anthropic.');
  });
});
