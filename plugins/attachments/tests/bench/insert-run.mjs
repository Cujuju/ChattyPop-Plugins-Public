import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_MESSAGES = 20_000; // A mixed fixture exposes catalog costs without running full rollup construction.
const [hostArg, publicArg, rows = String(DEFAULT_MESSAGES)] = process.argv.slice(2);
if (!hostArg || !publicArg) throw new Error('Usage: node insert-run.mjs <host worktree> <public plugins worktree> [messages]');
const host = resolve(hostArg), plugins = join(resolve(publicArg), 'plugins');
process.env.VITEST = '1';
const { runnerImport } = await import(pathToFileURL(join(host, 'node_modules/vite/dist/node/index.js')).href);
const { module: configuration } = await runnerImport(join(host, 'vitest.config.ts'), { configFile: false });
const config = configuration.testConfig({ dirs: plugins, selection: 'attachments' });
const { module } = await runnerImport(join(import.meta.dirname, 'insertBenchmark.ts'), {
  configFile: false, logLevel: 'silent', resolve: config.resolve, define: config.define, plugins: config.plugins,
});
await module.main(Number(rows));
