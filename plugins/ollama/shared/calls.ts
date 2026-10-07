export function decodeNoArgs(args: readonly unknown[]): [] {
  if (args.length !== 0) throw new Error('Expected no arguments.');
  return [];
}

export function decodeModel(args: readonly unknown[]): [string] {
  if (args.length !== 1 || typeof args[0] !== 'string' || !args[0].trim() || /[\u0000-\u001f\u007f]/.test(args[0])) throw new Error('Not a model name.');
  return [args[0].trim()];
}
