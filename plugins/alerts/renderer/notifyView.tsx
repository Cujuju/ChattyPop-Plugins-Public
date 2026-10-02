// Alert action editor and collapsed-card summary.
import type { KindProps, KindView } from '@plugin-sdk/renderer';
import { Select, Row } from '@plugin-sdk/renderer/kit';
import { ALERT_COOLDOWNS, type NotifyDevice } from '../shared/types';
import { notifyDevices, type DeviceNotify, type NotifyConfig } from '../shared/rules';
import styles from './Alerts.module.css';

/** The notification choice that turns a device's notifications off; the others are cooldowns in ms. */
const NOTIFY_NEVER = 'never';
const NOTIFY_OPTIONS = [
  ...ALERT_COOLDOWNS.map((x) => ({ value: String(x.ms), label: x.label })),
  { value: NOTIFY_NEVER, label: 'Never' },
];
const DEVICE: Record<NotifyDevice, { label: string; hint: string; field: keyof NotifyConfig }> = {
  desktop: {
    label: 'Windows notification',
    hint: 'Every match is still listed in Alerts. None for missed messages, or ones privacy mode hides.',
    field: 'toast',
  },
  phone: { label: 'Phone notification', hint: 'Each phone also chooses whether it gets alerts, in its Settings.', field: 'phone' },
};
const choice = (n: DeviceNotify): string => (n ? String(n.cooldownMs) : NOTIFY_NEVER);
const notifyOf = (v: string): DeviceNotify => (v === NOTIFY_NEVER ? null : { cooldownMs: Number(v) });

function NotifyEditor(props: KindProps<NotifyConfig>) {
  // Both devices written out: a rule saved before phones had their own keeps the phone's choice when the PC's changes.
  const set = (device: NotifyDevice, v: string) => {
    const now = notifyDevices(props.config);
    props.onChange({ toast: now.desktop, phone: now.phone, [DEVICE[device].field]: notifyOf(v) });
  };
  return (
    <>
      {(['desktop', 'phone'] as const).map((device) => (
        <Row
          label={DEVICE[device].label}
          for={`${props.id}-${device}`}
          hint={DEVICE[device].hint}
          control={
            <Select
              id={`${props.id}-${device}`}
              class={styles.control}
              value={choice(notifyDevices(props.config)[device])}
              options={NOTIFY_OPTIONS}
              onChange={(v) => set(device, v)}
            />
          }
        />
      ))}
    </>
  );
}
const cooldownLabel = (n: DeviceNotify): string => (n ? (ALERT_COOLDOWNS.find((c) => c.ms === n.cooldownMs)?.label.toLowerCase() ?? '') : 'never');
const view = <C,>(v: KindView<C>): KindView => v as KindView;
export const actionViews = {
  'alerts.notify': view({
    Editor: NotifyEditor,
    summary: (c: NotifyConfig) => {
      const d = notifyDevices(c);
      return `Listed in Alerts · Windows: ${cooldownLabel(d.desktop)} · phone: ${cooldownLabel(d.phone)}`;
    },
  }),

};
