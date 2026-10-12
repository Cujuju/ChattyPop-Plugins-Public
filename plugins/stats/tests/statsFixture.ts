import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MIN } from '@plugin-sdk/shared';
import type { SeedArchive } from '@plugin-sdk/core/testing';

const YEAR = 2026;
const PRIOR_YEAR = YEAR - 1;
const JANUARY = 0;
const MARCH = 2;
const DECEMBER = 11;
const LATE_HOUR = 23;
const FIRST_DAY = 1;
const LAST_DECEMBER_DAY = 31;
const MARCH_DAY = 3;
const EVENING_HOUR = 22;
const NEXT_MILLISECOND = 1;
const WEEK_DAYS = 7;
export const BEFORE_YEAR = new Date(PRIOR_YEAR, DECEMBER, LAST_DECEMBER_DAY, LATE_HOUR).getTime();
export const JANUARY_START = new Date(YEAR, JANUARY, FIRST_DAY).getTime();
export const MARCH_START = new Date(YEAR, MARCH, FIRST_DAY).getTime();
export const MARCH_MESSAGES = new Date(YEAR, MARCH, MARCH_DAY, EVENING_HOUR).getTime();
export const ALICE = { id: 'u1', username: 'alice', global_name: 'Alice', avatar: 'alice-avatar' };
export const BOB = { authorId: 'u2', authorName: 'Bob' };

/** Attachment metadata is ingested as Discord supplies it; no download is needed for these counts. */
const attachment = (id: string, contentType: string | null) => ({
  id, filename: `${id}.file`, content_type: contentType, size: 0, url: `https://cdn.example/${id}`,
});
const edit = (ts: number, delay: number) => ({ edited_timestamp: new Date(ts + delay).toISOString() });

export function analyticsArchive(): SeedArchive {
  return {
    guilds: [{ id: 'home', name: 'Home' }, { id: 'away', name: 'Away' }],
    channels: [
      { id: 'c1', name: 'General' }, { id: 't1', name: 'Thread', parentId: 'c1' },
      { id: 'c2', name: 'Other' }, { id: 'c3', guildId: 'away', name: 'Away' }, { id: 'hidden', hidden: true },
    ],
    messages: [
      { channelId: 'hidden', ts: BEFORE_YEAR - MS_PER_DAY, authorId: 'private', content: 'https://shared.example/a' },
      { channelId: 'c2', ts: BEFORE_YEAR, content: 'Bob elsewhere first', ...BOB },
      { channelId: 'c1', ts: BEFORE_YEAR, content: 'old https://shared.example/a', extra: {
        author: ALICE, ...edit(BEFORE_YEAR, MS_PER_MIN - NEXT_MILLISECOND), attachments: [attachment('image', 'image/png')],
      } },
      { channelId: 'c1', ts: JANUARY_START, content: 'https://shared.example/a https://second.example/b', extra: {
        author: ALICE, ...edit(JANUARY_START, MS_PER_MIN), attachments: [attachment('video', 'VIDEO/MP4'), attachment('audio', 'audio/ogg')],
      } },
      { channelId: 't1', ts: JANUARY_START + NEXT_MILLISECOND, content: '', ...BOB, extra: { attachments: [attachment('other', null)] } },
      { channelId: 'c2', ts: JANUARY_START + MS_PER_DAY, authorId: 'u3', authorName: 'Carol', content: ' \t\n', extra: edit(JANUARY_START + MS_PER_DAY, MS_PER_HOUR) },
      { channelId: 'c3', ts: JANUARY_START + MS_PER_DAY, authorId: 'u4', authorName: 'Dave', content: 'away', extra: edit(JANUARY_START + MS_PER_DAY, MS_PER_HOUR - NEXT_MILLISECOND) },
      { channelId: 'c1', ts: MARCH_MESSAGES, content: 'later https://shared.example/a', extra: { author: ALICE, ...edit(MARCH_MESSAGES, MS_PER_DAY) } },
      { channelId: 'c1', ts: MARCH_MESSAGES + NEXT_MILLISECOND, content: 'https://second.example/b https://third.example/c', ...BOB,
        extra: edit(MARCH_MESSAGES + NEXT_MILLISECOND, WEEK_DAYS * MS_PER_DAY) },
    ],
  };
}
