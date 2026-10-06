// The translation filter reads jobs recorded with derived text in the same transaction, before rule reevaluation.
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
