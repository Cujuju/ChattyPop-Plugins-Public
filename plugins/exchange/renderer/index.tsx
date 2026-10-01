// The exchange plugin's renderer side: its section in Settings → Archive.
import { defineRendererPlugin } from '@plugin-sdk/renderer';
import { EXCHANGE_SECTION, plugin } from '../shared';
import { ExchangeControls } from './ExchangeControls';

export default defineRendererPlugin(plugin, {
  settings: { [EXCHANGE_SECTION]: { body: ExchangeControls, meta: () => 'HTML page or DiscordChatExporter JSON' } },
});
