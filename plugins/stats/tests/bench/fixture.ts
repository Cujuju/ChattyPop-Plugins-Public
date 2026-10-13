import type { PluginDb } from '@plugin-sdk/core';
import { MS_PER_DAY } from '@plugin-sdk/shared';

export const CHANNEL = 'benchmark-channel';
const AUTHORS = 30; // Matches the observed small community.
const DAYS = 390; // Full-history span, including a daylight-saving transition.
const VOCABULARY = 40_000; // Long-tail vocabulary must exercise word-trend memory, not a repeated paragraph.
const LINK_PERIOD = 25;
const LINK_MESSAGES = 4; // Four of twenty-five messages contain links: sixteen percent.
const EMPTY_PERIOD = 21; // About 95 percent retain nonblank text, matching the observed archive.
const LINK_COUNT = 4_000; // Repeated shares and distinct URLs exercise both link sections.
const START = Date.UTC(2025, 0, 1);
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
const COMMON = 'the and a we you it this that I have with good bad love hate thanks today tomorrow hello think maybe really'.split(' ');
const SHORT_WORDS = 4;
const MEDIUM_WORDS = 18;
const LONG_WORDS = 80;
const RARE_WORDS = 240; // A small long-message tail exercises tokenization and length ranking.
const PERCENT = 100;
const COMMON_PERCENT = 75; // Most tokens are common prose; one quarter samples the long tail.
const SHORT_PERCENT = 60;
const MEDIUM_PERCENT = 95;
const LONG_PERCENT = 99; // Sixty percent short, thirty-five percent medium, four percent long, one percent very long.
const RANDOM_LEFT = 13;
const RANDOM_RIGHT = 17;
const RANDOM_FINAL = 5; // Standard xorshift32 shifts; deterministic and dependency-free.

export function seed(db: PluginDb, rows: number) {
  const vocab = Array.from({ length: VOCABULARY }, (_, n) => {
    let word = 'term';
    do { word += ALPHABET[n % ALPHABET.length]; n = Math.floor(n / ALPHABET.length); } while (n);
    return word;
  });
  let state = 0x12345678; // Fixed xorshift seed makes every run and revision use identical text.
  const random = () => { state ^= state << RANDOM_LEFT; state ^= state >>> RANDOM_RIGHT; state ^= state << RANDOM_FINAL; return state >>> 0; };
  const user = db.prepare('INSERT INTO users(id, username, global_name) VALUES (?, ?, ?)');
  for (let n = 0; n < AUTHORS; n++) user.run(`u${n}`, `author${n}`, `Author ${n}`);
  const message = db.prepare('INSERT INTO messages(id, channel_id, author_id, ts, content) VALUES (?, ?, ?, ?, ?)');
  const link = db.prepare(`INSERT OR IGNORE INTO links(id, url, platform, first_message_id, first_channel_id, first_author_id, first_ts)
    VALUES (?, ?, 'web', ?, ?, ?, ?)`);
  const share = db.prepare('INSERT INTO message_links(message_id, link_id) VALUES (?, ?)');
  let textMessages = 0;
  let linkedMessages = 0;
  let characters = 0;
  db.transaction(() => {
      for (let n = 0; n < rows; n++) {
        // Reverse history ingestion makes sequence independent of conversation-time ordering.
        const ts = START + Math.floor((rows - n - 1) * DAYS * MS_PER_DAY / rows);
        const author = `u${n % AUTHORS}`;
        const id = String(n + 1);
        const percentile = random() % PERCENT;
        const length = percentile < SHORT_PERCENT ? SHORT_WORDS : percentile < MEDIUM_PERCENT ? MEDIUM_WORDS : percentile < LONG_PERCENT ? LONG_WORDS : RARE_WORDS;
        const tokens = Array.from({ length }, () => random() % PERCENT < COMMON_PERCENT ? COMMON[random() % COMMON.length]! : vocab[random() % vocab.length]!);
        let content = n % EMPTY_PERIOD === 0 ? '' : `${tokens.join(' ')}${n % AUTHORS === 0 ? ' 😀 <:wave:123456>' : ''}`;
        if (n % LINK_PERIOD < LINK_MESSAGES) {
          const linkId = n % LINK_COUNT + 1;
          const url = `https://site${linkId % AUTHORS}.example/post/${linkId}`;
          content += ` ${url}`;
          link.run(linkId, url, id, CHANNEL, author, ts);
          share.run(id, linkId);
          linkedMessages++;
        }
        if (content.trim()) textMessages++;
        characters += content.length;
        message.run(id, CHANNEL, author, ts, content);
      }
  })();
  return { rows, textMessages, linkedMessages, days: DAYS, authors: AUTHORS, vocabulary: VOCABULARY,
    meanCharacters: characters / rows, ingestion: 'reverse timestamp', encrypted: false };
}
