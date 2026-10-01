// Plan usage reads ChattyPop's own use per provider and plan window, and stops once the plugin turns off.
import { describe, expect, it, vi } from 'vitest';
import { readUsage, usageReads } from '../renderer/usageReads';

const HOUR_MS = 3_600_000;
const window = (id: string) => ({ id, label: id, usedPercent: 1, resetsAt: '2026-09-29T12:00:00Z', durationMs: HOUR_MS });
const WINDOWS = [window('5h'), window('week')];
const NONE = { runs: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };

describe('Plan usage reads', () => {
  it('read only providers that reported windows, and nothing when none did', () => {
    expect(usageReads([{ provider: 'claude', windows: null }, { provider: 'codex', windows: undefined }])).toBeUndefined();
    expect(usageReads([{ provider: 'claude', windows: WINDOWS }, { provider: 'openrouter', windows: null }])).toEqual([{ id: 'claude', windows: WINDOWS }]);
  });

  it("key each provider's use by window id", async () => {
    const read = vi.fn(async (provider: string) => ({ ...NONE, runs: provider === 'claude' ? 2 : 5 }));
    const out = await readUsage([{ id: 'claude', windows: WINDOWS }, { id: 'codex', windows: [window('week')] }], read, () => true);
    expect(out).toEqual({ claude: { '5h': { ...NONE, runs: 2 }, week: { ...NONE, runs: 2 } }, codex: { week: { ...NONE, runs: 5 } } });
  });

  it('stop between windows once the plugin turns off', async () => {
    let on = true;
    const read = vi.fn(async () => {
      on = false;
      return NONE;
    });
    const out = await readUsage([{ id: 'claude', windows: WINDOWS }, { id: 'codex', windows: WINDOWS }], read, () => on);
    expect(out).toEqual({ claude: { '5h': NONE } });
    expect(read).toHaveBeenCalledTimes(1);
  });
});
