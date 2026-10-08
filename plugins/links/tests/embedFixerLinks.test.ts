import { describe, expect, it } from 'vitest';
import { MS_PER_MIN, MS_PER_S } from '@shared/units';
import { ARRIVAL } from '@core/arrival';
import { rawMessage, seedArchive, tempDb } from '@chattypop/host-testing';
import { partKey } from '@plugin-sdk/core';
import type { ArchiveMessage, AttachmentNote } from '@plugin-sdk/shared';
import { withLinkCard } from '../core/feed';
import type { LinkCard } from '../shared/types';
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
    // The original message still shows, the fixer's card in place of its own thinner one for this post.
    expect(link!.message!.content).toBe(POST);
    expect(link!.message!.embeds).toMatchObject([{ description: 'full post text' }]);
  });
});

describe('withLinkCard', () => {
  const url = 'https://www.tiktok.com/ZN8kgxtHm';
  const note = (part: string): AttachmentNote => ({ pluginId: 'translation', part, kind: 'translation', state: 'done', label: 'translation', text: 'hello' });
  const card = { url, embed: { type: 'rich', url: 'https://a.tnktok.com/ZN8kgxtHm', title: 'card' } } as LinkCard;
  const message = { id: 'm1', embeds: [], notes: [note(partKey.linkText(url)), note(partKey.linkText('https://other.example/'))] } as unknown as ArchiveMessage;

  it('moves the message’s notes on the link’s text into the card from elsewhere, leaving its others', () => {
    const shown = withLinkCard(message, card, 'm2');
    expect(shown.embeds).toMatchObject([{ title: 'card', notes: [{ part: partKey.linkText(url) }] }]);
    expect(shown.notes).toEqual([note(partKey.linkText('https://other.example/'))]);
  });

  it('leaves the message as is when the card is its own', () => {
    expect(withLinkCard(message, card, 'm1')).toBe(message);
  });
});
