import { describe, expect, it, vi } from 'vitest';
import type { CompletionEvent } from '@plugin-sdk/core';
import { callDelta, data, delta, rawResponse, REQUEST, scripted, streamed, tool } from './streamFixture';

describe('OpenRouter stream failures and cancellation', () => {
  it('rejects a content round ending before DONE instead of returning a partial answer', async () => {
    const events: CompletionEvent[] = [];
    const { provider, bodies } = scripted([rawResponse([data(delta({ content: 'Partial' }))])]);
    await expect(provider.complete({ ...REQUEST, onEvent: (event) => events.push(event) })).rejects.toThrow("OpenRouter's response ended early.");
    expect(events).toEqual([{ type: 'text', delta: 'Partial' }]);
    expect(bodies).toHaveLength(1);
  });

  it('rejects a tool round ending before DONE without running tools or sending another request', async () => {
    const events: CompletionEvent[] = [];
    const lookup = tool();
    const { provider, bodies } = scripted([rawResponse([data(callDelta('call')), data({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })])]);
    await expect(provider.complete({ ...REQUEST, tools: [lookup], maxToolCalls: 1, onEvent: (event) => events.push(event) })).rejects.toThrow("OpenRouter's response ended early.");
    expect(lookup.run).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(bodies).toHaveLength(1);
  });

  it.each([false, true])('surfaces a mid-stream error with existing key-cap wording (text first: %s)', async (textFirst) => {
    const events: CompletionEvent[] = [];
    const error = { error: { message: 'limit', metadata: { limit_source: 'openrouter_key_limit' } } };
    const { provider, bodies } = scripted([streamed(...(textFirst ? [delta({ content: 'Partial' })] : []), error, delta({ content: 'Never emitted' }))]);
    await expect(provider.complete({ ...REQUEST, onEvent: (event) => events.push(event) })).rejects.toThrow('OpenRouter: Key "Test" reached its OpenRouter spending limit.');
    expect(events).toEqual(textFirst ? [{ type: 'text', delta: 'Partial' }] : []);
    expect(bodies).toHaveLength(1);
  });

  it('surfaces a mid-stream provider error and cancels the connection', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(data({ error: { message: 'Provider disconnected' } }))); },
      cancel,
    });
    const { provider } = scripted([new Response(body)]);
    await expect(provider.complete({ ...REQUEST, onEvent: () => {} })).rejects.toThrow('OpenRouter: Provider disconnected');
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it('reports a JSON error before streaming starts and non-JSON HTTP failures', async () => {
    const { provider } = scripted([Response.json({ error: { message: 'Unavailable' } }, { status: 503 })]);
    await expect(provider.complete({ ...REQUEST, onEvent: () => {} })).rejects.toThrow('OpenRouter: Unavailable');
    const html = scripted([new Response('<html>Bad Gateway</html>', { status: 502 })]);
    await expect(html.provider.complete({ ...REQUEST, onEvent: () => {} })).rejects.toThrow('OpenRouter: HTTP 502');
  });

  it('rejects malformed JSON frames and incomplete tool calls', async () => {
    const invalid = scripted([rawResponse(['data: {broken}\n\n'])]);
    await expect(invalid.provider.complete({ ...REQUEST, onEvent: () => {} })).rejects.toBeInstanceOf(SyntaxError);
    const incomplete = scripted([streamed(delta({ tool_calls: [{ index: 0, function: { name: 'search_messages', arguments: '{}' } }] }))]);
    await expect(incomplete.provider.complete({ ...REQUEST, tools: [tool()], maxToolCalls: 1 })).rejects.toThrow('OpenRouter: incomplete streamed tool call.');
  });

  it('aborts an idle body without text events, tool runs, or another round', async () => {
    const events: CompletionEvent[] = [];
    const started = Promise.withResolvers<void>();
    const cancel = vi.fn();
    const controller = new AbortController();
    const reason = new Error('Stopped reading');
    const body = new ReadableStream<Uint8Array>({ pull: () => started.resolve(), cancel }, { highWaterMark: 0 });
    const lookup = tool();
    const { provider, bodies } = scripted([new Response(body)]);
    const pending = provider.complete({ ...REQUEST, tools: [lookup], maxToolCalls: 1, signal: controller.signal, onEvent: (event) => events.push(event) });
    const rejected = expect(pending).rejects.toBe(reason);
    await started.promise;
    controller.abort(reason);
    await rejected;
    expect(events).toEqual([]);
    expect(lookup.run).not.toHaveBeenCalled();
    expect(bodies).toHaveLength(1);
    expect(cancel).toHaveBeenCalledWith(reason);
    expect(body.locked).toBe(false);
  });

  it('stops events and tool calls immediately when an event callback aborts', async () => {
    const events: CompletionEvent[] = [];
    const controller = new AbortController();
    const lookup = tool();
    const { provider, bodies } = scripted([streamed(delta({ content: 'First' }), delta({ content: 'Later' }), callDelta('never'))]);
    await expect(provider.complete({
      ...REQUEST, tools: [lookup], maxToolCalls: 1, signal: controller.signal,
      onEvent: (event) => { events.push(event); controller.abort(new Error('Stopped in callback')); },
    })).rejects.toThrow('Stopped in callback');
    expect(events).toEqual([{ type: 'text', delta: 'First' }]);
    expect(lookup.run).not.toHaveBeenCalled();
    expect(bodies).toHaveLength(1);
  });

  it('aborts a tool that ignores cancellation without a later result event or request', async () => {
    const events: CompletionEvent[] = [];
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<string>();
    const controller = new AbortController();
    const lookup = tool(vi.fn(async () => { started.resolve(); return finish.promise; }));
    const { provider, bodies } = scripted([streamed(callDelta('call'))]);
    const pending = provider.complete({ ...REQUEST, tools: [lookup], maxToolCalls: 1, signal: controller.signal, onEvent: (event) => events.push(event) });
    const rejected = expect(pending).rejects.toThrow('Stopped tool');
    await started.promise;
    controller.abort(new Error('Stopped tool'));
    await rejected;
    finish.resolve('Late answer');
    await finish.promise;
    expect(events).toEqual([{ type: 'toolCall', callId: 'call', name: 'search_messages', args: {} }]);
    expect(bodies).toHaveLength(1);
  });

  it('checks cancellation between a round separator and its following text delta', async () => {
    const events: CompletionEvent[] = [];
    const controller = new AbortController();
    const { provider } = scripted([
      streamed(delta({ content: 'Looking up.' }), callDelta('call')), streamed(delta({ content: 'Never emitted' })),
    ]);
    await expect(provider.complete({
      ...REQUEST, tools: [tool()], maxToolCalls: 1, signal: controller.signal,
      onEvent: (event) => {
        events.push(event);
        if (event.type === 'text' && event.delta === '\n\n') controller.abort(new Error('Stopped at separator'));
      },
    })).rejects.toThrow('Stopped at separator');
    expect(events.filter((event) => event.type === 'text')).toEqual([{ type: 'text', delta: 'Looking up.' }, { type: 'text', delta: '\n\n' }]);
  });
});
