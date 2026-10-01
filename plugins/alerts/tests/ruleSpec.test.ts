// A new Alert action's configuration.
import { describe, expect, it } from 'vitest';
import { newRuleAction } from '@shared/ruleSpec';
import type { NotifyConfig } from '../shared/rules';
import { DEFAULT_ALERT_COOLDOWN_MS } from '../shared/types';

describe('rule spec', () => {
  it('a new Alert notifies with the default cooldown', () => {
    const notify = newRuleAction('alerts.notify');
    expect(notify.type === 'alerts.notify' && (notify.config as NotifyConfig).toast?.cooldownMs).toBe(DEFAULT_ALERT_COOLDOWN_MS);
  });
});
