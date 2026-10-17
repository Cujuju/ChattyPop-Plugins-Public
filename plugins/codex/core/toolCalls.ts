import type { ToolOutcome } from '@plugin-sdk/core';
import type { JsonRpcStdio } from './jsonRpcStdio';

interface ToolCall {
  threadId: string;
  turnId: string;
  callId: string;
  tool: string;
  arguments: unknown;
}
type Handler = (call: ToolCall) => Promise<ToolOutcome>;
interface Routes { threads: Map<string, Handler>; off(): void }
const routes = new WeakMap<JsonRpcStdio, Routes>();

/** Several completions share one connection; each thread owns only its requested tools. */
export function handleToolCalls(rpc: JsonRpcStdio, threadId: string, handler: Handler): () => void {
  let entry = routes.get(rpc);
  if (!entry) {
    const threads = new Map<string, Handler>();
    const off = rpc.handleRequest('item/tool/call', async (params) => {
      const call = params as ToolCall;
      const handle = threads.get(call.threadId);
      const outcome = handle ? await handle(call) : { ok: false, text: 'No active tool request for this thread.' };
      return { contentItems: [{ type: 'inputText', text: outcome.text }], success: outcome.ok };
    });
    entry = { threads, off };
    routes.set(rpc, entry);
  }
  const active = entry;
  active.threads.set(threadId, handler);
  return () => {
    active.threads.delete(threadId);
    if (active.threads.size) return;
    active.off();
    routes.delete(rpc);
  };
}
