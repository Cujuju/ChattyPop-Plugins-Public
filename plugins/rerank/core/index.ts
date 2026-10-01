// Search re-rank's core side: the search ranker, asking Jev while its Settings → Jev switch is on.
import { defineCorePlugin } from '@plugin-sdk/core';
import { plugin } from '../shared';
import { rerankHits } from './rerank';

export default defineCorePlugin(plugin, (ctx) => {
  const channelName = ctx.storage.db.prepare<[string], string>('SELECT COALESCE(name, id) FROM archive_channels WHERE id = ?').pluck();
  ctx.search.rerank(async (query, hits) => {
    const jev = ctx.jev.decider('searchRerank');
    // Off, or a search of filters alone: nothing to judge the hits against.
    if (!jev || !query) return hits;
    return rerankHits({ jev, messages: (ids) => ctx.archive.messages(ids), channelName: (id) => channelName.get(id) ?? id, sources: ctx.ai.sources }, query, hits);
  });
});
