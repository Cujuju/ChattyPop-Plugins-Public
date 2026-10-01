// The Alerts panel's rule picker.
import { For, Show, createSignal } from 'solid-js';
import { alertRuleIds, setAlertRuleIds, ruleUnread } from './state';
import { rules, listen, onPointerDownOutside, HeaderButton, look } from '@plugin-sdk/renderer/kit';
import styles from './Alerts.module.css';

/** Names shown on the button before it summarizes as "N rules". */
const MAX_NAMED_RULES = 2;

/** A checklist option's text. */
const OPTION = { 'data-size': 'sm', 'data-tone': 'primary' } as const;

const toggled = (ids: number[], id: number, on: boolean): number[] => (on ? [...ids, id] : ids.filter((x) => x !== id));

/** The Alerts header's rule picker: every alert, or any set of rules (a checklist in a popover). */
export function RuleFilter() {
  let root!: HTMLDivElement;
  const [open, setOpen] = createSignal(false);
  const byName = () => [...rules()].sort((a, b) => a.name.localeCompare(b.name));
  const label = (): string => {
    const names = byName()
      .filter((r) => alertRuleIds().includes(r.id))
      .map((r) => r.name);
    if (!names.length) return 'All alerts';
    return names.length <= MAX_NAMED_RULES ? names.join(', ') : `${names.length} rules`;
  };

  onPointerDownOutside(() => root, open, () => setOpen(false));
  listen(window, 'keydown', (e) => {
    if (open() && e.key === 'Escape') setOpen(false);
  });

  return (
    <div class={styles.ruleFilter} ref={root}>
      <HeaderButton aria-haspopup="true" aria-expanded={open()} title="Choose which rules' alerts to show" onClick={() => setOpen(!open())}>
        {label()}
        <span class="cp-chevron" aria-hidden="true" />
      </HeaderButton>
      <Show when={open()}>
        <div class={`cp-popover ${styles.ruleMenu}`} role="group" aria-label="Alerts to show">
          <label class={`${styles.ruleOption} ${look.option} ${look.text}`} {...OPTION}>
            <input type="checkbox" checked={alertRuleIds().length === 0} onChange={() => setAlertRuleIds([])} />
            All alerts
          </label>
          <For each={byName()}>
            {(r) => (
              <label class={`${styles.ruleOption} ${look.option} ${look.text}`} {...OPTION}>
                <input type="checkbox" checked={alertRuleIds().includes(r.id)} onChange={(e) => setAlertRuleIds(toggled(alertRuleIds(), r.id, e.currentTarget.checked))} />
                <span class={styles.ruleName}>{r.name}</span>
                <Show when={ruleUnread(r.id)}>
                  <span class={`${styles.ruleCount} ${look.text}`} data-size="xs" data-tone="section">{ruleUnread(r.id)} new</span>
                </Show>
              </label>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
