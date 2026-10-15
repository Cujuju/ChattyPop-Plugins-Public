import { describe, expect, it } from 'vitest';
import { hoverZoomOf, HOVER_ZOOM } from '../shared';
import { zoomWithin, type Box } from '../renderer/zoom';

const TILE = 128;
const GRID: Box = { left: 0, top: 0, width: 4 * TILE, height: 3 * TILE };
const tileAt = (column: number, row: number): Box => ({ left: column * TILE, top: row * TILE, width: TILE, height: TILE });
/** Where the zoomed tile lands, from its zoom's origin. */
const grown = (tile: Box, wanted: number): Box => {
  const z = zoomWithin(tile, GRID, wanted);
  const [x, y] = z.origin.split(' ').map((v) => parseFloat(v)) as [number, number];
  return { left: tile.left + x * (1 - z.scale), top: tile.top + y * (1 - z.scale), width: tile.width * z.scale, height: tile.height * z.scale };
};
const inside = (b: Box): boolean =>
  b.left >= GRID.left - 1e-9 && b.top >= GRID.top - 1e-9 && b.left + b.width <= GRID.width + 1e-9 && b.top + b.height <= GRID.height + 1e-9;

describe('a hovered tile zooms inside its grid', () => {
  it('grows from its middle when there is room', () => {
    expect(zoomWithin(tileAt(1, 1), GRID, 1.5)).toEqual({ scale: 1.5, origin: `${TILE / 2}px ${TILE / 2}px` });
  });

  it.each([[0, 0], [3, 0], [0, 2], [3, 2], [1, 1], [2, 0]])('stays inside from the tile at column %i, row %i', (column, row) => {
    for (const wanted of [1.5, 2, 3, HOVER_ZOOM.max]) expect(inside(grown(tileAt(column, row), wanted))).toBe(true);
  });

  it('is lowered to what the grid holds', () => {
    expect(zoomWithin(tileAt(0, 0), GRID, HOVER_ZOOM.max).scale).toBe(GRID.height / TILE);
  });

  it('keeps a tile scrolled half out inside', () => {
    expect(inside(grown({ ...tileAt(1, 0), top: -TILE / 2 }, 2))).toBe(true);
  });
});

describe('the hover zoom setting', () => {
  it.each([[1.6, 1.5], [9, HOVER_ZOOM.max], [0, HOVER_ZOOM.min], [3.1, 3]])('takes %f as %f', (typed, kept) => expect(hoverZoomOf(typed)).toBe(kept));

  it('falls back to the default for a non-number', () => expect(hoverZoomOf('2')).toBe(hoverZoomOf(undefined)));
});
