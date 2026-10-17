import { describe, expect, it, vi } from 'vitest';
import type { AttachmentItem } from '../shared/types';
import { canHoverPlay, createHoverPlayer, HOVER_PLAY_DELAY_MS } from '../renderer/hoverVideo';

vi.mock('solid-js', async () => { const clientBuild = 'solid-js/dist/solid.cjs'; return import(clientBuild); });

describe('single hover-video player', () => {
  it('plays only hovered, stored, non-spoiler grid videos with motion enabled', () => {
    const video = { kind: 'video', status: 'stored', sha256: 'hash', spoiler: false } as AttachmentItem;
    const options = { hovered: true, list: false, reducedMotion: false };
    expect(canHoverPlay(video, options)).toBe(true);
    expect(canHoverPlay(video, { ...options, reducedMotion: true })).toBe(false);
    expect(canHoverPlay(video, { ...options, hovered: false })).toBe(false);
    expect(canHoverPlay(video, { ...options, list: true })).toBe(false);
    expect(canHoverPlay({ ...video, status: 'evicted' }, options)).toBe(false);
    expect(canHoverPlay({ ...video, sha256: null }, options)).toBe(false);
    expect(canHoverPlay({ ...video, spoiler: true }, options)).toBe(false);
    expect(canHoverPlay({ ...video, kind: 'image' }, options)).toBe(false);
  });
  it('waits through quick sweeps, replaces the previous player, and removes immediately on leave', async () => {
    vi.useFakeTimers();
    try {
      const p = createHoverPlayer(); const a = Symbol('a'); const b = Symbol('b');
      p.enter(a);
      await vi.advanceTimersByTimeAsync(HOVER_PLAY_DELAY_MS - 1);
      expect(p.active()).toBeNull();
      p.leave(a);
      await vi.advanceTimersByTimeAsync(HOVER_PLAY_DELAY_MS);
      expect(p.active()).toBeNull();
      p.enter(a); await vi.advanceTimersByTimeAsync(HOVER_PLAY_DELAY_MS);
      expect(p.active()).toBe(a);
      p.enter(b);
      expect(p.active()).toBeNull();
      p.leave(a);
      await vi.advanceTimersByTimeAsync(HOVER_PLAY_DELAY_MS);
      expect(p.active()).toBe(b);
      p.leave(b);
      expect(p.active()).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});
