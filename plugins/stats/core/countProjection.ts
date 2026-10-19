import type { ArchiveRead } from '@plugin-sdk/core';

/** Projects daily summaries inside the worker; only bounded panel results cross back to Core. */
export async function countProjection(all: any[], read: ArchiveRead, data: any): Promise<any[]> {
  const q = data.query;
  const calendar = new Intl.DateTimeFormat('sv-SE', { timeZone: data.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dateFromTs = (ts: number) => new Date(calendar.format(ts) + 'T00:00:00');
  const dateName = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const shifted = new Map<string, string>();
  const shift = (day: string, n: number) => {
    const key = day + '/' + n;
    let result = shifted.get(key);
    if (result === undefined) { const d = new Date(day + 'T00:00:00'); d.setDate(d.getDate() + n); result = dateName(d); shifted.set(key, result); }
    return result;
  };
  const bucketNames = new Map<string, string>();
  const bucketName = (day: string, bucket: string) => {
    const key = day + '/' + bucket, prior = bucketNames.get(key); if (prior !== undefined) return prior;
    const d = new Date(day + 'T00:00:00');
    if (bucket === 'week') d.setDate(d.getDate() - (d.getDay() + data.weekDays - 1) % data.weekDays);
    const value = dateName(d); bucketNames.set(key, value); return value;
  };
  const bucketFor = (first: number | null, last: number | null) => first !== null && last !== null && (last - first) / data.dayMs > data.maxDayBuckets ? 'week' : 'day';
  const fill = (counts: Map<string, number>, bucket: string) => {
    const days = [...counts.keys()].sort(), out: any[] = [];
    if (days.length) for (let start = days[0]!; start <= days.at(-1)!; start = shift(start, bucket === 'week' ? data.weekDays : 1)) out.push({ start, count: counts.get(start) ?? 0 });
    return out;
  };
  const streak = (dates: Iterable<string>, silence = true) => {
    let longest: any = null, current: any = { days: 0, start: '', end: '' }, gap: any = null;
    for (const day of [...new Set(dates)].sort()) {
      const next = current.days ? shift(current.end, 1) : null;
      if (next === day) current = { ...current, days: current.days + 1, end: day };
      else {
        if (silence && next && next < day) {
          let days = 0; for (let d = next; d < day; d = shift(d, 1)) days++;
          if (!gap || days > gap.days) gap = { days, start: next, end: shift(day, -1) };
        }
        current = { days: 1, start: day, end: day };
      }
      if (!longest || current.days > longest.days) longest = current;
    }
    return { longest, current: current.days ? current : null, gap };
  };
  const history = all.filter((r) => r.kind === 'message');
  const rows = history.filter((r) => q.sinceTs === null || r.first_ts >= q.sinceTs);
  const min = (rs: any[]) => rs.reduce<number | null>((v, r) => Math.min(v ?? r.first_ts, r.first_ts), null);
  const max = (rs: any[]) => rs.reduce<number | null>((v, r) => Math.max(v ?? r.last_ts, r.last_ts), null);
  const identities = new Map<string, any>();
  for (const r of history) {
    const p = identities.get(r.author_id);
    if (!p || r.name < p.name) identities.set(r.author_id, { userId: r.author_id, name: r.name, avatar: null });
  }
  if (identities.size) for (const p of await read<any>('SELECT id, avatar FROM archive_users WHERE id IN (SELECT value FROM json_each(?))', [JSON.stringify([...identities.keys()])])) identities.get(p.id).avatar = p.avatar;
  const posters = (rs: any[]) => {
    const counts = new Map<string, any>();
    for (const r of rs) {
      const p = counts.get(r.author_id) ?? { ...(identities.get(r.author_id) ?? { userId: r.author_id, avatar: null }), name: r.name, count: 0 };
      p.count += r.n; if (r.name < p.name) p.name = r.name; counts.set(r.author_id, p);
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.userId.localeCompare(b.userId));
  };
  if (data.member === 'identityCandidates') {
    const visible = rows.filter((r) => q.scope !== 'channels' || q.untilTs === null || r.last_ts <= q.untilTs);
    const candidates = posters(visible);
    const pairs = [...new Set(visible.map((r) => JSON.stringify([r.author_id, r.channel_id])))].map((pair) => JSON.parse(pair));
    const names = await read<any>(`SELECT user_id, name FROM archive_names a WHERE EXISTS (
      SELECT 1 FROM json_each(?) j WHERE json_extract(j.value, '$[0]') = a.user_id AND json_extract(j.value, '$[1]') = a.channel_id)`, [JSON.stringify(pairs)]);
    return [candidates.map((p) => ({ ...p, aliases: names.filter((n) => n.user_id === p.userId).map((n) => n.name) }))];
  }
  if (data.member === 'postersPage') return [posters(rows).slice(q.offset, q.offset + q.limit)];
  if (data.member === 'repeatedLinks') {
    const links = all.filter((r) => r.kind === 'link' && (q.sinceTs === null || r.first_ts >= q.sinceTs));
    const urls = new Map<string, any>();
    for (const r of links) {
      let host = ''; try { host = new URL(r.url).hostname.replace(/^www\./, '').replace(/\.$/, ''); } catch {}
      const u = urls.get(r.url) ?? { url: r.url, host, shares: 0, ids: new Set(), first: r };
      u.shares += r.n; u.ids.add(r.author_id);
      const f = u.first;
      if (r.first_ts < f.first_ts || (r.first_ts === f.first_ts && (r.first_id.length < f.first_id.length || (r.first_id.length === f.first_id.length && r.first_id < f.first_id)))) u.first = r;
      urls.set(r.url, u);
    }
    const people = posters(links);
    for (const u of urls.values()) people.find((p) => p.userId === u.first.author_id)!.count--;
    return [{ urls: [...urls.values()].filter((u) => u.shares >= data.minShares).map((u) => ({ url: u.url, host: u.host, shares: u.shares, people: u.ids.size }))
      .sort((a, b) => b.shares - a.shares || a.url.localeCompare(b.url)).slice(0, data.top),
      reposts: people.filter((p) => p.count).sort((a, b) => b.count - a.count || a.userId.localeCompare(b.userId)).slice(0, data.top) }];
  }
  if (data.member !== 'activityStats') {
    const grouped = new Map<string, any>();
    for (const r of history) {
      const key = JSON.stringify([r.author_id, r.date]);
      const day = grouped.get(key) ?? { ...identities.get(r.author_id), start: r.date, count: 0, rangeCount: 0, firstTs: r.first_ts, lastTs: r.last_ts, rangeFirstTs: null, rangeLastTs: null };
      day.count += r.n; day.firstTs = Math.min(day.firstTs, r.first_ts); day.lastTs = Math.max(day.lastTs, r.last_ts);
      if (q.sinceTs === null || r.first_ts >= q.sinceTs) { day.rangeCount += r.n; day.rangeFirstTs = Math.min(day.rangeFirstTs ?? r.first_ts, r.first_ts); day.rangeLastTs = Math.max(day.rangeLastTs ?? r.last_ts, r.last_ts); }
      grouped.set(key, day);
    }
    const days: any[] = [...grouped.values()].sort((a, b) => a.userId.localeCompare(b.userId) || a.start.localeCompare(b.start));
    const people = new Map<string, any>();
    for (const day of days) {
      const p = people.get(day.userId) ?? { ...identities.get(day.userId), count: 0, rangeCount: 0, dates: [], rangeDates: [] };
      p.count += day.count; p.rangeCount += day.rangeCount; p.dates.push(day.start); if (day.rangeCount) p.rangeDates.push(day.start); people.set(day.userId, p);
    }
    const selected = [...people.values()].filter((p) => q.authorId == null || q.authorId === p.userId);
    const asPoster = (p: any) => ({ ...identities.get(p.userId), count: p.count });
    const streaks = selected.filter((p) => p.rangeDates.length).map((p) => ({ ...identities.get(p.userId), ...streak(p.rangeDates, false).longest }))
      .sort((a, b) => b.days - a.days || a.start.localeCompare(b.start) || a.userId.localeCompare(b.userId)).slice(0, data.top);
    if (data.member === 'personStreaks') return [streaks];
    const lastDay = days.length ? days.reduce((s, d) => s > d.start ? s : d.start, days[0]!.start) : null;
    const quiet: any[] = [], returned: any[] = [];
    if (lastDay) for (const p of selected) {
      const threshold = shift(lastDay, -data.silenceDays), lastSeen = p.dates.at(-1);
      if (p.count >= data.quietMin && lastSeen < threshold) quiet.push({ ...asPoster(p), lastSeen });
      const current = streak(p.dates, false).current!, prior = p.dates.indexOf(current.start) - 1;
      if (current.start < threshold || prior < 0) continue;
      const silenceDays = streak([p.dates[prior], current.start]).gap?.days ?? 0;
      if (silenceDays >= data.silenceDays) returned.push({ ...asPoster(p), silenceDays, returned: current.start });
    }
    const h = { archivedSince: min(history), lastDay, streaks,
      quiet: quiet.sort((a, b) => b.count - a.count || a.userId.localeCompare(b.userId)).slice(0, data.top),
      returned: returned.sort((a, b) => b.silenceDays - a.silenceDays || a.userId.localeCompare(b.userId)).slice(0, data.top) };
    if (data.member === 'personHistory') return [h];
    const selectedRows = days.filter((d) => d.rangeCount);
    const first = selectedRows.reduce<number | null>((v, r) => Math.min(v ?? r.rangeFirstTs, r.rangeFirstTs), null);
    const last = selectedRows.reduce<number | null>((v, r) => Math.max(v ?? r.rangeLastTs, r.rangeLastTs), null);
    const bucket = bucketFor(first === null ? null : q.sinceTs ?? first, last);
    const shown = [...people.values()].filter((p) => p.rangeCount && (q.authorId == null || p.userId === q.authorId))
      .sort((a, b) => b.rangeCount - a.rangeCount || a.userId.localeCompare(b.userId)).slice(0, data.voicePeople);
    const totals = new Map<string, number>(), byPerson = new Map(shown.map((p) => [p.userId, new Map<string, number>()]));
    for (const d of selectedRows) {
      const start = bucketName(d.start, bucket); totals.set(start, (totals.get(start) ?? 0) + d.rangeCount);
      const p = byPerson.get(d.userId); if (p) p.set(start, (p.get(start) ?? 0) + d.rangeCount);
    }
    const buckets = fill(totals, bucket);
    const voices = shown.map((p) => ({ poster: { ...identities.get(p.userId), count: p.rangeCount }, counts: buckets.map((b) => byPerson.get(p.userId)!.get(b.start) ?? 0) }));
    let maxShare = 0; for (const p of voices) for (const [i, n] of p.counts.entries()) maxShare = Math.max(maxShare, buckets[i]!.count ? n / buckets[i]!.count : 0);
    const voice = { bucket, buckets, people: voices, maxShare };
    if (data.member === 'voiceStats') return [voice];
    const person = q.authorId == null ? undefined : people.get(q.authorId);
    return [{ history: h, voice, ...(q.authorId == null ? {} : { person: person?.rangeCount ? { poster: { ...identities.get(person.userId), count: person.rangeCount }, rank: 1 + [...people.values()].filter((p) => p.rangeCount > person.rangeCount).length } : null }) }];
  }
  const totals = (rs: any[]) => {
    const sum = (k: string) => rs.reduce((n, r) => n + r[k], 0);
    return { messages: sum('n'), authors: new Set(rs.map((r) => r.author_id)).size, activeDays: new Set(rs.map((r) => r.date)).size,
      editedMessages: sum('edited_n'), textMessages: sum('text_n'), linkedMessages: sum('linked_n'), attachmentMessages: sum('attachment_n') };
  };
  const start = rows.length ? q.sinceTs ?? min(rows) : null, last = max(rows), bucket = bucketFor(start, last);
  const heatmap = Array.from({ length: data.weekDays }, () => new Array(data.dayHours).fill(0));
  const maps = { buckets: new Map<string, number>(), hour: new Map<string, number>(), day: new Map<string, number>(), month: new Map<string, number>(), year: new Map<string, number>() };
  const add = (map: Map<string, number>, key: string, n: number) => map.set(key, (map.get(key) ?? 0) + n);
  const edits = data.editIds.map((id: string) => ({ id, count: 0 })), attachments = data.kinds.map((kind: string) => ({ kind, count: 0 }));
  const histograms = data.histograms?.filter((r: any) => q.sinceTs === null || r.first_ts >= q.sinceTs) ?? rows;
  for (const r of histograms) {
    const p = JSON.parse(r.payload), weekday = new Date(r.date + 'T00:00:00').getDay(), period = bucketName(r.date, bucket);
    for (const [hour, count] of Object.entries(p.hours)) {
      const n = count as number; heatmap[weekday]![Number(hour)] += n;
      add(maps.hour, r.date + 'T' + hour.padStart(2, '0') + ':00:00', n); add(maps.day, r.date, n);
      add(maps.month, r.date.slice(0, 'YYYY-MM'.length) + '-01', n); add(maps.year, r.date.slice(0, 'YYYY'.length) + '-01-01', n);
      add(maps.buckets, period, n);
    }
    p.edits.forEach((n: number, i: number) => { edits[i].count += n; }); p.attachments.forEach((n: number, i: number) => { attachments[i].count += n; });
  }
  const names = new Map((await read<any>('SELECT id, name FROM archive_all_channels')).map((c) => [c.id, c.name]));
  const channelCounts = (rs: any[]) => { const c = new Map<string, number>(); for (const r of rs) add(c, r.channel_id, r.n);
    return [...c].map(([channelId, count]) => ({ channelId, name: names.get(channelId) ?? channelId, count })).sort((a, b) => b.count - a.count || a.channelId.localeCompare(b.channelId)).slice(0, data.top); };
  const links = all.filter((r) => r.kind === 'link' && (q.sinceTs === null || r.first_ts >= q.sinceTs));
  const hosts = new Map<string, number>();
  for (const r of links) try { add(hosts, new URL(r.url).hostname, r.n); } catch {}
  const first = new Map<string, number>(); for (const r of history) first.set(r.author_id, Math.min(first.get(r.author_id) ?? r.first_ts, r.first_ts));
  const timeline: any[] = [];
  if (start !== null && last !== null) {
    const d = dateFromTs(start); d.setDate(1); d.setHours(0, 0, 0, 0);
    const end = dateFromTs(last); end.setDate(1); end.setHours(0, 0, 0, 0);
    for (; d <= end; d.setMonth(d.getMonth() + 1)) {
      const month = dateName(d), prefix = month.slice(0, 'YYYY-MM'.length);
      timeline.push({ start: month, activePosters: new Set(rows.filter((r) => r.date.startsWith(prefix)).map((r) => r.author_id)).size,
        newPosters: [...first.values()].filter((ts) => ts >= start && calendar.format(ts).startsWith(prefix)).length });
    }
  }
  const busiest = (map: Map<string, number>) => [...map].map(([start, count]) => ({ start, count })).sort((a, b) => b.count - a.count || a.start.localeCompare(b.start))[0] ?? null;
  const archivedSince = min(history), preceding = q.sinceTs === null ? null : q.sinceTs - (data.now - q.sinceTs);
  return [{ query: q, ...totals(rows), streaks: streak(maps.day.keys()), bucket, buckets: fill(maps.buckets, bucket), heatmap,
    mostActive: { hour: busiest(maps.hour), day: busiest(maps.day), month: busiest(maps.month), year: busiest(maps.year) },
    archivedSince, archivedUntil: max(history), timeline, comparison: preceding === null || q.sinceTs >= data.now ? null : { start: preceding, end: q.sinceTs,
      totals: archivedSince === null || archivedSince > preceding ? null : totals(history.filter((r) => r.first_ts >= preceding && r.last_ts < q.sinceTs)) },
    posters: posters(rows).slice(0, data.postersTop), channels: channelCounts(rows), editDelay: edits, attachmentTypes: attachments,
    domains: [...hosts].map(([host, n]) => ({ url: 'https://' + host, n })), linksByPerson: posters(links).slice(0, data.top), linksByChannel: channelCounts(links) }];
}
