import { defineCorePlugin } from '@plugin-sdk/core';
import { plugin } from '../shared';
import { attachmentPage, personFiles } from './feed';
import { attachmentPeople, attachmentPlaces, attachmentTotals } from './totals';
import { attachmentMonths } from './months';
import { attachmentBreakdown, attachmentPostings } from './space';

export default defineCorePlugin(plugin, (ctx) => {
  const read = ctx.storage.read;
  ctx.ai.tools.provide(archiveTools(ctx.storage.read));
  ctx.channels.serve({
    page: (q) => attachmentPage(read, ctx.archive.messages, q),
    totals: (f) => attachmentTotals(read, f),
    people: (q) => attachmentPeople(read, q),
    places: (f) => attachmentPlaces(read, f),
    months: (f, timeZone) => attachmentMonths(read, f, timeZone),
    sharedBy: (q) => personFiles(read, ctx.archive.messages, q),
    postings: (sha) => attachmentPostings(read, sha),
    breakdown: (f, by) => attachmentBreakdown(read, f, by),
  });
});
import { archiveTools } from './aiTools';
