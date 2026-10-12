import { describe, expect, it, onTestFinished } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import statsCore from '../core';
import { domainTree } from '../core/domains';

describe('Analytics site tree', () => {
  it('groups subdomains and multi-part public suffixes through the core contract', async () => {
    const t = testPlugin(statsCore, { archive: { channels: [{ id: 'c1' }], messages: [
      { channelId: 'c1', ts: 0, content: 'https://youtube.com/a https://music.youtube.com/a https://music.youtube.com/b' },
      { channelId: 'c1', ts: 0, content: 'https://bbc.co.uk/a https://news.bbc.co.uk/a https://news.bbc.co.uk/b' },
    ] } });
    onTestFinished(() => t.dispose());
    const s = await t.client('renderer').activityStats({ scope: 'all', channelId: null, sinceTs: null });
    expect(s.domains).toEqual([
      { domain: 'bbc.co.uk', count: 3, hosts: [{ host: 'news.bbc.co.uk', count: 2 }, { host: 'bbc.co.uk', count: 1 }] },
      { domain: 'youtube.com', count: 2, hosts: [{ host: 'youtube.com', count: 2 }] },
    ]);
  });

  it('groups distinct YouTube hosts before host URL canonicalization', () => {
    expect(domainTree([{ url: 'https://youtube.com/a', n: 1 }, { url: 'https://music.youtube.com/b', n: 2 }]))
      .toEqual([{ domain: 'youtube.com', count: 3, hosts: [{ host: 'music.youtube.com', count: 2 }, { host: 'youtube.com', count: 1 }] }]);
  });

  it('folds www and bare links into the single site host used by plain rows', () => {
    expect(domainTree([{ url: 'https://www.example.com/a', n: 2 }, { url: 'https://example.com/b', n: 3 }]))
      .toEqual([{ domain: 'example.com', count: 5, hosts: [{ host: 'example.com', count: 5 }] }]);
  });

  it('keeps the bare site and its music subdomain as two hosts', () => {
    expect(domainTree([{ url: 'https://example.com/a', n: 1 }, { url: 'https://music.example.com/b', n: 2 }]))
      .toEqual([{ domain: 'example.com', count: 3, hosts: [{ host: 'music.example.com', count: 2 }, { host: 'example.com', count: 1 }] }]);
  });

  it('preserves private sites, IPs and local hosts, and skips invalid URLs', () => {
    expect(domainTree(['https://a.github.io/a', 'https://b.github.io/a', 'http://localhost/a', 'http://127.0.0.1/a', 'broken']
      .map((url) => ({ url, n: 1 }))).map((site) => site.domain)).toEqual(['127.0.0.1', 'a.github.io', 'b.github.io', 'localhost']);
  });
});
