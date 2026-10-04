// Summary panels, settings, rules and frame contributions.
import { For, Show } from 'solid-js';
import { defineRendererPlugin } from '@plugin-sdk/renderer';
import { planPercentText, planUsageOf, providerLabel, StatusBarItem } from '@plugin-sdk/renderer/kit';
import { plugin } from '../shared';
import { SummaryPanel } from './SummaryPanel';
import { SummarySection } from './SummarySection';
import { summarySettings } from './settings';
import { summaryView } from './rules';
import { templates } from './templates';
import { stepCitation } from './citations';
import { markSummariesSeen, unseenSummaryCount } from './state';
import { SUMMARY_FEATURE_INFO } from './features';

/** Summaries' provider and its plan-window percentages in the status bar. */
function SummaryStatus() {
  return (
    <Show when={summarySettings().defaultProvider}>
      {(id) => (
        <StatusBarItem label="summary" value={providerLabel(id())}>
          <For each={planUsageOf(id()) ?? []}>{(window) => ` · ${window.label} ${planPercentText(window)}`}</For>
        </StatusBarItem>
      )}
    </Show>
  );
}

export default defineRendererPlugin(plugin, {
  panels: {
    summary: {
      view: SummaryPanel,
      unread: {
        count: unseenSummaryCount,
        markSeen: markSummariesSeen,
      },
    },
  },
  settings: { summaries: { body: SummarySection } },
  rules: {
    actions: { 'summaries.summarize': summaryView },
  },
  shortcuts: {
    j: () => stepCitation(1),
    k: () => stepCitation(-1),
  },
  ruleTemplates: templates,
  statusBar: { status: { Component: SummaryStatus } },
  phoneSections: {
    summary: {
      label: 'Summaries',
      overview: {
        noun: 'summaries',
        does: 'run a summary',
      },
      section: 'summary',
      Component: SummaryPanel,
    },
  },
  notificationKinds: {
    summary: { label: 'Automatic summaries' },
  },
  jevFeatures: SUMMARY_FEATURE_INFO,
});
