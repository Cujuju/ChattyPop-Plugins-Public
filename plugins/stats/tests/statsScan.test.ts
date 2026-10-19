import { describe, expect, it, onTestFinished } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import statsCore from '../core';
import { wordStats } from '../core/words';

describe('Analytics retained text', () => {
  it.each([
    ['[Tweet](https://x.com/a/status/1) • [@name](https://x.com/name) • [FxTwitter](https://fxtwitter.com/i/status/1)', []],
    ['[Tweet](<https://x.com/a/status/1>) • [@name](<https://x.com/name>) • [FxTwitter](<https://fxtwitter.com/i/status/1>)', []],
    ['see [the docs](https://example.com/x) now', ['see', 'now']],
    ['see [the docs](<https://example.com/x>) now', ['see', 'now']],
    ['see [the docs](https://example.com/a_(topic)/more) now', ['see', 'now']],
    ['[not a link] stays', ['not', 'a', 'link', 'stays']],
    ["it’s it's i‘m i’m i'm don’t don't that’s that's can’t can't you’re you're", ["it's", "it's", "i'm", "i'm", "i'm", "don't", "don't", "that's", "that's", "can't", "can't", "you're", "you're"]],
  ])('tokenizes masked links and apostrophes consistently: %s', async (content, words) => {
    const t = testPlugin(statsCore, { archive: { channels: [{ id: 'c1' }], messages: [{ channelId: 'c1', ts: 1, content }] } });
    onTestFinished(() => t.dispose());
    expect((await wordStats(t.read, { scope: 'all', channelId: null, sinceTs: null })).totalWords).toBe(words.length);
  });

  it('strips URLs, Discord mentions, emoji and fenced code through wordStats', async () => {
    const t = testPlugin(statsCore, { archive: { channels: [{ id: 'c1' }], messages: [{ channelId: 'c1', ts: 1,
      content: 'HELLO https://example.com/Secret www.example.com/Other <@123> <@!123> <@&456> <#789> <:Secret:123> <a:Dance:456> ```js\nHidden Words``` WORLD!' }] } });
    onTestFinished(() => t.dispose());
    expect((await wordStats(t.read, { scope: 'all', channelId: null, sinceTs: null })).totalWords).toBe(2);
  });

  it('honors cancellation before a text fold is admitted', async () => {
    const t = testPlugin(statsCore);
    onTestFinished(() => t.dispose());
    const abort = new AbortController(); abort.abort(new Error('superseded'));
    await expect(wordStats(t.read, { scope: 'all', channelId: null, sinceTs: null }, abort.signal)).rejects.toThrow('superseded');
  });
});
