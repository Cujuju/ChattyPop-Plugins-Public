// Fixed managed alert match editors and list summaries.
import { For } from 'solid-js';
import { ALERT_QUERIES as JEV_QUERIES } from '../shared/queries';
import { ALERT_FEATURE_INFO as JEV_FEATURE_INFO } from './features';
import type { KindView } from '@plugin-sdk/renderer';
import { showJevQuery, Field, look } from '@plugin-sdk/renderer/kit';
import styles from './Alerts.module.css';

function ManagedMatch(props: { feature: 'aimedAtMe' | 'unansweredQuestions'; lede: string }) {
  return (
    <>
      <Field
        label="Built in"
        hint={
          <>
            Its switch is beside it in the rule list, and it needs Jev:{' '}
            {JEV_FEATURE_INFO[props.feature].perMessage ?? 'questions only when it runs'}. Where, who and what it does are
            yours to change.
          </>
        }
      >
        <p class={`${styles.lede} ${look.text}`} data-size="xs" data-tone="secondary" data-line="relaxed">
          {props.lede}
        </p>
      </Field>
      <For each={JEV_QUERIES.filter((d) => d.features.includes(props.feature))}>
        {(d) => (
          <Field label="Jev question">
            <button type="button" class="cp-button" onClick={() => showJevQuery(d.id)}>
              Edit “{d.label}”…
            </button>
          </Field>
        )}
      </For>
    </>
  );
}

/** What managed alert rules match: their list lines and the fixed descriptions shown in the editor. */
export const alertMatchViews = {
  'alerts.aimed': {
    managedOnly: true,
    Editor: () => (
      <ManagedMatch
        feature="aimedAtMe"
        lede="A reply to you or an @mention always matches. Jev also judges each message for being addressed to you or asking you something without one."
      />
    ),
    summary: () => 'Jev · addressed to you',
  },
  'alerts.openQuestion': {
    managedOnly: true,
    Editor: () => (
      <ManagedMatch
        feature="unansweredQuestions"
        lede="Jev collects questions others ask in chat. A Discord reply to one marks its alert read."
      />
    ),
    summary: () => 'Jev · unanswered questions',
  },
};
