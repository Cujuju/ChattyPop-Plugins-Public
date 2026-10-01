// Most-used owner tags on one person's visible messages.
import { TAGS, MESSAGE_TAGS } from './tables';
import { type PluginDb } from '@plugin-sdk/core';
import type { PersonTags } from '../shared/types';
import { SHOWN_TAG_SQL } from './store';
/** Tags listed: the chips fit on two lines of the window. */
const PERSON_TOP_TAGS = 12;
/** Privacy-safe top tags, with the original count/name order. */
export function personTags(db: PluginDb, userId: string): PersonTags {
  return db.prepare(
    `SELECT t.name, COUNT(*) AS count FROM ${MESSAGE_TAGS} mt JOIN ${TAGS} t ON t.id = mt.tag_id JOIN archive_messages m ON m.id = mt.message_id
    WHERE mt.${SHOWN_TAG_SQL} AND m.author_id = @user GROUP BY t.id ORDER BY count DESC, t.name LIMIT @limit`,
  )
    .all({
      user: userId,
      limit: PERSON_TOP_TAGS,
    }) as PersonTags;
}
