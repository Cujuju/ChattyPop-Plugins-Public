// Summary services, scoped rules, usage and retention coverage.
import { defineCorePlugin, type CoreContext } from '@plugin-sdk/core';
import { errorMessage } from '@plugin-sdk/shared';
import { plugin } from '../shared';
import { withOwnPrompts } from '../shared/settings';
import type { SummaryEvent } from '../shared/types';
import { Summarizer } from './summarize';
import { Comparer } from './compare';
import { registerSummaryKinds } from './kinds';
import { migrateAutoSummaries } from './autoSummaries';
import { coverageSpans, summarySpend } from './summaryRows';
import { estimateMissingCosts } from './costBackfill';
import { linkPerson } from './linkPerson';
import { SUMMARY_MIGRATIONS } from './schema';
import type { SummaryProviders } from './providers';

/** Activates the complete summary service through the host context. */
export function activateSummaries(ctx: CoreContext<typeof plugin>) {
  ctx.storage.migrate(SUMMARY_MIGRATIONS);
  const prefs = () => ctx.preferences.get('settings');
  const emit = (event: SummaryEvent): void => {
    if (event.type === 'summary-progress') ctx.channels.emit('progress', event);
    else if (event.type === 'summary-added') ctx.channels.emit('added', event.summary);
    else {
      const { type: _, ...failure } = event;
      ctx.channels.emit('failed', failure);
    }
  };
  const providers: SummaryProviders = {
    get: (id, settings) => ctx.ai.provider(id, settings),
    decider: (_settings, feature) => ctx.jev.decider(feature),
    permitted: (ids, reader) => ctx.ai.sources.permitted(ids, reader),
    localNames: () => ctx.ai.providers().filter((p) => p.local).map((p) => p.displayName),
  };
  const summarizer = new Summarizer(ctx.storage.db, ctx.archive.replyFlags, providers, emit, () => ctx.identity.names(), ctx.lifetime.signal);
  const comparer = new Comparer(ctx.storage.db, summarizer, providers, (p) => ctx.channels.emit('compareProgress', p));
  registerSummaryKinds(ctx.rules, {
    summarize: (request, prompts, trigger) => summarizer.run(request, ctx.ai.settings(), withOwnPrompts(prefs(), prompts), trigger),
  }, emit, (q) => summarizer.coveredFrom(q, prefs()));
  ctx.ai.usage.provide((provider, sinceTs) => summarizer.usageSince(provider, sinceTs));
  ctx.archive.textCoverage.provide(() => coverageSpans(ctx.storage.db));
  ctx.channels.serve({
    summarize: async (request) => {
      try {
        return await summarizer.run(request, ctx.ai.settings(), prefs(), 'manual');
      } catch (err) {
        ctx.channels.emit('progress', {
          phase: 'error',
          done: 0,
          total: 0,
          message: errorMessage(err),
        });
        throw err;
      }
    },
    page: (query) => summarizer.page(query),
    estimate: (request) => summarizer.estimate(request, ctx.ai.settings(), prefs()),
    prompts: (own) => summarizer.prompts(ctx.ai.settings(), withOwnPrompts(prefs(), own)),
    usageSince: (provider, sinceTs) => summarizer.usageSince(provider, sinceTs),
    spending: (starts) => starts.map((sinceTs) => summarySpend(ctx.storage.db, sinceTs)),
    linkPerson: (id, written, userId) => linkPerson(ctx.storage.db, id, written, userId),
    notifyAuto: () => prefs().notifyAuto,
    compare: async (request) => {
      try {
        return await comparer.run(request, ctx.ai.settings(), prefs());
      } catch (err) {
        ctx.channels.emit('compareProgress', { phase: 'error', done: 0, total: request.models.length });
        throw err;
      }
    },
    comparisons: () => comparer.list(),
    comparison: (id) => comparer.get(id),
    deleteComparison: (id) => comparer.delete(id),
  });
  migrateAutoSummaries(ctx, Date.now(), ctx.session.lastSeenAt());
  void estimateMissingCosts(ctx.storage.db, ctx.ai.apiCost);
}

export default defineCorePlugin(plugin, activateSummaries);
