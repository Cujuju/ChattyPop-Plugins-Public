// The "A translation" filter (under "And it has"). It reads the jobs table: a translation's job is recorded in the transaction that
// stores its derived text, before the host checks rules again.
import type { CoreContext, PluginDb } from '@plugin-sdk/core';
import type { plugin } from '../shared';
import { JOBS_TABLE } from './store';

/** Whether any part of the message has a done translation; a text already in the language (NULL) has none. */
export function hasTranslation(db: PluginDb, messageId: string): boolean {
  return db.prepare(`SELECT 1 FROM ${JOBS_TABLE} WHERE message_id = ? AND state = 'done' AND translation <> '' LIMIT 1`).get(messageId) !== undefined;
}

export function registerTranslationFilter(rules: CoreContext<typeof plugin>['rules'], db: PluginDb): void {
  rules.filter('translation.translated', { test: (_config, { facts }) => facts.memo('translated', () => hasTranslation(db, facts.m.id)) });
}
