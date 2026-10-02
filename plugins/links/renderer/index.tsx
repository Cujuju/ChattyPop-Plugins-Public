// Links' renderer side: the Links panel, its new-link count on the top bar, the l shortcut that brings it forward, and
// the phone's Links section.
import { defineRendererPlugin } from '@plugin-sdk/renderer';
import { revealPanel } from '@plugin-sdk/renderer/kit';
import { LINKS_PANEL, plugin } from '../shared';
import { LinksPanel } from './LinksPanel';
import { markLinksSeen, newLinkCount, onLinksShown } from './state';

export default defineRendererPlugin(plugin, {
  panels: { [LINKS_PANEL]: { view: LinksPanel, unread: { count: newLinkCount, markSeen: markLinksSeen, onShown: onLinksShown } } },
  shortcuts: { l: () => revealPanel(LINKS_PANEL) },
  // No badge: the phone can't move the watermark, so a count there would never clear.
  phoneSections: { feed: { label: 'Links', overview: { noun: 'links' }, section: LINKS_PANEL, Component: LinksPanel } },
  jevFeatures: {
    linkCategories: { group: 'Links', hint: 'Jev sorts each link into a category (video, article, tool…).' },
    linkSafety: { group: 'Links', hint: 'Jev flags risky links in the Links panel.' },
    linkWorth: { group: 'Links', hint: 'Jev rates how worth reading each link is, for sorting the Links panel.' },
  },
});
