// Alert action editor and collapsed-card summary.
import type { KindProps, KindView } from '@plugin-sdk/renderer';
import { Select, Row } from '@plugin-sdk/renderer/kit';
import { ALERT_COOLDOWNS } from '../shared/types';
import type { NotifyConfig } from '../shared/rules';
import styles from './Alerts.module.css';

/** The notification choice that turns desktop notifications off; the others are cooldowns in ms. */
const NOTIFY_NEVER = 'never';
const NOTIFY_OPTIONS = [
  ...ALERT_COOLDOWNS.map((x) => ({ value: String(x.ms), label: x.label })),
  { value: NOTIFY_NEVER, label: 'Never' },
];
function NotifyEditor(props: KindProps<NotifyConfig>) {
  const id = (field: string) => `${props.id}-${field}`;
  const set = (patch: Partial<NotifyConfig>) => props.onChange({ ...props.config, ...patch });
  return (
    <Row
      label="Desktop notification"
      for={id('toast')}
      hint="Every match is still listed in Alerts. None for missed messages, or ones privacy mode hides."
      control={
        <Select
          id={id('toast')}
          class={styles.control}
          value={props.config.toast ? String(props.config.toast!.cooldownMs) : NOTIFY_NEVER}
          options={NOTIFY_OPTIONS}
          onChange={(v) => set({ toast: v === NOTIFY_NEVER ? null : { cooldownMs: Number(v) } })}
        />
      }
    />
  );
}
const cooldownLabel = (ms: number): string => ALERT_COOLDOWNS.find((c) => c.ms === ms)?.label.toLowerCase() ?? '';
const view = <C,>(v: KindView<C>): KindView => v as KindView;
export const actionViews = {
  'alerts.notify': view({
    Editor: NotifyEditor,
    summary: (c) =>
      c.toast
        ? `Listed in Alerts · desktop notification: ${cooldownLabel(c.toast.cooldownMs)}`
        : 'Listed in Alerts · no desktop notification',
  }),

};
