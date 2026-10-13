// The exchange plugin's renderer side: its section in Settings → Archive and its action on the Archive's selected messages.
import { defineRendererPlugin } from '@plugin-sdk/renderer';
import { countText, failureNotice, inCompanion, noticeDialog } from '@plugin-sdk/renderer/kit';
import { EXCHANGE_SECTION, SELECTION_EXPORT, plugin } from '../shared';
import type { SelectionExportOptions } from '../shared/types';
import { ExchangeControls } from './ExchangeControls';
import { FORMATS } from './formats';
import { exportMessages } from './state';

const EXPORT_TITLE = 'Export selected messages';

/** Asks for a folder, writes the file and says where it is; nothing when no folder was picked. */
const exportSelection = (opts: SelectionExportOptions): Promise<void> =>
  exportMessages(opts).then((r) => {
    if (!r) return;
    const message = r.file ? `Wrote ${countText(r.messages, 'message')} to ${r.file}` : 'None of the selected messages is still stored with its content.';
    void noticeDialog({ title: EXPORT_TITLE, message });
  }, failureNotice(EXPORT_TITLE));

export default defineRendererPlugin(plugin, {
  settings: { [EXCHANGE_SECTION]: { body: ExchangeControls, meta: () => 'HTML, JSON, text, Markdown or CSV' } },
  selectionMenu: {
    [SELECTION_EXPORT]: {
      // Main picks the folder and core writes there: no core call of a window's own.
      calls: [],
      // The file lands on the PC, so a phone isn't offered it.
      item: (messages) => {
        const first = messages[0];
        if (inCompanion || !first) return null;
        const opts = { channelId: first.channelId, messageIds: messages.map((m) => m.id) };
        return {
          label: 'Export',
          icon: 'download',
          submenu: [{ heading: 'Export as', items: FORMATS.map((f) => ({ label: f.label, icon: 'download', run: () => exportSelection({ ...opts, format: f.value }) })) }],
        };
      },
    },
  },
});
