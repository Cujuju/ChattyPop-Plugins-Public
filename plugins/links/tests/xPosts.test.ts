import { describe, expect, it, vi } from 'vitest';
import { X_POSTS } from '../core/tables';
import { XPosts } from '../core/xPosts';
import type { LinkItem } from '../shared/types';
import { ARRIVAL } from '@core/arrival';
import { messageImages } from '@core/messageImages';
import { textMessage } from '@core/queries/messageText';
import { rawMessage, seedArchive, tempDb } from '@chattypop/host-testing';
import { adoptLinks, hostLinks } from './linksHarness';

const item = (id: number, url: string, embed: LinkItem['embed'] = null): LinkItem => ({
  id,
  url,
  platform: 'x',
  title: null,
  description: null,
  thumbnailUrl: null,
  site: null,
  ts: id,
  messageId: String(id),
  channelId: 'c',
  channelName: 'c',
  guildName: 'g',
  authorName: 'a',
  shares: 1,
  embed,
  message: null,
  category: null,
  flagged: false,
  worth: null,
});

const status = {
  url: 'https://x.com/some_user/status/1',
  text: 'hi @some_user_name *not em* https://example.com/a_b',
  author: { name: 'Some User', screen_name: 'some_user', avatar_url: 'https://pbs.twimg.com/profile_images/1/a.jpg' },
  media: { photos: [{ url: 'https://pbs.twimg.com/media/p.jpg?name=orig' }] },
};

/** FxTwitter answers by post id: 1 ok, 2 deleted (404), 3 rate-limited (429). Stands in for the context's net.fetch. */
function stubFxTwitter() {
  return vi.fn(async (url: string) => {
    const id = url.split('/').pop();
    if (id === '1') return new Response(JSON.stringify({ code: 200, status }), { status: 200 });
    return new Response('{}', { status: id === '2' ? 404 : 429 });
  });
}

/** Resolves once the fetch queue has written every queued post. */
const drained = (db: ReturnType<typeof tempDb>, n: number): Promise<void> =>
  vi.waitFor(() => expect((db.prepare(`SELECT COUNT(*) AS n FROM ${X_POSTS}`).get() as { n: number }).n).toBe(n));

describe('X posts from FxTwitter', () => {
  it('fills X links Discord never previewed, once fetched', async () => {
    const db = adoptLinks(tempDb());
    const fetch = stubFxTwitter();
    let refreshes = 0;
    const x = new XPosts(db, fetch, hostLinks(db), () => refreshes++);
    const items = [
      item(1, 'https://x.com/some_user/status/1'),
      item(2, 'https://x.com/gone/status/2'),
      item(3, 'https://x.com/busy/status/3'),
      item(4, 'https://x.com/some_user'),
      item(5, 'https://x.com/other/status/1', { type: 'rich' } as LinkItem['embed']),
    ];
    expect(x.fill(items).map((i) => i.embed)).toEqual([null, null, null, null, items[4]!.embed]);
    await drained(db, 3);

    // Profile links and links with a Discord preview are never fetched.
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(refreshes).toBe(1);
    const embed = x.fill(items)[0]!.embed!;
    expect(embed).toMatchObject({ url: status.url, imageUrl: status.media.photos[0]!.url, author: { name: 'Some User (@some_user)' } });
    // Plain text is escaped for the markdown renderer; URLs stay whole.
    expect(embed.description).toBe('hi \\@some\\_user\\_name \\*not em\\* https://example.com/a_b');
  });

  it('never refetches deleted posts and retries failures only after the retry interval', async () => {
    const db = adoptLinks(tempDb());
    const fetch = stubFxTwitter();
    const x = new XPosts(db, fetch, hostLinks(db), () => undefined);
    const items = [item(2, 'https://x.com/gone/status/2'), item(3, 'https://x.com/busy/status/3')];
    x.fill(items);
    await drained(db, 2);
    x.fill(items);
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(2);

    db.prepare(`UPDATE ${X_POSTS} SET fetched_at = 0`).run();
    x.fill(items);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(fetch.mock.calls.at(-1)![0]).toMatch(/\/3$/);
  });
});

describe('X posts fetched long ago', () => {
  it('give their photos to a new share without being fetched again', () => {
    const db = adoptLinks(tempDb());
    const a = seedArchive(db, [{ id: 'c1' }]);
    const status = { url: 'https://x.com/u/status/7', text: 'chart', author: { name: 'U', screen_name: 'u', avatar_url: null }, media: { photos: [{ url: 'https://pbs.twimg.com/media/c.jpg', width: 10, height: 10 }] } };
    db.prepare(`INSERT INTO ${X_POSTS} (status_id, state, status_json, fetched_at) VALUES ('7', 'ok', ?, 0)`).run(JSON.stringify(status));
    const fetch = vi.fn();
    const x = new XPosts(db, fetch, hostLinks(db), () => undefined);
    const m = rawMessage('c1', Date.now(), 'https://x.com/u/status/7');
    a.ingestMessages([m], ARRIVAL.gateway);
    x.fetchFor(textMessage(db, m.id)!);
    expect(fetch).not.toHaveBeenCalled();
    expect(messageImages(db, [m.id]).get(m.id)!.map((i) => i.url)).toEqual(['https://pbs.twimg.com/media/c.jpg']);
  });
});
