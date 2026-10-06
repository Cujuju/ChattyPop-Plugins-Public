// #78 Jev questions for automatic owner tags and explicit range runs.
import { TAG_RANGE_MAX, tagSubject, type TagRangeRequest, type TagRangeResult } from '../shared/types';
import { LocalOnlyError, sumCosts, type AiSources, type Answer, type PluginDecider, type Question } from '@plugin-sdk/core';
import type { PluginDb } from '@plugin-sdk/core';
import { assertRange, clampCount } from '@plugin-sdk/core';
import { tagQuestion, type TagRow, type TagStore } from './store';
import type { LiveAt, TextMessage } from '@plugin-sdk/core';
import type { TagTriggerSource } from '../shared/types';
import type { Fresh, PluginMessageQuestion, RangeJudgments } from '@plugin-sdk/core';
import { specMatch } from '@plugin-sdk/core';
import { customQuestion } from '@plugin-sdk/core';

// Auto questions ride the per-message request; range runs ask about older messages. The tag condition decides, then TagStore applies.

/** A tag newly shown on a message, applied by Jev or by the owner (rules' own tags are never reported). */
export interface TagApplied {
  m: TextMessage;
  tagId: number;
  source: TagTriggerSource;
  /** When a live message was checked; null for catch-up, re-asks and range runs. */
  liveAt: LiveAt;
}

/** What tag changes report: changed message ids (chips to redraw), and each tag newly applied. */
export interface TagEvents {
  tagged(messageIds: string[]): void;
  applied(e: TagApplied): void;
}

export type TagQuestions = Map<string, { signature: string; dispose: () => void }>;

/** An auto tag's per-message question, turned on by Settings → Jev → Your own tags. */
export type TagQuestion = PluginMessageQuestion<'customTags'>;

/** Registers each auto tag's question for new messages (and drops deleted or manual-only ones). */
export function syncTagQuestions(store: TagStore, events: TagEvents, register: (q: TagQuestion) => () => void, current: TagQuestions = new Map()): () => void {
  const retained = new Set<string>();
  for (const row of store.rows()) {
    const q = tagQuestion(row);
    if (!q || !row.auto) continue;
    const subject = tagSubject(row.id);
    retained.add(subject);
    const signature = JSON.stringify(q);
    if (current.get(subject)?.signature === signature) continue;
    current.get(subject)?.dispose();
    const question = customQuestion(q);
    const match = specMatch(q);
    const dispose = register({
      subject,
      feature: 'customTags',
      question: () => question,
      onAnswer: (m, a, liveAt) => {
        const value = match(a);
        if (!store.applyJev(m.id, row.id, value)) return;
        events.tagged([m.id]);
        if (value !== null) events.applied({
          m,
          tagId: row.id,
          source: 'jev',
          liveAt,
        });
      },
    });
    current.set(subject, { signature, dispose });
  }
  for (const [subject, entry] of current) {
    if (retained.has(subject)) continue;
    entry.dispose();
    current.delete(subject);
  }
  return () => {
    for (const entry of current.values()) entry.dispose();
    current.clear();
  };
}

/** Why a range run refuses a local-AI-only channel. */
const LOCAL_ONLY = 'This channel is set to local AI only, so Jev (hosted) may not read it.';

const RANGE_SQL = `SELECT m.id, m.channel_id AS channelId, m.author_id AS authorId, m.ts, m.text AS content, m.linked FROM archive_all_messages m WHERE m.text != '' AND (m.channel_id = @channel OR m.channel_id IN (SELECT id FROM archive_all_channels WHERE parent_id = @channel))`;

function rangeMessages(db: PluginDb, req: TagRangeRequest): TextMessage[] {
  const s = req.scope;
  if (s.kind === 'latest') {
    const limit = clampCount(s.count, TAG_RANGE_MAX);
    return db.prepare(`${RANGE_SQL} ORDER BY m.ts DESC LIMIT @limit`).all({
      channel: req.channelId,
      limit,
    }) as TextMessage[];
  }
  assertRange(s.fromTs, s.toTs);
  return db.prepare(`${RANGE_SQL} AND m.ts >= @from AND m.ts < @to ORDER BY m.ts DESC LIMIT @limit`).all({
    channel: req.channelId,
    from: s.fromTs,
    to: s.toTs,
    limit: TAG_RANGE_MAX,
  }) as TextMessage[];
}

/** How many messages a range run would ask about (capped at TAG_RANGE_MAX), for the cost estimate. */
export function tagRangeCount(db: PluginDb, req: TagRangeRequest): number {
  return rangeMessages(db, req).length;
}

/** The chosen tags that have a Jev question, with their request form and condition. */
function askable(store: TagStore, tagIds: number[]): {
  row: TagRow;
  question: Question;
  match: (a: Answer) => number | null;
}[] {
  return tagIds.flatMap((id) => {
    const row = store.row(id);
    const q = row && tagQuestion(row);
    return row && q ? [{
      row,
      question: customQuestion(q),
      match: specMatch(q),
    }] : [];
  });
}

/** Asks each selected tag question per message. Rejects local-only channels, skips failed requests, and discards answers when the tag's revision changed. */
export async function tagRange(db: PluginDb, store: TagStore, judge: RangeJudgments, jev: PluginDecider, sources: Pick<AiSources, 'permitted'>, req: TagRangeRequest, events: TagEvents, active: () => boolean, revision: (tagId: number) => number): Promise<TagRangeResult> {
  const tags = askable(store, req.tagIds);
  if (!tags.length) throw new Error('Pick at least one tag with a Jev question.');
  if (!sources.permitted([req.channelId], 'hosted').length) throw new LocalOnlyError(LOCAL_ONLY);
  const messages = rangeMessages(db, req);
  const questions = Object.fromEntries(tags.map((t) => [tagSubject(t.row.id), t.question]));
  const asked = new Map(tags.map((t) => [tagSubject(t.row.id), { tagId: t.row.id, revision: revision(t.row.id) }]));
  const fresh: Fresh = (subject) => {
    const was = asked.get(subject);
    return was !== undefined && revision(was.tagId) === was.revision;
  };
  const changed: string[] = [];
  const costs: number[] = [];
  let failed = 0;
  let applied = 0;
  await Promise.all(messages.map(async (m) => {
    try {
      const { answers, costUsd } = await judge.judgeNow(jev, m, questions, { fresh });
      if (costUsd !== null) costs.push(costUsd); // paid for even if Tags turned off meanwhile
      if (!active()) return;
      for (const t of tags) {
        const subject = tagSubject(t.row.id);
        const a = answers[subject];
        if (!a || !fresh(subject)) continue;
        const value = t.match(a);
        if (!store.applyJev(m.id, t.row.id, value)) continue;
        changed.push(m.id);
        if (value === null) continue;
        applied++;
        events.applied({
          m,
          tagId: t.row.id,
          source: 'jev',
          liveAt: null,
        });
      }
    } catch {
      failed++;
    }
  }));
  if (changed.length) events.tagged([...new Set(changed)]);
  return {
    asked: messages.length,
    applied,
    failed,
    costUsd: sumCosts(costs),
  };
}
