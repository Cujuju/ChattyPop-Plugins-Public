// Tags panel: the owner's tags and their Jev range tools.
import { For, Show, createSignal } from 'solid-js';
import { TAG_NAME_MAX, type Tag } from '../shared/types';
import type { CustomJevQuestion } from '@plugin-sdk/shared';
import {
  look,
  openArchive,
  createAction,
  confirmDialog,
  percentText,
  shortDateTime as when,
  usdText,
  JevQuestionField,
  conditionWording,
  usdPerQuestion,
} from '@plugin-sdk/renderer/kit';
import { createTag, deleteTag, saveTag, setEditingTag, taggedMessages } from './state';
import styles from './Tags.module.css';

const TAG_WORDING = conditionWording('Tag', 'Jev question (none: you tag by hand)', 'e.g. Does `message` mention a stock, ticker or trade?');

/** Edits one tag (null = a new one): name, Jev question, whether new messages are tagged; lists what carries it. */
export function TagEditor(props: { tag: Tag | null }) {
  const t = props.tag;
  const [name, setName] = createSignal(t?.name ?? '');
  const [question, setQuestion] = createSignal<CustomJevQuestion | null>(t?.jevQuestion ?? null);
  const [auto, setAuto] = createSignal(t?.auto ?? false);
  const action = createAction();
  const { busy, error } = action;
  const save = async (e: SubmitEvent): Promise<void> => {
    e.preventDefault();
    const input = {
      name: name(),
      jevQuestion: question(),
      auto: auto() && question() !== null,
    };
    await action.run(() => (t ? saveTag(t.id, input) : createTag(input)));
  };
  const remove = async (): Promise<void> => {
    if (!t) return;
    const ok = await confirmDialog({ title: 'Delete tag', message: `Delete the tag “${t.name}”? It comes off every message.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    await action.run(() => deleteTag(t.id));
  };
  return (
    <>
      <form class={`${styles.card} ${look.card}`} onSubmit={(e) => void save(e)}>
        <h3 class={look.text} data-size="sm" data-weight="semibold" data-tone="primary" data-font="sans">{t ? `Tag “${t.name}”` : 'New tag'}</h3>
        <label class="cp-field">
          <span class="cp-label">Name</span>
          <input class={`${styles.input} ${look.text}`} data-size="sm" data-font="sans" maxLength={TAG_NAME_MAX} placeholder="e.g. Trading" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        <JevQuestionField wording={TAG_WORDING} value={question()} onChange={setQuestion} />
        <Show when={question()}>
          <label class="cp-check">
            <input type="checkbox" checked={auto()} onChange={(e) => setAuto(e.currentTarget.checked)} />
            Tag new messages as they arrive
          </label>
          <p class="cp-hint">
            Asks Jev about every new message: one question each (about {usdText(usdPerQuestion())}). Without it, the tag runs only on ranges you pick below.
          </p>
        </Show>
        <Show when={error()}>
          <p class="cp-error" role="alert">
            {error()}
          </p>
        </Show>
        <div class="cp-actions">
          <button type="submit" class="cp-button" disabled={busy() || !name().trim()}>
            {t ? 'Save' : 'Create tag'}
          </button>
          <button type="button" class="cp-button" onClick={() => setEditingTag(null)}>
            Close
          </button>
          <Show when={t}>
            <button type="button" class={`cp-danger ${styles.danger}`} onClick={() => void remove()}>
              Delete tag
            </button>
          </Show>
        </div>
      </form>
      <Show when={t}>
        <section class="cp-field" aria-label="Tagged messages">
          <span class="cp-label">Tagged messages</span>
          <Show when={taggedMessages().length} fallback={<p class="cp-hint">No messages carry this tag yet.</p>}>
            <div class={styles.list}>
              <For each={taggedMessages()}>
                {(m) => (
                  <button
                    type="button"
                    class={`${styles.row} ${look.row} ${look.insetFocus} ${look.text}`}
                    data-hover="raise"
                    data-tone="primary"
                    data-font="sans"
                    data-source={m.source} title="Show the message in the Archive" onClick={() => void openArchive(m.channelId, m.messageId)}>
                    <span class={look.text} data-size="2xs" data-tone="muted">
                      {when(m.ts)} · #{m.channelName} · {m.author} · {m.source === 'manual' ? 'by you' : m.source === 'rule' ? 'by a rule' : `Jev ${percentText(m.value ?? 0)}`}
                    </span>
                    <span class={`${styles.text} ${look.text}`} data-size="sm" data-line="normal">{m.content}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </section>
      </Show>
    </>
  );
}
