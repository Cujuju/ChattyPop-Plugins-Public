// Catch-up after Alerts turns back on: direct matches it missed while off are synced from history.
import { expect, it } from 'vitest';
import { newRuleAction } from '@shared/ruleSpec';
import { Archive } from '@core/archive';
import { ARRIVAL } from '@core/arrival';
import { nextTs, rawMessage } from '@chattypop/host-testing';
import { startAlerts } from './alertsHarness';
import { ruleHarness, ruleInput } from './ruleHarness';

it('syncs the direct matches Alerts missed while off, and skips the rescan after a gapless restart', () => {
  const h = ruleHarness();
  h.rules.create(ruleInput([newRuleAction('alerts.notify')], { match: { text: { pattern: 'deploy', spec: null } } }));
  h.alerts.dispose();
  h.say('deploy while off');
  const back = startAlerts(h.db, { kinds: h.engine.kinds });
  expect(back.calls.alerts({ limit: 10 }).map((a) => a.snippet)).toEqual(['deploy while off']);
  // Stored without the rules seeing it: only a history rescan would find it.
  new Archive(h.db).ingestMessages([rawMessage('c1', nextTs(), 'deploy unseen')], ARRIVAL.gateway);
  back.dispose();
  const resumed = startAlerts(h.db, { kinds: h.engine.kinds, resumed: true });
  expect(resumed.calls.alerts({ limit: 10 }).map((a) => a.snippet)).toEqual(['deploy while off']);
  resumed.dispose();
  const afterGap = startAlerts(h.db, { kinds: h.engine.kinds });
  expect(afterGap.calls.alerts({ limit: 10 }).map((a) => a.snippet).sort()).toEqual(['deploy unseen', 'deploy while off']);
});
