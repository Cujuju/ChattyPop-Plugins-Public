import { describe, expect, it } from 'vitest';
import { MS_PER_MIN, MS_PER_S } from '@shared/units';
import { adoptLinks, linkFeed } from './linksHarness';
import { rawMessage, seedArchive, tempDb } from '@chattypop/host-testing';
import { ARRIVAL } from '@core/arrival';

const CH = '200000000000000001';
const BOB = { id: '400000000000000001', username: 'bob', global_name: 'Bob', avatar: 'abc123' };

describe('links carry the message that first shared them', () => {
  it('as the Archive shows it: author with avatar, text and resolved mentions', () => {
    const db = adoptLinks(tempDb());
    const a = seedArchive(db, [{ id: CH }]);
    const t0 = Date.now() - MS_PER_MIN;
    a.ingestMessages([
      rawMessage(CH, t0, 'hi', { author: BOB }),
      rawMessage(CH, t0 + MS_PER_S, `<@${BOB.id}> look **at** https://example.com/post`),
    ], ARRIVAL.gateway);
    const [link] = linkFeed(db, { limit: 10 });
    expect(link!.message).toMatchObject({
      id: link!.messageId,
      content: `<@${BOB.id}> look **at** https://example.com/post`,
      author: { id: 'u1', name: 'Alice' },
      mentions: { [BOB.id]: 'Bob' },
    });
  });
});
