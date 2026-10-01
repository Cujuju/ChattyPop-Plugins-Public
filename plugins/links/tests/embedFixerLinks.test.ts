import { describe, expect, it } from 'vitest';
import { MS_PER_MIN, MS_PER_S } from '@shared/units';
import { ARRIVAL } from '@core/arrival';
import { rawMessage, seedArchive, tempDb } from '@chattypop/host-testing';
import { adoptLinks, linkFeed } from './linksHarness';

const CH = '200000000000000001';
const STAT = { id: '400000000000000001', username: 'imstat', global_name: 'stat' };
const FIXER = { id: '400000000000000002', username: 'FixTweet', bot: true };
const POST = 'https://x.com/IanCarrollShow/status/2103618781855817746?s=20';

/** A fixer bot's reply as FixTweet posts it: the post, the poster's profile and an attribution link; the card is its embed. */
const fixerReply = (ms: number) =>
  rawMessage(
    CH,
    ms,
    '[Tweet](<https://x.com/i/status/2103618781855817746>) • [@IanCarrollShow](<https://x.com/IanCarrollShow>) • [FxTwitter](https://fxtwitter.com/i/status/2103618781855817746)',
    { author: FIXER, embeds: [{ type: 'rich', url: 'https://fxtwitter.com/i/status/2103618781855817746', description: 'full post text' }] },
  );

describe('an embed fixer bot’s reply collapses into the original share', () => {
  it('adds no links of its own, and its card replaces the original’s', () => {
    const db = adoptLinks(tempDb());
    const a = seedArchive(db, [{ id: CH }]);
    const t0 = Date.now() - MS_PER_MIN;
    // History sync may store the reply before the original: the result must not depend on order.
    a.ingestMessages([fixerReply(t0 + MS_PER_S)], ARRIVAL.gateway);
    a.ingestMessages([rawMessage(CH, t0, POST, { author: STAT, embeds: [{ type: 'link', url: POST, description: 'thin unfurl' }] })], ARRIVAL.gateway);

    const links = linkFeed(db, { limit: 10 });
    expect(links).toHaveLength(1);
    const [link] = links;
    expect(link).toMatchObject({ shares: 2, authorName: 'stat', embed: { description: 'full post text' } });
    // The original message still shows, without its own thinner card for this post.
    expect(link!.message!.content).toBe(POST);
    expect(link!.message!.embeds).toEqual([]);
  });
});
