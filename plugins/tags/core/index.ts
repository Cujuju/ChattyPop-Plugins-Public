// Tags' core side: storage, Jev, rules and contributions to host reads.
import { TAGS, MESSAGE_TAGS } from './tables';
import { defineCorePlugin, type TextMessage } from '@plugin-sdk/core';
import { plugin } from '../shared';
import { tagSubject, TAG_SOURCE_TITLE } from '../shared/types';
import { SHOWN_TAG_SQL } from './store';
import { TagService } from './service';
import { registerTagKinds } from './rules';
import { personTagsRead } from './person';
import { liveChipsRead, manualMessageRead, messageChipsRead, rangeCountRead, taggedRead, tagsRead } from './reads';

export default defineCorePlugin(
  plugin,
  (ctx) => {
    const db = ctx.storage.db;
    ctx.storage.migrate([`CREATE INDEX IF NOT EXISTS ${MESSAGE_TAGS}_message_state ON ${MESSAGE_TAGS}(message_id, state, tag_id)`]);
    const read = ctx.storage.read;
    ctx.ai.tools.provide(archiveTools(ctx.storage.read));
    const trigger = ctx.rules.trigger('tags.applied');
    const tags = new TagService(
      db,
      (messageIds) => {
        ctx.channels.emit('changed', { messageIds });
        ctx.archive.messageLabels.changed(messageIds);
      },
      () => {
        const jev = ctx.jev.decider('customTags');
        if (!jev) throw new Error('Turn on Settings → Jev → Your own tags, with Jev on an OpenRouter key.');
        return jev;
      },
      ctx.jev.catchUp,
      trigger.fire,
      (q) => ctx.jev.questions.register(q, 'owner'),
      ctx.jev.judgments,
      ctx.ai.sources,
    );
    registerTagKinds(
      ctx.rules,
      (id) => new Set(tags.forMessage(id).map((c) => c.tagId)),
      (id, tag) => tags.applyByRule(id, tag),
    );
    ctx.archive.messageLabels.provide((ids) => {
      const entries = [...tags.chips(ids)].map(([id, chips]) => {
        const labels = chips.map((chip) => ({
          subject: tagSubject(chip.tagId),
          text: chip.name,
          title: TAG_SOURCE_TITLE[chip.source],
          key: String(chip.tagId),
          variant: chip.source,
        }));
        return [id, labels] as const;
      });
      return new Map(entries);
    });
    ctx.search.token(
      'tag',
      (value) => ({
        sql: `EXISTS (SELECT 1 FROM ${MESSAGE_TAGS} mt JOIN ${TAGS} tg ON tg.id = mt.tag_id WHERE mt.message_id = m.id AND mt.${SHOWN_TAG_SQL} AND tg.name = ?)`,
        params: [value],
      }),
    );
    ctx.channels.serve({
      tags: () => tagsRead(read),
      createTag: (input) => tags.create(input),
      updateTag: (id, input) => tags.update(id, input),
      deleteTag: (id) => tags.remove(id),
      setMessageTag: async (id, tag, on) => {
        const message = on ? await manualMessageRead(read, id) : undefined;
        tags.applyManual(id, tag, on, message);
      },
      messageTags: async (id) => (await messageChipsRead(read, [id]))[id] ?? [],
      taggedMessages: (id, limit) => taggedRead(read, id, limit),
      tagRangeCount: (req) => rangeCountRead(read, req),
      tagRange: (req) => tags.range(req, read),
      liveTagChips: (id) => liveChipsRead(read, id),
      personTags: ctx.people.section((id) => personTagsRead(read, id)),
    });
    return () => tags.dispose();
  },
);
import { archiveTools } from './aiTools';
