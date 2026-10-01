// #78 tag handlers: storage, Jev registration, catch-up and the change event, kept together so every path does all four.
import type { AppliedConfig } from '../shared/rules';
import type { RangeJudgments, TriggerEvent } from '@plugin-sdk/core';
import {
  tagSubject,
  type MessageTagChip,
  type Tag,
  type TagInput,
  type TaggedMessage,
  type TagRangeRequest,
  type TagRangeResult,
} from '../shared/types';
import type { AiSources, PluginDecider } from '@plugin-sdk/core';
import type { PluginDb } from '@plugin-sdk/core';
import { syncTagQuestions, tagRange, tagRangeCount, type TagApplied, type TagEvents, type TagQuestion, type TagQuestions } from './questions';
import type { TextMessage } from '@plugin-sdk/core';
import { TagStore, type RuleTagResult } from './store';

/** Tagged messages the live client decorates per channel: the newest ones are the ones on screen. */
const LIVE_CHIPS_MAX = 500;

/** Coordinates tag storage, dynamic questions, trigger events and view refreshes. */
export class TagService {
  private readonly store: TagStore;
  private active = true;
  private readonly questions: TagQuestions = new Map();
  /** Each tag's revision: bumped when it is created, deleted or its question changes, from one never-reused counter. */
  private readonly revisions = new Map<number, number>();
  private lastRevision = 0;
  private disposeQuestions: () => void = () => undefined;

  constructor(
    private readonly db: PluginDb,
    private readonly emit: (messageIds: string[] | null) => void,
    /** Jev for range runs; throws naming the switch to turn on. */
    private readonly requireJev: () => PluginDecider,
    /** Asks what the lookback window lacks: a new or edited auto tag tags the last day too. */
    private readonly catchUp: () => void,
    /** A tag newly applied by Jev or the owner (#88 rules' tagApplied trigger). */
    private readonly fire: (e: Omit<TriggerEvent, 'accepts'> & { accepts(config: AppliedConfig): boolean }) => void,
    private readonly register: (q: TagQuestion) => () => void,
    private readonly judge: RangeJudgments,
    /** Which channels Jev may read, for range runs. */
    private readonly sources: Pick<AiSources, 'permitted'>,
  ) {
    this.store = new TagStore(db);
    this.sync();
  }

  private applied(e: TagApplied): void {
    this.fire({
      m: e.m,
      liveAt: e.liveAt,
      key: `tag:${e.m.id}:${e.tagId}`,
      accepts: (config) => {
        const c = config as AppliedConfig;
        return c.tagIds.includes(e.tagId) && c.sources.includes(e.source);
      },
    });
  }

  private readonly changed = (messageIds: string[] | null): void => this.emit(messageIds);
  private readonly events: TagEvents = {
    tagged: (ids) => this.changed(ids),
    applied: (e) => this.applied(e),
  };

  private sync(): void {
    this.disposeQuestions = syncTagQuestions(this.store, this.events, this.register, this.questions);
  }

  /** Drops this service's dynamically registered questions. */
  dispose(): void {
    this.active = false;
    this.disposeQuestions();
  }

  list(): Tag[] {
    return this.store.list();
  }

  /** A tag's current revision (0: unchanged since this service started). */
  private readonly revision = (tagId: number): number => this.revisions.get(tagId) ?? 0;

  private revise(tagId: number): void {
    this.revisions.set(tagId, ++this.lastRevision);
  }

  create(input: TagInput): number {
    const id = this.store.create(input);
    this.revise(id); // SQLite may reuse a deleted tag's id
    this.sync();
    if (input.auto) this.catchUp();
    this.changed(null);
    return id;
  }

  update(id: number, input: TagInput): void {
    const { questionChanged } = this.store.update(id, input);
    if (questionChanged) {
      this.revise(id);
      this.judge.forget(tagSubject(id));
    }
    this.sync();
    if (input.auto) this.catchUp();
    this.changed(null);
  }

  remove(id: number): void {
    this.store.remove(id);
    this.revise(id);
    this.judge.forget(tagSubject(id));
    this.sync();
    this.changed(null);
  }

  /** The owner's add is live: they are acting on the message now. */
  setManual(messageId: string, tagId: number, on: boolean): void {
    this.store.setManual(messageId, tagId, on);
    this.changed([messageId]);
    const m = on ? this.db.prepare('SELECT id, channel_id AS channelId, author_id AS authorId, ts, text AS content, linked FROM archive_all_messages WHERE id = ?').get(messageId) as TextMessage | undefined : undefined;
    if (m) this.applied({
      m,
      tagId,
      source: 'manual',
      liveAt: Date.now(),
    });
  }

  /** A rule's tag action; a rule-applied tag starts no rules (tagApplied triggers ignore it). */
  applyByRule(messageId: string, tagId: number): RuleTagResult {
    const r = this.store.applyRule(messageId, tagId);
    if (r === 'applied') this.changed([messageId]);
    return r;
  }

  forMessage(messageId: string): MessageTagChip[] {
    return this.store.chips([messageId]).get(messageId) ?? [];
  }

  chips(messageIds: string[]): Map<string, MessageTagChip[]> {
    return this.store.chips(messageIds);
  }

  taggedMessages(tagId: number, limit: number): TaggedMessage[] {
    return this.store.tagged(tagId, limit);
  }

  rangeCount(req: TagRangeRequest): number {
    return tagRangeCount(this.db, req);
  }

  range(req: TagRangeRequest): Promise<TagRangeResult> {
    return tagRange(this.db, this.store, this.judge, this.requireJev(), this.sources, req, this.events, () => this.active, this.revision);
  }

  liveChips(channelId: string): Record<string, MessageTagChip[]> {
    return this.store.channelChips(channelId, LIVE_CHIPS_MAX);
  }
}
