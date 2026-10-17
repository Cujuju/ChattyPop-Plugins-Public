import { describe, expect, it, onTestFinished } from 'vitest';
import { defineCorePlugin } from '@plugin-sdk/core';
import { testPlugin } from '@plugin-sdk/core/testing';
import ollamaCore from '../core';
import { OllamaProvider } from '../core/ollama';
import { plugin } from '../shared';
import { OLLAMA_DEFAULT_URL } from '../shared/settings';

describe('Ollama model tools capability', () => {
  it('declares tools and lists them only for models whose show response includes tools', async () => {
    let p!: OllamaProvider;
    const names = ['capable', 'plain', 'old-server', 'unavailable', 'invalid'];
    const t = testPlugin(defineCorePlugin(plugin, (ctx) => {
      p = new OllamaProvider(ctx.net.fetch, OLLAMA_DEFAULT_URL, null);
      return ollamaCore.activate(ctx);
    }), {
      network: async (url, init) => {
        if (url.pathname === '/api/tags') return Response.json({ models: names.map((name) => ({ name, size: 1, digest: name })) });
        expect(url.pathname).toBe('/api/show');
        const { model } = JSON.parse(String(init.body)) as { model: string };
        if (model === 'capable') return Response.json({ capabilities: ['completion', 'tools', 'vision', 'thinking'] });
        if (model === 'plain') return Response.json({ capabilities: ['completion'] });
        if (model === 'unavailable') return new Response(null, { status: 404 });
        if (model === 'invalid') return new Response('invalid JSON');
        return Response.json({});
      },
    });
    onTestFinished(() => t.dispose());
    expect(plugin.providers[0]!.tools).toBe(true);
    expect(await p.listModels()).toEqual([
      { id: 'capable', label: 'capable', bytes: 1, tools: true, images: true, efforts: ['off', 'on'], isDefault: true },
      ...names.slice(1).map((id) => ({ id, label: id, bytes: 1 })),
    ]);
  });
});
