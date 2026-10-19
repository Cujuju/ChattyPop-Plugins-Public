import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Launch } from '@plugin-sdk/core';

interface Started {
  launch: Launch;
  args: string[];
  env?: NodeJS.ProcessEnv;
  methods: string[];
  dispose: ReturnType<typeof vi.fn<() => void>>;
}
const started: Started[] = [];
let initialize: () => Promise<unknown> = async () => ({});
let modelProvider = 'chattypop';
let startThread: () => Promise<void> = async () => undefined;
vi.mock('@core/ai/asyncCli', () => ({ resolveCliAsync: async () => ({ command: 'node', args: ['test-codex'] }) }));
vi.mock('../core/jsonRpcStdio', () => ({
  JsonRpcStdio: class {
    private readonly state: Started;
    private readonly handlers = new Map<string, (value: unknown) => void>();
    readonly closed: Promise<Error>;
    constructor(launch: Launch, args: string[], env?: NodeJS.ProcessEnv) {
      let close!: (err: Error) => void;
      this.closed = new Promise((resolve) => { close = resolve; });
      this.state = { launch, args, env, methods: [], dispose: vi.fn(() => close(new Error('closed'))) };
      started.push(this.state);
    }
    request = async (method: string) => {
      if (this.state.dispose.mock.calls.length) throw new Error('codex app-server exited (1)');
      this.state.methods.push(method);
      if (method === 'initialize') return initialize();
      if (method === 'thread/start') {
        await startThread();
        return { thread: { id: 'thread' }, model: 'model', modelProvider };
      }
      if (method === 'turn/start') {
        this.handlers.get('item/completed')?.({ threadId: 'thread', item: { type: 'agentMessage', text: 'answer' } });
        this.handlers.get('turn/completed')?.({ threadId: 'thread', turn: { id: 'turn', status: 'completed', error: null } });
      }
      if (method === 'account/rateLimits/read') return { rateLimits: { primary: null, secondary: null } };
      return { data: [], nextCursor: null };
    };
    notify = () => undefined;
    on = (method: string, handler: (value: unknown) => void) => { this.handlers.set(method, handler); return () => this.handlers.delete(method); };
    dispose = () => this.state.dispose();
  },
}));
const { CodexProvider } = await import('../core/codex');
const { API_KEY_ENV } = await import('../core/connection');
const NO_PRICE = async () => undefined;
const REQUEST = { system: '', prompt: 'hello' };
const providers: InstanceType<typeof CodexProvider>[] = [];
const provider = (key: () => string | null) => {
  const codex = new CodexProvider(NO_PRICE, { id: key() ? 'codex@api' : 'codex', auth: key() ? 'apiKey' : 'cli', apiKey: key, dir: null });
  providers.push(codex);
  return codex;
};
afterEach(() => {
  providers.splice(0).forEach((codex) => codex.dispose());
  started.length = 0;
  initialize = async () => ({});
  startThread = async () => undefined;
  modelProvider = 'chattypop';
});

describe('Codex owner key payment', () => {
  it('launches sign-in without overrides or an explicit environment', async () => {
    await provider(() => null).listModels();
    expect(started[0]).toMatchObject({ launch: { command: 'node', args: ['test-codex'] }, args: ['app-server'], env: undefined });
  });
  it('puts config overrides before app-server, with the key only in the child environment', async () => {
    await provider(() => 'test-key').listModels();
    expect(started[0]?.args).toEqual([
      '-c', 'model_provider="chattypop"',
      '-c', 'model_providers.chattypop={name="OpenAI API key",base_url="https://api.openai.com/v1",env_key="CHATTYPOP_OPENAI_API_KEY",wire_api="responses"}',
      'app-server',
    ]);
    expect(started[0]?.env).toEqual({ ...process.env, [API_KEY_ENV]: 'test-key' });
    expect(started[0]?.args.join(' ')).not.toContain('test-key');
  });
  it('shares one launch and replaces it on key set, change and removal', async () => {
    let key: string | null = 'test-key';
    const codex = provider(() => key);
    await Promise.all([codex.listModels(), codex.listModels()]);
    expect(started).toHaveLength(1);
    for (const next of ['test-next', 'test-replacement', 'test-last']) {
      const previous = started.at(-1)!;
      key = next;
      await Promise.all([codex.listModels(), codex.listModels()]);
      expect(previous.dispose).toHaveBeenCalledOnce();
      expect(started.at(-1)?.env?.[API_KEY_ENV] ?? null).toBe(next);
    }
    expect(started).toHaveLength(4);
  });
  it('rotating during initialization prevents callers from using the stale process', async () => {
    let key: string | null = 'test-key';
    let finish!: (value: unknown) => void;
    initialize = () => new Promise((resolve) => { finish = resolve; });
    const codex = provider(() => key);
    const first = codex.listModels();
    await vi.waitFor(() => expect(started).toHaveLength(1));
    expect(started).toHaveLength(1);
    const oldFinish = finish;
    key = 'test-next';
    initialize = async () => ({});
    await Promise.all([codex.listModels(), codex.listModels()]);
    oldFinish({});
    await first;
    expect(started).toHaveLength(2);
    expect(started[0]?.methods).toEqual(['initialize']);
    expect(started[1]?.methods.filter((method) => method === 'model/list')).toHaveLength(3);
  });
  it('stops before a turn if app-server selects another provider', async () => {
    modelProvider = 'openai';
    await expect(provider(() => 'test-key').complete(REQUEST)).rejects.toThrow('did not select your API key provider');
    expect(started[0]?.methods).not.toContain('turn/start');
  });
  it('a matching provider completes normally', async () => {
    await expect(provider(() => 'test-key').complete(REQUEST)).resolves.toMatchObject({ text: 'answer' });
  });
  it('key changes while starting a thread stop the turn', async () => {
    let key: string | null = 'test-key';
    startThread = async () => { key = 'test-replacement'; };
    await expect(provider(() => key).complete(REQUEST)).rejects.toThrow('payment key changed');
    expect(started[0]?.methods).not.toContain('turn/start');
  });
  it('an app-server that exits mid-request is reported as that, not as a key change', async () => {
    startThread = async () => { started[0]!.dispose(); };
    await expect(provider(() => 'test-key').complete(REQUEST)).rejects.toThrow('codex app-server exited (1)');
  });
  it('stored keys have no plan usage and make no RPC call', async () => {
    await expect(provider(() => 'test-key').planUsage()).resolves.toBeNull();
    expect(started).toEqual([]);
  });
  it('RPC errors cannot echo the key belonging to their process', async () => {
    startThread = async () => { throw new Error('failure test-key'); };
    await expect(provider(() => 'test-key').complete(REQUEST)).rejects.toThrow('failure [API key]');
  });
  it('removing an API-account key refuses later requests without falling back to sign-in', async () => {
    let key: string | null = 'test-key';
    const codex = provider(() => key);
    await codex.listModels();
    key = null;
    await expect(codex.listModels()).rejects.toThrow('Add an API key');
    expect(started).toHaveLength(1);
    await expect(codex.planUsage()).resolves.toBeNull();
    expect(started.flatMap((state) => state.methods)).not.toContain('account/rateLimits/read');
  });
});
