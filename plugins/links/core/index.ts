// Links' core side: the feed the panel pages through, Jev's reading of new links, and FxTwitter posts for X links.
import { defineCorePlugin } from '@plugin-sdk/core';
import { UPDATED_EVENT, plugin } from '../shared';
import { linkCounts, linkPage } from './feed';
import { LinkJudge } from './judge';
import { XPosts } from './xPosts';

/** X posts still to fetch: kept for the core process, so turning Links off and on pauses them. */
const xQueue = new Set<string>();

export default defineCorePlugin(plugin, (ctx) => {
  const db = ctx.storage.db;
  // A judgment or a fetched post changes no channel: the panel refreshes on this event.
  const updated = (): void => ctx.channels.emit(UPDATED_EVENT, null);
  const judge = new LinkJudge(db, (feature) => ctx.jev.decider(feature), updated, ctx.ai.sources);
  const xPosts = new XPosts(db, ctx.net.fetch, ctx.archive, updated, xQueue, ctx.lifetime.signal);
  // New links may be waiting for Jev (#61–#63), or a switch was just turned on.
  ctx.archive.onChanged(() => judge.kick());
  ctx.ai.onSettingsChange(() => judge.kick());
  ctx.archive.linkIndex.onRebuilt(() => judge.prune());
  // A new message's bare X links: their posts' text is what Jev reads for them.
  ctx.archive.onText((m, _arrived, source) => void (source === 'message' && xPosts.fetchFor(m)));
  ctx.channels.serve({
    page: (q) => xPosts.fill(linkPage(db, ctx.archive.payloads, ctx.archive.messages, q)),
    counts: (f) => linkCounts(db, f),
    // Core's clock, not the caller's: a phone's may differ from the PC's.
    markSeen: () => ctx.preferences.set('seenUpTo', Date.now()),
  });
  judge.kick();
  xPosts.resume();
  return () => judge.stop();
});
