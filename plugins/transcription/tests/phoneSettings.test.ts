import { describe, expect, it, onTestFinished } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import transcriptionCore from '../core';
import { plugin } from '../shared';
import { decodeInstall, decodeItem, decodeNoArgs, decodeRequest } from '../shared/calls';

const MESSAGE = '123456789012345678';

describe('Transcription phone settings', () => {
  it('exposes the toolchain and its writes to both windows', async () => {
    for (const name of ['status', 'install', 'cancel', 'deleteModel', 'request'] as const) {
      const member = plugin.channels.audiences.core[name];
      expect(member.audiences).toEqual(['renderer', 'phone']);
      expect(member.writes).toBe(name !== 'status');
      expect(member.decode).toBeTypeOf('function');
    }
    const t = testPlugin(transcriptionCore);
    onTestFinished(() => t.dispose());
    expect(await t.client('phone').status()).toHaveProperty('models');
    await t.client('phone').cancel('ffmpeg');
    await expect(t.client('phone').install('ffmpeg', 'other' as never)).rejects.toThrow('tool build');
    await expect(t.client('phone').deleteModel('../model')).rejects.toThrow('download id');
    await expect(t.client('phone').request(MESSAGE, 5 as never)).rejects.toThrow('message part');
  });

  it('checks tool ids, builds and argument counts', () => {
    expect(decodeNoArgs([])).toEqual([]);
    expect(() => decodeNoArgs([null])).toThrow();
    expect(decodeItem(['ggml-base.bin'])).toEqual(['ggml-base.bin']);
    for (const build of [null, 'cpu', 'gpu']) expect(decodeInstall(['whisper-cli', build])).toEqual(['whisper-cli', build]);
    for (const args of [[], [5], [''], ['../model'], ['a/b'], ['ffmpeg', null]]) expect(() => decodeItem(args)).toThrow();
    for (const args of [[], ['ffmpeg'], ['ffmpeg', undefined], ['ffmpeg', 'other'], ['ffmpeg', null, 1], [5, null]]) expect(() => decodeInstall(args)).toThrow();
  });

  it('accepts media part keys and rejects malformed parts', () => {
    for (const part of [null, `attachment:${MESSAGE}`, 'embed:https://media.example/video.mp4']) expect(decodeRequest([MESSAGE, part])).toEqual([MESSAGE, part]);
    for (const args of [[], [MESSAGE], [MESSAGE, null, 1], ['bad', null], [MESSAGE, undefined],
      [MESSAGE, 'attachment:bad'], [MESSAGE, 'embed:file:///tmp/video'], [MESSAGE, 'embed:https://u:p@example/video'],
      [MESSAGE, 'embed:broken'], [MESSAGE, 'other']]) expect(() => decodeRequest(args)).toThrow();
  });
});
