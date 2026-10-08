// #106: Links feed, Jev judgments (#61–63), and FxTwitter previews for unpreviewed X posts. The host owns the link index.
import { defineChannels, definePlugin, definePreference, finiteOr, type JevFeatureDecl, type JevQueryDecl, type Platform } from '@plugin-sdk/shared';
import type { LinkCard, LinkFilter, LinkItem, LinkPageQuery, PersonLinksQuery } from './types';

export const manifest = {
  id: 'links',
  name: 'Links',
  version: '1.14.5',
  description: 'The Links panel: every shared link with its preview, filters, and Jev’s category, safety and worth-reading reads.',
};

/** Its panel's layout id; presets and saved layouts from before it was a plugin already name it. */
export const LINKS_PANEL = 'links' as const;
/** Its event: judgments or fetched X posts changed what the feed shows. */
export const UPDATED_EVENT = 'updated';

/** Core's calls, from the panel. */
export interface LinksCoreCalls {
  /** Links newest first (by first share), or most worth reading first; keyset-paged. Privacy mode applies. */
  page(q: LinkPageQuery): LinkItem[];
  /** Link counts per platform for a filter (its platform filter ignored). */
  counts(f: LinkFilter): Partial<Record<Platform, number>>;
  /** The links a person shared, each at their latest share of it, newest first. Privacy mode applies. */
  sharedBy(q: PersonLinksQuery): LinkCard[];
  /** Moves the seen watermark to core's clock now: every link shared so far is seen, on the desktop and the phone. */
  markSeen(): void;
}

/** markSeen's arguments checked (the phone makes the call): it takes none. */
export const decodeMarkSeen = (): Parameters<LinksCoreCalls['markSeen']> => [];

export interface LinksEvents {
  [UPDATED_EVENT]: null;
}

/** Settings → Jev → Queries ids (kept from when they were built in). Each question carries its link as `link`. */
export const LINK_QUERY = { category: 'links.category', safety: 'links.safety', worth: 'links.worth' } as const;

const LINK_SEES = '`link`: one link, with its url, title, description, site and `shared_with` (the message that shared it).';
/** Requires the link placeholder in edited questions. */
const LINK_REF = ['`link`'];
const LINK_GROUP = 'Links & search';

/** Links' Settings → Jev switches, keyed as they were before Links was a plugin (adopted as links.<key>). */
const FEATURES = [
  { key: 'linkCategories', label: 'Link categories', default: false },
  { key: 'linkSafety', label: 'Flag spam, scam and NSFW links', default: false },
  { key: 'linkWorth', label: 'Sort links by worth reading', default: false },
] as const satisfies readonly JevFeatureDecl[];

// Placed where they were listed before Links was a plugin: ahead of the host's channel-suggestion query.
const QUERIES: readonly JevQueryDecl<(typeof FEATURES)[number]['key']>[] = [
  {
    id: LINK_QUERY.category,
    before: 'channels.suggest',
    group: LINK_GROUP,
    label: 'Link category',
    features: ['linkCategories'],
    sees: LINK_SEES,
    placeholders: LINK_REF,
    use: 'fixed-options',
    condition: null,
    defaults: {
      type: 'choice',
      question: 'What kind of thing does `link` lead to? Use its title, description and site, and its `shared_with` text for context.',
      // One option per LINK_CATEGORIES entry: a label outside it is stored as no category.
      options: [
        { name: 'video', description: 'a video or stream' },
        { name: 'article', description: 'an article, blog post or documentation page' },
        { name: 'tool', description: 'software, an app, a website tool or a code repository' },
        { name: 'meme', description: 'a meme, joke or humorous image' },
        { name: 'music', description: 'a song, album or music service page' },
        { name: 'news', description: 'a news report' },
        { name: 'social', description: 'a social media post' },
        { name: 'image', description: 'a photo or image that is not a meme' },
        { name: 'discussion', description: 'a forum thread or discussion' },
        { name: 'shopping', description: 'a product or store page' },
        { name: 'other', description: 'none of these' },
      ],
      alertOn: ['other'],
      minProbability: 0.5,
    },
  },
  {
    id: LINK_QUERY.safety,
    after: LINK_QUERY.category,
    group: LINK_GROUP,
    label: 'Spam, scam or NSFW link',
    features: ['linkSafety'],
    sees: LINK_SEES,
    placeholders: LINK_REF,
    use: 'decision',
    condition: 'Flag the link',
    defaults: {
      type: 'noul',
      question: 'Is `link` spam, a scam or phishing, or NSFW (sexual or graphic content)?',
      yes: 'spam, scam, phishing, or NSFW',
      no: 'an ordinary link',
      // Safety flags hide links when Hide flagged is enabled.
      minProbability: 0.7,
    },
  },
  {
    id: LINK_QUERY.worth,
    after: LINK_QUERY.safety,
    group: LINK_GROUP,
    label: 'Link worth reading',
    features: ['linkWorth'],
    sees: LINK_SEES,
    placeholders: LINK_REF,
    use: 'fixed-levels',
    condition: null,
    defaults: {
      type: 'score',
      question: 'For someone catching up on this chat, how worth opening is `link`?',
      // One level per LINK_WORTH_LEVELS entry, same order: the Links panel shows that name.
      levels: ['not worth opening', 'low value', 'somewhat interesting', 'good', 'must see'],
      minScore: 0,
    },
  },
];

export const plugin = definePlugin({
  manifest,
  channels: defineChannels<{ core: LinksCoreCalls; events: LinksEvents }>()({
    core: {
      page: { audiences: ['renderer', 'phone'], writes: false },
      counts: { audiences: ['renderer', 'phone'], writes: false },
      // The Person window is the desktop's.
      sharedBy: { audiences: ['renderer'], writes: false },
      markSeen: { audiences: ['renderer', 'phone'], writes: true, decode: decodeMarkSeen },
    },
    events: { [UPDATED_EVENT]: ['renderer', 'phone'] },
  }),
  panels: [
    {
      id: LINKS_PANEL,
      title: 'Links',
      importance: 'secondary',
      dialog: false,
      // Two chain links.
      iconPath: 'M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2',
      before: 'chat',
    },
  ],
  shortcuts: [{ key: 'l', hint: 'links', after: 'live' }],
  jev: { queries: QUERIES, features: FEATURES },
  // FxTwitter's public status API, for X posts Discord never previewed.
  network: { hosts: ['api.fxtwitter.com'] },
  // Beside Summaries in the phone's drawer; a person's links, as previews, in the Person window.
  slots: { phoneSections: [{ id: 'feed', after: 'summaries.summary' }], personLinks: [{ id: 'previews' }] },
  /** Links first shared after this count as new. The phone reads it, and moves it through markSeen. */
  preferences: { seenUpTo: definePreference<number | null>({ default: null, normalize: finiteOr(null), phone: true }) },
  // Its tables and watermark from when it was built in.
  adopts: { tables: { link_judgments: 'judgments', x_posts: 'x_posts' }, settings: { 'links.seenUpTo': 'seenUpTo' }, jevFeatures: { linkCategories: 'linkCategories', linkSafety: 'linkSafety', linkWorth: 'linkWorth' } },
});
export default plugin;
