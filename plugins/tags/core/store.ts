// #78 the owner's tags and which messages carry them. A manual add or removal outranks Jev: Jev never overrides it.
import { TAGS, MESSAGE_TAGS } from './tables';
import { validateTagInput, type MessageTagChip, type Tag, type TagInput, type TaggedMessage } from '../shared/types';
import type { CustomJevQuestion } from '@plugin-sdk/shared';
import { fromJson, toJson, type PluginDb } from '@plugin-sdk/core';

/** Stored tag definition. */
export interface TagRow {
  id: number;
  name: string;
  jev_question: string | null;
  auto: number;
  created_at: number;
}

/** State values in the message tags table. */
export const TAG_STATE = {
  jev: 'jev',
  manual: 'manual',
  removed: 'removed',
  rule: 'rule',
} as const;
/** States that show the tag on the message (prefix the state column with a table alias and '.' in a join). */
export const SHOWN_TAG_SQL = `state IN ('${TAG_STATE.jev}', '${TAG_STATE.manual}', '${TAG_STATE.rule}')`;

/** What a rule's tag action found: applied now, already shown, taken off by the owner (stays off), or the tag is gone. */
export type RuleTagResult = 'applied' | 'shown' | 'removed' | 'noTag';

/** Parses the stored optional Jev question. */
export const tagQuestion = (row: TagRow): CustomJevQuestion | null => fromJson<CustomJevQuestion>(row.jev_question);

const toTag = (r: TagRow & { count: number }): Tag => ({
  id: r.id,
  name: r.name,
  jevQuestion: tagQuestion(r),
  auto: r.auto === 1,
  createdAt: r.created_at,
  count: r.count,
});

/** Owner tag definitions and memberships in the adopted plugin tables. */
export class TagStore {
  constructor(private readonly db: PluginDb) {}

  list(): Tag[] {
    return (
      this.db
        .prepare(`SELECT t.*, (SELECT COUNT(*) FROM ${MESSAGE_TAGS} mt JOIN archive_messages m ON m.id = mt.message_id WHERE mt.tag_id = t.id AND mt.${SHOWN_TAG_SQL}) AS count FROM ${TAGS} t ORDER BY t.name`)
        .all() as (TagRow & { count: number })[]
    ).map(toTag);
  }

  rows(): TagRow[] {
    return this.db.prepare(`SELECT * FROM ${TAGS} ORDER BY id`).all() as TagRow[];
  }

  row(id: number): TagRow | undefined {
    return this.db.prepare(`SELECT * FROM ${TAGS} WHERE id = ?`).get(id) as TagRow | undefined;
  }

  create(input: TagInput): number {
    validateTagInput(input);
    this.assertNameFree(input.name);
    const info = this.db
      .prepare(`INSERT INTO ${TAGS} (name, jev_question, auto, created_at) VALUES (?, ?, ?, ?)`)
      .run(input.name.trim(), toJson(input.jevQuestion), input.auto ? 1 : 0, Date.now());
    return Number(info.lastInsertRowid);
  }

  /** Returns whether what Jev is asked changed; then Jev's tags are dropped (manual ones stay) and asked again. */
  update(id: number, input: TagInput): { questionChanged: boolean } {
    validateTagInput(input);
    this.assertNameFree(input.name, id);
    const old = this.row(id);
    if (!old) throw new Error('That tag no longer exists.');
    const question = toJson(input.jevQuestion);
    const questionChanged = old.jev_question !== question;
    this.db.transaction(() => {
      this.db.prepare(`UPDATE ${TAGS} SET name = ?, jev_question = ?, auto = ? WHERE id = ?`).run(input.name.trim(), question, input.auto ? 1 : 0, id);
      if (questionChanged) this.db.prepare(`DELETE FROM ${MESSAGE_TAGS} WHERE tag_id = ? AND state = ?`).run(id, TAG_STATE.jev);
    })();
    return { questionChanged };
  }

  remove(id: number): void {
    this.db.prepare(`DELETE FROM ${TAGS} WHERE id = ?`).run(id); // Memberships in the message tags table cascade.
  }

  /** The owner adds (on) or takes off (off) a tag; either way Jev no longer decides it for this message. */
  setManual(messageId: string, tagId: number, on: boolean): void {
    this.db
      .prepare(
      `INSERT INTO ${MESSAGE_TAGS} (message_id, tag_id, state, value, updated_at) VALUES (?, ?, ?, NULL, ?)
         ON CONFLICT (message_id, tag_id) DO UPDATE SET state = excluded.state, value = NULL, updated_at = excluded.updated_at`,
    )
      .run(messageId, tagId, on ? TAG_STATE.manual : TAG_STATE.removed, Date.now());
  }

  /** Applies Jev's matching value or clears its previous tag. Preserves manual tagging decisions; returns whether the chip changed. */
  applyJev(messageId: string, tagId: number, value: number | null): boolean {
    const cur = this.db.prepare(`SELECT state FROM ${MESSAGE_TAGS} WHERE message_id = ? AND tag_id = ?`).get(messageId, tagId) as { state: string } | undefined;
    if (cur && cur.state !== TAG_STATE.jev) return false;
    if (value === null) return cur ? this.db.prepare(`DELETE FROM ${MESSAGE_TAGS} WHERE message_id = ? AND tag_id = ?`).run(messageId, tagId).changes > 0 : false;
    this.db
      .prepare(
      `INSERT INTO ${MESSAGE_TAGS} (message_id, tag_id, state, value, updated_at) VALUES (?, ?, '${TAG_STATE.jev}', ?, ?)
         ON CONFLICT (message_id, tag_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
      .run(messageId, tagId, value, Date.now());
    return !cur;
  }

  /** Rule-applied tags preserve manual removals and existing tags; Jev never clears them. */
  applyRule(messageId: string, tagId: number): RuleTagResult {
    if (!this.row(tagId)) return 'noTag';
    const cur = this.db.prepare(`SELECT state FROM ${MESSAGE_TAGS} WHERE message_id = ? AND tag_id = ?`).get(messageId, tagId) as { state: string } | undefined;
    if (cur) return cur.state === TAG_STATE.removed ? 'removed' : 'shown';
    this.db
      .prepare(`INSERT INTO ${MESSAGE_TAGS} (message_id, tag_id, state, value, updated_at) VALUES (?, ?, '${TAG_STATE.rule}', NULL, ?)`)
      .run(messageId, tagId, Date.now());
    return 'applied';
  }

  /** Tags shown on each of these messages. */
  chips(messageIds: string[]): Map<string, MessageTagChip[]> {
    const out = new Map<string, MessageTagChip[]>();
    if (!messageIds.length) return out;
    const rows = this.db
      .prepare(
      `SELECT mt.message_id AS messageId, t.id AS tagId, t.name, mt.state AS source FROM ${MESSAGE_TAGS} mt JOIN ${TAGS} t ON t.id = mt.tag_id
         WHERE mt.${SHOWN_TAG_SQL} AND mt.message_id IN (${messageIds.map(() => '?').join(',')}) ORDER BY t.name`,
    )
      .all(...messageIds) as (MessageTagChip & { messageId: string })[];
    for (const { messageId, ...chip } of rows) out.set(messageId, [...(out.get(messageId) ?? []), chip]);
    return out;
  }

  /** The newest `limit` tagged messages of one channel, for the live client's chips. */
  channelChips(channelId: string, limit: number): Record<string, MessageTagChip[]> {
    const ids = (
      this.db
        .prepare(
        `SELECT DISTINCT m.id FROM ${MESSAGE_TAGS} mt JOIN archive_all_messages m ON m.id = mt.message_id
           WHERE m.channel_id = ? AND mt.${SHOWN_TAG_SQL} ORDER BY m.ts DESC LIMIT ?`,
      )
        .all(channelId, limit) as { id: string }[]
    ).map((r) => r.id);
    return Object.fromEntries(this.chips(ids));
  }

  /** Messages carrying a tag, newest first. */
  tagged(tagId: number, limit: number): TaggedMessage[] {
    return this.db
      .prepare(
      `SELECT m.id AS messageId, m.channel_id AS channelId, COALESCE(c.name, m.channel_id) AS channelName, m.ts,
                m.author_name AS author, m.content, mt.state AS source, mt.value
         FROM ${MESSAGE_TAGS} mt JOIN archive_messages m ON m.id = mt.message_id
         LEFT JOIN archive_all_channels c ON c.id = m.channel_id
         WHERE mt.tag_id = ? AND mt.${SHOWN_TAG_SQL} ORDER BY m.ts DESC LIMIT ?`,
    )
      .all(tagId, limit) as TaggedMessage[];
  }

  private assertNameFree(name: string, exceptId?: number): void {
    const hit = this.db.prepare(`SELECT id FROM ${TAGS} WHERE name = ? COLLATE NOCASE`).get(name.trim()) as { id: number } | undefined;
    if (hit && hit.id !== exceptId) throw new Error('A tag with that name already exists.');
  }
}
