// Argument validation and inclusive archive scope for contributed tools.
import { ARCHIVE_TOOL_LINES_MAX, type ArchiveToolLine, type ArchiveToolResult, type ArchiveToolScope } from '@plugin-sdk/core';

interface Field { type: 'string' | 'integer' | 'boolean'; description?: string; minimum?: number; maximum?: number; enum?: readonly string[]; minLength?: number }
export type Fields = Record<string, Field>;
/** JavaScript dates accept timestamps within one hundred million days of the epoch. */
const DATE_BOUND_MS = 8_640_000_000_000_000;
export const timeFields: Fields = {
  since: { type: 'integer', minimum: -DATE_BOUND_MS, maximum: DATE_BOUND_MS, description: 'Inclusive Unix milliseconds; cannot widen the chat window.' },
  until: { type: 'integer', minimum: -DATE_BOUND_MS, maximum: DATE_BOUND_MS, description: 'Inclusive Unix milliseconds; cannot widen the chat window.' },
};
export const textField: Field = { type: 'string', minLength: 1 };
export const limitField = (maximum: number): Field => ({ type: 'integer', minimum: 1, maximum });
export const schema = (properties: Fields, required: string[] = []): Record<string, unknown> =>
  ({ type: 'object', properties, additionalProperties: false, ...(required.length ? { required } : {}) });

/** Rejects unknown fields and invalid values even when the caller bypasses schema validation. */
export function parseArgs<T>(raw: unknown, fields: Fields, required: string[] = []): T {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Tool arguments must be an object.');
  if (Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null) throw new Error('Tool arguments must be a plain object.');
  const values = raw as Record<string, unknown>;
  for (const key of required) if (!Object.hasOwn(values, key)) throw new Error(`Missing argument: ${key}.`);
  for (const [key, value] of Object.entries(values)) {
    const field = Object.hasOwn(fields, key) ? fields[key] : undefined;
    if (!field) throw new Error(`Unknown argument: ${key}.`);
    const valid = field.type === 'integer'
      ? typeof value === 'number' && Number.isSafeInteger(value) && (field.minimum === undefined || value >= field.minimum) && (field.maximum === undefined || value <= field.maximum)
      : field.type === 'boolean' ? typeof value === 'boolean'
      : typeof value === 'string' && value.trim().length >= (field.minLength ?? 0) && (!field.enum || field.enum.includes(value));
    if (!valid) throw new Error(`Invalid argument: ${key}.`);
  }
  return values as T;
}

/** Disjoint windows become an empty channel scope; arguments never enlarge the caller's window. */
export function clampWindow(scope: ArchiveToolScope, args: { since?: number; until?: number }): ArchiveToolScope {
  if (args.since !== undefined && args.until !== undefined && args.since > args.until) throw new Error('since must be <= until.');
  const since = args.since === undefined ? scope.since : scope.since === null ? args.since : Math.max(scope.since, args.since);
  const until = args.until === undefined ? scope.until : scope.until === null ? args.until : Math.min(scope.until, args.until);
  return { channelIds: since !== null && until !== null && since > until ? [] : scope.channelIds, since, until };
}

/** Scope predicates use exact channel membership, including threads only when explicitly listed. */
export function messageScope(scope: ArchiveToolScope): { sql: string; params: (string | number)[] } {
  const parts = ['m.channel_id IN (SELECT value FROM json_each(?))'];
  const params: (string | number)[] = [JSON.stringify(scope.channelIds)];
  if (scope.since !== null) { parts.push('m.ts >= ?'); params.push(scope.since); }
  if (scope.until !== null) { parts.push('m.ts <= ?'); params.push(scope.until); }
  return { sql: parts.join(' AND '), params };
}

/** Readers fetch one extra row to report truncation without loading every matching message. */
export function result(lines: ArchiveToolLine[], limit: number = ARCHIVE_TOOL_LINES_MAX, readChannels?: readonly string[], more = false): ArchiveToolResult {
  const cap = Math.min(limit, ARCHIVE_TOOL_LINES_MAX);
  return {
    lines: lines.slice(0, cap),
    ...(readChannels ? { readChannels } : {}),
    ...(more || lines.length > cap ? { note: 'More results not shown.' } : {}),
  };
}
