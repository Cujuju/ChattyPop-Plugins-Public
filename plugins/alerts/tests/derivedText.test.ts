// Alerts match a message's derived text (a transcript), and keep those alerts through rule edits.
import { expect, it } from 'vitest';
import { VOICE_MESSAGE_FLAG } from '@shared/discord';
import { ARRIVAL } from '@core/arrival';
import { storeDerivedText } from '@core/derivedText';
import { addedTextArrival, textMessage } from '@core/queries/messageText';
import { rawMessage } from '@chattypop/host-testing';
import { ALERTS } from '../core/tables';
import { alertRule, ruleHarness } from './ruleHarness';

/** The derived-text source of a voice message's transcript, as Transcription names it. */
const TRANSCRIPT_SOURCE = 'transcription:a1';
/** A transcript's first part; the message's own content reads as part 0. */
const FIRST_PART = 1;

it('a rule matches a transcript, and editing the rule keeps that alert', () => {
  const h = ruleHarness();
  const id = h.rules.create(alertRule({ text: { pattern: 'boat', spec: null } }, { name: 'boat' }));
  // Older than the one-day catch-up, so only the archive-wide history can keep its alert.
  const m = rawMessage('c1', Date.UTC(2025, 0, 1), '', { flags: VOICE_MESSAGE_FLAG });
  h.archive.ingestMessages([m], ARRIVAL.gateway);
  // As the host wires a finished transcript: derived text for its message, then the rules see it.
  storeDerivedText(h.db, m.id, TRANSCRIPT_SOURCE, FIRST_PART, 'the boat leaves at noon');
  h.matcher.check(textMessage(h.db, m.id)!, addedTextArrival(h.db, m.id, Date.now()));
  const alerts = () => h.db.prepare(`SELECT message_id AS m FROM ${ALERTS} WHERE rule_id = ?`).all(id);
  expect(alerts()).toEqual([{ m: m.id }]);
  h.rules.update(id, alertRule({ text: { pattern: 'boat', spec: null } }, { name: 'boats' }));
  expect(alerts()).toEqual([{ m: m.id }]);
});
