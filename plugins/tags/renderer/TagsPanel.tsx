// Tags panel: the owner's tags and their Jev range tools.
import { For, Show } from 'solid-js';
import { isPanelCollapsed, look, countText, PanelHeader } from '@plugin-sdk/renderer/kit';
import { customTags, editingTag, setEditingTag, tags } from './state';
import { TagEditor } from './TagEditor';
import { TagRange } from './TagRange';
import styles from './Tags.module.css';

/** #78 your own tags: chips with counts, the open tag's editor and tagged messages, and the range runner. */
export function TagsPanel() {
  const withJev = () => tags().filter((t) => t.jevQuestion);
  return (
    <section class="cp-panel" aria-label="Tags" data-section="tags">
      <PanelHeader section="tags" collapsible title="Tags" meta={tags().length ? countText(tags().length, 'tag') : undefined} />
      <Show when={!isPanelCollapsed('tags')}>
        <div class={`cp-panel-body ${styles.body}`}>
          <div class={styles.chips} role="group" aria-label="Your tags (select to edit)">
            <For each={tags()}>
              {(t) => (
                <button
                  type="button"
                  class={`${styles.chip} ${look.chip} ${look.text}`}
                  data-size="xs"
                  data-line="none"
                  data-tone="primary"
                  aria-pressed={editingTag() === t.id}
                  title={t.jevQuestion ? `Jev: ${t.jevQuestion.question}` : 'Tagged by hand'}
                  onClick={() => setEditingTag(editingTag() === t.id ? null : t.id)}
                >
                  {t.name}
                  <span class={look.text} data-tone="muted">{t.count}</span>
                </button>
              )}
            </For>
            <button
              type="button"
              class={`${styles.chip} ${look.chip} ${look.text}`}
              data-size="xs"
              data-line="none"
              data-tone="primary"
              aria-pressed={editingTag() === 'new'}
              onClick={() => setEditingTag(editingTag() === 'new' ? null : 'new')}
            >
              + New tag
            </button>
          </div>
          <Show when={!tags().length && editingTag() === null}>
            <p class="cp-hint">
              Tags label messages with chips, here and in the live Discord view. Give a tag a Jev question and Jev applies it; without one, tag messages yourself
              (right-click a message).
            </p>
          </Show>
          <Show when={withJev().length && !customTags.on()}>
            <p class="cp-hint">Turn on Settings → Jev → Your own tags for Jev to apply tags.</p>
          </Show>
          {/* Keyed: switching tags remounts the editor with that tag's fields; refreshed counts don't. */}
          <Show when={editingTag()} keyed>
            {(id) => <TagEditor tag={id === 'new' ? null : (tags().find((t) => t.id === id) ?? null)} />}
          </Show>
          <Show when={withJev().length}>
            <TagRange />
          </Show>
        </div>
      </Show>
    </section>
  );
}
