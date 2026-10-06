// #65: Jev reranks readable full-text hits in one request. Hidden and local-AI-only hits remain in place and are never sent.
import { carriedQuestion, clipMessage, queryRequest, queryStrength, type AiSources, type PluginDecider, type Question } from '@plugin-sdk/core';
import type { ArchiveMessage, SearchHit } from '@plugin-sdk/shared';
import { RERANK_QUERY } from '../shared';

/** Hits Jev judges per search: the top of the list is what the owner reads; the cost stays one small request. */
export const RERANK_TOP = 15;
/** Below any probability: hits Jev didn't answer follow the answered ones among the judged places. */
const UNANSWERED = -1;

/** What a re-rank reads and asks through. */
export interface RerankDeps {
  jev: PluginDecider;
  /** Archived messages by id, privacy mode applied (ctx.archive.messages). */
  messages(ids: string[]): ArchiveMessage[];
  /** An archived channel's name, else its id. */
  channelName(channelId: string): string;
  sources: AiSources;
}


/** Ranks top sendable hits by Jev probability, followed by unanswered hits. Other positions remain unchanged; hit text and metadata come from the archive. */
export async function rerankHits({ jev, messages, channelName, sources }: RerankDeps, query: string, hits: readonly SearchHit[]): Promise<SearchHit[]> {
  const top = hits.slice(0, RERANK_TOP);
  const stored = new Map(messages(top.map((h) => h.messageId)).map((m) => [m.id, m]));
  const readable = new Set(sources.permitted([...new Set([...stored.values()].map((m) => m.channelId))], 'hosted'));
  const slots = top.flatMap((h, slot) => {
    const m = stored.get(h.messageId);
    return m && readable.has(m.channelId) ? [{ slot, m }] : [];
  });
  if (slots.length < 2) return [...hits];
  const questions: Record<string, Question> = {};
  slots.forEach(({ m }, k) => {
    const q = carriedQuestion(queryRequest(RERANK_QUERY), { candidate: `${m.author.name} in #${channelName(m.channelId)}: ${clipMessage(m.content)}` });
    // Unreachable: the query's `candidate` reference is required (its placeholder), so an edit without it is never used.
    if (!q) throw new Error(`${RERANK_QUERY} names no \`candidate\``);
    questions[`c${k}`] = q;
  });
  const reads = [...new Set(slots.map(({ m }) => m.channelId))];
  const { answers } = await jev.decide({ state: { query }, questions, reads });
  const scored = slots.map(({ slot }, k) => {
    const a = answers[`c${k}`];
    return { hit: hits[slot]!, p: a ? queryStrength(RERANK_QUERY, a) : null, k };
  });
  // Stable: equal probabilities, and hits Jev didn't answer, keep their full-text order.
  scored.sort((x, y) => (y.p ?? UNANSWERED) - (x.p ?? UNANSWERED) || x.k - y.k);
  const out = [...hits];
  slots.forEach(({ slot }, k) => {
    const s = scored[k]!;
    out[slot] = s.p === null ? s.hit : { ...s.hit, relevance: s.p };
  });
  return out;
}
