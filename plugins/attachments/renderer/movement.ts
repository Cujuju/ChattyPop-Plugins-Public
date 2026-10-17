export type MovementKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End' | 'PageUp' | 'PageDown';
export const isMovementKey = (key: string): key is MovementKey =>
  ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(key);

/** Rows already include day-boundary short rows; vertical moves keep the column where the next row permits it. */
export function moveTo(rows: readonly (readonly string[])[], id: string, key: MovementKey, pageRows: number, grid: boolean): string {
  const all = rows.flat();
  const index = all.indexOf(id);
  if (index < 0 || (!grid && (key === 'ArrowLeft' || key === 'ArrowRight'))) return id;
  if (key === 'Home') return all[0] ?? id;
  if (key === 'End') return all.at(-1) ?? id;
  if (key === 'ArrowLeft' || key === 'ArrowRight') return all[Math.max(0, Math.min(all.length - 1, index + (key === 'ArrowLeft' ? -1 : 1)))] ?? id;
  const row = rows.findIndex((r) => r.includes(id));
  const column = rows[row]!.indexOf(id);
  const sign = key === 'ArrowUp' || key === 'PageUp' ? -1 : 1;
  const distance = key === 'PageUp' || key === 'PageDown' ? Math.max(1, pageRows) : 1;
  const target = rows[Math.max(0, Math.min(rows.length - 1, row + distance * sign))]!;
  return target[Math.min(column, target.length - 1)] ?? id;
}
