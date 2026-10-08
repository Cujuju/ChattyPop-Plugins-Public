// Compare models' list: add a model at the top, edit one in place under its row, drag rows to set column order.
import { createSignal, For, Show } from 'solid-js';
import type { ProviderId } from '@plugin-sdk/shared';
import { Card, EffortRow, ModelRow, Note, ProviderSelect, Row, countText, createReorderList, look, providerSettingsOf, providerStatus } from '@plugin-sdk/renderer/kit';
import type { CompareModel } from '../shared/compare';
import { patchSummarySettings as update, summarySettings } from './settings';
import { modelText } from './compareState';
import styles from './Summary.module.css';

/** The editor's target: a listed model by index, a new one, or none. */
type Editing = number | 'new' | null;

/** Each listed model's drag id; the list holds no ids, so one is minted per entry object as it is first drawn. */
const dragIds = new WeakMap<CompareModel, string>();
let nextDragId = 0;
const dragId = (m: CompareModel): string => {
  let id = dragIds.get(m);
  if (id === undefined) dragIds.set(m, (id = String(nextDragId++)));
  return id;
};

export function ModelsCard() {
  const models = () => summarySettings().compareModels;
  const [editing, setEditing] = createSignal<Editing>(null);
  const setModels = (list: CompareModel[]): void => void update({ compareModels: list });
  const reorder = createReorderList({
    ids: () => models().map(dragId),
    onReorder(from, to) {
      const list = [...models()];
      const e = editing();
      const edited = typeof e === 'number' ? list[e] : undefined;
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved!);
      setModels(list);
      // The model being edited keeps its editor wherever it lands.
      if (edited) setEditing(list.indexOf(edited));
    },
  });
  const remove = (i: number): void => {
    setModels(models().filter((_, j) => j !== i));
    const e = editing();
    if (e === i) setEditing(null);
    else if (typeof e === 'number' && e > i) setEditing(e - 1);
  };
  return (
    <Card title="Models" meta={countText(models().length, 'model')}>
      <Row
        label="Models to compare"
        hint="Drag to set the column order."
        control={
          <button type="button" class="cp-button" disabled={editing() === 'new'} onClick={() => setEditing('new')}>
            Add model
          </button>
        }
      />
      <Show when={editing() === 'new'}>
        <ModelEditor start={null} save="Add" onSave={(m) => (setModels([...models(), m]), setEditing(null))} onCancel={() => setEditing(null)} />
      </Show>
      <Show when={models().length} fallback={<Note>No models yet.</Note>}>
        <div class={styles.modelList}>
          <For each={models()}>
            {(m, i) => (
              <div class={styles.modelItem} {...reorder.itemProps(dragId(m))}>
                <div class={styles.modelLine}>
                  {/* A touch drags from here; elsewhere on the row it scrolls the page. */}
                  <span data-reorder-handle aria-hidden="true" />
                  <Row
                    label={`${i() + 1}. ${modelText(m)}`}
                    control={
                      <span class={styles.buttons}>
                        <button type="button" class="cp-button" aria-pressed={editing() === i()} onClick={() => setEditing(editing() === i() ? null : i())}>
                          {editing() === i() ? 'Close' : 'Edit'}
                        </button>
                        <button type="button" class="cp-danger" onClick={() => remove(i())}>
                          Remove
                        </button>
                      </span>
                    }
                  />
                </div>
                <Show when={editing() === i()}>
                  <ModelEditor
                    start={m}
                    save="Save"
                    onSave={(next) => (setModels(models().map((x, j) => (j === i() ? next : x))), setEditing(null))}
                    onCancel={() => setEditing(null)}
                  />
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </Card>
  );
}

/** Provider, model and thinking level for one entry, starting from `start` (null: a new one). */
function ModelEditor(props: { start: CompareModel | null; save: string; onSave: (m: CompareModel) => void; onCancel: () => void }) {
  // The fields start from the entry once and are the editor's own after that.
  const [picked, setPicked] = createSignal<ProviderId | null>(props.start?.provider ?? null);
  const provider = () => picked() ?? summarySettings().defaultProvider;
  const [choice, setChoice] = createSignal({ model: props.start?.model ?? null, effort: props.start?.effort ?? null });
  const patch = (p: Partial<{ model: string | null; effort: string | null }>): void => void setChoice({ ...choice(), ...p });
  // A model left on "from Settings → AI providers" is saved as the one that is now, so the comparison names it.
  const save = (p: ProviderId): void => {
    const { model, effort } = choice();
    const resolved = model ?? providerSettingsOf(p).model ?? providerStatus().find((s) => s.id === p)?.models?.find((m) => m.isDefault)?.id ?? null;
    props.onSave({ provider: p, model: resolved, effort });
  };
  return (
    <div class={`${styles.editor} ${look.wash}`}>
      <Row
        label="Provider"
        for="compare-provider"
        control={
          <ProviderSelect
            id="compare-provider"
            value={provider()}
            onChange={(p) => {
              setPicked(p);
              setChoice({ model: null, effort: null });
            }}
          />
        }
      />
      <Show when={provider()}>
        {(p) => (
          <>
            <ModelRow fieldId="compare-model" provider={p()} value={choice()} onChange={patch} />
            <EffortRow fieldId="compare-effort" provider={p()} value={choice()} onChange={patch} />
          </>
        )}
      </Show>
      <div class={styles.editorActions}>
        <button type="button" class="cp-button" onClick={() => props.onCancel()}>
          Cancel
        </button>
        <button type="button" class="cp-primary" disabled={!provider()} onClick={() => save(provider()!)}>
          {props.save}
        </button>
      </div>
    </div>
  );
}
