// Summaries' phone write: the summarize call's decoder runs only a well-formed request.
import { describe, expect, it } from 'vitest';
import { decodeSummaryRequest } from '../shared/request';

describe("bundled plugins' phone writes", () => {
  it('Summaries runs only a well-formed request', () => {
    const request = { sinceTs: 1, untilTs: 2, channelIds: ['123456789012345678'], provider: 'claude' };
    expect(decodeSummaryRequest([request])).toEqual([request]);
    expect(decodeSummaryRequest([{ sinceTs: 5 }])).toEqual([{ sinceTs: 5 }]);
    expect(() => decodeSummaryRequest([{ sinceTs: 'yesterday' }])).toThrow(/start time/);
    expect(() => decodeSummaryRequest([{ sinceTs: 1, channelIds: ['../x'] }])).toThrow(/channel id/);
    expect(() => decodeSummaryRequest([{ sinceTs: 1, provider: 'bad provider' }])).toThrow(/provider id/);
    expect(() => decodeSummaryRequest([null])).toThrow(/summary request/);
  });
});
