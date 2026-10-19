// #85 Analytics: who posts most, when, and in which channels, for a channel, a server or everything.
import { defineChannels, definePlugin, definePreference } from '@plugin-sdk/shared';
import { STATS_RANGES, STATS_SECTIONS, isKey, normalizeStatsPick, type ActivityQuery, type ActivityStats, type PostersQuery, type StatsPick, type StatsPoster, type StatsRange, type StatsSection } from './types';
import type { AnalyticsRead } from './readResult';
export type { AnalyticsRead } from './readResult';
import type { EmojiStats, WordStats, SentimentStats } from './text';
import type { ConversationStats } from './conversations';
import type { PersonStreak } from './streaks';
import type { RepeatedLinksStats } from './repeatedLinks';
import type { RollupStatus } from '@plugin-sdk/shared';
import type { VoiceStats } from './voice';
import type { PeopleStats, PersonHistory } from './personHistory';

export const manifest = {
  id: 'stats',
  name: 'Analytics',
  version: '1.24.0',
  description: 'The Analytics panel: message counts by person, day, hour and channel.',
};

/** Its panel's layout id; saved layouts from before it was a plugin already name it. */
export const STATS_PANEL = 'stats' as const;

/** Core's calls, from the panel. */
export interface StatsCoreCalls {
  rollupStatus(): RollupStatus;
  rebuildRollups(channelIds?: string[]): void;
  activityStats(q: ActivityQuery): Promise<AnalyticsRead<ActivityStats>>;
  postersPage(q: PostersQuery): Promise<AnalyticsRead<StatsPoster[]>>;
  personStreaks(q: ActivityQuery): Promise<AnalyticsRead<PersonStreak[]>>;
  personHistory(q: ActivityQuery): Promise<AnalyticsRead<PersonHistory>>;
  peopleStats(q: ActivityQuery): Promise<AnalyticsRead<PeopleStats>>;
  voiceStats(q: ActivityQuery): Promise<AnalyticsRead<VoiceStats>>;
  repeatedLinks(q: ActivityQuery): Promise<AnalyticsRead<RepeatedLinksStats>>;
  emojiStats(q: ActivityQuery): Promise<AnalyticsRead<EmojiStats>>;
  wordStats(q: ActivityQuery): Promise<AnalyticsRead<WordStats>>;
  sentimentStats(q: ActivityQuery): Promise<AnalyticsRead<SentimentStats>>;
  conversationStats(q: ActivityQuery): Promise<AnalyticsRead<ConversationStats>>;
}

export const plugin = definePlugin({
  aiTools: ['words'],
  manifest,
  channels: defineChannels<{ core: StatsCoreCalls }>()({ core: {
    rollupStatus: { audiences: ['renderer'] }, rebuildRollups: { audiences: ['renderer'], ownerOnly: true },
    activityStats: { audiences: ['renderer'], reads: true }, postersPage: { audiences: ['renderer'], reads: true }, personStreaks: { audiences: ['renderer'], reads: true }, personHistory: { audiences: ['renderer'], reads: true }, peopleStats: { audiences: ['renderer'], reads: true }, voiceStats: { audiences: ['renderer'], reads: true }, repeatedLinks: { audiences: ['renderer'], reads: true },
    emojiStats: { audiences: ['renderer'], reads: true }, wordStats: { audiences: ['renderer'], reads: true }, sentimentStats: { audiences: ['renderer'], reads: true }, conversationStats: { audiences: ['renderer'], reads: true },
  } }),
  // The panel's place, range and open section, and whether its rail's channel column is folded.
  preferences: {
    place: definePreference<StatsPick>({ default: null, normalize: normalizeStatsPick }),
    channelsHidden: definePreference<boolean>({ default: false, normalize: (v) => v === true }),
    range: definePreference<StatsRange>({ default: '30d', normalize: (v) => (isKey(STATS_RANGES)(v) ? v : '30d') }),
    section: definePreference<StatsSection>({ default: 'overview', normalize: (v) => (isKey(STATS_SECTIONS)(v) ? v : 'overview') }),
  },
  // The panel's choices from when it was built in.
  adopts: { settings: { 'stats.range': 'range' } },
  // A bar chart's baseline and three bars.
  panels: [{ id: STATS_PANEL, title: 'Analytics', importance: 'reference', dialog: true, after: 'tags', iconPath: 'M4 20h16M7 16v-5M12 16V6M17 16v-8' }],
});
export default plugin;
