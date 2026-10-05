// Alerts lifecycle: adopting legacy rows and settings, turning off, and rebuilding history after rule edits.
import { describe, expect, it, vi } from 'vitest';
import { newRuleAction } from '@shared/ruleSpec';
import { getSetting, setSetting } from '@core/db';
import { adoptBundledData } from '@core/plugins/adoption';
import { insertRule } from '@core/rules/ruleStore';
import { markRead } from '@core/queries/readMarks';
import { tempDb } from '@chattypop/host-testing';
import { plugin } from '../shared';
import { ALERTS } from '../core/tables';
import { ruleHarness, ruleInput } from './ruleHarness';
import { settleAlerts } from './alertsHarness';
describe('Alerts lifecycle', () => {
  it.each([
    ['aimed_at_me', 'alerts.aimed'],
    ['open_questions', 'alerts.openQuestion'],
  ])('adopts %s with its rule id, armed time, edits and inbox rows intact', (key, match) => {
    const db = tempDb();
    const input = ruleInput([newRuleAction('alerts.notify')], { name: 'Owner edit' });
    input.spec.match = [{ type: match!, config: null }];
    const armedAt = 1234;
    const id = insertRule(db, input, armedAt, key);
    db.prepare(
      `INSERT INTO alerts (rule_id, message_id, channel_id, author_id, ts, snippet, created_at)
       VALUES (?, 'message', 'channel', 'author', 1, 'kept', 1)`,
    ).run(id);
    const rows = db.prepare('SELECT * FROM alerts').all();
    adoptBundledData(db, [plugin]);
    adoptBundledData(db, [plugin]);
    expect(db.prepare('SELECT id, name, armed_at, builtin FROM rules WHERE id = ?').get(id)).toEqual({
      id,
      name: 'Owner edit',
      armed_at: armedAt,
      builtin: `alerts.${key}`,
    });
    expect(db.prepare(`SELECT * FROM ${ALERTS}`).all()).toEqual(rows);
  });

  it('adopts panel sort and rule filters once, preserving existing destination settings', () => {
    const db = tempDb();
    setSetting(db, 'alerts.sort', 'topic');
    setSetting(db, 'alerts.ruleIds', [4, 9]);
    adoptBundledData(db, [plugin]);
    expect(getSetting(db, 'plugin.alerts.sort')).toBe('topic');
    expect(getSetting(db, 'plugin.alerts.ruleIds')).toEqual([4, 9]);
    setSetting(db, 'plugin.alerts.sort', 'time');
    adoptBundledData(db, [plugin]);
    expect(getSetting(db, 'plugin.alerts.sort')).toBe('time');
  });

  it('drops queued notifications and registrations when disabled, retaining existing rows', async () => {
    const h = ruleHarness();
    h.rules.create(ruleInput([newRuleAction('alerts.notify')]));
    h.say('first');
    expect(h.alerts.calls.alerts({ limit: 10 })).toHaveLength(1);
    h.alerts.dispose();
    h.say('second');
    await settleAlerts();
    expect(h.events.filter((event) =>
      event.type === 'plugin-event' && event.pluginId === 'alerts' && event.name === 'notify',
    )).toEqual([]);
    expect(h.engine.kinds.unavailable('actions', 'alerts.notify')).toMatch(/off/);
  });

  it('rebuilds direct history from the edited match and preserves retained read state', () => {
    const h = ruleHarness();
    h.say('news');
    h.say('sale');
    const input = ruleInput([newRuleAction('alerts.notify')], {
      match: { text: { pattern: 'news', spec: null } },
    });
    const id = h.rules.create(input);
    const first = h.alerts.calls.alerts({ limit: 10 });
    expect(first.map((alert) => alert.snippet)).toEqual(['news']);
    h.alerts.calls.markRead([first[0]!.id]);
    h.rules.update(id, { ...input, name: 'Renamed' });
    expect(h.alerts.calls.alerts({ limit: 10 })[0]!.readAt).not.toBeNull();
    h.rules.update(id, {
      ...input,
      spec: { ...input.spec, match: [{ type: 'text', config: { pattern: 'sale', spec: null } }] },
    });
    expect(h.alerts.calls.alerts({ limit: 10 }).map((alert) => alert.snippet)).toEqual(['sale']);
  });

  it("an edited rule's history lands read on a message the owner already read", () => {
    const h = ruleHarness();
    const input = ruleInput([newRuleAction('alerts.notify')], { match: { text: { pattern: 'news', spec: null } } });
    const id = h.rules.create(input);
    // After the rule was armed, so only the owner's reading can land it read.
    const sale = h.say('sale');
    h.say('sale again');
    markRead(h.db, sale.channel_id, sale.id);
    h.rules.update(id, { ...input, spec: { ...input.spec, match: [{ type: 'text', config: { pattern: 'sale', spec: null } }] } });
    const alerts = h.alerts.calls.alerts({ limit: 10 });
    expect(alerts.find((a) => a.snippet === 'sale')?.readAt).not.toBeNull();
    expect(alerts.find((a) => a.snippet === 'sale again')?.readAt).toBeNull();
  });

  it('reconciles unchanged rules once per edit, without reading archive history', () => {
    const h = ruleHarness();
    h.say('news');
    const input = ruleInput([newRuleAction('alerts.notify')], {
      match: { text: { pattern: 'news', spec: null } },
    });
    const id = h.rules.create(input);
    const reads = vi.spyOn(h.engine.kinds, 'history');
    h.rules.update(id, { ...input, name: 'Renamed' });
    expect(reads).toHaveBeenCalledOnce();
    const examined = vi.spyOn(h.engine, 'facts');
    h.engine.reload();
    expect(examined).not.toHaveBeenCalled();
    expect(h.alerts.calls.alerts({ limit: 10 }).map((alert) => alert.snippet)).toEqual(['news']);
  });
});
