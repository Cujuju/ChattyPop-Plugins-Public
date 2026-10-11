import { describe, expect, it, vi } from 'vitest';
import { checkApiKey } from '../core/checkApiKey';

const KEY = 'test-key';
describe('OpenAI key validation', () => {
  it('uses the declared model endpoint and a bounded signal', async () => {
    const fetch = vi.fn(async () => new Response('{}'));
    await checkApiKey(fetch, KEY);
    expect(fetch).toHaveBeenCalledWith('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${KEY}` }, signal: expect.any(AbortSignal) });
  });
  it.each([401, 403, 429, 500])('reports HTTP %s without reading a vendor error body', async (status) => {
    const fetch = async () => new Response(KEY, { status });
    await expect(checkApiKey(fetch, KEY)).rejects.toThrow(status === 401 || status === 403 ? 'OpenAI rejected that key.' : `OpenAI key check failed: HTTP ${status}`);
  });
  it('does not echo a transport error containing the key', async () => {
    const fetch = async (): Promise<Response> => { throw new Error(KEY); };
    await expect(checkApiKey(fetch, KEY)).rejects.toThrow('OpenAI key check failed: could not reach OpenAI.');
  });
});
