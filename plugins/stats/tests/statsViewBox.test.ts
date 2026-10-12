import { describe, expect, it } from 'vitest';
import { fitViewBox } from '../renderer/viewBox';

describe('Analytics drawing bounds', () => {
  it('fits measured node and label corners with exactly the requested padding on every side', () => {
    const bounds = [{ x: -180, y: -30 }, { x: 740, y: 290 }];
    const copy = structuredClone(bounds);
    const padding = 16;
    const [left, top, width, height] = fitViewBox(bounds, padding, { width: 1000, height: 1000 }).split(' ').map(Number);
    expect(bounds[0]!.x - left!).toBe(padding);
    expect(bounds[0]!.y - top!).toBe(padding);
    expect(left! + width! - bounds[1]!.x).toBe(padding);
    expect(top! + height! - bounds[1]!.y).toBe(padding);
    expect(bounds).toEqual(copy);
  });

  it('uses the caller layout for empty or incomplete bounds', () => {
    for (const bounds of [null, [], [{ x: 10, y: 10 }]]) {
      expect(fitViewBox(bounds, 16, { width: 1000, height: 1000 })).toBe('0 0 1000 1000');
    }
  });

  it('keeps a point-sized drawing nonempty through padding and accepts fractional bounds', () => {
    expect(fitViewBox([{ x: 2.5, y: -1.5 }, { x: 2.5, y: -1.5 }], 0.5, { width: 1000, height: 1000 })).toBe('2 -2 1 1');
  });
});
