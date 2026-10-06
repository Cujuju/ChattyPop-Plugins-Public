// The transcript filter reads jobs recorded with derived text in the same transaction, before rule reevaluation.
import type { CoreContext, PluginDb } from '@plugin-sdk/core';
import type { plugin } from '../shared';
import { JOBS_TABLE } from './schema';

/** Whether any audio or video part of the message has a done transcript that found speech. */
export function hasTranscript(db: PluginDb, messageId: string): boolean {
  return db.prepare(`SELECT 1 FROM ${JOBS_TABLE} WHERE message_id = ? AND state = 'done' AND text <> '' LIMIT 1`).get(messageId) !== undefined;
}

export function registerTranscriptFilter(rules: CoreContext<typeof plugin>['rules'], db: PluginDb): void {
  rules.filter('transcription.transcribed', { test: (_config, { facts }) => facts.memo('transcribed', () => hasTranscript(db, facts.m.id)) });
}
