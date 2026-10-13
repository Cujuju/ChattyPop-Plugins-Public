import { defineCorePlugin } from '@plugin-sdk/core';
import { plugin } from '../shared';
import { attachmentPage, personFiles } from './feed';
import { attachmentBreakdown, attachmentTotals } from './totals';

export default defineCorePlugin(plugin, (ctx) => {
  const db = ctx.storage.db;
  ctx.channels.serve({
    page: (q) => attachmentPage(db, ctx.archive.messages, q),
    totals: (f) => attachmentTotals(db, f),
    breakdown: (q) => attachmentBreakdown(db, q),
    sharedBy: (q) => personFiles(db, ctx.archive.messages, q),
  });
});
