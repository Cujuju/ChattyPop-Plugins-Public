/** Reads SSE data fields, joining multiline events and stopping at OpenRouter's terminal marker. */
export async function* sseData(body: ReadableStream<Uint8Array> | null, signal: AbortSignal): AsyncGenerator<string> {
  if (!body) throw new Error('OpenRouter: missing response body.');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  const abort = (): void => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      buffer += decoder.decode(value, { stream: !done });
      if (done) buffer += '\n\n';
      while (true) {
        const end = buffer.search(/[\r\n]/);
        if (end < 0 || (!done && end === buffer.length - 1 && buffer[end] === '\r')) break;
        const line = buffer.slice(0, end);
        const newlineLength = buffer[end] === '\r' && buffer[end + 1] === '\n' ? '\r\n'.length : '\n'.length;
        buffer = buffer.slice(end + newlineLength);
        if (line === '' && data.length) {
          const payload = data.join('\n');
          data = [];
          if (payload === '[DONE]') return;
          yield payload;
          signal.throwIfAborted();
        } else if (line.startsWith('data:')) {
          data.push(line.slice('data:'.length).replace(/^ /, ''));
        }
      }
      if (done) throw new Error("OpenRouter's response ended early.");
    }
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
