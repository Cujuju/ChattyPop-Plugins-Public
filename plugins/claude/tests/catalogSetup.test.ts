import { AsyncLocalStorage, createHook } from 'node:async_hooks';
import { linkSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';
import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { IS_WINDOWS, resolveCli } from '@core/ai/resolveCli';
import { resolveCliAsync } from '@core/ai/asyncCli';
import { tempDir } from '@chattypop/host-testing';
import { ClaudeProvider } from '../core/claude';

async function coreWork<T>(fn: () => Promise<T>) {
  const scope = new AsyncLocalStorage<boolean>(), turns = new Map<number, number>();
  let active = true, synchronousMs = 0, longestTurnMs = 0;
  const add = (ms: number) => { if (active) { synchronousMs += ms; longestTurnMs = Math.max(longestTurnMs, ms); } };
  const hook = createHook({ before(id) { if (scope.getStore()) turns.set(id, performance.now()); },
    after(id) { const start = turns.get(id); if (start !== undefined) { turns.delete(id); add(performance.now() - start); } } });
  hook.enable();
  try {
    const value = await scope.run(true, () => { const start = performance.now(); try { return fn(); } finally { add(performance.now() - start); } });
    return { value, synchronousMs, longestTurnMs };
  } finally { active = false; hook.disable(); }
}

describe.runIf(IS_WINDOWS)('real SDK catalog setup', () => {
  it('keeps executable discovery and SDK process creation off Core without contacting a provider', async () => {
    const dir = tempDir(), pkg = join(dir, 'node_modules', '@anthropic-ai', 'claude-code');
    mkdirSync(pkg, { recursive: true });
    // A hard link to this test's Node runs only the disposable CLI; no installed account or credential files are read.
    linkSync(process.execPath, join(dir, 'node.exe'));
    writeFileSync(join(dir, 'claude.cmd'), '');
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ bin: { claude: 'cli.js' } }));
    const script = join(pkg, 'cli.js');
    writeFileSync(script, `const rl = require('node:readline').createInterface({input:process.stdin});
      rl.on('line',line=>{const m=JSON.parse(line);if(m.type==='control_request')process.stdout.write(JSON.stringify({
        type:'control_response',response:{subtype:'success',request_id:m.request_id,response:{models:[{value:'fixture',displayName:'Fixture',description:''}]}}
      })+'\\n');});`);
    vi.stubEnv('PATH', dir);
    const provider = new ClaudeProvider({ id: 'claude', auth: 'cli', apiKey: () => null, dir: null });
    try {
      const beforeDiscovery = performance.now(); resolveCli('claude', '@anthropic-ai/claude-code');
      const syncResolveMs = performance.now() - beforeDiscovery;
      const startDiscovery = performance.now();
      const discovery = resolveCliAsync('claude', '@anthropic-ai/claude-code', true);
      const asyncResolveDispatchMs = performance.now() - startDiscovery;
      await discovery;
      const { value, ...timing } = await coreWork(() => provider.listModels());
      expect(value).toMatchObject([{ id: 'fixture', label: 'Fixture' }]);
      const idle: AsyncIterable<SDKUserMessage> = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) };
      const beforeSdk = performance.now();
      const native = query({ prompt: idle, options: { pathToClaudeCodeExecutable: script, settingSources: [], tools: [], persistSession: false, cwd: dir } });
      const nativeSdkSetupMs = performance.now() - beforeSdk;
      try { expect((await native.supportedModels()).map((m) => m.value)).toEqual(['fixture']); }
      finally { native.close(); }
      process.stdout.write(JSON.stringify({ syncResolveMs, asyncResolveDispatchMs, nativeSdkSetupMs, ...timing }) + '\n');
    } finally { provider.dispose(); vi.unstubAllEnvs(); }
  });
});
