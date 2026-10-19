import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [hostArg, rowsArg = '400000', beforeRef = '7abceb754247e973eddd5bbdf997817130db75cf'] = process.argv.slice(2);
if (!hostArg) throw new Error('Usage: node run.mjs <absolute host worktree> [rows] [before host commit]');
const host = resolve(hostArg);
const pluginDir = resolve(import.meta.dirname, '../..');
process.env.VITEST = '1';
const { runnerImport, build } = await import(pathToFileURL(join(host, 'node_modules/vite/dist/node/index.js')).href);
const { module: configModule } = await runnerImport(join(host, 'vitest.config.ts'), { configFile: false });
const config = configModule.testConfig({ dirs: resolve(pluginDir, '..'), selection: 'tags' });
await build({ configFile: false, logLevel: 'silent', resolve: config.resolve, plugins: config.plugins,
  build: { ssr: true, target: 'node24', outDir: join(host, 'out/read-tests'), emptyOutDir: false,
    rollupOptions: { input: { archiveReadProcess: join(host, 'src/core/reads/archiveReadProcess.ts'), archiveReadWorker: join(host, 'src/core/reads/archiveReadWorker.ts') },
      external: [/^node:/, 'better-sqlite3-multiple-ciphers'], output: { format: 'es', entryFileNames: '[name].js' } } } });
mkdirSync(join(host, 'out'), { recursive: true });
const baselinePath = join(host, 'out/round3-baseline-store.ts');
let baseline = execFileSync('git', ['show', `${beforeRef}:src/core/rollups/store.ts`], { cwd: host, encoding: 'utf8' });
baseline = baseline.replace(/from '(\.\.?\/[^']+)'/g, (_, rel) => `from '${resolve(host, 'src/core/rollups', rel).replaceAll('\\', '/')}'`);
writeFileSync(baselinePath, baseline);
const { module: before } = await runnerImport(baselinePath, { configFile: false, logLevel: 'silent', resolve: config.resolve, plugins: config.plugins });
const { module } = await runnerImport(join(import.meta.dirname, 'benchmark.ts'), { configFile: false, logLevel: 'silent', resolve: config.resolve, plugins: config.plugins });
const result = await module.main(Number(rowsArg), before.replacePartition, join(host, `out/round3-rollup-${process.pid}.db`));
const output = { beforeHost: beforeRef,
  afterHost: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: host, encoding: 'utf8' }).trim(),
  tagsCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: resolve(pluginDir, '../..'), encoding: 'utf8' }).trim(),
  node: process.version, platform: process.platform, ...result };
const json = JSON.stringify(output, null, 2).replace(/"samples": \[[\s\S]*?\n\s*\]/g,
  (block) => `"samples": ${JSON.stringify(JSON.parse(`{${block}}`).samples)}`);
writeFileSync(join(import.meta.dirname, 'results.json'), `${json}\n`);
console.log(JSON.stringify(output, null, 2));
