import { describe, expect, it, vi } from 'vitest';
import { sseData } from '../core/sse';
import { rawResponse } from './streamFixture';

async function collect(response: Response, signal = new AbortController().signal): Promise<string[]> {
  const result: string[] = [];
  for await (const value of sseData(response.body, signal)) result.push(value);
  return result;
}

describe('OpenRouter SSE framing', () => {
  it('ignores comments and other fields, joins data lines, and stops at DONE', async () => {
    const response = rawResponse([
      ': OPENROUTER PROCESSING\n\nevent: message\nid: ignored\ndata: {"first":\ndata: true}\n\n',
      ': another comment\ndata:{"second":true}\n\ndata: [DONE]\n\ndata: never parsed\n\n',
    ]);
    await expect(collect(response)).resolves.toEqual(['{"first":\ntrue}', '{"second":true}']);
    expect(response.body?.locked).toBe(false);
  });

  it('buffers fields, CRLF, JSON, UTF-8 characters, and DONE across single-byte reads', async () => {
    const bytes = new TextEncoder().encode(': OPENROUTER PROCESSING\r\ndata: {"text":"Hi 🌟"}\r\n\r\ndata: [DONE]\r\n\r\ndata: ignored\r\n\r\n');
    const response = rawResponse([...bytes].map((byte) => Uint8Array.of(byte)));
    await expect(collect(response)).resolves.toEqual(['{"text":"Hi 🌟"}']);
  });

  it('accepts bare CR delimiters and a final event without a trailing newline', async () => {
    await expect(collect(rawResponse(['data: one\r\rdata: two\r\rdata: [DONE]']))).resolves.toEqual(['one', 'two']);
  });

  it.each(['', ': keepalive\n\n', 'data: last', 'data: last\n\n'])('rejects EOF without DONE: %j', async (wire) => {
    const response = rawResponse([wire]);
    await expect(collect(response)).rejects.toThrow("OpenRouter's response ended early.");
    expect(response.body?.locked).toBe(false);
  });

  it('cancels and unlocks the body at DONE even if the connection stays open', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); },
      cancel,
    });
    await expect(collect(new Response(body))).resolves.toEqual([]);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it('aborts a pending read with the caller reason and cancels the body', async () => {
    const cancel = vi.fn();
    const started = Promise.withResolvers<void>();
    const controller = new AbortController();
    const reason = new Error('Stopped');
    const body = new ReadableStream<Uint8Array>({ pull: () => started.resolve(), cancel }, { highWaterMark: 0 });
    const pending = collect(new Response(body), controller.signal);
    const rejected = expect(pending).rejects.toBe(reason);
    await started.promise;
    controller.abort(reason);
    await rejected;
    expect(cancel).toHaveBeenCalledWith(reason);
    expect(body.locked).toBe(false);
  });

  it('cancels an already-aborted request and rejects a missing body', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    await expect(collect(new Response(body), AbortSignal.abort(new Error('Already stopped')))).rejects.toThrow('Already stopped');
    expect(cancel).toHaveBeenCalledOnce();
    await expect(collect(new Response(null))).rejects.toThrow('OpenRouter: missing response body.');
  });
});
