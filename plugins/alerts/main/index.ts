// Alerts main: host notifications deliver plugin-selected notices to the devices core chose.
import { defineMainPlugin } from '@plugin-sdk/main';
import { plugin } from '../shared';
import { alertRequests } from './notices';

export default defineMainPlugin(plugin, (ctx) => {
  ctx.channels.on('notify', async (deliveries) => {
    await Promise.all(alertRequests(deliveries).map((request) => ctx.notifications.show(request)));
  });
});
