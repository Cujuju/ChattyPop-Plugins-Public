import { defineRendererPlugin } from '@plugin-sdk/renderer';
import { revealPanel } from '@plugin-sdk/renderer/kit';
import { ATTACHMENTS_PANEL, plugin } from '../shared';
import { AttachmentsPanel } from './AttachmentsPanel';
import { PersonFiles } from './PersonFiles';
import { canCompress, compressArchiveAttachment, deleteArchiveAttachment, deleteLabel } from './actions';
import { compressionJob } from './selection';

export default defineRendererPlugin(plugin, {
  panels: { attachments: { view: AttachmentsPanel } },
  shortcuts: { f: () => revealPanel(ATTACHMENTS_PANEL) },
  personTabs: { files: { label: 'Files', Component: PersonFiles } },
  attachmentMenu: {
    compress: { calls: [], item: (_m, a) => !compressionJob()?.running && canCompress(a)
      ? { label: 'Compress', icon: 'compress', run: () => compressArchiveAttachment(a) } : null },
    free: { calls: [], item: (_m, a) => !compressionJob()?.running && a.status === 'stored' && a.sha256
      ? { label: deleteLabel(1), icon: 'trash', danger: true, run: () => deleteArchiveAttachment(a) } : null },
  },
});
