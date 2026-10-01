// A bare X link's text: the X post the Links plugin fetches when Discord sent no preview, so Jev reads it.
import { describe, expect, it, vi } from 'vitest';
import { MS_PER_DAY } from '@shared/units';
import { ARRIVAL } from '@core/arrival';
import { textMessage } from '@core/queries/messageText';
import { rawMessage, seedArchive, tempDb } from '@chattypop/host-testing';
import { XPosts } from '../core/xPosts';
import { adoptLinks, hostLinks } from './linksHarness';

const preview = (url: string, title: string, description?: string) => ({ embeds: [{ url, title, description }] });

describe('X posts for bare X links', () => {
  const status = { url: 'https://x.com/u/status/1', text: '$MDB CEO poached', author: { name: 'U', screen_name: 'u', avatar_url: null } };

  it('are fetched when a new message shares one, and its message is judged again once the text lands', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ status }), { status: 200 }));
    const db = adoptLinks(tempDb());
    const a = seedArchive(db, [{ id: 'c1' }]);
    const reported: string[][] = [];
    const x = new XPosts(db, fetch, hostLinks(db, (ids) => reported.push(ids)), () => undefined);
    const bare = rawMessage('c1', Date.now(), 'https://x.com/u/status/1');
    const shown = rawMessage('c1', Date.now() + 1, 'https://x.com/u/status/2', preview('https://x.com/u/status/2', 'U', 'seen'));
    const old = rawMessage('c1', Date.now() - 2 * MS_PER_DAY, 'https://x.com/u/status/3');
    a.ingestMessages([bare, shown, old], ARRIVAL.gateway);
    for (const m of [bare, shown, old]) x.fetchFor(textMessage(db, m.id)!);

    await vi.waitFor(() => expect(reported).toEqual([[bare.id]]));
    // Previewed links and messages older than Jev's lookback are never fetched for.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(textMessage(db, bare.id)!.linked).toBe(status.text);
  });
});
