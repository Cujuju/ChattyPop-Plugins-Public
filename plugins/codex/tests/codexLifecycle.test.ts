// Tests disposal during app-server startup, handled startup failures, and prevention of starts after disposal.
import { afterEach, describe, expect, it, vi } from 'vitest';

const started: string[] = [];
let initialize: () => Promise<unknown> = async () => ({});

vi.mock('@core/ai/resolveCli', async (original) => ({ ...(await original<object>()), resolveCli: () => ({ command: 'codex', args: [] }) }));
vi.mock('../core/jsonRpcStdio', () => ({
  JsonRpcStdio: class {
    readonly closed = new Promise<Error>(() => undefined);
    constructor() {
      started.push('app-server');
    }
    request = (method: string) => (method === 'initialize' ? initialize() : Promise.resolve({ data: [], nextCursor: null }));
    notify = () => undefined;
    on = () => () => undefined;
    dispose = () => undefined;
  },
}));

const { CodexProvider } = await import('../core/codex');

afterEach(() => {
  started.length = 0;
  initialize = async () => ({});
});

/** Pricing is covered by tests/apiRates.test.ts; these calls leave cost unknown. */
const NO_PRICE = async (): Promise<undefined> => undefined;

describe('Codex provider disposal', () => {
  it('disposed while its app-server fails to start: the caller sees the failure, nothing is left unhandled', async () => {
    const unhandled: unknown[] = [];
    const note = (err: unknown): void => void unhandled.push(err);
    process.on('unhandledRejection', note);
    try {
      let fail!: (err: Error) => void;
      initialize = () => new Promise((_, reject) => (fail = reject));
      const codex = new CodexProvider(NO_PRICE);
      const listing = codex.listModels();
      await vi.waitFor(() => expect(started).toHaveLength(1));
      codex.dispose();
      fail(new Error('initialize failed'));
      await expect(listing).rejects.toThrow('initialize failed');
      await new Promise((r) => setTimeout(r, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', note);
    }
  });

  it('never starts another app-server once disposed', async () => {
    const codex = new CodexProvider(NO_PRICE);
    await codex.listModels();
    codex.dispose();
    await expect(codex.listModels()).rejects.toThrow();
    expect(started).toHaveLength(1);
  });
});
