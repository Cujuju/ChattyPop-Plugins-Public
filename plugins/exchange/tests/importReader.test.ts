import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { tempDir } from '@chattypop/host-testing';
import { readDceFile } from '../core/importReader';

const MESSAGES = 100_000; // Large enough to expose a synchronous whole-file parse and validation.
const CONTENT_BYTES = 256; // A multi-megabyte export without unusually wide individual messages.
const CORE_TURN_BUDGET_MS = 100; // Core must remain responsive while the import worker reads and parses.
const HEARTBEAT_MS = 1; // Observe delays between writer turns throughout parsing and backpressured delivery.

it('reads, validates and maps a large export off Core with bounded batch delivery', async () => {
  const file = join(tempDir(), 'large.json');
  const channel = { id: '200000000000000001', name: 'channel' };
  const message = { id: '300000000000000001', type: 'Default', timestamp: '2026-01-01T00:00:00Z',
    content: 'x'.repeat(CONTENT_BYTES), author: { id: '400000000000000001', name: 'person' } };
  const json = JSON.stringify({ guild: { id: '100000000000000001', name: 'guild' }, channel, messages: Array(MESSAGES).fill(message) });
  writeFileSync(file, json);
  let last = performance.now(), longest = 0, received = 0, batches = 0, largest = 0;
  const tick = () => { const now = performance.now(); longest = Math.max(longest, now - last); last = now; };
  const timer = setInterval(tick, HEARTBEAT_MS);
  try {
    const head = await readDceFile(file, () => undefined, async (messages) => {
      received += messages.length; batches++; largest = Math.max(largest, messages.length);
      expect(messages[0]).toMatchObject({ channel_id: channel.id, content: message.content });
    });
    tick();
    expect(head.channel.id).toBe(channel.id);
    expect(received).toBe(MESSAGES);
    expect(batches).toBeGreaterThan(1);
    expect(largest).toBeLessThan(MESSAGES);
    process.stdout.write(`DCE reader: ${Buffer.byteLength(json)} bytes, ${received} messages, ${batches} packets, longest Core gap ${longest.toFixed(2)} ms\n`);
    expect(longest).toBeLessThan(CORE_TURN_BUDGET_MS);
  } finally { clearInterval(timer); }
});

it('validates the tail before handing any metadata or messages to the writer', async () => {
  const file = join(tempDir(), 'invalid.json');
  const message = { id: '300000000000000001', type: 'Default', timestamp: '2026-01-01T00:00:00Z', content: 'valid', author: { id: 'person', name: 'person' } };
  writeFileSync(file, JSON.stringify({ guild: { id: 'guild', name: 'guild' }, channel: { id: '200000000000000001', name: 'channel' },
    messages: [...Array(MESSAGES).fill(message), { ...message, content: null }] }));
  let writes = 0;
  await expect(readDceFile(file, () => { writes++; }, async () => { writes++; })).rejects.toThrow('Not a DiscordChatExporter file');
  expect(writes).toBe(0);
});
