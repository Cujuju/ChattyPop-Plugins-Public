import { Show, createSignal } from 'solid-js';
import type { ExchangeResult, ExportResult } from '../shared/types';
import { FORMATS, type ExportFormat } from './formats';
import { MS_PER_DAY } from '@plugin-sdk/shared';
import {
  AddPicker,
  archivedChannels,
  Card,
  channelLabel,
  ChipRow,
  countText,
  errorText,
  inCompanion,
  look,
  Note,
  Row,
  Select,
  SettingsButton,
  Switch,
} from '@plugin-sdk/renderer/kit';
import { cancelExport, exportChannels, exportProgress, importDce } from './state';
import styles from './Exchange.module.css';

/** Export ranges offered, in days; 0 = everything archived. */
const RANGE_DAYS = [0, 1, 7, 30, 365];
/** The range choice that takes two dates instead of a count of days. */
const BETWEEN = 'between';
const ALL = 'all';
const CHOSEN = 'chosen';
const SCOPES = [
  { value: ALL, label: 'All archived channels' },
  { value: CHOSEN, label: 'Chosen channels' },
];

const rangeLabel = (d: number): string => (d === 0 ? 'Everything archived' : d === 1 ? 'Last day' : `Last ${d} days`);
const RANGES = [...RANGE_DAYS.map((d) => ({ value: String(d), label: rangeLabel(d) })), { value: BETWEEN, label: 'Between two dates' }];
/** A date field's time; undefined while it is empty or unreadable. */
const fieldTime = (value: string): number | undefined => {
  const ms = new Date(value).getTime();
  return value && Number.isFinite(ms) ? ms : undefined;
};

const imported = (r: ExchangeResult): string =>
  `Imported ${r.messages} messages in ${countText(r.channelIds.length, 'channel')}.${r.skippedFiles.length ? ` Skipped ${r.skippedFiles.length} file(s) that couldn't be imported as DiscordChatExporter JSON.` : ''}`;
const exported = (r: ExportResult): string =>
  [
    `${r.cancelled ? 'Stopped after' : 'Exported'} ${r.messages} messages in ${countText(r.channelIds.length, 'file')}.`,
    r.emptyChannelIds.length ? `${countText(r.emptyChannelIds.length, 'chosen channel')} had no messages in that range.` : '',
    r.failedChannelIds.length ? `${countText(r.failedChannelIds.length, 'channel')} couldn't be written.` : '',
    r.unfetchedChannelIds.length
      ? `History didn't reach the start of the range for ${countText(r.unfetchedChannelIds.length, 'channel')} (sync is paused, or Discord refused): what is stored was exported.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

/** Settings → Archive: export channels (HTML, DCE JSON, text, Markdown or CSV) and import DiscordChatExporter JSON. */
export function ExchangeControls() {
  return (
    <Show when={!inCompanion} fallback={<Note>Import and export archives on the PC.</Note>}>
      <DesktopExchangeControls />
    </Show>
  );
}

function DesktopExchangeControls() {
  const channels = () => archivedChannels();
  const [scope, setScope] = createSignal(ALL);
  const [chosen, setChosen] = createSignal<string[]>([]);
  const [threads, setThreads] = createSignal(true);
  const [range, setRange] = createSignal(String(RANGE_DAYS[0]));
  const [from, setFrom] = createSignal('');
  const [to, setTo] = createSignal('');
  const [format, setFormat] = createSignal<ExportFormat>('html');
  const [media, setMedia] = createSignal(false);
  const [fetchFirst, setFetchFirst] = createSignal(false);
  const [status, setStatus] = createSignal<string | null>(null);
  const [exporting, setExporting] = createSignal(false);

  const label = (id: string): string => {
    const ch = channels().find((c) => c.id === id);
    return ch ? channelLabel(ch, ch.guildName) : 'A channel no longer archived';
  };
  const channelIds = (): string[] => (scope() === ALL ? channels().map((ch) => ch.id) : chosen());
  /** The chosen range; null when From is not before To. */
  const times = (): { sinceTs?: number; untilTs?: number } | null => {
    if (range() !== BETWEEN) return Number(range()) ? { sinceTs: Date.now() - Number(range()) * MS_PER_DAY } : {};
    const sinceTs = fieldTime(from());
    const untilTs = fieldTime(to());
    if (sinceTs !== undefined && untilTs !== undefined && sinceTs >= untilTs) return null;
    return { ...(sinceTs !== undefined ? { sinceTs } : {}), ...(untilTs !== undefined ? { untilTs } : {}) };
  };
  const running = (): string => {
    const p = exportProgress();
    if (p) return `Exporting… ${p.channelsDone} of ${countText(p.channelsTotal, 'channel')}, ${p.messages} messages.`;
    return fetching() ? 'Fetching history back to the start of the range, at the sync pace; the export follows…' : 'Exporting…';
  };
  /** The range has a start, so history can be fetched back to it. */
  const startsAt = (): boolean => times()?.sinceTs !== undefined;
  const fetching = (): boolean => fetchFirst() && startsAt();

  const run = <T,>(started: string, job: () => Promise<T | null>, done: (r: T) => string): Promise<void> => {
    setStatus(started);
    return job().then(
      (r) => void setStatus(r ? done(r) : null),
      (err: unknown) => void setStatus(errorText(err)),
    );
  };
  const doExport = (): void => {
    const span = times();
    if (!span) return;
    setExporting(true);
    void run('Exporting…', () => exportChannels({ channelIds: channelIds(), includeThreads: threads(), ...span, format: format(), includeMedia: media(), fetchFirst: fetching() }), exported).finally(() =>
      setExporting(false),
    );
  };

  return (
    <>
      <Card title="Export">
        <Row label="Channels" for="export-scope" control={<Select id="export-scope" class={styles.control} value={scope()} options={SCOPES} onChange={setScope} />}>
          <Show when={scope() === CHOSEN}>
            <ChipRow items={chosen()} label={label} onRemove={(id) => setChosen(chosen().filter((x) => x !== id))}>
              <AddPicker
                label="Channel"
                options={() =>
                  channels()
                    .filter((ch) => !chosen().includes(ch.id))
                    .map((ch) => ({ value: ch.id, label: channelLabel(ch), hint: ch.guildName }))
                }
                empty="No archived channels left to add."
                onPick={(id) => setChosen([...chosen(), id])}
              />
            </ChipRow>
          </Show>
        </Row>
        <Row
          label="Include threads and forum posts"
          for="export-threads"
          hint="Each thread and post is written to its own file."
          control={<Switch id="export-threads" checked={threads()} onChange={setThreads} />}
        />
        <Row label="Messages" for="export-range" control={<Select id="export-range" class={styles.control} value={range()} options={RANGES} onChange={setRange} />} />
        <Show when={range() === BETWEEN}>
          <Row
            label="From"
            for="export-from"
            hint="Leave empty to start at the first archived message."
            control={
              <input id="export-from" class={`${styles.control} ${look.text}`} data-size="sm" data-font="sans" type="datetime-local" value={from()} onInput={(e) => setFrom(e.currentTarget.value)} />
            }
          />
          <Row
            label="To"
            for="export-to"
            hint="Leave empty to end at the newest."
            control={<input id="export-to" class={`${styles.control} ${look.text}`} data-size="sm" data-font="sans" type="datetime-local" value={to()} onInput={(e) => setTo(e.currentTarget.value)} />}
          />
          <Show when={!times()}>
            <Note kind="error">From must be before To.</Note>
          </Show>
        </Show>
        <Show when={startsAt()}>
          <Row
            label="Fetch missing history first"
            for="export-fetch"
            hint="Fetches each chosen channel back to the start of the range at the sync pace, then exports. What is fetched stays in the archive; your history settings don't change."
            control={<Switch id="export-fetch" checked={fetchFirst()} onChange={setFetchFirst} />}
          />
        </Show>
        <Row
          label="Format"
          for="export-format"
          hint="HTML reads in any browser; JSON is DiscordChatExporter's format, which ChattyPop and other tools can import; CSV has one row per message."
          control={<Select id="export-format" class={styles.control} value={format()} options={FORMATS} onChange={(v) => setFormat(v as ExportFormat)} />}
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
            <Show when={exporting()} fallback={<SettingsButton disabled={!times() || !channelIds().length} onClick={doExport}>Export…</SettingsButton>}>
              <SettingsButton onClick={() => void cancelExport()}>Stop</SettingsButton>
            </Show>
          }
        />
      </Card>
      <Card title="Import">
        <Row
          label="DiscordChatExporter JSON"
          hint="Imported channels become archived and sync brings them up to date."
          control={<SettingsButton disabled={exporting()} onClick={() => void run('Importing…', importDce, imported)}>Import…</SettingsButton>}
        />
      </Card>
      <Show when={exporting() ? running() : status()}>{(st) => <Note kind="status">{st()}</Note>}</Show>
    </>
  );
}
