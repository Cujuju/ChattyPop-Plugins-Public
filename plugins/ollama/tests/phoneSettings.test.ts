import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import ollamaCore from '../core';
import { INSTALLED_EVENT, PULLS_EVENT, plugin } from '../shared';
import { decodeModel, decodeNoArgs } from '../shared/calls';

describe('Ollama phone settings', () => {
  it('serves model management and its progress events to both windows', async () => {
    for (const name of ['pulls', 'pull', 'cancelPull', 'deleteModel'] as const) {
      const member = plugin.channels.audiences.core[name];
      expect(member.audiences).toEqual(['renderer', 'phone']);
      expect(member.writes).toBe(name !== 'pulls');
      expect(member.decode).toBeTypeOf('function');
    }
    for (const event of [PULLS_EVENT, INSTALLED_EVENT]) expect(plugin.channels.audiences.events[event]).toEqual(['renderer', 'phone']);
    const network = vi.fn(async () => new Response('{"status":"success"}\n'));
    const t = testPlugin(ollamaCore, { network });
    onTestFinished(() => t.dispose());
    const phone = t.client('phone');
    expect(await phone.pulls()).toEqual([]);
    await phone.pull('qwen3:8b');
    await vi.waitFor(() => expect(t.events(INSTALLED_EVENT)).toContain('qwen3:8b'));
    await phone.cancelPull('qwen3:8b');
    await phone.deleteModel('qwen3:8b');
    expect(network).toHaveBeenCalled();
    await expect(phone.pull(5 as never)).rejects.toThrow('model name');
  });

  it('checks model names and arity without coercing values', () => {
    expect(decodeNoArgs([])).toEqual([]);
    expect(() => decodeNoArgs([null])).toThrow();
    expect(decodeModel([' owner/model:tag '])).toEqual(['owner/model:tag']);
    for (const args of [[], [null], [5], [''], [' '], ['a\0b'], ['a\nb'], ['model', 1]]) expect(() => decodeModel(args)).toThrow();
  });
});
