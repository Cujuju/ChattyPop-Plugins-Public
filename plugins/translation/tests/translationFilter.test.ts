// "A translation" in the host's rule engine: a rule narrowed by it fires when its message's translation arrives
// after the message (settled without asking Jev), because the job's record lands in the derived text's transaction,
// before the rule check. A text already in the owner's language is no translation.
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
import { translated } from '../shared/rules';
import translationCore from '../core';
import { messageSources } from '../core/sources';
import { JOBS_TABLE, PRIORITY, enqueue, finish } from '../core/store';

const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

/** The rule stack and the archive as core wires them, with Translation's real activation; its context kept. */
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
        return translationCore.activate(c);
      }),
    ],
  );
  host.startBundled();
  stops.push(() => host.setEnabled(plugin.manifest.id, false));

  /** A rule narrowed by "A translation" that writes each hit to a file. */
  const rule = (): number => {
    const action = { ...newRuleAction('file'), config: { path: join(tempDir(), 'hits.jsonl'), format: 'jsonl' } } as RuleAction;
    const input = ruleInput([action]);
    return stack.rules.create({ ...input, spec: { ...input.spec, narrow: [{ type: translated.type, config: null }] } } as RuleInput);
  };
  /** A message whose link preview has its own text: the part Translation translates. */
  const say = (): string => {
    const m = rawMessage('c1', nextTs(), 'look', { embeds: [{ type: 'rich', title: 'こんにちは' }] });
    archive.ingestMessages([m], ARRIVAL.gateway);
    return m.id;
  };
  /**
   * The message's part's translation settles as the queue settles it: its source queued as the queue hashes it, the job
   * finished by the record, and derived text only when there is a translation (null: already in the language).
   */
  const translation = (messageId: string, text: string | null): void => {
    const pdb = ctx.storage.db;
    const language = ctx.preferences.get('settings').translateLanguage;
    const [source] = messageSources(plugin.manifest.id, language, ctx.archive.parts.of([messageId]), ctx.archive.derivedText.ofParts([messageId])).get(messageId) ?? [];
    if (!source) throw new Error('The message has no part to translate.');
    enqueue(pdb, messageId, 'c1', [source], PRIORITY.automatic, Date.now());
    const seq = pdb.prepare(`SELECT seq FROM ${JOBS_TABLE} WHERE message_id = ? AND part_key = ?`).pluck().get(messageId, source.key) as number;
    const record = (): void => finish(pdb, seq, text, source.hash, Date.now());
    if (text === null) ctx.archive.derivedText.settle(messageId, null, record);
    else ctx.archive.derivedText.settle(messageId, { key: String(seq), order: seq, text, queuedAt: Date.now(), part: source.key, askJev: false }, record);
  };
  /** Rules check the message again, as when another plugin's text of it arrives. */
  const recheck = (messageId: string): void => stack.matcher.check(textMessage(db, messageId)!, addedTextArrival(db, messageId, Date.now()), false);
  return { rule, say, translation, recheck, runs: (id: number) => runsOf(stack, id) };
}

describe('the "A translation" rule filter', () => {
  it('fires its rule when the translation arrives after the message, not before', async () => {
    const h = start();
    const id = h.rule();
    const m = h.say();
    await settleAsync();
    expect(h.runs(id)).toEqual([]);
    h.translation(m, 'Stock prices');
    await settleAsync();
    expect(h.runs(id)).toEqual([[m, true, ['done']]]);
  });

  it('leaves out a text already in your language', async () => {
    const h = start();
    const id = h.rule();
    const m = h.say();
    h.translation(m, null);
    h.recheck(m);
    await settleAsync();
    expect(h.runs(id)).toEqual([]);
  });
});
