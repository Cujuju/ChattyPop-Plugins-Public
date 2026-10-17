import { expect, onTestFinished, vi } from 'vitest';
import { defineCorePlugin, type OpenRouterKeyEntry } from '@plugin-sdk/core';
import { testPlugin } from '@plugin-sdk/core/testing';
import { OpenRouterProvider } from '../core/openrouter';
import { plugin } from '../shared';

export const MODEL = 'example/chat';
export const KEY: OpenRouterKeyEntry = { id: 'test', label: 'Test', key: 'sk-test', hint: '…', models: [MODEL], anyModel: false };
export const REQUEST = { system: 'System', prompt: 'Question' };
export const PARAMETERS = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] };
export const tool = (run = vi.fn(async (_args: unknown, _signal: AbortSignal) => 'Found a message')) => ({
  name: 'search_messages', description: 'Search messages', parameters: PARAMETERS, run,
});
export const toolSpec = { type: 'function', function: { name: 'search_messages', description: 'Search messages', parameters: PARAMETERS } };
export const delta = (value: unknown) => ({ choices: [{ delta: value }] });
export const data = (value: unknown): string => `data: ${JSON.stringify(value)}\n\n`;
export const callDelta = (id: string, args = '{}', name = 'search_messages', index = 0) => delta({
  tool_calls: [{ index, id, type: 'function', function: { name, arguments: args } }],
});

export function rawResponse(parts: readonly (string | Uint8Array)[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(typeof part === 'string' ? encoder.encode(part) : part);
      controller.close();
    },
  }), { headers: { 'content-type': 'text/event-stream' } });
}

export const streamed = (...chunks: unknown[]): Response => rawResponse([...chunks.map(data), 'data: [DONE]\n\n']);

/** Runs the provider over the host's declared-host network adapter with scripted wire responses. */
export function scripted(responses: readonly Response[]) {
  const bodies: Record<string, unknown>[] = [];
  const auths: (string | null)[] = [];
  const forModel = vi.fn(() => KEY);
  let provider!: OpenRouterProvider;
  const t = testPlugin(defineCorePlugin(plugin, (ctx) => {
    provider = new OpenRouterProvider(ctx.net.fetch, {
      forModel,
      balance: async () => ({ limitUsd: null, remainingUsd: null, limitReset: null, usageMonthlyUsd: 0 }),
    }, MODEL);
    ctx.ai.registerProvider('openrouter', {
      create: () => provider,
      status: async () => ({ available: true, detail: 'Test', models: [] }),
    });
  }), {
    network: async (url, init) => {
      expect(url.origin).toBe('https://openrouter.ai');
      bodies.push(JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>);
      auths.push(new Headers(init.headers).get('authorization'));
      const response = responses[bodies.length - 1];
      if (!response) throw new Error('Unexpected OpenRouter request.');
      return response;
    },
  });
  onTestFinished(() => t.dispose());
  expect(t.status()).toEqual({ status: 'active', error: null });
  return { provider, bodies, auths, forModel };
}
