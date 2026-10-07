import { describe, expect, it, onTestFinished } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import translationCore from '../core';
import { plugin, STATUS_EVENT } from '../shared';
import { decodeNoArgs, decodeTranslate } from '../shared/calls';

const MESSAGE = '123456789012345678';

describe('Translation phone settings', () => {
  it('exposes reads, writes and refresh events to both windows', async () => {
    for (const name of ['status', 'translate', 'retryFailed'] as const) {
      const member = plugin.channels.audiences.core[name];
      expect(member.audiences).toEqual(['renderer', 'phone']);
      expect(member.writes).toBe(name !== 'status');
      expect(member.decode).toBeTypeOf('function');
    }
    expect(plugin.channels.audiences.events[STATUS_EVENT]).toEqual(['renderer', 'phone']);
    const t = testPlugin(translationCore);
    onTestFinished(() => t.dispose());
    expect(await t.client('phone').status()).toHaveProperty('translator');
    await t.client('phone').retryFailed();
    await expect(t.client('phone').translate(MESSAGE, { provider: 'ollama', model: '' })).rejects.toThrow('provider and model');
  });

  it('checks arity, ids and every model field', () => {
    expect(decodeNoArgs([])).toEqual([]);
    expect(() => decodeNoArgs([null])).toThrow();
    expect(decodeTranslate([MESSAGE, null])).toEqual([MESSAGE, null]);
    const pick = { provider: 'ollama', model: 'tx' };
    expect(decodeTranslate([MESSAGE, pick])).toEqual([MESSAGE, pick]);
    for (const args of [[], [MESSAGE], [MESSAGE, null, 1], ['../message', null], [MESSAGE, undefined],
      [MESSAGE, { provider: 'bad id', model: 'tx' }], [MESSAGE, { provider: 'ollama' }],
      [MESSAGE, { provider: 'ollama', model: 4 }], [MESSAGE, { ...pick, extra: true }]]) {
      expect(() => decodeTranslate(args)).toThrow();
    }
  });
});
