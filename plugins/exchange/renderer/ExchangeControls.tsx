import { Show, createSignal } from 'solid-js';
import type { ExchangeResult } from '../shared/types';
import { MS_PER_DAY } from '@plugin-sdk/shared';
import {
  archivedChannels,
  Card,
  channelLabel,
  countText,
  errorText,
  Note,
  Row,
  Select,
  SettingsButton,
  Switch,
} from '@plugin-sdk/renderer/kit';
import { exportChannels, importDce } from './state';
import styles from './Exchange.module.css';

/** Export ranges offered, in days; 0 = everything archived. */
const RANGE_DAYS = [0, 1, 7, 30, 365];
const ALL = 'all';

const rangeLabel = (d: number): string => (d === 0 ? 'Everything archived' : d === 1 ? 'Last day' : `Last ${d} days`);
const summary = (verb: string, r: ExchangeResult): string =>
  `${verb} ${r.messages} messages in ${countText(r.channelIds.length, 'channel')}.${r.skippedFiles.length ? ` Skipped ${r.skippedFiles.length} file(s) that couldn't be imported as DiscordChatExporter JSON.` : ''}`;

/** Settings → Archive: export channels (DCE JSON or HTML) and import DiscordChatExporter JSON. */
export function ExchangeControls() {
  const channels = () => archivedChannels().map((ch) => ({ value: ch.id, label: channelLabel(ch, ch.guildName) }));
  const [channel, setChannel] = createSignal(ALL);
  const [days, setDays] = createSignal(0);
  const [format, setFormat] = createSignal<'html' | 'json'>('html');
  const [media, setMedia] = createSignal(false);
  const [status, setStatus] = createSignal<string | null>(null);

  const run = (label: string, job: () => Promise<ExchangeResult | null>): void => {
    setStatus(`${label}…`);
    job().then(
      (r) => setStatus(r ? summary(label === 'Exporting' ? 'Exported' : 'Imported', r) : null),
      (err: unknown) => setStatus(errorText(err)),
    );
  };
  const doExport = (): void =>
    run('Exporting', () =>
      exportChannels({
        channelIds: channel() === ALL ? channels().map((ch) => ch.value) : [channel()],
        ...(days() ? { sinceTs: Date.now() - days() * MS_PER_DAY } : {}),
        format: format(),
        includeMedia: media(),
      }),
    );

  return (
    <>
      <Card title="Export">
        <Row
          label="Channels"
          for="export-channel"
          control={<Select id="export-channel" class={styles.control} value={channel()} options={[{ value: ALL, label: 'All archived channels' }, ...channels()]} onChange={setChannel} />}
        />
        <Row
          label="Messages"
          for="export-range"
          control={<Select id="export-range" class={styles.control} value={String(days())} options={RANGE_DAYS.map((d) => ({ value: String(d), label: rangeLabel(d) }))} onChange={(v) => setDays(Number(v))} />}
        />
        <Row
          label="Format"
          for="export-format"
          hint="HTML reads in any browser; JSON is DiscordChatExporter's format, which ChattyPop and other tools can import."
          control={
            <Select
              id="export-format"
              class={styles.control}
              value={format()}
              options={[
                { value: 'html', label: 'HTML page' },
                { value: 'json', label: 'JSON (DiscordChatExporter)' },
              ]}
              onChange={(v) => setFormat(v as 'html' | 'json')}
            />
          }
        />
        <Row
          label="Copy attachment files into the export"
          for="export-media"
          hint="Without copied files, attachments link to Discord."
          control={<Switch id="export-media" checked={media()} onChange={setMedia} />}
        />
        <Row
          label="Export to a folder"
          control={
            <SettingsButton onClick={doExport}>Export…</SettingsButton>
          }
        />
      </Card>
      <Card title="Import">
        <Row
          label="DiscordChatExporter JSON"
          hint="Imported channels become archived and sync brings them up to date."
          control={
            <SettingsButton onClick={() => run('Importing', importDce)}>Import…</SettingsButton>
          }
        />
      </Card>
      <Show when={status()}>{(st) => <Note kind="status">{st()}</Note>}</Show>
    </>
  );
}
