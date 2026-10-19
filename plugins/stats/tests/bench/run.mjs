// Opt-in runner: uses the host's existing Vite loader and dependencies, never its normal test discovery.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const MIB = 1024 * 1024; // Heap units match Node's byte counters.
const [hostArg, targetArg, sizeArg = '400000', section = 'all', profileDir = '', authorId = ''] = process.argv.slice(2);
if (!hostArg || !targetArg) throw new Error('Usage: node bench/run.mjs <host> <stats plugin> [rows] [section|all] [profile directory] [author id]');
const host = resolve(hostArg);
const target = resolve(targetArg);
if (!process.env.STATS_BENCH_WORKER) {
  const child = spawn(process.execPath, ['--expose-gc', '--trace-gc-nvp', import.meta.filename, ...process.argv.slice(2)], {
    env: { ...process.env, STATS_BENCH_WORKER: '1' }, stdio: ['ignore', 'pipe', 'inherit', 'ipc'], cwd: host,
  });
  const heaps = [];
  const results = [];
  createInterface({ input: child.stdout }).on('line', (line) => {
    const gc = /\]\s+(\d+) ms:.*?(?:total_size_before|start_object_size)=(\d+)/.exec(line);
    if (gc) heaps.push({ at: Number(gc[1]), bytes: Number(gc[2]) });
  });
  child.on('message', ({ kind, value }) => {
    if (kind === 'result') {
      results.push(value);
      console.log(`DONE ${value.section}: ${(value.wallMs / 1000).toFixed(3)}s; SQL ${(value.sqlMs / 1000).toFixed(3)}s`);
    }
    else console.log(`${kind.toUpperCase()} ${JSON.stringify(value)}`);
  });
  process.exitCode = await new Promise((done) => child.on('exit', (code) => done(code ?? 1)));
  for (const row of results) {
    for (const heap of heaps) if (heap.at >= row.startUptimeMs && heap.at <= row.startUptimeMs + row.wallMs) {
      row.peakHeapMiB = Math.max(row.peakHeapMiB, heap.bytes / MIB);
    }
    console.log(JSON.stringify(row));
  }
} else {
  process.env.VITEST = '1';
  const { runnerImport, build } = await import(pathToFileURL(join(host, 'node_modules/vite/dist/node/index.js')).href);
  const { module: configModule } = await runnerImport(join(host, 'vitest.config.ts'), { configFile: false });
  await build({ configFile: false, logLevel: 'silent', resolve: { alias: { '@shared': join(host, 'src/shared'), '@plugin-sdk': join(host, 'src/plugin-sdk') } }, plugins: configModule.testConfig().plugins,
    build: { ssr: true, target: 'node24', outDir: join(host, 'out/read-tests'), emptyOutDir: false,
      rollupOptions: { input: { archiveReadProcess: join(host, 'src/core/reads/archiveReadProcess.ts'), archiveReadWorker: join(host, 'src/core/reads/archiveReadWorker.ts') },
        external: [/^node:/, 'better-sqlite3-multiple-ciphers'], output: { format: 'es', entryFileNames: '[name].js' } } } });
  const config = configModule.testConfig({ dirs: resolve(target, '..'), selection: 'stats' });
  // Historical worktrees reuse the installed plugin packages; use tldts's published ESM entry with Vite's module runner.
  config.resolve.alias.push({ find: 'tldts', replacement: join(import.meta.dirname, '../../node_modules/tldts/dist/es6/index.js').replaceAll('\\', '/') });
  const candidates = { activityStats: 'stats', peopleStats: 'personHistory', repeatedLinks: 'repeatedLinks',
    emojiStats: 'emoji', wordStats: 'words', sentimentStats: 'sentiment', conversationStats: 'conversations' };
  const available = Object.entries(candidates).filter(([, file]) => existsSync(join(target, 'core', `${file}.ts`)));
  const virtual = '\0stats-bench-functions';
  const pluginPackages = join(import.meta.dirname, '../../package.json');
  const hostPackages = join(host, 'package.json');
  const resolver = {
    name: 'stats-bench-functions',
    resolveId(source) {
      if (source === 'stats-bench-functions') return virtual;
      if (source === 'stats-bench-main') return '\0stats-bench-main';
      if (source === 'stats-bench-target') return '\0stats-bench-target';
    },
    load(id) {
      if (id === '\0stats-bench-target') return `export { default } from ${JSON.stringify(join(target, 'core/index.ts').replaceAll('\\', '/'))};
        export { plugin } from ${JSON.stringify(join(target, 'shared/index.ts').replaceAll('\\', '/'))};`;
      if (id === '\0stats-bench-main') return `import { setArchiveReadEntry } from ${JSON.stringify(join(host, 'src/core/reads/helperEntry.ts').replaceAll('\\', '/'))};
        setArchiveReadEntry(${JSON.stringify(join(host, 'out/read-tests/archiveReadProcess.js'))});
        export * from ${JSON.stringify(join(import.meta.dirname, section === 'rollups' ? 'rollupBenchmark.ts' : section === 'review' ? 'reviewBenchmark.ts' : 'benchmark.ts').replaceAll('\\', '/'))};`;
      if (id !== virtual) return;
      return available.map(([name, file]) => `import { ${name} } from ${JSON.stringify(join(target, 'core', `${file}.ts`).replaceAll('\\', '/'))};`).join('\n')
        + `\nexport default { ${available.map(([name]) => name).join(',')} };`;
    },
  };
  const packages = {
    name: 'stats-bench-packages',
    async resolveId(source, importer, options) {
      if (!importer || !/^(?:@[\w.-]+\/)?[\w.-]+(?:\/.*)?$/.test(source)) return;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
        ?? await this.resolve(source, pluginPackages, { ...options, skipSelf: true })
        ?? await this.resolve(source, hostPackages, { ...options, skipSelf: true });
      if (resolved?.id.includes('/node_modules/') && !resolved.id.endsWith('.json')) return { ...resolved, external: true };
      return resolved;
    },
  };
  const { module } = await runnerImport('stats-bench-main', {
    configFile: false, logLevel: 'silent', resolve: config.resolve, define: config.define,
    plugins: [...config.plugins, resolver, packages],
  });
  await module.main(Number(sizeArg), section, profileDir, authorId || null);
}
