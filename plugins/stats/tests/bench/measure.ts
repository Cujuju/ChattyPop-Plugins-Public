import { performance } from 'node:perf_hooks';
import { Session } from 'node:inspector';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PluginDb } from '@plugin-sdk/core';

const MIB = 1024 * 1024;
const SAMPLE_MS = 5; // Timer samples supplement SQL boundaries and V8's pre-GC heap measurements.
type Metric = { sql: string; calls: number; ms: number; maxMs: number; plan: unknown[] };
export const report = (kind: string, value: unknown) => process.send!({ kind, value });

export async function measure(db: PluginDb, name: string, run: (db: PluginDb) => unknown, profileDir: string) {
  global.gc?.();
  let peak = process.memoryUsage().heapUsed;
  let peakArrayBuffers = process.memoryUsage().arrayBuffers;
  const base = peak;
  const sample = () => {
    const memory = process.memoryUsage();
    peak = Math.max(peak, memory.heapUsed);
    peakArrayBuffers = Math.max(peakArrayBuffers, memory.arrayBuffers);
  };
  const metrics = new Map<string, Metric>();
  const measured = new Proxy(db, { get(target, key) {
    if (key !== 'prepare') return Reflect.get(target, key);
    return (sql: string) => {
      const stmt = target.prepare(sql);
      const metric = metrics.get(sql) ?? { sql, calls: 0, ms: 0, maxMs: 0, plan: [] };
      metrics.set(sql, metric);
      let proxy: typeof stmt;
      proxy = new Proxy(stmt, { get(statement, method) {
        const value = Reflect.get(statement, method);
        if (['pluck', 'raw', 'expand'].includes(String(method))) return (...args: unknown[]) => { value(...args); return proxy; };
        if (!['all', 'get'].includes(String(method))) return value;
        return (...args: unknown[]) => {
          if (!metric.calls) metric.plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args);
          const start = performance.now();
          const result = value(...args);
          const duration = performance.now() - start;
          metric.calls++; metric.ms += duration; metric.maxMs = Math.max(metric.maxMs, duration);
          sample();
          return result;
        };
      } });
      return proxy;
    };
  } });
  const session = profileDir ? new Session() : null;
  const post = (method: string) => new Promise<any>((resolve, reject) => session!.post(method as any, (error, result) => error ? reject(error) : resolve(result)));
  if (session) { session.connect(); await post('Profiler.enable'); await post('Profiler.start'); }
  report('start', name);
  const startUptimeMs = process.uptime() * 1000;
  const started = performance.now();
  let previous = started;
  let maxSliceMs = 0;
  let yields = 0;
  let done = false;
  const tick = () => {
    const now = performance.now();
    maxSliceMs = Math.max(maxSliceMs, now - previous);
    previous = now; sample(); yields++;
    if (!done) setImmediate(tick);
  };
  setImmediate(tick);
  const timer = setInterval(sample, SAMPLE_MS);
  const result = await run(measured);
  const wallMs = performance.now() - started;
  done = true; clearInterval(timer); sample();
  maxSliceMs = Math.max(maxSliceMs, performance.now() - previous);
  if (session) {
    const { profile } = await post('Profiler.stop');
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, `${name}.cpuprofile`), JSON.stringify(profile));
    session.disconnect();
  }
  report('result', { section: name, startUptimeMs, wallMs, peakHeapMiB: peak / MIB, baseHeapMiB: base / MIB,
    peakArrayBuffersMiB: peakArrayBuffers / MIB,
    sqlMs: [...metrics.values()].reduce((sum, m) => sum + m.ms, 0), maxSliceMs, yields,
    resultBytes: JSON.stringify(result).length, statements: [...metrics.values()] });
  await new Promise<void>((resolve) => setImmediate(resolve));
}
