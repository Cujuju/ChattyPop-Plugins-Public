// #85 Analytics: who posts most, when, and in which channels, for the shown channel, its server or everything.
import { defineChannels, definePlugin, definePreference } from '@plugin-sdk/shared';
import { STATS_RANGES, STATS_SCOPES, STATS_SECTIONS, isKey, type ActivityQuery, type ActivityStats, type PostersQuery, type StatsPoster, type StatsRange, type StatsScope, type StatsSection } from './types';
import type { EmojiStats, WordStats, SentimentStats } from './text';
import type { ConversationStats } from './conversations';
import type { PersonStreak } from './streaks';
import type { RepeatedLinksStats } from './repeatedLinks';
import type { VoiceStats } from './voice';
import type { PeopleStats, PersonHistory } from './personHistory';

export const manifest = {
  id: 'stats',
  name: 'Analytics',
  version: '1.23.5',
  description: 'The Analytics panel: message counts by person, day, hour and channel.',
};

/** Its panel's layout id; saved layouts from before it was a plugin already name it. */
export const STATS_PANEL = 'stats' as const;

/** Core's calls, from the panel. */
export interface StatsCoreCalls {
  activityStats(q: ActivityQuery): ActivityStats;
  postersPage(q: PostersQuery): StatsPoster[];
  personStreaks(q: ActivityQuery): PersonStreak[];
  personHistory(q: ActivityQuery): PersonHistory;
  peopleStats(q: ActivityQuery): PeopleStats;
  voiceStats(q: ActivityQuery): VoiceStats;
  repeatedLinks(q: ActivityQuery): RepeatedLinksStats;
  emojiStats(q: ActivityQuery): Promise<EmojiStats>;
  wordStats(q: ActivityQuery): Promise<WordStats>;
  sentimentStats(q: ActivityQuery): Promise<SentimentStats>;
  conversationStats(q: ActivityQuery): Promise<ConversationStats>;
}

export const plugin = definePlugin({
  aiTools: ['words'],
  manifest,
  channels: defineChannels<{ core: StatsCoreCalls }>()({ core: {
    activityStats: ['renderer'], postersPage: ['renderer'], personStreaks: ['renderer'], personHistory: ['renderer'], peopleStats: ['renderer'], voiceStats: ['renderer'], repeatedLinks: ['renderer'],
    emojiStats: ['renderer'], wordStats: ['renderer'], sentimentStats: ['renderer'], conversationStats: ['renderer'],
  } }),
  // The panel's scope, range and open section.
  preferences: {
    scope: definePreference<StatsScope>({ default: 'channel', normalize: (v) => (isKey(STATS_SCOPES)(v) ? v : 'channel') }),
    range: definePreference<StatsRange>({ default: '30d', normalize: (v) => (isKey(STATS_RANGES)(v) ? v : '30d') }),
    section: definePreference<StatsSection>({ default: 'overview', normalize: (v) => (isKey(STATS_SECTIONS)(v) ? v : 'overview') }),
  },
  // The panel's choices from when it was built in.
  adopts: { settings: { 'stats.scope': 'scope', 'stats.range': 'range' } },
  // A bar chart's baseline and three bars.
  panels: [{ id: STATS_PANEL, title: 'Analytics', importance: 'reference', dialog: true, after: 'tags', iconPath: 'M4 20h16M7 16v-5M12 16V6M17 16v-8' }],
});
export default plugin;
