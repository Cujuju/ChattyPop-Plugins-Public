// Registers Links panel, top-bar count, l shortcut, phone section, and Person-window links.
import { defineRendererPlugin } from '@plugin-sdk/renderer';
import { revealPanel } from '@plugin-sdk/renderer/kit';
import { LINKS_PANEL, plugin } from '../shared';
import { LinksPanel } from './LinksPanel';
import { PersonLinks } from './PersonLinks';
import { markLinksSeen, newLinkCount, onLinksShown } from './state';

/** Phone Links uses a primary-panel look. The wrapper scopes theme attributes without adding layout. */
const PhoneLinks = () => (
  <div data-importance="primary" style={{ display: 'contents' }}>
    <LinksPanel />
  </div>
);

export default defineRendererPlugin(plugin, {
  panels: { [LINKS_PANEL]: { view: LinksPanel, unread: { count: newLinkCount, markSeen: markLinksSeen, onShown: onLinksShown } } },
  shortcuts: { l: () => revealPanel(LINKS_PANEL) },
  personLinks: { previews: { Component: PersonLinks } },
  phoneSections: { feed: { label: 'Links', overview: { noun: 'links' }, section: LINKS_PANEL, Component: PhoneLinks, badge: newLinkCount } },
  jevFeatures: {
    linkCategories: { group: 'Links', hint: 'Jev sorts each link into a category (video, article, tool…).' },
    linkSafety: { group: 'Links', hint: 'Jev flags risky links in the Links panel.' },
    linkWorth: { group: 'Links', hint: 'Jev rates how worth reading each link is, for sorting the Links panel.' },
  },
});
