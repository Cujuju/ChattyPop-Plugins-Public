// Editors and summaries for Tags' declared rule kinds.
import type { KindProps, RendererContributions } from '@plugin-sdk/renderer';
import { AddPicker, ChipRow, Checks, Row, Select } from '@plugin-sdk/renderer/kit';
import type { AppliedConfig, ApplyTagConfig } from '../shared/rules';
import { plugin } from '../shared';
import { tags } from './state';
import styles from './Tags.module.css';

const TAG_SOURCES = [
  {
    id: 'manual' as const,
    label: 'By you',
  },
  {
    id: 'jev' as const,
    label: 'By Jev',
  },
];
function AppliedEditor(p: KindProps<AppliedConfig>) {
  return (
    <>
      <ChipRow
        items={p.config.tagIds}
        label={(id) => tags().find((t) => t.id === id)?.name ?? 'A tag'}
        onRemove={(id) => p.onChange({
          ...p.config,
          tagIds: p.config.tagIds.filter((x) => x !== id),
        })}
      >
        <AddPicker
          label="Tag"
          options={() =>
            tags()
              .filter((t) => !p.config.tagIds.includes(t.id))
              .map((t) => ({
                value: String(t.id),
                label: t.name,
              }))
          }
          empty="No tags yet (Tags panel)."
          onPick={(v) => p.onChange({
            ...p.config,
            tagIds: [...p.config.tagIds, Number(v)],
          })}
        />
      </ChipRow>
      <Checks
        items={TAG_SOURCES}
        chosen={p.config.sources}
        onChange={(sources) => p.onChange({
          ...p.config,
          sources,
        })}
      />
    </>
  );
}

function TagEditor(props: KindProps<ApplyTagConfig>) {
  const id = (field: string) => `${props.id}-${field}`;
  const set = (patch: Partial<ApplyTagConfig>) => props.onChange({
    ...props.config,
    ...patch,
  });
  return (
    <Row
      label="Tag"
      for={id('tag')}
      control={
        <Select
          id={id('tag')}
          class={styles.control}
          value={props.config.tagId === null ? '' : String(props.config.tagId)}
          options={[{
            value: '',
            label: 'Pick a tag',
          }, ...tags().map((t) => ({
            value: String(t.id),
            label: t.name,
          }))]}
          onChange={(v) => set({ tagId: v ? Number(v) : null })}
        />
      }
    />
  );
}

/** Views remain available for existing rules when Tags is off. */
export const ruleViews: RendererContributions<typeof plugin>['rules'] = {
  triggers: {
    'tags.applied': {
      Editor: AppliedEditor,
      summary: (c) =>
        !c.tagIds.length
          ? 'No tag picked'
          : c.tagIds.length === 1
            ? `Tag ${tags().find((t) => t.id === c.tagIds[0])?.name ?? 'a tag'} put on`
            : `${c.tagIds.length} tags put on`,
    },
  },
  actions: {
    'tags.apply': {
      Editor: TagEditor,
      summary: (c) =>
        c.tagId === null ? 'Pick a tag' : `Tag ${tags().find((t) => t.id === c.tagId)?.name ?? ''}`.trim(),
    },
  },
  filters: {
    'tags.any': {
      Editor: (p) => (
        <ChipRow items={p.config.tagIds} label={(id) => tags().find((t) => t.id === id)?.name ?? 'A tag'} onRemove={(id) => p.onChange({ tagIds: p.config.tagIds.filter((x) => x !== id) })}>
          <AddPicker
            label="Tag"
            options={() =>
              tags()
                .filter((t) => !p.config.tagIds.includes(t.id))
                .map((t) => ({
                  value: String(t.id),
                  label: t.name,
                }))
            }
            empty="No tags yet (Tags panel)."
            onPick={(v) => p.onChange({ tagIds: [...p.config.tagIds, Number(v)] })}
          />
        </ChipRow>
      ),
      summary: (c) => c.tagIds.map((id) => `Tagged ${tags().find((t) => t.id === id)?.name ?? 'a tag'}`).join(', '),
      chips: (config) => config.tagIds.map((id) => `Tag ${tags().find((t) => t.id === id)?.name ?? ''}`.trim()),
    },
  },
};
