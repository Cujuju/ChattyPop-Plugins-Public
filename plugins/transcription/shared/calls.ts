import { snowflakeArg } from '@plugin-sdk/shared';
import type { ToolBuild } from './types';

export function decodeNoArgs(args: readonly unknown[]): [] {
  if (args.length !== 0) throw new Error('Expected no arguments.');
  return [];
}

function itemId(id: unknown): string {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(id)) throw new Error('Not a download id.');
  return id;
}

export function decodeItem(args: readonly unknown[]): [string] {
  if (args.length !== 1) throw new Error('Expected a download id.');
  return [itemId(args[0])];
}

export function decodeInstall(args: readonly unknown[]): [string, ToolBuild | null] {
  if (args.length !== 2) throw new Error('Expected a download id and build.');
  const build = args[1];
  if (build !== null && build !== 'cpu' && build !== 'gpu') throw new Error('Not a tool build.');
  return [itemId(args[0]), build];
}

export function decodeRequest(args: readonly unknown[]): [string, string | null] {
  if (args.length !== 2 || typeof args[0] !== 'string') throw new Error('Not a message part to transcribe.');
  const messageId = snowflakeArg(args[0], 'message');
  const part = args[1];
  if (part === null) return [messageId, null];
  if (typeof part !== 'string') throw new Error('Not a message part to transcribe.');
  if (part.startsWith('attachment:')) snowflakeArg(part.slice('attachment:'.length), 'attachment');
  else if (part.startsWith('embed:')) {
    const url = new URL(part.slice('embed:'.length));
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Not an embed media URL.');
  } else throw new Error('Not a message part to transcribe.');
  return [messageId, part];
}
