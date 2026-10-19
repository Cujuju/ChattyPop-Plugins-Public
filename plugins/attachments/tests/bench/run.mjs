// Opt-in synthetic benchmark, using the host's Vite loader and fixture database.
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [hostArg, publicArg, rows = '400000'] = process.argv.slice(2);
if (!hostArg || !publicArg) throw new Error('Usage: node run.mjs <host worktree> <public plugins worktree> [messages]');
const host = resolve(hostArg);
const plugins = join(resolve(publicArg), 'plugins');
// Select the worker entries built by the host's test setup.
process.env.VITEST = '1';
const { runnerImport, build } = await import(pathToFileURL(join(host, 'node_modules/vite/dist/node/index.js')).href);
await build({
  configFile: false, logLevel: 'silent', resolve: { alias: { '@shared': join(host, 'src/shared') } },
  build: { ssr: true, target: 'node24', outDir: join(host, 'out/read-tests'), emptyOutDir: false,
    rollupOptions: { input: {
      archiveReadProcess: join(host, 'src/core/reads/archiveReadProcess.ts'),
      archiveReadWorker: join(host, 'src/core/reads/archiveReadWorker.ts'),
    }, external: [/^node:/, 'better-sqlite3-multiple-ciphers'], output: { format: 'es', entryFileNames: '[name].js' } },
  },
});
const { module: configuration } = await runnerImport(join(host, 'vitest.config.ts'), { configFile: false });
const config = configuration.testConfig({ dirs: plugins, selection: 'attachments,links' });
const { module } = await runnerImport(join(import.meta.dirname, 'benchmark.ts'), {
  configFile: false, logLevel: 'silent', resolve: config.resolve, define: config.define, plugins: config.plugins,
});
await module.main(Number(rows));
