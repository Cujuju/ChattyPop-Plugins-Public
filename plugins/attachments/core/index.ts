import { defineCorePlugin } from '@plugin-sdk/core';
import { plugin } from '../shared';
import { attachmentPage, personFiles } from './feed';
import { attachmentPeople, attachmentPlaces, attachmentTotals } from './totals';
import { attachmentMonths } from './months';
import { attachmentBreakdown, attachmentPostings } from './space';

export default defineCorePlugin(plugin, (ctx) => {
  const db = ctx.storage.db;
  ctx.ai.tools.provide(archiveTools(db));
  ctx.channels.serve({
    page: (q) => attachmentPage(db, ctx.archive.messages, q),
    totals: (f) => attachmentTotals(db, f),
    people: (q) => attachmentPeople(db, q),
    places: (f) => attachmentPlaces(db, f),
    months: (f, timeZone) => attachmentMonths(db, f, timeZone),
    sharedBy: (q) => personFiles(db, ctx.archive.messages, q),
    postings: (sha) => attachmentPostings(db, sha),
    breakdown: (f, by) => attachmentBreakdown(db, f, by),
  });
});
import { archiveTools } from './aiTools';
