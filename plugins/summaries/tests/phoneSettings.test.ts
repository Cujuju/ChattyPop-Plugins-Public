import { describe, expect, it, onTestFinished } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import summariesCore from '../core';
import { plugin } from '../shared';
import { decodePrompts, decodeSpending } from '../shared/calls';

describe('Summaries phone settings', () => {
  it('serves prompt previews and spending as phone reads', async () => {
    for (const name of ['prompts', 'spending'] as const) {
      expect(plugin.channels.audiences.core[name].audiences).toEqual(['renderer', 'phone']);
      expect(plugin.channels.audiences.core[name].writes).toBe(false);
    }
    const t = testPlugin(summariesCore);
    onTestFinished(() => t.dispose());
    expect(await t.client('phone').prompts()).toHaveProperty('summarize');
    expect(await t.client('phone').spending([0])).toHaveLength(1);
    await expect(t.client('phone').spending(['yesterday'] as never)).rejects.toThrow('start time');
  });

  it('checks optional templates and all spending times', () => {
    expect(decodePrompts([])).toEqual([]);
    expect(decodePrompts([undefined])).toEqual([]);
    const own = { summarize: 'draft', merge: null };
    expect(decodePrompts([own])).toEqual([own]);
    for (const args of [[null], [5], [{}], [{ summarize: 5, merge: null }], [{ ...own, extra: 1 }], [own, null]]) expect(() => decodePrompts(args)).toThrow();
    expect(decodeSpending([[1, 2]])).toEqual([[1, 2]]);
    for (const args of [[], [null], [[1, '2']], [[NaN]], [[Infinity]], [Array(1)], [[1], 2]]) expect(() => decodeSpending(args)).toThrow();
  });
});
