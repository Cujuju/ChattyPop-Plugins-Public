import { describe, expect, it, onTestFinished } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import plansCore from '../core';
import { plugin } from '../shared';
import { decodeList } from '../shared/calls';

describe('Plans phone settings seed', () => {
  it('lets either window read the list for its seen preference', async () => {
    expect(plugin.channels.audiences.core.list.audiences).toEqual(['renderer', 'phone']);
    expect(plugin.channels.audiences.core.list.writes).toBe(false);
    const t = testPlugin(plansCore);
    onTestFinished(() => t.dispose());
    expect(await t.client('phone').list(200)).toEqual([]);
    await expect(t.client('phone').list('200' as never)).rejects.toThrow('plan limit');
  });

  it('requires one positive integer limit', () => {
    expect(decodeList([200])).toEqual([200]);
    for (const args of [[], [null], ['200'], [0], [-1], [1.5], [NaN], [Infinity], [200, 1]]) expect(() => decodeList(args)).toThrow();
  });
});
