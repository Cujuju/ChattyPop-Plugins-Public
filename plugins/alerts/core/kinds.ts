// Alert matching, synchronous recording and notifications held until their event settles.
import { userNames } from '@plugin-sdk/shared';
import { queryMatch, queryRequest, type CoreContext, type ReplyTarget, type TextMessage } from '@plugin-sdk/core';
import { plugin } from '../shared';
import type { AlertNotifier, Fresh } from './notifier';
import { INSERT_ALERT, alertText, hasReply, snippet } from './rows';
import { reconcileAlertHistory } from './reconcile';
import { ALERTS } from './tables';
import { OPEN_QUESTIONS } from './managed';

/** jev_judgments subjects shared by every rule: one "aimed at you" and one "open question" answer per message; urgency. */
const SUBJECT = { aimed: 'aimed', question: 'question', urgency: 'urgency' } as const;
/** Settings → Jev → Queries ids of the built-in alert queries. */
const QUERY = { aimed: 'alerts.aimed', question: 'alerts.openQuestion', urgency: 'alerts.urgency' } as const;

/** Registers alert matches, recording, invalidation and event settlement. Returns a pending-event count reader for lifecycle diagnostics. */
export function registerAlertKinds(ctx: CoreContext<typeof plugin>, notifier: AlertNotifier, now: () => number): () => number {
  const db = ctx.storage.db;
  const k = ctx.rules;
  /** What `m` replies to, from the target Discord embedded in the reply; null when it isn't one. */
  const replyTo = (m: TextMessage): ReplyTarget | null => ctx.archive.replyTargets([m.id]).get(m.id) ?? null;
  /** A Discord reply to the owner or an @mention of them is aimed at them by definition; no Jev needed. */
  const aimedDirectly = (m: TextMessage, selfId: string): boolean =>
    m.content.includes(`<@${selfId}>`) || m.content.includes(`<@!${selfId}>`) || replyTo(m)?.authorId === selfId;
  const readContents = (id: string) => ctx.archive.payloads([id]).get(id)?.kinds ?? new Set();
  const reconcile = reconcileAlertHistory(ctx, () => notifier.changed());
  k.onReloaded(reconcile);
  const pending = new Map<number, Fresh[]>();
  k.match('alerts.aimed', {
    direct: (_, { m, self }) =>
      self && m.authorId !== self.id && aimedDirectly(m, self.id)
        ? { kind: 'pattern', probability: null, highlight: null }
        : null,
    question: (_, { m, self }) =>
      self && m.authorId !== self.id
        ? {
            subject: SUBJECT.aimed,
            features: ['aimedAtMe'],
            question: queryRequest(QUERY.aimed, { vars: { me: { names: userNames(self), mention: `<@${self.id}>` } } }),
            match: (a) => queryMatch(QUERY.aimed, a),
          }
        : null,
  });
  k.match('alerts.openQuestion', {
    question: (_, { m, self }) =>
      m.authorId !== self?.id
        ? {
            subject: SUBJECT.question,
            features: ['unansweredQuestions'],
            question: queryRequest(QUERY.question),
            match: (a) => queryMatch(QUERY.question, a),
          }
        : null,
  });
  // History and questions already answered by a reply (#54) land read; duplicates keep their existing alert.
  k.action('alerts.notify', (c, r) => {
    if (r.event.kind !== 'message') throw new Error('Alerts need a message.');
    const { m, hit, liveAt } = r.event;
    const at = now();
    const read = m.ts < r.rule.armedAt || (r.rule.managed === k.managed.key(OPEN_QUESTIONS) && hasReply(ctx.archive.replyExists, m));
    const text = alertText(m, () => readContents(m.id));
    const info = db
      .prepare(INSERT_ALERT)
      .run(
        r.rule.id,
        m.id,
        m.channelId,
        m.authorId,
        m.ts,
        snippet(text, hit.highlight),
        at,
        read ? at : null,
        hit.kind,
        hit.probability,
      );
    notifier.changed();
    if (info.changes && !r.history) {
      const fresh = pending.get(r.event.eventId) ?? [];
      fresh.push({
        ruleId: r.rule.id,
        actionId: r.actionId,
        alertId: Number(info.lastInsertRowid),
        liveAt,
        cooldownMs: c.toast?.cooldownMs ?? null,
      });
      pending.set(r.event.eventId, fresh);
    }
    return { outcome: 'done', detail: info.changes ? null : 'Already in Alerts.' };
  });
  ctx.jev.questions.register({
    subject: SUBJECT.urgency,
    feature: 'urgentToasts',
    question: (_, c) => (c.live && c.mayAct('alerts.notify') ? queryRequest(QUERY.urgency) : null),
  });
  /** #54: a Discord reply from someone else answers an open question, so its alert is marked read. */
  k.onMessage((m) => {
    const target = replyTo(m);
    const ruleId = k.managed.ruleId(OPEN_QUESTIONS);
    if (!target || target.authorId === m.authorId || ruleId === null) return;
    const info = db
      .prepare(`UPDATE ${ALERTS} SET read_at = ? WHERE read_at IS NULL AND message_id = ? AND rule_id = ?`)
      .run(now(), target.id, ruleId);
    if (info.changes) notifier.changed();
  });
  k.onSettled(({ eventId, answers }) => {
    const fresh = pending.get(eventId) ?? [];
    pending.delete(eventId);
    const answer = answers?.[SUBJECT.urgency];
    notifier.notifyAll(fresh, answer ? queryMatch(QUERY.urgency, answer) !== null : null);
  });
  return () => pending.size;
}
