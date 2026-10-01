// Ollama models: installing through Ollama's /api/pull (progress over every layer, failures kept until dismissed,
// cancel), and the owner's unload time sent with each request and applied to models already loaded.
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import ollamaCore from '../core';
import { OllamaProvider } from '../core/ollama';
import { normalizeOllamaSettings, OLLAMA_DEFAULT_URL } from '../shared/settings';

const MODEL = 'qwen3-vl:8b-instruct';

/** A streamed /api/pull answer the test writes line by line; the request's abort errors it, as fetch does. */
function pullStream(signal: AbortSignal | null | undefined) {
  let push!: (line: object) => void, end!: () => void;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      push = (line) => c.enqueue(new TextEncoder().encode(`${JSON.stringify(line)}\n`));
      end = () => c.close();
      signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
    },
  });
  return { response: new Response(body), push: (line: object) => push(line), end: () => end() };
}

function start(answer: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const sent: { url: string; body: unknown; signal: AbortSignal | null }[] = [];
  const t = testPlugin(ollamaCore, {
    network: async (url, init) => {
      sent.push({ url: url.pathname, body: init.body ? JSON.parse(String(init.body)) : null, signal: init.signal ?? null });
      return answer(url, init);
    },
  });
  onTestFinished(() => t.dispose());
  return { t, sent, renderer: t.client('renderer') };
}

describe('installing a model', () => {
  it('reports progress over every layer, then installed, and lists nothing once done', async () => {
    let stream!: ReturnType<typeof pullStream>;
    const { t, sent, renderer } = start((_url, init) => (stream = pullStream(init.signal)).response);
    await renderer.pull(` ${MODEL} `);
    await vi.waitFor(() => expect(sent.map((s) => s.url)).toEqual(['/api/pull']));
    expect(sent[0]!.body).toEqual({ model: MODEL, stream: true });
    stream.push({ status: 'pulling manifest' });
    stream.push({ status: 'pulling a', digest: 'sha256:a', total: 100, completed: 50 });
    stream.push({ status: 'pulling b', digest: 'sha256:b', total: 200, completed: 25 });
    await vi.waitFor(async () => expect(await renderer.pulls()).toEqual([{ model: MODEL, state: 'downloading', step: 'pulling b', completed: 75, total: 300, error: null }]));
    stream.push({ status: 'verifying sha256 digest' });
    stream.push({ status: 'success' });
    stream.end();
    await vi.waitFor(() => expect(t.events('installed')).toEqual([MODEL]));
    expect(await renderer.pulls()).toEqual([]);
    expect(t.events('pulls').at(-1)).toEqual([]);
  });

  it('keeps a failure (an error line, or an HTTP error’s message) until dismissed, and a new pull clears it', async () => {
    let n = 0;
    const { renderer } = start((_url, init) => {
      if (n++ === 0) return Response.json({ error: 'pull model manifest: file does not exist' }, { status: 500 });
      const s = pullStream(init.signal);
      s.push({ error: 'max retries exceeded' });
      s.end();
      return s.response;
    });
    await renderer.pull('nope:1b');
    await vi.waitFor(async () => expect(await renderer.pulls()).toMatchObject([{ model: 'nope:1b', state: 'failed', error: 'pull model manifest: file does not exist' }]));
    await renderer.pull('nope:1b');
    await vi.waitFor(async () => expect(await renderer.pulls()).toMatchObject([{ model: 'nope:1b', state: 'failed', error: 'max retries exceeded' }]));
    await renderer.cancelPull('nope:1b');
    expect(await renderer.pulls()).toEqual([]);
  });

  it('a stream that ends without success is a failure', async () => {
    const { renderer } = start((_url, init) => {
      const s = pullStream(init.signal);
      s.push({ status: 'pulling manifest' });
      s.end();
      return s.response;
    });
    await renderer.pull(MODEL);
    await vi.waitFor(async () => expect(await renderer.pulls()).toMatchObject([{ state: 'failed', error: 'Ollama stopped before the download finished.' }]));
  });

  it('cancel stops the download without listing a failure; turning the plugin off stops one too', async () => {
    const { t, sent, renderer } = start((_url, init) => pullStream(init.signal).response);
    await renderer.pull(MODEL);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await renderer.cancelPull(MODEL);
    expect(sent[0]!.signal?.aborted).toBe(true);
    await vi.waitFor(async () => expect(await renderer.pulls()).toEqual([]));
    expect(t.events('installed')).toEqual([]);

    await renderer.pull(MODEL);
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    await t.off();
    expect(sent[1]!.signal?.aborted).toBe(true);
  });

  it('refuses a blank name', async () => {
    const { renderer, sent } = start(() => new Response(null, { status: 500 }));
    await expect(renderer.pull('  ')).rejects.toThrow(/model name/);
    expect(sent).toEqual([]);
  });
});

describe('unload time', () => {
  it('is sent as keep_alive with each chat request, and left to Ollama when unset', async () => {
    const bodies: Record<string, unknown>[] = [];
    const net = async (_url: string, init?: RequestInit): Promise<Response> => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ message: { content: 'ok' } });
    };
    await new OllamaProvider(net, OLLAMA_DEFAULT_URL, 'm', 0).complete({ system: 's', prompt: 'p' });
    await new OllamaProvider(net, OLLAMA_DEFAULT_URL, 'm', null).complete({ system: 's', prompt: 'p' });
    expect(bodies[0]).toMatchObject({ keep_alive: 0 });
    expect(bodies[1]).not.toHaveProperty('keep_alive');
  });

  it('a new unload time reaches the models already loaded; Ollama’s setting resets them to its own', async () => {
    const loaded = [{ name: 'a:1b', context_length: 16_384 }, { name: 'b:7b', context_length: 65_536 }];
    const { t, sent } = start((url) => (url.pathname === '/api/ps' ? Response.json({ models: loaded }) : Response.json({ done: true })));
    t.preferences.set('settings', { ...t.preferences.get('settings'), unloadAfterS: 60 });
    // Each at the context window it's loaded with: another would reload it.
    await vi.waitFor(() =>
      expect(sent.filter((s) => s.url === '/api/generate').map((s) => s.body)).toEqual([
        { model: 'a:1b', options: { num_ctx: 16_384 }, keep_alive: 60 },
        { model: 'b:7b', options: { num_ctx: 65_536 }, keep_alive: 60 },
      ]),
    );
    sent.length = 0;
    // The address changing alone doesn't touch loaded models.
    t.preferences.set('settings', { ...t.preferences.get('settings'), ollamaUrl: 'http://127.0.0.1:11435' });
    t.preferences.set('settings', { ...t.preferences.get('settings'), ollamaUrl: OLLAMA_DEFAULT_URL, unloadAfterS: null });
    await vi.waitFor(() =>
      expect(sent.filter((s) => s.url === '/api/generate').map((s) => s.body)).toEqual([
        { model: 'a:1b', options: { num_ctx: 16_384 } },
        { model: 'b:7b', options: { num_ctx: 65_536 } },
      ]),
    );
    expect(sent.filter((s) => s.url === '/api/ps')).toHaveLength(1);
  });

  it('keeps only the listed choices', () => {
    expect(normalizeOllamaSettings({ unloadAfterS: 60 }).unloadAfterS).toBe(60);
    expect(normalizeOllamaSettings({ unloadAfterS: 61 }).unloadAfterS).toBeNull();
    expect(normalizeOllamaSettings({}).unloadAfterS).toBeNull();
  });
});
