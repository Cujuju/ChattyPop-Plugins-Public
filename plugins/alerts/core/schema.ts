// Alerts' schema steps, applied in order once each: append new steps, never edit a shipped one.
import { pluginTable } from '@plugin-sdk/shared';
import { plugin } from '../shared';
import type { NotifyDevice } from '../shared/types';
import { ALERTS } from './tables';

/** Rules' question signatures, for reconciling history after rule edits. */
export const RULE_QUESTIONS = pluginTable(plugin, 'rule_questions');

/** The inbox column holding why a device was not notified of an alert (#233). */
export const HELD_COLUMN: Record<NotifyDevice, string> = { desktop: 'held_desktop', phone: 'held_phone' };

export const ALERT_MIGRATIONS: readonly string[] = [
  `CREATE TABLE ${RULE_QUESTIONS} (rule_id INTEGER PRIMARY KEY, signature TEXT NOT NULL, history_signature TEXT)`,
  `ALTER TABLE ${ALERTS} ADD COLUMN ${HELD_COLUMN.desktop} TEXT; ALTER TABLE ${ALERTS} ADD COLUMN ${HELD_COLUMN.phone} TEXT`,
];
