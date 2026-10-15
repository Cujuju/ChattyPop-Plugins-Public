/** A box on screen: a tile, or the area that clips it. */
export interface Box { left: number; top: number; width: number; height: number }
/** How a hovered tile's picture grows: by `scale`, from `origin` (CSS px from the tile's top left). */
export interface TileZoom { scale: number; origin: string }

/** The point on one axis to grow from so the grown span stays in [0, bound]: as near the middle as that allows. */
function anchor(start: number, size: number, bound: number, scale: number): number {
  if (scale <= 1) return size / 2;
  const least = (start + size * scale - bound) / (scale - 1);
  const most = start / (scale - 1);
  return Math.min(most, Math.max(least, size / 2));
}

/** `wanted`, lowered until the grown tile fits `bounds`, grown from where it stays inside them. */
export function zoomWithin(tile: Box, bounds: Box, wanted: number): TileZoom {
  const scale = Math.max(1, Math.min(wanted, bounds.width / tile.width, bounds.height / tile.height));
  const x = anchor(tile.left - bounds.left, tile.width, bounds.width, scale);
  const y = anchor(tile.top - bounds.top, tile.height, bounds.height, scale);
  return { scale, origin: `${x}px ${y}px` };
}
