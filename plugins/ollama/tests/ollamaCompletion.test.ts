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

/** A response streamed as Ollama does, one JSON line per piece; `closed`: called when its reader closes it before the last. */
function streamed(lines: readonly (object | null)[]) {
  const closed = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const line of lines) c.enqueue(new TextEncoder().encode(`${JSON.stringify(line)}\n`));
      c.close();
    },
    cancel: closed,
  });
  return { response: new Response(body), closed };
}

describe('Ollama completion responses', () => {
  it('returns completed structured output and usage with the existing request options', async () => {
    const content = '{"text":"hello"}';
    const { p, net } = provider(Response.json({ message: { content }, done: true, done_reason: 'stop', prompt_eval_count: 3800, eval_count: 12 }));
    expect(await p.complete(REQUEST)).toEqual({ text: content, json: { text: 'hello' }, usage: { inputTokens: 3800, cachedInputTokens: 0, outputTokens: 12 } });
    expect(net).toHaveBeenCalledOnce();
    // The cap is not Ollama's `num_predict`, which counts thinking too.
    expect(JSON.parse(String(net.mock.calls[0]![1]?.body))).toMatchObject({ model: MODEL, stream: true, format: SCHEMA, options: { num_ctx: 16_384 } });
    expect(JSON.parse(String(net.mock.calls[0]![1]?.body)).options).not.toHaveProperty('num_predict');
  });

  it('limits the answer alone: thinking longer than the cap still answers', async () => {
    const thinking = Array.from({ length: 5 }, () => ({ message: { content: '', thinking: 'hm ' }, done: false }));
    const answer = ['{"text":', '"hi"', '}'].map((content) => ({ message: { content }, done: false }));
    const { p } = provider(streamed([...thinking, ...answer, { message: { content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 9, eval_count: 8 }]).response);
    expect(await p.complete({ ...REQUEST, maxOutputTokens: 3 })).toEqual({ text: '{"text":"hi"}', json: { text: 'hi' }, usage: { inputTokens: 9, cachedInputTokens: 0, outputTokens: 8 } });
  });

  it('rejects an answer longer than the cap, and stops the model by closing the stream', async () => {
    const s = streamed(['{"text":', '"a', ' long', ' answer', ' goes', ' on'].map((content) => ({ message: { content }, done: false })));
    const { p } = provider(s.response);
    await expect(p.complete({ ...REQUEST, maxOutputTokens: 3 })).rejects.toThrow('Ollama (qwen3-vl:8b-instruct) reached its output token limit; the response may be incomplete (answer limit: 3 tokens).');
    expect(s.closed).toHaveBeenCalledOnce();
  });

  it('says so when the model ran out of output while still thinking', async () => {
    const { p } = provider(streamed([{ message: { content: '', thinking: 'hm ' }, done: false }, { message: { content: '' }, done: true, done_reason: 'length', eval_count: 16_000 }]).response);
    await expect(p.complete(REQUEST)).rejects.toThrow('Ollama (qwen3-vl:8b-instruct) ran out of output while thinking and gave no answer (stop reason: length; output tokens: 16000).');
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

  it('accepts completed responses that omit the stop reason and usage', async () => {
    const { p } = provider(Response.json({ message: { content: '{"text":"hello"}' }, done: true }));
    expect(await p.complete(REQUEST)).toMatchObject({ json: { text: 'hello' } });
  });

  it('rejects a response without done even when its JSON parses', async () => {
    const { p } = provider(Response.json({ message: { content: '{"text":"partial"}' } }));
    await expect(p.complete(REQUEST)).rejects.toThrow('returned an unfinished response (stop reason not reported).');
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
    const { p } = provider(streamed([body, { done: true }]).response);
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
