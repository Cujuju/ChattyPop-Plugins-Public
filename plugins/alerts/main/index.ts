// Alerts main: host notifications deliver plugin-selected notices to desktop and paired phones.
import { defineMainPlugin, notificationRequest } from '@plugin-sdk/main';
import { plugin } from '../shared';
import { alertNotices } from './notices';

export default defineMainPlugin(plugin, (ctx) => {
  ctx.channels.on('notify', async (alerts) => {
    await Promise.all(alertNotices(alerts).map((notice) => ctx.notifications.show(notificationRequest(notice))));
  });
});
