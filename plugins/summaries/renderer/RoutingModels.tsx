// OpenRouter routing controls for summary runs.
import { For, Show } from 'solid-js';
import { providerStatus, SearchSelect, EffortSelect, hasEffortChoice, keptEffort, Card, Row } from '@plugin-sdk/renderer/kit';
import styles from './Summary.module.css';
import { summarySettings, patchSummarySettings } from './settings';

const ROUTING_TIERS = [
  { tier: 'cheap', label: 'Cheap model', hint: 'For simple conversations.', model: 'cheapModel', effort: 'cheapEffort' },
  { tier: 'premium', label: 'Premium model', hint: 'For complex conversations.', model: 'premiumModel', effort: 'premiumEffort' },
] as const;

/** #60: the two OpenRouter models Jev picks between, each with its own thinking level; each must be on an OpenRouter key. */
export function RoutingModels() {
  const models = () => providerStatus().find((p) => p.id === 'openrouter')?.models ?? [];
  const options = () => [{ value: '', label: 'Not set' }, ...models().map((m) => ({ value: m.id, label: m.label }))];
  const routing = () => summarySettings().jevRouting;
  const optionOf = (id: string | null) => models().find((m) => m.id === id);
  return (
    <Card title="Models">
      <For each={ROUTING_TIERS}>
        {(t) => (
          <>
            <Row
              label={t.label}
              for={`jev-${t.tier}`}
              hint={t.hint}
              control={
                <SearchSelect
                  id={`jev-${t.tier}`}
                  label={t.label}
                  searchLabel={`Filter ${t.label.toLowerCase()}s`}
                  class={styles.control}
                  value={routing()[t.model] ?? ''}
                  options={options()}
                  onChange={(v) => {
                    const model = v || null;
                    patchSummarySettings({ jevRouting: { ...routing(), [t.model]: model, [t.effort]: keptEffort(routing()[t.effort], optionOf(model)) } });
                  }}
                />
              }
            />
            <Show when={hasEffortChoice(optionOf(routing()[t.model]), routing()[t.effort])}>
              <Row
                label={`${t.label} thinking`}
                for={`jev-${t.tier}-effort`}
                hint="How much it reasons before answering. Higher is slower and costs more."
                control={
                  <EffortSelect
                    id={`jev-${t.tier}-effort`}
                    model={optionOf(routing()[t.model])}
                    value={routing()[t.effort]}
                    onChange={(e) => patchSummarySettings({ jevRouting: { ...routing(), [t.effort]: e } })}
                  />
                }
              />
            </Show>
          </>
        )}
      </For>
    </Card>
  );
}
