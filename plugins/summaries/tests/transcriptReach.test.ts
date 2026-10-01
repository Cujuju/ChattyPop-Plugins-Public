// Transcripts as message text in Summaries: its summaries (and their cache), and the text retention its coverage drives.
import { archivePayloads } from '@core/plugins/archivePayloads';
import { SUMMARIES_TABLE } from '../core/schema';
import { adoptSummaries, fakeRegistry, startSummaries } from './summariesHarness';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ARCHIVE_SETTINGS } from '@shared/settings';
import { DEFAULT_SUMMARY_SETTINGS } from '../shared/settings';
import { VOICE_MESSAGE_FLAG } from '@shared/discord';
import { MS_PER_DAY } from '@shared/units';
import { Summarizer } from '../core/summarize';
import type { Db } from '@core/db';
import { applyTextRetention } from '@core/textRetention';
import { storeDerivedText } from '@core/derivedText';
import { rawMessage, seedArchive, tempDb } from '@chattypop/host-testing';
import { ARRIVAL } from '@core/arrival';
import { aiSettingsFrom } from '@shared/aiProviders';

/** A fresh profile's AI settings: Claude is the default. */
const FRESH_AI = aiSettingsFrom({});

const CH = '200000000000000001';

let db: Db;
let voiceId: string;
beforeEach(() => {
  db = adoptSummaries(tempDb());
  startSummaries(db);
  const a = seedArchive(db, [{ id: CH }]);
  const t0 = Date.now() - MS_PER_DAY;
  const voice = rawMessage(CH, t0 + 1000, '', {
    flags: VOICE_MESSAGE_FLAG,
    attachments: [{ id: 'a1', filename: 'voice-message.ogg', content_type: 'audio/ogg', url: 'https://cdn.example/a1' }],
  });
  voiceId = voice.id;
  a.ingestMessages([rawMessage(CH, t0, 'who is bringing snacks?'), voice], ARRIVAL.gateway);
});

/** The transcription plugin settled a transcript: the host keeps it as the message's derived text. */
const transcribe = (text: string): void => storeDerivedText(db, voiceId, 'transcription:a1', 1, text);

describe('summaries', () => {
  it('read a voice message once transcribed, and a transcript arriving later means a new summary', async () => {
    const { calls, registry } = fakeRegistry(() => db, () => ({ headline: 'h', items: [{ parts: [{ text: 'point', refs: ['m1'] }] }] }));
    const s = new Summarizer(db, (ids) => archivePayloads(db, ids), registry, () => undefined);
    const since = Date.now() - 2 * MS_PER_DAY; // one fixed range, so only the log can differ between runs
    const run = () => s.run({ sinceTs: since }, FRESH_AI, DEFAULT_SUMMARY_SETTINGS, 'manual');
    await run();
    await run();
    expect(calls).toHaveLength(1); // the same log comes from cache
    expect(calls[0]!.prompt).not.toContain('I will bring chips');
    transcribe('I will bring chips');
    await run();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.prompt).toContain('I will bring chips');
  });
});

describe('text retention', () => {
  it('summary-only keeps transcripts when it removes the message text', async () => {
    transcribe('I will bring chips');
    const now = Date.now() + 200 * MS_PER_DAY;
    db.prepare(
      `INSERT INTO ${SUMMARIES_TABLE} (cache_key, created_at, provider, since_ts, until_ts, channel_ids, message_count, duration_ms, headline, items_json)
       VALUES ('k', ?, 'claude', 0, ?, ?, 1, 1, 'h', '[]')`,
    ).run(now, now, JSON.stringify([CH]));
    const r = await applyTextRetention(db, { ...DEFAULT_ARCHIVE_SETTINGS, textTier: 'summary-only', textTierAfterDays: 90 }, now);
    expect(r.pruned).toBeGreaterThan(0);
    expect(db.prepare('SELECT text FROM derived_texts WHERE message_id = ?').pluck().get(voiceId)).toBe('I will bring chips');
  });
});
