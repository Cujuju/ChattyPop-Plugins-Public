import { describe, expect, it, onTestFinished } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import imageTextCore from '../core';
import { plugin, STATUS_EVENT } from '../shared';
import { decodeNoArgs, decodeRequest } from '../shared/calls';

const MESSAGE = '123456789012345678';

describe('Image text phone settings', () => {
  it('exposes reads, writes and refresh events to both windows', async () => {
    for (const name of ['status', 'request', 'retryFailed'] as const) {
      const member = plugin.channels.audiences.core[name];
      expect(member.audiences).toEqual(['renderer', 'phone']);
      expect(member.writes).toBe(name !== 'status');
      expect(member.decode).toBeTypeOf('function');
    }
    expect(plugin.channels.audiences.events[STATUS_EVENT]).toEqual(['renderer', 'phone']);
    const t = testPlugin(imageTextCore);
    onTestFinished(() => t.dispose());
    expect(await t.client('phone').status()).toHaveProperty('counts');
    await t.client('phone').retryFailed();
    await expect(t.client('phone').request('../message', null)).rejects.toThrow('message id');
  });

  it('checks arity, ids and every engine field', () => {
    expect(decodeNoArgs([])).toEqual([]);
    expect(() => decodeNoArgs([undefined])).toThrow();
    for (const pick of [null, { engine: 'windows' }, { engine: 'vision', provider: 'ollama', model: 'vl' }]) {
      expect(decodeRequest([MESSAGE, pick])).toEqual([MESSAGE, pick]);
    }
    for (const args of [[], [MESSAGE], [MESSAGE, null, 1], [5, null], [MESSAGE, undefined],
      [MESSAGE, { engine: 'other' }], [MESSAGE, { engine: 'windows', model: 'vl' }],
      [MESSAGE, { engine: 'vision', provider: 'bad id', model: 'vl' }],
      [MESSAGE, { engine: 'vision', provider: 'ollama', model: '' }],
      [MESSAGE, { engine: 'vision', provider: 'ollama', model: 4 }]]) {
      expect(() => decodeRequest(args)).toThrow();
    }
  });
});
