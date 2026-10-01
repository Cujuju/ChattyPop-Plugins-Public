// Tags adoption and plugin-off parity across the host read paths.
import { expect, it } from 'vitest';
import { insertRule } from '@core/rules/ruleStore';
import { newRuleInput, newRuleAction } from '@shared/ruleSpec';
import { ARRIVAL } from '@core/arrival';
import { messagePage } from '@core/queries/messages';
import { personProfile } from '@core/queries/person';
import { parseSearch } from '@core/queries/search';
import { messageQuestions } from '@core/jev/messageQuestions';
import { RuleKinds } from '@core/rules/kinds';
import { SHOWN_TAG_SQL } from '../core/store';
import { adoptTags, startTags } from './tagsHarness';
import { rawMessage, seedArchive, tempDb } from '@chattypop/host-testing';

it(
  'adopts legacy ids and memberships without rewriting stored rule configs; adoption is idempotent',
  () => {
    const db = tempDb();
    const archive = seedArchive(db, [{ id: 'c1' }]);
    const raw = rawMessage('c1', Date.now(), 'hello');
    archive.ingestMessages([raw], ARRIVAL.gateway);
    const legacyId = 41;
    db.prepare('INSERT INTO tags (id, name, auto, created_at) VALUES (?, ?, 0, 0)').run(legacyId, 'Kept');
    db.prepare("INSERT INTO message_tags (message_id, tag_id, state, updated_at) VALUES (?, ?, 'manual', 0)").run(raw.id, legacyId);
    const input = newRuleInput();
    const ruleId = insertRule(
      db,
      {
        ...input,
        name: 'Preserved id',
        spec: {
          ...input.spec,
          actions: [{
            ...newRuleAction('tags.apply'),
            config: { tagId: legacyId },
          }],
        },
      },
      0,
    );
    const config = db.prepare('SELECT spec FROM rules WHERE id = ?').pluck().get(ruleId);
    adoptTags(db);
    adoptTags(db);
    const tags = startTags(db);
    expect(tags.list()).toMatchObject([{
      id: legacyId,
      name: 'Kept',
      count: 1,
    }]);
    expect(tags.forMessage(raw.id)).toEqual([{
      tagId: legacyId,
      name: 'Kept',
      source: 'manual',
    }]);
    expect(db.prepare('SELECT spec FROM rules WHERE id = ?').pluck().get(ruleId)).toBe(config);
    tags.remove(legacyId);
    expect(db.prepare(`SELECT * FROM p_tags_message_tags WHERE ${SHOWN_TAG_SQL}`).all()).toEqual([]);
  },
);

it(
  'unregisters every read and rule kind when off, and restores preserved data when activated again',
  () => {
    const db = tempDb();
    const archive = seedArchive(db, [{ id: 'c1' }]);
    const raw = rawMessage('c1', Date.now(), 'hello');
    archive.ingestMessages([raw], ARRIVAL.gateway);
    const kinds = new RuleKinds();
    const tags = startTags(db, { kinds });
    const id = tags.create({
      name: 'Mine',
      auto: true,
      jevQuestion: {
        type: 'noul',
        question: 'Mine?',
        yes: '',
        no: '',
        minProbability: 0.5,
      },
    });
    tags.setManual(raw.id, id, true);
    expect(tags.calls.personTags(raw.author.id)).toEqual([{
      name: 'Mine',
      count: 1,
    }]);
    expect(tags.calls.liveTagChips('c1')[raw.id]).toEqual([{
      tagId: id,
      name: 'Mine',
      source: 'manual',
    }]);
    expect(messagePage(
      db,
      {
        channelId: 'c1',
        limit: 1,
      },
    )[0]!.labels[0]).toMatchObject({
      pluginId: 'tags',
      key: String(id),
      variant: 'manual',
    });
    const ruleTag = tags.create({
      name: 'Rule',
      auto: false,
      jevQuestion: null,
    });
    tags.store.applyRule(raw.id, ruleTag);
    expect(messagePage(
      db,
      {
        channelId: 'c1',
        limit: 1,
      },
    )[0]!.labels.find((label) => label.key === String(ruleTag)))
    .toMatchObject({
      variant: 'rule',
      title: 'Your tag, applied by one of your rules',
    });
    tags.dispose();
    expect(messagePage(
      db,
      {
        channelId: 'c1',
        limit: 1,
      },
    )[0]!.labels).toEqual([]);
    expect(personProfile(db, raw.author.id)).not.toHaveProperty('tags');
    expect(parseSearch('tag:Mine')).toEqual({
      words: 'tag:Mine',
      where: [],
      params: [],
    });
    expect(messageQuestions().some((q) => q.subject === `usertag:${id}`)).toBe(false);
    expect(() => kinds.prepareFilter({
      type: 'tags.any',
      config: { tagIds: [id] },
    })).toThrow(/No implementation/);
    expect(startTags(db, { kinds }).list()[0]!.id).toBe(id);
  },
);
