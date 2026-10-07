// The provider that extracts each detected plan, in Settings → Jev → Detect plans and decisions.
import { Card, ProviderSelect, Row } from '@plugin-sdk/renderer/kit';
import { plansSettings, patchPlansSettings } from './state';

const FIELD_ID = 'plans-provider';

export function PlanProvider() {
  return (
    <Card>
      <Row
        label="Provider"
        for={FIELD_ID}
        hint="Writes each detected plan; uses the model picked for it in Settings → AI providers."
        control={<ProviderSelect id={FIELD_ID} value={plansSettings().defaultProvider} onChange={(id) => patchPlansSettings({ defaultProvider: id })} />}
      />
    </Card>
  );
}
