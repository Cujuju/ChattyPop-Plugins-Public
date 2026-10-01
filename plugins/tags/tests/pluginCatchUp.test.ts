// Catch-up after Tags turns back on: messages that arrived while it was off are judged once its questions are back.
import { expect, it, onTestFinished } from 'vitest';
import { ProviderRegistry } from '@core/ai/registry';
import { ARRIVAL } from '@core/arrival';
import { setSetting } from '@core/db';
import { adoptBundledData } from '@core/plugins/adoption';
import { PluginHost } from '@core/plugins/host';
import { FakeJev, hostRuleStack, nextTs, rawMessage, seedArchive, settleAsync, tempDb, tempDir } from '@chattypop/host-testing';
import tagsCore from '../core';
import { plugin as tags } from '../shared';
import { tagSubject, type TagInput } from '../shared/types';

const AUTO_TAG: TagInput = {
  name: 'Stocks',
  auto: true,
  jevQuestion: { type: 'noul', question: 'Does `message` mention a stock?', yes: '', no: '', minProbability: 0.5 },
};

/** The real host with Tags, wired to the rule matcher as core init wires it. */
function tagsHost() {
  const db = tempDb();
  adoptBundledData(db, [tags]);
  const jev = new FakeJev();
  jev.on['tags.customTags'] = true;
  const stack = hostRuleStack(db, () => undefined, jev.forFeature);
  let catchUps = 0;
  const archive = seedArchive(db, [{ id: 'c1' }], { onText: (m, a) => stack.matcher.check(m, a) });
  const host = new PluginHost(tempDir(), {
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
      storeText: () => undefined,
      storeLinkText: () => undefined, storeLinkImages: () => undefined,
      saveSetting: (key, value) => setSetting(db, key, value),
      aiSettings: () => {
        throw new Error('No AI settings in this test.');
      },
      providers: new ProviderRegistry(() => undefined),
      decider: jev.forFeature,
      catchUp: () => {
        catchUps++;
        stack.matcher.requestCatchUp();
      },
      now: Date.now,
    },
  }, [tagsCore], [tags]);
  host.startBundled();
  onTestFinished(() => host.setEnabled('tags', false)); // its registrations are process-wide
  return { db, jev, host, archive, catchUps: () => catchUps };
}

it('judges messages that arrived while Tags was off once it is turned back on', async () => {
  const h = tagsHost();
  const id = (await h.host.call('renderer', 'tags', 'createTag', [AUTO_TAG])) as number;
  h.jev.values[tagSubject(id)] = 0.99;
  await h.host.setEnabled('tags', false);
  const m = rawMessage('c1', nextTs(), 'NVDA to the moon');
  h.archive.ingestMessages([m], ARRIVAL.gateway);
  await settleAsync();
  expect(h.jev.requests).toEqual([]);
  const before = h.catchUps();
  await h.host.setEnabled('tags', true);
  await settleAsync();
  expect(h.catchUps() - before).toBe(1);
  const chips = (await h.host.call('renderer', 'tags', 'messageTags', [m.id])) as { tagId: number }[];
  expect(chips.map((c) => c.tagId)).toEqual([id]);
});
