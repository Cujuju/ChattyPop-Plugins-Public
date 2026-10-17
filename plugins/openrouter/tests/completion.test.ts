import { describe, expect, it, vi } from 'vitest';
import type { CompletionEvent } from '@plugin-sdk/core';
import { plugin } from '../shared';
import { data, delta, KEY, MODEL, rawResponse, REQUEST, scripted, streamed } from './streamFixture';

describe('OpenRouter completion paths', () => {
  it('keeps the plain JSON request and response unchanged', async () => {
    const { provider, bodies, auths } = scripted([Response.json({
      choices: [{ message: { content: 'Answer' } }],
      usage: { prompt_tokens: 12, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 3 }, cost: 0.02 },
    })]);
    await expect(provider.complete({ ...REQUEST, effort: 'low', maxOutputTokens: 8 })).resolves.toEqual({
      text: 'Answer', usage: { inputTokens: 12, outputTokens: 4, cachedInputTokens: 3 }, apiCostUsd: 0.02,
    });
    expect(bodies).toEqual([{
      model: MODEL,
      messages: [{ role: 'system', content: REQUEST.system }, { role: 'user', content: REQUEST.prompt }],
      reasoning: { effort: 'low' },
    }]);
    expect(auths).toEqual([`Bearer ${KEY.key}`]);
  });

  it('keeps schema output non-streaming even with an event callback', async () => {
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } } };
    const onEvent = vi.fn();
    const { provider, bodies } = scripted([Response.json({ choices: [{ message: { content: '{"ok":true}' } }] })]);
    await expect(provider.complete({ ...REQUEST, schema, onEvent, effort: 'high' })).resolves.toEqual({ text: '{"ok":true}', json: { ok: true } });
    expect(bodies).toEqual([{
      model: MODEL,
      messages: [{ role: 'system', content: REQUEST.system }, { role: 'user', content: REQUEST.prompt }],
      reasoning: { effort: 'high' },
      response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema } },
      provider: { require_parameters: true },
    }]);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('sends history as native messages before the new user content, retaining images', async () => {
    const { provider, bodies } = scripted([Response.json({ choices: [{ message: { content: 'Answer' } }] })]);
    await provider.complete({
      ...REQUEST,
      history: [{ role: 'user', text: 'Earlier question' }, { role: 'assistant', text: 'Earlier answer' }],
      images: [{ mediaType: 'image/png', data: 'QUJD' }],
    });
    expect(bodies[0]).toEqual({
      model: MODEL,
      messages: [
        { role: 'system', content: REQUEST.system },
        { role: 'user', content: 'Earlier question' },
        { role: 'assistant', content: 'Earlier answer' },
        { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } }, { type: 'text', text: REQUEST.prompt }] },
      ],
    });
  });

  it('joins text deltas and reads usage after the finish chunk', async () => {
    const events: CompletionEvent[] = [];
    const { provider, bodies } = scripted([rawResponse([
      ': OPENROUTER PROCESSING\n\n',
      data(delta({ role: 'assistant', content: 'Hi ' })),
      data({ choices: [{ delta: { content: '🌟' }, finish_reason: 'stop' }] }),
      data({ choices: [{ delta: { content: '' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0 } }),
      'data: [DONE]\n\n',
    ])]);
    const result = await provider.complete({ ...REQUEST, onEvent: (event) => events.push(event) });
    expect(result).toEqual({ text: 'Hi 🌟', usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 2 }, apiCostUsd: 0 });
    expect(events).toEqual([{ type: 'text', delta: 'Hi ' }, { type: 'text', delta: '🌟' }]);
    expect(bodies[0]).toEqual({
      model: MODEL, messages: [{ role: 'system', content: REQUEST.system }, { role: 'user', content: REQUEST.prompt }], stream: true,
    });
  });

  it('leaves unknown usage and cost absent', async () => {
    const { provider } = scripted([streamed(delta({ content: 'Answer' }))]);
    await expect(provider.complete({ ...REQUEST, onEvent: () => {} })).resolves.toEqual({ text: 'Answer' });
    const other = scripted([streamed(delta({ content: 'Answer' }), { choices: [], usage: { prompt_tokens: 2, completion_tokens: 1 } })]);
    await expect(other.provider.complete({ ...REQUEST, onEvent: () => {} })).resolves.toEqual({
      text: 'Answer', usage: { inputTokens: 2, outputTokens: 1, cachedInputTokens: 0 },
    });
  });

  it('declares tool support and marks only listed models whose parameters include tools', async () => {
    expect(plugin.providers[0].tools).toBe(true);
    const { provider } = scripted([Response.json({ data: [
      { id: 'tools', name: 'Tools', supported_parameters: ['structured_outputs', 'tools'], architecture: { input_modalities: ['image'] } },
      { id: 'text', name: 'Text', supported_parameters: ['structured_outputs'] },
      { id: 'no-schema', name: 'No schema', supported_parameters: ['tools'] },
    ] })]);
    const models = await provider.listModels();
    expect(models.map((model) => model.id)).toEqual(['openrouter/auto', 'text', 'tools']);
    expect(models.filter((model) => model.tools).map((model) => model.id)).toEqual(['tools']);
    expect(models.find((model) => model.id === 'tools')).toMatchObject({ images: true, tools: true });
  });
});
