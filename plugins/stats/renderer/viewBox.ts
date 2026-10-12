export interface ChartPoint { x: number; y: number }

/** Both d3-cloud bounds and SVG getBBox corners fit in their drawing's coordinate system. */
export function fitViewBox(bounds: readonly ChartPoint[] | null, padding: number, fallback: { width: number; height: number }): string {
  const [min, max] = bounds ?? [];
  if (!min || !max) return `0 0 ${fallback.width} ${fallback.height}`;
  return `${min.x - padding} ${min.y - padding} ${max.x - min.x + padding * 2} ${max.y - min.y + padding * 2}`;
}
