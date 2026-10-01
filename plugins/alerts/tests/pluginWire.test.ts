// Alerts' phone-callable write decodes its arguments before the handler runs.
import { describe, expect, it } from 'vitest';
import { decodeWire } from '@plugin-sdk/shared';
import { decodeMarkRead } from '../shared';

describe("bundled plugins' phone writes", () => {
  it('Alerts marks read only integer ids', () => {
    expect(decodeMarkRead([[1, 2], [3]])).toEqual([[1, 2], [3]]);
    expect(decodeMarkRead([null])).toEqual([null, undefined]);
    expect(() => decodeMarkRead([['1']])).toThrow(/alert ids/);
    expect(() => decodeMarkRead([null, [1.5]])).toThrow(/rule ids/);
    // An undefined element on the wire is an element: it fails the id check rather than being skipped.
    expect(() => decodeMarkRead(decodeWire('[[42,{"$void":true},84]]') as unknown[])).toThrow(/alert ids/);
  });
});
