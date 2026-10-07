export function decodeList(args: readonly unknown[]): [number] {
  if (args.length !== 1 || typeof args[0] !== 'number' || !Number.isSafeInteger(args[0]) || args[0] < 1) throw new Error('Not a plan limit.');
  return [args[0]];
}
