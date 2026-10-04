// AI services needed by a summary run, without host provider-registry ownership.
import type { AiSettings, ProviderId } from '@plugin-sdk/shared';
import type { AiSources, PluginDecider, PluginProvider } from '@plugin-sdk/core';
import type { SummaryFeature } from '../shared/queries';
/** Provider and Jev selection for one run's settings. */
export interface SummaryProviders {
  get(id: ProviderId, settings: AiSettings): PluginProvider;
  decider(settings: AiSettings, feature: SummaryFeature): PluginDecider | null;
  /** Which channels a provider or Jev may read (ctx.ai.sources). */
  permitted: AiSources['permitted'];
  /** Short names of the providers that run on this PC. */
  localNames(): string[];
}
