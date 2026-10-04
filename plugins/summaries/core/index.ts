// Summary services, scoped rules, usage and retention coverage.
import { defineCorePlugin, type CoreContext } from '@plugin-sdk/core';
import { errorMessage } from '@plugin-sdk/shared';
import { plugin } from '../shared';
import { withOwnPrompts } from '../shared/settings';
import type { SummaryEvent } from '../shared/types';
import { Summarizer } from './summarize';
import { registerSummaryKinds } from './kinds';
import { migrateAutoSummaries } from './autoSummaries';
import { coverageSpans, summarySpend } from './summaryRows';
import { estimateMissingCosts } from './costBackfill';
import { linkPerson, linkStoredPeople } from './linkStored';
import { SUMMARY_MIGRATIONS } from './schema';

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
  const summarizer = new Summarizer(ctx.storage.db, ctx.archive.replyFlags, {
    get: (id, settings) => ctx.ai.provider(id, settings),
    decider: (_settings, feature) => ctx.jev.decider(feature),
    permitted: (ids, reader) => ctx.ai.sources.permitted(ids, reader),
    localNames: () => ctx.ai.providers().filter((p) => p.local).map((p) => p.displayName),
    effective: (settings) => ctx.ai.effective(settings),
  }, emit, () => ctx.identity.names(), ctx.lifetime.signal);
  registerSummaryKinds(ctx.rules, {
    summarize: (request, prompts, trigger) => summarizer.run(request, ctx.ai.settings(), withOwnPrompts(prefs(), prompts), trigger),
  }, emit, (q) => summarizer.coveredFrom(q, ctx.ai.settings()));
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
  });
  migrateAutoSummaries(ctx, Date.now(), ctx.session.lastSeenAt());
  void estimateMissingCosts(ctx.storage.db, ctx.ai.apiCost);
  linkStoredPeople(ctx.storage.db, () => ctx.lifetime.signal.aborted).catch((err: unknown) => {
    if (!ctx.lifetime.signal.aborted) console.warn('[summary] linking people in stored summaries failed:', errorMessage(err));
  });
}

export default defineCorePlugin(plugin, activateSummaries);
