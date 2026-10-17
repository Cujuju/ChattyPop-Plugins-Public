import { mkdirSync } from 'node:fs';
import { ProviderUnavailableError, resolveCli, type CliSpec, type ProviderAccount } from '@plugin-sdk/core';
import { JsonRpcStdio } from './jsonRpcStdio';

export const API_KEY_PROVIDER = 'chattypop';
export const API_KEY_ENV = 'CHATTYPOP_OPENAI_API_KEY';
export const API_BASE_URL = 'https://api.openai.com/v1';
const API_PROVIDER_NAME = 'OpenAI API key';
const CONFIG_FLAG = '-c';
const APP_SERVER = 'app-server';
const WIRE_API = 'responses';

const safeError = (err: unknown, key: string | null): Error => {
  const error = err instanceof Error ? err : new Error(String(err));
  return key && error.message.includes(key) ? new Error(error.message.replaceAll(key, '[API key]')) : error;
};

interface Connection {
  rpc: JsonRpcStdio;
  key: string | null;
  owner: object;
  accountId: string;
  home: string | null;
  ready: Promise<void>;
}

/** One warm app-server per payment key; concurrent callers share initialization. */
export class CodexConnection {
  private readonly owner = {};
  private current: Connection | undefined;
  private disposed = false;

  constructor(private readonly cli: CliSpec, private readonly clientInfo: object, private readonly account: ProviderAccount) {}

  async connect(): Promise<Connection> {
    for (;;) {
      if (this.disposed) throw new ProviderUnavailableError('Codex was turned off.');
      const key = this.account.auth === 'apiKey' ? this.account.apiKey() : null;
      if (this.current && this.current.key !== key) this.drop(this.current);
      if (this.account.auth === 'apiKey' && !key) throw new ProviderUnavailableError('Add an API key to use this account.');
      const connection = this.current ?? this.launch(key);
      try {
        await connection.ready;
      } catch (err) {
        if (this.current && this.current !== connection && !this.disposed) continue;
        throw err;
      }
      if (this.disposed) throw new ProviderUnavailableError('Codex was turned off.');
      if (this.current === connection && key === (this.account.auth === 'apiKey' ? this.account.apiKey() : null)) return connection;
    }
  }

  /** Refuses a turn whose connection stopped matching the owner's current payment key. An exited process is its request's to report. */
  assertCurrent(connection: Connection): void {
    if (this.disposed) throw new ProviderUnavailableError('Codex was turned off.');
    if (connection.owner !== this.owner) throw new ProviderUnavailableError('Codex connection belongs to another account.');
    if (connection.accountId === this.account.id && connection.home === this.account.dir && connection.key === (this.account.auth === 'apiKey' ? this.account.apiKey() : null)) return;
    this.drop(connection);
    throw new ProviderUnavailableError('Codex payment key changed. Send the request again.');
  }

  async request<T>(connection: Connection, method: string, params: unknown): Promise<T> {
    this.assertCurrent(connection);
    try { return await connection.rpc.request<T>(method, params); }
    catch (err) { throw safeError(err, connection.key); }
  }

  closed(connection: Connection): Promise<Error> {
    return connection.rpc.closed.then((err) => safeError(err, connection.key));
  }

  error(connection: Connection, err: unknown): Error {
    return safeError(err, connection.key);
  }

  private launch(key: string | null): Connection {
    const launch = resolveCli(this.cli.bin, this.cli.npm);
    if (!launch) throw new ProviderUnavailableError(`${this.cli.name} is not installed or not on PATH.`);
    const config = key ? [
      CONFIG_FLAG, `model_provider="${API_KEY_PROVIDER}"`,
      CONFIG_FLAG, `model_providers.${API_KEY_PROVIDER}={name="${API_PROVIDER_NAME}",base_url="${API_BASE_URL}",env_key="${API_KEY_ENV}",wire_api="${WIRE_API}"}`,
    ] : [];
    let env: NodeJS.ProcessEnv | undefined = key ? { ...process.env, [API_KEY_ENV]: key } : undefined;
    if (this.account.auth === 'signIn') {
      if (!this.account.dir) throw new Error('Linked Codex account has no config folder.');
      mkdirSync(this.account.dir, { recursive: true });
      env = { ...process.env, CODEX_HOME: this.account.dir };
    }
    const rpc = new JsonRpcStdio(launch, [...config, APP_SERVER], env);
    const connection: Connection = { rpc, key, owner: this.owner, accountId: this.account.id, home: this.account.dir, ready: Promise.resolve() };
    this.current = connection;
    // One warm connection serves plain requests and experimental dynamic tools.
    connection.ready = rpc.request('initialize', { clientInfo: this.clientInfo, capabilities: { experimentalApi: true } }).then(
      () => { rpc.notify('initialized'); },
      (err: unknown) => { this.drop(connection); throw safeError(err, key); },
    );
    void rpc.closed.then(() => { if (this.current === connection) this.current = undefined; });
    return connection;
  }

  private drop(connection: Connection): void {
    if (this.current === connection) this.current = undefined;
    connection.rpc.dispose();
  }

  dispose(): void {
    this.disposed = true;
    if (this.current) this.drop(this.current);
  }
}
