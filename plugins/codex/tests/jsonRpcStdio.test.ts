import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { tempDir } from '@chattypop/host-testing';
import { JsonRpcStdio } from '../core/jsonRpcStdio';

/** Fake app-server supports echo, failure, notifications, server requests, malformed output, and exit-code scenarios. */
const SERVER = String.raw`
const rl = require('readline').createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
rl.on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'echo') send({ jsonrpc: '2.0', id: m.id, result: m.params });
  else if (m.method === 'fail') send({ jsonrpc: '2.0', id: m.id, error: { code: 1, message: 'nope' } });
  else if (m.method === 'poke') { send({ jsonrpc: '2.0', method: 'progress', params: { n: 1 } }); send({ jsonrpc: '2.0', id: 99, method: 'approve', params: {} }); }
  else if (m.id === 99) send({ jsonrpc: '2.0', method: 'answered', params: m.error });
  else if (m.method === 'garble') { process.stdout.write('not json\n'); send({ jsonrpc: '2.0', id: m.id, result: 'ok' }); }
  else if (m.method === 'die') process.exit(3);
});
`;

let rpc: JsonRpcStdio | undefined;
afterEach(() => rpc?.dispose());

function start(): JsonRpcStdio {
  const script = join(tempDir(), 'server.cjs');
  writeFileSync(script, SERVER);
  return (rpc = new JsonRpcStdio({ command: process.execPath, args: [script] }, []));
}

describe('JSON-RPC over stdio', () => {
  it('resolves results and rejects errors by id', async () => {
    const c = start();
    await expect(c.request('echo', { a: 1 })).resolves.toEqual({ a: 1 });
    await expect(c.request('fail', {})).rejects.toThrow('nope');
  });

  it('delivers notifications and refuses server requests', async () => {
    const c = start();
    const progress = new Promise((r) => c.on('progress', r));
    const answered = new Promise((r) => c.on('answered', r));
    c.notify('poke');
    await expect(progress).resolves.toEqual({ n: 1 });
    await expect(answered).resolves.toMatchObject({ code: -32601 });
  });

  it('fails pending calls when the server exits', async () => {
    const c = start();
    const pending = c.request('never', {});
    c.dispose();
    await expect(pending).rejects.toThrow();
  });

  it('skips a line that is not JSON', async () => {
    await expect(start().request('garble', {})).resolves.toBe('ok');
  });

  it('reports the exit, so a caller waiting on a notification stops, and refuses later calls', async () => {
    const c = start();
    await expect(c.request('die', {})).rejects.toThrow('exited (3)');
    await expect(c.closed).resolves.toBeInstanceOf(Error);
    await expect(c.request('echo', {})).rejects.toThrow('exited (3)');
  });
});
