// Batches enabled Jev link questions (#61–63), carrying each link with its question. Excludes links first shared in local-AI-only channels.
import { MS_PER_DAY, errorMessage } from '@plugin-sdk/shared';
import {
  SerialLoop,
  carriedQuestion,
  clipMessage,
  fromJson,
  queryLabel,
  queryMatch,
  queryRequest,
  type AiSources,
  type Answer,
  type PluginDb,
  type PluginDecider,
  type Question,
} from '@plugin-sdk/core';
import { LINK_QUERY as QUERY } from '../shared';
import { LINK_CATEGORIES, type LinkCategory } from '../shared/types';
import { JUDGMENTS } from './tables';

/** Activation judges links from the preceding day; older links remain unjudged. Newly shared links are judged on arrival. */
const LOOKBACK_MS = MS_PER_DAY;
/** Links per batched Jev request. */
const LINKS_PER_REQUEST = 8;
/** Flag threshold for legacy probability judgments. New editable-query judgments store 1 or 0. */
export const FLAG_AT = 0.7;
const FLAGGED = 1;
const NOT_FLAGGED = 0;

/** The Settings → Jev switches it declares. */
export type Feature = 'linkCategories' | 'linkSafety' | 'linkWorth';
const COLUMN: Record<Feature, 'category' | 'flagged' | 'worth'> = { linkCategories: 'category', linkSafety: 'flagged', linkWorth: 'worth' };

/** A batched request's state: each question carries its own link, so no link sits before another's questions. */
const NO_SHARED_STATE = {};
/** The questions each feature asks, keyed by its answer's prefix. */
const ASKS: Record<Feature, { prefix: string; query: string }> = {
  linkCategories: { prefix: 'category', query: QUERY.category },
  linkSafety: { prefix: 'flagged', query: QUERY.safety },
  linkWorth: { prefix: 'worth', query: QUERY.worth },
};

interface Pending {
  id: number;
  url: string;
  title: string | null;
  description: string | null;
  site: string | null;
  content: string | null;
  asked: string | null;
  /** Where it was first shared: what Jev reads about it. */
  channelId: string;
}

/** Judges unjudged recent links in the background. `deciderFor` reads Settings → Jev per call, so toggles apply at once. */
export class LinkJudge {
  private readonly loop = new SerialLoop(() => this.drain());
  /** Links whose request failed this session; retried next start rather than in a tight loop. */
  private readonly skipped = new Set<number>();
  /** The plugin turned off: no further requests (one in flight still lands). */
  private stopped = false;

  constructor(
    private readonly db: PluginDb,
    private readonly deciderFor: (feature: Feature) => PluginDecider | null,
    private readonly changed: () => void,
    /** Which channels Jev may read. */
    private readonly sources: Pick<AiSources, 'sql'>,
  ) {}

  /** Coalesces calls (every archive change) into one background loop. */
  kick(): void {
    if (!this.stopped) void this.loop.kick();
  }

  stop(): void {
    this.stopped = true;
  }

  /** Judgments are keyed by URL: drops those whose URL left the link index (a rebuild merged it into another). */
  prune(): void {
    this.db.prepare(`DELETE FROM ${JUDGMENTS} WHERE url NOT IN (SELECT url FROM archive_all_links)`).run();
  }

  private async drain(): Promise<void> {
    for (let batch = this.pending(); batch.length && !this.stopped; batch = this.pending()) {
      await this.judge(batch);
      this.changed();
    }
  }

  private features(): { feature: Feature; jev: PluginDecider }[] {
    return (Object.keys(COLUMN) as Feature[]).flatMap((feature) => {
      const jev = this.deciderFor(feature);
      return jev ? [{ feature, jev }] : [];
    });
  }

  /** Recent links missing an answer for an enabled feature that wasn't asked yet (a failed ask is retried next start). */
  private pending(): (Pending & { features: Feature[] })[] {
    const on = this.features().map((f) => f.feature);
    if (!on.length) return [];
    const rows = this.db
      .prepare(
        `SELECT l.id, l.url, l.title, l.description, l.site, l.first_channel_id AS channelId, (SELECT content FROM archive_all_messages WHERE id = l.first_message_id) AS content, j.asked
         FROM archive_all_links l LEFT JOIN ${JUDGMENTS} j ON j.url = l.url
         WHERE l.first_ts >= ? AND ${this.sources.sql('l.first_channel_id', 'hosted')} ORDER BY l.first_ts DESC`,
      )
      .all(Date.now() - LOOKBACK_MS) as Pending[];
    const out: (Pending & { features: Feature[] })[] = [];
    for (const r of rows) {
      if (this.skipped.has(r.id)) continue;
      const asked = new Set(fromJson<string[]>(r.asked) ?? []);
      const features = on.filter((f) => !asked.has(f));
      if (features.length) out.push({ ...r, features });
      if (out.length >= LINKS_PER_REQUEST) break;
    }
    return out;
  }

  /** One request for a batch of links; each link's answers are stored with the features asked, even when Jev gave none. */
  private async judge(links: (Pending & { features: Feature[] })[]): Promise<void> {
    const jev = this.features()[0]?.jev;
    if (!jev) return;
    let answers: Record<string, Answer | undefined>;
    try {
      const questions: Record<string, Question> = {};
      links.forEach((link, k) => {
        const data = {
          link: { url: link.url, title: link.title, description: link.description, site: link.site, ...(link.content ? { shared_with: clipMessage(link.content) } : {}) },
        };
        for (const f of link.features) {
          const q = carriedQuestion(queryRequest(ASKS[f].query), data);
          // Unreachable: each query's `link` reference is required (its placeholder), so an edit without it is never used.
          if (!q) throw new Error(`${ASKS[f].query} names no \`link\``);
          questions[`${ASKS[f].prefix}_l${k}`] = q;
        }
      });
      answers = (await jev.decide({ state: NO_SHARED_STATE, questions, reads: links.map((l) => l.channelId) })).answers as typeof answers;
    } catch (err) {
      for (const link of links) this.skipped.add(link.id);
      console.warn('[links] Jev judgment failed:', errorMessage(err));
      return;
    }
    const prevAsked = this.db.prepare(`SELECT asked FROM ${JUDGMENTS} WHERE url = ?`);
    const store = this.db.prepare(
      `INSERT INTO ${JUDGMENTS} (url, category, flagged, worth, asked, model, judged_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(url) DO UPDATE SET category = COALESCE(excluded.category, category), flagged = COALESCE(excluded.flagged, flagged),
         worth = COALESCE(excluded.worth, worth), asked = excluded.asked, model = excluded.model, judged_at = excluded.judged_at`,
    );
    this.db.transaction(() =>
      links.forEach((link, k) => {
        const ref = `l${k}`;
        const prev = prevAsked.get(link.url) as { asked: string } | undefined;
        const asked = [...new Set([...(fromJson<string[]>(prev?.asked ?? null) ?? []), ...link.features])];
        const c = answers[`category_${ref}`];
        const label = c ? queryLabel(QUERY.category, c) : null;
        const category = label && LINK_CATEGORIES.includes(label as LinkCategory) ? label : null;
        const f = answers[`flagged_${ref}`];
        const flagged = f ? (queryMatch(QUERY.safety, f) !== null ? FLAGGED : NOT_FLAGGED) : null;
        const w = answers[`worth_${ref}`];
        store.run(link.url, category, flagged, w?.type === 'score' ? w.score : null, JSON.stringify(asked), jev.model, Date.now());
      }),
    )();
  }
}
