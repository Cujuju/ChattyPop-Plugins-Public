import { defineCorePlugin } from '@plugin-sdk/core';
import { plugin } from '../shared';
import { attachmentPage, personFiles } from './feed';
import { attachmentPeople, attachmentPlaces, attachmentTotals } from './totals';
import { attachmentMonths } from './months';
import { attachmentBreakdown, attachmentPostings } from './space';
import { defineAttachmentRollups } from './rollups';

export default defineCorePlugin(plugin, (ctx) => {
  const read = ctx.storage.read;
  const rollups = defineAttachmentRollups(ctx);
  ctx.ai.tools.provide(archiveTools(ctx.storage.read));
  ctx.channels.serve({
    rollupStatus: () => {
      const a = rollups.counts.status(), b = rollups.files.status();
      return { building: a.building || b.building, dirty: a.dirty + b.dirty, total: a.total + b.total, error: a.error ?? b.error };
    },
    rebuildRollups: (channelIds) => { for (const rollup of Object.values(rollups)) rollup.rebuild(channelIds ? { channelIds } : undefined); },
    page: (q) => attachmentPage(read, ctx.archive.messages, q),
    totals: (f) => attachmentTotals(read, f, rollups),
    people: (q) => attachmentPeople(read, q, rollups),
    places: (f) => attachmentPlaces(read, f, rollups),
    months: (f, timeZone) => attachmentMonths(read, f, timeZone, rollups),
    sharedBy: (q) => personFiles(read, ctx.archive.messages, q),
    postings: (sha) => attachmentPostings(read, sha),
    breakdown: (f, by) => attachmentBreakdown(read, f, by, rollups),
  });
});
import { archiveTools } from './aiTools';
