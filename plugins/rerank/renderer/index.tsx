// Search re-rank's renderer side: its Settings → Jev row. The host's search shows its order and note.
import { defineRendererPlugin } from '@plugin-sdk/renderer';
import { plugin } from '../shared';

export default defineRendererPlugin(plugin, {
  jevFeatures: {
    searchRerank: { group: 'Messages & search', hint: 'Jev re-orders the top search results by how well they answer your query.' },
  },
});
