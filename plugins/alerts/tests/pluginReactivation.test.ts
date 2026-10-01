// Alerts across off/on: history reconciliation after edits made while it or a rule filter was unavailable.
import { expect, it, onTestFinished } from 'vitest';
import { pluginTable } from '@plugin-sdk/shared';
import { newRuleAction } from '@shared/ruleSpec';
import { MS_PER_DAY } from '@shared/units';
import { ARRIVAL } from '@core/arrival';
import { from, rawMessage } from '@chattypop/host-testing';
import { includeProbe } from '@chattypop/host-testing/pluginRuleProbe';
import { ALERTS } from '../core/tables';
import { plugin as alerts } from '../shared';
import { startAlerts } from './alertsHarness';
import { ruleHarness, ruleInput } from './ruleHarness';

it('reconciles direct and meaning history after edits while Alerts is off', () => {
  const h = ruleHarness();
  h.say('old');
  h.say('new');
  const input = ruleInput([newRuleAction('alerts.notify')], { match: { text: { pattern: 'old', spec: null } } });
  const id = h.rules.create(input);
  expect(h.rules.alerts({ limit: 10 }).map((a) => a.snippet)).toEqual(['old']);
  h.alerts.dispose();
  const edited = { ...input, spec: { ...input.spec, match: [{ type: 'text', config: { pattern: 'new', spec: null } }] } };
  h.rules.update(id, edited);
  h.db.prepare(`UPDATE ${ALERTS} SET match_kind = 'meaning' WHERE rule_id = ?`).run(id);
  // Changing scope changes the question signature even when the direct pattern itself does not.
  h.rules.update(id, { ...edited, spec: { ...edited.spec, gates: { ...edited.spec.gates, channelIds: ['c1'] } } });
  const resumed = startAlerts(h.db, { kinds: h.engine.kinds });
  expect(resumed.calls.alerts({ limit: 10 }).map((a) => a.snippet)).toEqual(['new']);
  expect(h.db.prepare(`SELECT COUNT(*) FROM ${ALERTS} WHERE match_kind = 'meaning'`).pluck().get()).toBe(0);
});

/** How long the rule stays off: longer than the matcher's one-day catch-up lookback. */
const OFF_FOR_MS = 3 * MS_PER_DAY;

it('backfills matches from while a rule was off, as read, when it is turned back on unchanged', () => {
  const h = ruleHarness();
  const input = ruleInput([newRuleAction('alerts.notify')], { match: { text: { pattern: 'deploy', spec: null } } });
  const id = h.rules.create(input);
  h.rules.update(id, { ...input, enabled: false });
  // Archived while the rule was off, and older than the matcher's one-day catch-up: only the history sync finds it.
  h.archive.ingestMessages([rawMessage('c1', Date.now() - OFF_FOR_MS, 'deploy while off', from('u2'))], ARRIVAL.sync);
  expect(h.rules.alerts({ limit: 10 })).toEqual([]);
  h.rules.update(id, { ...input, enabled: true });
  const alerts = h.rules.alerts({ limit: 10 });
  expect(alerts.map((a) => a.snippet)).toEqual(['deploy while off']);
  expect(alerts[0]?.readAt).not.toBeNull();
});

it('keeps meaning alerts on the first reconcile after an upgrade, then guards later question changes', () => {
  const h = ruleHarness();
  h.say('old');
  const input = ruleInput([newRuleAction('alerts.notify')], { match: { text: { pattern: 'old', spec: null } } });
  const id = h.rules.create(input);
  h.alerts.dispose();
  h.db.prepare(`UPDATE ${ALERTS} SET match_kind = 'meaning' WHERE rule_id = ?`).run(id);
  // An archive from before signatures were stored has no baseline for any rule.
  h.db.prepare(`DELETE FROM ${pluginTable(alerts, 'rule_questions')}`).run();
  const meaning = () => h.db.prepare(`SELECT COUNT(*) FROM ${ALERTS} WHERE match_kind = 'meaning'`).pluck().get();
  startAlerts(h.db, { kinds: h.engine.kinds });
  expect(meaning()).toBe(1);
  h.rules.update(id, { ...input, spec: { ...input.spec, gates: { ...input.spec.gates, channelIds: ['c1'] } } });
  expect(meaning()).toBe(0);
});

/** The rule-kind probe's filter: a stand-in for another plugin's filter (Tags' tags.any in the app). */
const PROBE_FILTER = 'ruleprobe.filter';

it('retries history reconciliation when an edited rule filter becomes available again', () => {
  onTestFinished(includeProbe());
  const h = ruleHarness();
  const old = h.say('old');
  const fresh = h.say('new');
  const passed = new Set([old.id, fresh.id]);
  const registerFilter = () => h.engine.kinds.filter<number>(PROBE_FILTER, { test: (_config, { facts }) => passed.has(facts.m.id) });
  const unregister = registerFilter();
  const base = ruleInput([newRuleAction('alerts.notify')], { match: { text: { pattern: 'old', spec: null } } });
  const probeNarrow = { type: PROBE_FILTER, config: 1 };
  const input = { ...base, spec: { ...base.spec, narrow: [probeNarrow] } };
  const id = h.rules.create(input);
  expect(h.rules.alerts({ limit: 10 }).map((a) => a.snippet)).toEqual(['old']);
  unregister();
  h.engine.kinds.changed();
  h.rules.update(id, { ...input, spec: { ...input.spec, match: [{ type: 'text', config: { pattern: 'new', spec: null } }] } });
  registerFilter();
  h.engine.kinds.changed();
  expect(h.rules.alerts({ limit: 10 }).map((a) => a.snippet)).toEqual(['new']);
});
