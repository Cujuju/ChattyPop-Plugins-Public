// Links' renderer side: the Links panel, its new-link count on the top bar, the l shortcut that brings it forward, and
// the phone's Links section.
import { defineRendererPlugin } from '@plugin-sdk/renderer';
import { revealPanel } from '@plugin-sdk/renderer/kit';
import { LINKS_PANEL, plugin } from '../shared';
import { LinksPanel } from './LinksPanel';
import { markLinksSeen, newLinkCount, onLinksShown } from './state';

/**
 * The phone's Links section. A screen of its own there, it takes a primary panel's look (the filled icon tile, as
 * Summaries has), where the desktop's panel is secondary. The wrapper only scopes the theme: it lays nothing out.
 */
const PhoneLinks = () => (
  <div data-importance="primary" style={{ display: 'contents' }}>
    <LinksPanel />
  </div>
);

export default defineRendererPlugin(plugin, {
  panels: { [LINKS_PANEL]: { view: LinksPanel, unread: { count: newLinkCount, markSeen: markLinksSeen, onShown: onLinksShown } } },
  shortcuts: { l: () => revealPanel(LINKS_PANEL) },
  phoneSections: { feed: { label: 'Links', overview: { noun: 'links' }, section: LINKS_PANEL, Component: PhoneLinks, badge: newLinkCount } },
  jevFeatures: {
    linkCategories: { group: 'Links', hint: 'Jev sorts each link into a category (video, article, tool…).' },
    linkSafety: { group: 'Links', hint: 'Jev flags risky links in the Links panel.' },
    linkWorth: { group: 'Links', hint: 'Jev rates how worth reading each link is, for sorting the Links panel.' },
  },
});
