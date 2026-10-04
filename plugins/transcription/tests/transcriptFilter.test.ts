// "A transcript" in the host's rule engine: a rule narrowed by it fires when its message's transcript arrives after
// the message, because the job's record lands in the derived text's transaction, before the rule check.
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defineCorePlugin, type CoreContext } from '@plugin-sdk/core';
import type { RuleAction, RuleInput } from '@shared/rules';
import { DEFAULT_AI_SETTINGS } from '@shared/settings';
import { ProviderRegistry } from '@core/ai/registry';
import { ARRIVAL } from '@core/arrival';
import { setSetting } from '@core/db';
import { storeDerivedText } from '@core/derivedText';
import { PluginHost } from '@core/plugins/host';
import { addedTextArrival, textMessage } from '@core/queries/messageText';
import { hostRuleStack, newRuleAction, nextTs, rawMessage, ruleInput, runsOf, seedArchive, settleAsync, tempDb, tempDir } from '@chattypop/host-testing';
import { plugin } from '../shared';
import { transcribed } from '../shared/rules';
import transcriptionCore from '../core';
import { JOBS_TABLE } from '../core/schema';
import { PRIORITY, enqueue, finish, transcriptKey } from '../core/store';

const PART = 'attachment:a1';
const MODEL = 'ggml-base.bin';

const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

/** The rule stack and the archive as core wires them, with Transcription's real activation; its context kept. */
function start() {
  const db = tempDb();
  const stack = hostRuleStack(db, () => undefined, () => null);
  const archive = seedArchive(db, [{ id: 'c1' }], { onText: (m, arrived) => stack.matcher.check(m, arrived) });
  let ctx!: CoreContext<typeof plugin>;
  const host = new PluginHost(
    tempDir(),
    {
      db,
      emit: () => undefined,
      changed: () => undefined,
      ai: async () => ({ text: '' }),
      decider: () => null,
      bundled: {
        rules: stack.engine.kinds,
        ready: () => db,
        archive: () => archive,
        mediaDir: tempDir(),
        attachmentsDir: tempDir(),
        pluginData: { root: tempDir(), unmoved: {} },
        // As core's storeText (src/core/index.ts): the text with the plugin's record in one transaction, then the rule check.
        storeText: (pluginId, messageId, t, record) => {
          storeDerivedText(db, messageId, `${pluginId}:${t.key}`, t.order, t.text, record, t.part ?? null);
          const m = textMessage(db, messageId);
          if (m) stack.matcher.check(m, addedTextArrival(db, messageId, t.queuedAt), t.askJev ?? true);
        },
        storeLinkText: () => undefined,
        storeLinkImages: () => undefined,
        catchUp: () => undefined,
        saveSetting: (key, value) => setSetting(db, key, value),
        aiSettings: () => DEFAULT_AI_SETTINGS,
        providers: new ProviderRegistry(() => undefined),
        decider: () => null,
        now: Date.now,
      },
    },
    [
      defineCorePlugin(plugin, (c) => {
        ctx = c;
        return transcriptionCore.activate(c);
      }),
    ],
  );
  host.startBundled();
  stops.push(() => host.setEnabled(plugin.manifest.id, false));

  /** A rule narrowed by "A transcript" that writes each hit to a file. */
  const rule = (): number => {
    const action = { ...newRuleAction('file'), config: { path: join(tempDir(), 'hits.jsonl'), format: 'jsonl' } } as RuleAction;
    const input = ruleInput([action]);
    return stack.rules.create({ ...input, spec: { ...input.spec, narrow: [{ type: transcribed.type, config: null }] } } as RuleInput);
  };
  const say = (): string => {
    const m = rawMessage('c1', nextTs(), 'listen to this');
    archive.ingestMessages([m], ARRIVAL.gateway);
    return m.id;
  };
  /** A part's transcript settles as the transcriber settles it: its job finished by the record. */
  const transcript = (messageId: string, text: string): void => {
    const pdb = ctx.storage.db;
    enqueue(pdb, { messageId, partKey: PART, kind: 'audio', attachmentId: null, url: 'https://cdn.discordapp.com/a1/voice.ogg' }, PRIORITY.automatic, Date.now());
    const seq = pdb.prepare(`SELECT seq FROM ${JOBS_TABLE} WHERE message_id = ? AND part_key = ?`).pluck().get(messageId, PART) as number;
    const record = (): void => finish(pdb, seq, { text, language: 'ja', segments: [] }, MODEL, Date.now());
    ctx.archive.derivedText.settle(messageId, { key: transcriptKey({ seq, attachmentId: null }), order: seq, text, queuedAt: Date.now(), part: PART }, record);
  };
  return { rule, say, transcript, runs: (id: number) => runsOf(stack, id) };
}

describe('the "A transcript" rule filter', () => {
  it('fires its rule when the transcript arrives after the message, not before', async () => {
    const h = start();
    const id = h.rule();
    const m = h.say();
    await settleAsync();
    expect(h.runs(id)).toEqual([]);
    h.transcript(m, 'もしもし');
    await settleAsync();
    expect(h.runs(id)).toEqual([[m, true, ['done']]]);
  });

  it('leaves out a transcript that found no speech', async () => {
    const h = start();
    const id = h.rule();
    const m = h.say();
    h.transcript(m, '');
    await settleAsync();
    expect(h.runs(id)).toEqual([]);
  });
});
