// Completion errors distinguish a generation limit from malformed output, without exposing generated text.
import { describe, expect, it, vi } from 'vitest';
import type { CompletionRequest } from '@plugin-sdk/core';
import { OllamaProvider } from '../core/ollama';
import { OLLAMA_DEFAULT_URL } from '../shared/settings';

const MODEL = 'qwen3-vl:8b-instruct';
const SCHEMA = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] };
const REQUEST: CompletionRequest = { system: 'Read an image.', prompt: 'Transcribe its text.', schema: SCHEMA, maxOutputTokens: 2048 };

function provider(response: Response) {
  const net = vi.fn(async (_url: string, _init?: RequestInit) => response);
  return { net, p: new OllamaProvider(net, OLLAMA_DEFAULT_URL, MODEL) };
}

describe('Ollama completion responses', () => {
  it('returns completed structured output and usage with the existing request options', async () => {
    const content = '{"text":"hello"}';
    const { p, net } = provider(Response.json({ message: { content }, done: true, done_reason: 'stop', prompt_eval_count: 3800, eval_count: 12 }));
    expect(await p.complete(REQUEST)).toEqual({ text: content, json: { text: 'hello' }, usage: { inputTokens: 3800, cachedInputTokens: 0, outputTokens: 12 } });
    expect(net).toHaveBeenCalledOnce();
    expect(JSON.parse(String(net.mock.calls[0]![1]?.body))).toMatchObject({ model: MODEL, stream: false, format: SCHEMA, options: { num_ctx: 16_384, num_predict: 2048 } });
  });

  it.each([
    { name: 'unfinished JSON', content: '{"text":"SAP\\n', schema: SCHEMA },
    { name: 'parseable JSON', content: '{"text":"first line"}', schema: SCHEMA },
    { name: 'plain text', content: 'A partial answer', schema: undefined },
  ])('rejects token-limited $name before accepting any output', async ({ content, schema }) => {
    const { p } = provider(Response.json({ message: { content }, done: true, done_reason: 'length', eval_count: 2048 }));
    await expect(p.complete({ ...REQUEST, schema, model: 'chosen-model' })).rejects.toThrow('Ollama (chosen-model) reached its output token limit; the response may be incomplete (stop reason: length; output tokens: 2048).');
  });

  it('reports a server-side output limit even without a requested cap or token count', async () => {
    const { p } = provider(Response.json({ done: true, done_reason: 'length' }));
    await expect(p.complete({ system: 's', prompt: 'p' })).rejects.toThrow('Ollama (qwen3-vl:8b-instruct) reached its output token limit; the response may be incomplete (stop reason: length).');
  });

  it('identifies malformed generated JSON with completion metadata and no generated text', async () => {
    const { p } = provider(Response.json({ message: { content: 'private generated text' }, done: true, done_reason: 'stop', eval_count: 15 }));
    await expect(p.complete(REQUEST)).rejects.toThrow('Ollama (qwen3-vl:8b-instruct) returned malformed JSON (stop reason: stop; output tokens: 15).');
  });

  it('accepts plain text without parsing it as JSON', async () => {
    const { p } = provider(Response.json({ message: { content: 'An ordinary answer' }, done: true, done_reason: 'stop', eval_count: 4 }));
    expect(await p.complete({ system: 's', prompt: 'p' })).toEqual({ text: 'An ordinary answer', usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 4 } });
  });

  it('keeps compatibility with responses that omit stop metadata', async () => {
    const { p } = provider(Response.json({ message: { content: '{"text":"hello"}' } }));
    expect(await p.complete(REQUEST)).toMatchObject({ json: { text: 'hello' } });
  });

  it('rejects an explicitly unfinished response even when its JSON parses', async () => {
    const { p } = provider(Response.json({ message: { content: '{"text":"partial"}' }, done: false, eval_count: 10 }));
    await expect(p.complete(REQUEST)).rejects.toThrow('returned an unfinished response (stop reason not reported; output tokens: 10).');
  });

  it('reports invalid API JSON separately from malformed generated JSON', async () => {
    const { p } = provider(new Response('not an API JSON response'));
    await expect(p.complete(REQUEST)).rejects.toThrow('Ollama (qwen3-vl:8b-instruct) returned an invalid API response.');
  });

  it.each([null, {}, { message: {} }, { message: { content: 42 } }])('reports missing response text instead of throwing a property-access error: %j', async (body) => {
    const { p } = provider(Response.json(body));
    await expect(p.complete(REQUEST)).rejects.toThrow('returned no response text (stop reason not reported).');
  });

  it('preserves a server-reported generation error in a successful HTTP response', async () => {
    const { p } = provider(Response.json({ error: 'prediction aborted, token repeat limit reached' }));
    await expect(p.complete(REQUEST)).rejects.toThrow('Ollama (qwen3-vl:8b-instruct): prediction aborted, token repeat limit reached');
  });

  it('preserves HTTP failures such as the repeat guard', async () => {
    const { p } = provider(Response.json({ error: 'prediction aborted, token repeat limit reached' }, { status: 500 }));
    await expect(p.complete(REQUEST)).rejects.toThrow('Ollama 500: {"error":"prediction aborted, token repeat limit reached"}');
  });

  it('preserves cancellation while reading the API response', async () => {
    const cancelled = new DOMException('The request was aborted.', 'AbortError');
    const { p } = provider(new Response(new ReadableStream({ start(c) { c.error(cancelled); } })));
    await expect(p.complete(REQUEST)).rejects.toBe(cancelled);
  });
});
