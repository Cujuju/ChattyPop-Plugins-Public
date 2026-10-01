// Alerts core: rule matches, adopted inbox rows, managed rules and notification decisions.
import { defineCorePlugin, type CoreContext } from '@plugin-sdk/core';
import { plugin } from '../shared';
import { AlertNotifier, type AlertCooldowns } from './notifier';
import { registerAlertKinds } from './kinds';
import { builtinRules } from './managed';
import { alertItems, markAlertsRead, unreadCounts } from './queries';

/** This core process's notification cooldowns: kept while Alerts is turned off and on. */
const cooldowns: AlertCooldowns = new Map();

/** Registers Alerts and exposes its pending count for lifecycle diagnostics. */
export function activateAlerts(ctx: CoreContext<typeof plugin>, now: () => number = Date.now, session: AlertCooldowns = cooldowns) {
  const db = ctx.storage.db;
  const notifier = new AlertNotifier(
    db,
    ctx.archive.payloads,
    (notify) => {
      ctx.channels.emit('changed', null);
      if (notify.length) ctx.channels.emit('notify', notify);
    },
    (feature) => ctx.jev.decider(feature),
    session,
  );
  const pending = registerAlertKinds(ctx, notifier, now);
  const sync = (): void => {
    ctx.rules.managed.sync(builtinRules((feature) => ctx.jev.isOn(feature)));
  };
  ctx.ai.onSettingsChange(sync);
  ctx.channels.serve({
    alerts: (query) => alertItems(db, ctx.archive.payloads, query),
    markRead: (ids, ruleIds) => {
      markAlertsRead(db, ids, ruleIds);
      notifier.changed();
    },
    unread: () => unreadCounts(db),
  });
  sync();
  return { pending, dispose: () => notifier.dispose() };
}

export default defineCorePlugin(plugin, (ctx) => activateAlerts(ctx).dispose);
