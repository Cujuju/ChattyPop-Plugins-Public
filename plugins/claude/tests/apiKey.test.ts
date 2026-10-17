import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Options } from '@anthropic-ai/claude-agent-sdk';

const options: Options[] = [];
let messages: unknown[] = [];
/** Thrown by the run after its messages. */
let failure: Error | null = null;
const close = vi.fn();
vi.mock('@core/ai/resolveCli', () => ({ resolveCli: () => ({ command: 'test-claude', args: [] }) }));
vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => ({
  ...await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>(),
  query: ({ options: value }: { options: Options }) => {
    options.push(value);
    return { close, [Symbol.asyncIterator]: async function* () { yield* messages; if (failure) throw failure; } };
  },
}));
const { ClaudeProvider } = await import('../core/claude');
const KEY = 'test-key';
const REQUEST = { system: '', prompt: 'hello' };
const RESULT = { type: 'result', subtype: 'success', result: 'answer', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 };
const CHAT_REQUEST = {
  ...REQUEST, history: [{ role: 'user' as const, text: 'earlier' }], maxToolCalls: 1, onEvent: vi.fn(),
  tools: [{ name: 'lookup', description: 'Lookup', parameters: { type: 'object', properties: {} }, run: async () => 'found' }],
};

afterEach(() => { options.length = 0; messages = []; failure = null; close.mockClear(); vi.unstubAllEnvs(); });

describe('Claude owner key', () => {
  it('passes a stored key only through the child environment and confirms its source', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'inherited-test-key');
    messages = [{ type: 'system', subtype: 'init', apiKeySource: 'ANTHROPIC_API_KEY' }, RESULT];
    await expect(new ClaudeProvider({ id: 'claude@api', auth: 'apiKey', apiKey: () => KEY, dir: null }).complete(REQUEST)).resolves.toMatchObject({ text: 'answer' });
    expect(options[0]?.env?.ANTHROPIC_API_KEY).toBe(KEY);
    expect(process.env.ANTHROPIC_API_KEY).toBe('inherited-test-key');
    expect(close).toHaveBeenCalledOnce();
  });
  it('no stored key preserves the inherited environment and sign-in', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'inherited-test-key');
    messages = [RESULT];
    await new ClaudeProvider({ id: 'claude', auth: 'cli', apiKey: () => null, dir: null }).complete(REQUEST);
    expect(options[0]?.env).toEqual({ ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'chattypop/0.1' });
  });
  it.each(['oauth', 'none', 'apiKeyHelper'])('stops when init selects %s', async (apiKeySource) => {
    messages = [{ type: 'system', subtype: 'init', apiKeySource }, RESULT];
    await expect(new ClaudeProvider({ id: 'claude@api', auth: 'apiKey', apiKey: () => KEY, dir: null }).complete(REQUEST)).rejects.toThrow('did not select your API key');
    expect(close).toHaveBeenCalledOnce();
  });
  it('refuses a result without payment confirmation', async () => {
    messages = [RESULT];
    await expect(new ClaudeProvider({ id: 'claude@api', auth: 'apiKey', apiKey: () => KEY, dir: null }).complete(REQUEST)).rejects.toThrow('did not confirm your API key');
  });
  it('reads the key per request, including removal', async () => {
    let key: string | null = KEY;
    const claude = new ClaudeProvider({ id: 'claude@api', auth: 'apiKey', apiKey: () => key, dir: null });
    messages = [{ type: 'system', subtype: 'init', apiKeySource: 'ANTHROPIC_API_KEY' }, RESULT];
    await claude.complete(REQUEST);
    key = null;
    messages = [RESULT];
    await expect(claude.complete(REQUEST)).rejects.toThrow('Add an API key');
    expect(options[0]?.env?.ANTHROPIC_API_KEY).toBe(KEY);
    expect(options).toHaveLength(1);
  });
  it('a failure that does not echo the key keeps its own error, so an abort stays an abort', async () => {
    failure = new DOMException('stopped', 'AbortError');
    await expect(new ClaudeProvider({ id: 'claude@api', auth: 'apiKey', apiKey: () => KEY, dir: null }).complete(REQUEST)).rejects.toBe(failure);
  });
  it('a failure that echoes the key is reported without it', async () => {
    failure = new Error(`rejected ${KEY}`);
    await expect(new ClaudeProvider({ id: 'claude@api', auth: 'apiKey', apiKey: () => KEY, dir: null }).complete(REQUEST)).rejects.toThrow('rejected [API key]');
  });
  it('API key payments have no plan usage and start no subprocess', async () => {
    await expect(new ClaudeProvider({ id: 'claude@api', auth: 'apiKey', apiKey: () => KEY, dir: null }).planUsage()).resolves.toBeNull();
    expect(options).toEqual([]);
  });
  it.each(['oauth', 'none', 'apiKeyHelper'])('keeps source verification with history, tools and streaming: %s', async (apiKeySource) => {
    messages = [{ type: 'system', subtype: 'init', apiKeySource }, RESULT];
    await expect(new ClaudeProvider({ id: 'claude@api', auth: 'apiKey', apiKey: () => KEY, dir: null }).complete(CHAT_REQUEST)).rejects.toThrow('did not select your API key');
    expect(close).toHaveBeenCalledOnce();
  });
  it('requires key confirmation for conversation requests too', async () => {
    messages = [RESULT];
    await expect(new ClaudeProvider({ id: 'claude@api', auth: 'apiKey', apiKey: () => KEY, dir: null }).complete(CHAT_REQUEST)).rejects.toThrow('did not confirm your API key');
  });
  it('redacts query and schema failures on the conversation path', async () => {
    const claude = new ClaudeProvider({ id: 'claude@api', auth: 'apiKey', apiKey: () => KEY, dir: null });
    failure = new Error(`rejected ${KEY}`);
    await expect(claude.complete(CHAT_REQUEST)).rejects.toThrow('rejected [API key]');
    await expect(claude.complete({ ...CHAT_REQUEST, tools: [{ ...CHAT_REQUEST.tools[0]!, name: KEY, parameters: { type: 'string' } }] })).rejects.toThrow('Claude tool "[API key]"');
  });
});
