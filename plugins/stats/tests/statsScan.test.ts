import { describe, expect, it, onTestFinished } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import statsCore from '../core';
import { SCAN_BATCH_SIZE, scanText } from '../core/scan';
import { tokenize } from '../core/tokenize';

describe('Analytics retained text', () => {
  it('strips URLs, Discord mentions, emoji tags and fenced code before lower-casing word-like segments', () => {
    expect(tokenize('HELLO https://example.com/Secret www.example.com/Other <@123> <@!123> <@&456> <#789> <:Secret:123> <a:Dance:456> ```js\nHidden Words``` WORLD!'))
      .toEqual(['hello', 'world']);
    expect(tokenize('Hi ```unfinished Hidden')).toEqual(['hi']);
  });

  it('yields between fixed-size keyset batches and excludes arrivals beyond its sequence ceiling', async () => {
    const t = testPlugin(statsCore, { archive: { channels: [{ id: 'c1' }], messages: Array.from({ length: SCAN_BATCH_SIZE + 1 }, (_, ts) => ({ channelId: 'c1', ts, content: 'word' })) } });
    onTestFinished(() => t.dispose());
    const events: string[] = [];
    let count = 0;
    const coverage = await scanText(t.db, { scope: 'all', channelId: null, sinceTs: null }, () => {
      count++;
      if (count === SCAN_BATCH_SIZE) setImmediate(() => {
        events.push('yield');
        t.archive.arrive([{ channelId: 'c1', ts: SCAN_BATCH_SIZE + 1, content: 'arrived later' }]);
      });
      if (count === SCAN_BATCH_SIZE + 1) events.push('last original');
    });
    expect(coverage).toBe(SCAN_BATCH_SIZE + 1);
    expect(events).toEqual(['yield', 'last original']);
  });
});
