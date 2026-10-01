// A provider's short name in the Plan usage panel, set on its card in Settings → AI.
import { PROVIDER_DISPLAY_NAME_MAX, normalizeDisplayName, type ProviderId } from '@plugin-sdk/shared';
import { Row, aiProviders, providerSettingsOf, setProviderDisplayName } from '@plugin-sdk/renderer/kit';
import styles from './Provider.module.css';

export function DisplayNameRow(props: { provider: ProviderId }) {
  const id = props.provider;
  return (
    <Row
      label="Display name"
      for={`ai-display-${id}`}
      hint="How Plan usage names this provider. Blank uses the default."
      control={
        <input
          id={`ai-display-${id}`}
          type="text"
          class={styles.control}
          maxLength={PROVIDER_DISPLAY_NAME_MAX}
          placeholder={aiProviders().find((d) => d.id === id)?.displayName}
          value={providerSettingsOf(id).displayName ?? ''}
          onChange={(e) => setProviderDisplayName(id, normalizeDisplayName(e.currentTarget.value))}
        />
      }
    />
  );
}
