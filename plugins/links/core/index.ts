// Links' core side: the feed the panel pages through, Jev's reading of new links, and FxTwitter posts for X links.
import { defineCorePlugin } from '@plugin-sdk/core';
import { UPDATED_EVENT, plugin } from '../shared';
import { linkCounts, linkPage, linkWindow, personLinkPage } from './feed';
import { LinkJudge } from './judge';
import { XPosts } from './xPosts';
import { defineLinkRollup } from './rollups';

/** X posts still to fetch: kept for the core process, so turning Links off and on pauses them. */
const xQueue = new Set<string>();

export default defineCorePlugin(plugin, (ctx) => {
  const db = ctx.storage.db;
  const rollup = defineLinkRollup(ctx);
  ctx.ai.tools.provide(archiveTools(ctx.storage.read, ctx.archive));
  // A judgment or a fetched post changes no channel: the panel refreshes on this event.
  const updated = (): void => ctx.channels.emit(UPDATED_EVENT, null);
  const judge = new LinkJudge(db, (feature) => ctx.jev.decider(feature), updated, ctx.ai.sources, ctx.archive.linksSql);
  const xPosts = new XPosts(db, ctx.storage.read, ctx.net.fetch, ctx.archive, updated, xQueue, ctx.lifetime.signal);
  // New links may be waiting for Jev (#61–#63), or a switch was just turned on.
  ctx.archive.onChanged((change) => { if (Object.values(change.changes).some((kinds) => kinds.includes('links'))) judge.kick(); });
  ctx.ai.onSettingsChange(() => judge.kick());
  // Turning privacy off reveals links the judge skipped while their channels were hidden.
  ctx.archive.onPrivacyChanged(() => judge.kick());
  ctx.archive.linkIndex.onRebuilt(() => judge.prune());
  // A new message's bare X links: their posts' text is what Jev reads for them.
  ctx.archive.onText((m, _arrived, source) => void (source === 'message' && xPosts.fetchFor(m)));
  ctx.channels.serve({
    rollupStatus: () => rollup.status(),
    rebuildRollups: (channelIds) => rollup.rebuild(channelIds ? { channelIds } : undefined),
    page: async (q) => xPosts.fill(await linkPage(ctx.storage.read, ctx.archive.payloads, ctx.archive.messages, q, ctx.archive.linksSql)),
    window: async (q) => {
      const w = await linkWindow(ctx.storage.read, ctx.archive.payloads, ctx.archive.messages, q, ctx.archive.linksSql);
      return { ...w, items: await xPosts.fill(w.items) };
    },
    counts: (f) => linkCounts(ctx.storage.read, f, rollup),
    sharedBy: async (q) => xPosts.fill(await personLinkPage(ctx.storage.read, ctx.archive.payloads, q, ctx.archive.linksSql)),
    // Core's clock, not the caller's: a phone's may differ from the PC's.
    markSeen: () => ctx.preferences.set('seenUpTo', Date.now()),
  });
  judge.kick();
  xPosts.resume();
  return () => judge.stop();
});
import { archiveTools } from './aiTools';
