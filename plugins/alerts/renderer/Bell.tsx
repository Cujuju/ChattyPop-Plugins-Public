// Alerts' top-bar bell and unread navigation.
import { unreadCount, revealPanel, TopBarButton } from '@plugin-sdk/renderer/kit';
import { setAlertsUnreadOnly } from './state';

/** Bell: filter Alerts to unread and bring the panel into view (unfolded, its tab selected, or in its window). */
function showUnreadAlerts(): void {
  setAlertsUnreadOnly(true);
  revealPanel('alerts');
}

/** The bell, a top-bar item; its dot marks unread alerts. */
export function AlertsBell() {
  return (
    <TopBarButton
      label={unreadCount('alerts') ? `Alerts, ${unreadCount('alerts')} unread` : 'Alerts'}
      title="Show unread alerts"
      badge={unreadCount('alerts') > 0}
      onClick={showUnreadAlerts}
      icon={(iconClass) => (
        <svg class={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2z" />
          <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
      )}
    />
  );
}
