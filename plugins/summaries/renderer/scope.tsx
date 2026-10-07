// Where a summary reads: everything, one server, or one channel. The picker, and how a run names what it read.
import { DM_GROUP_NAME, DM_GUILD_ID, type DirectoryGuild, type Rule } from '@plugin-sdk/shared';
import {
  GuildIcon,
  Icon,
  SearchSelect,
  channelById,
  channelLabel,
  channelSigil,
  directory,
  isThread,
  ruleInputOf,
  saveRule,
  type SearchOption,
} from '@plugin-sdk/renderer/kit';
import type { SummaryScope } from '../shared/types';

/** The picker's values: everything, a server or a channel by id, or a scope it can't pick (a rule's several). */
const EVERYTHING = '';
const SERVER = 'g:';
const CHANNEL = 'c:';
const OTHER = 'other';
/** Names a label lists before "+N more". */
const NAMES_SHOWN = 2;

const isEverything = (s: SummaryScope | null): boolean => !s || (!s.guildIds.length && !s.channelIds.length);

/** A scope as the picker's value; OTHER when it isn't one server or one channel. */
function valueOf(s: SummaryScope | null): string {
  if (isEverything(s)) return EVERYTHING;
  if (s!.guildIds.length === 1 && !s!.channelIds.length) return SERVER + s!.guildIds[0];
  if (s!.channelIds.length === 1 && !s!.guildIds.length) return CHANNEL + s!.channelIds[0];
  return OTHER;
}

function scopeOf(v: string): SummaryScope | null {
  if (v.startsWith(SERVER)) return { guildIds: [v.slice(SERVER.length)], channelIds: [] };
  if (v.startsWith(CHANNEL)) return { guildIds: [], channelIds: [v.slice(CHANNEL.length)] };
  return null;
}

/** Same scope, whatever order its ids are in; '' for everything. */
export const scopeKey = (s: SummaryScope | null): string =>
  isEverything(s) ? '' : JSON.stringify([[...s!.guildIds].sort(), [...s!.channelIds].sort()]);

/**
 * A scope's name: servers, then channels; channels that make up a whole server (a rule's, resolved) read as the server.
 * Past NAMES_SHOWN, the rest count as "+N more".
 */
export function scopeLabel(s: SummaryScope | null): string {
  if (isEverything(s)) return 'Everything';
  const servers = directory();
  const left = new Set(s!.channelIds);
  const names = s!.guildIds.map((id) => servers.find((g) => g.id === id)?.name ?? 'a server');
  for (const g of servers) {
    const own = g.channels.filter((c) => c.optedIn && !isThread(c));
    if (!own.length || !own.every((c) => left.has(c.id))) continue;
    names.push(g.name);
    g.channels.forEach((c) => left.delete(c.id));
  }
  for (const id of left) {
    const c = channelById(id);
    // A thread whose channel is listed is part of it.
    if (c && !(isThread(c) && c.parentId && left.has(c.parentId))) names.push(channelLabel(c));
  }
  const more = names.length - NAMES_SHOWN;
  return more > 1 ? `${names.slice(0, NAMES_SHOWN).join(', ')} +${more} more` : names.join(', ');
}

/** A scheduled summary's scope: its rule's Where. */
export const ruleScope = (r: Rule): SummaryScope => ({ guildIds: r.spec.gates.guildIds ?? [], channelIds: r.spec.gates.channelIds ?? [] });

/** Saves `s` as the rule's Where; everything clears it. */
export async function setRuleScope(r: Rule, s: SummaryScope | null): Promise<void> {
  const input = ruleInputOf(r);
  const { guildIds: _servers, channelIds: _channels, ...gates } = input.spec.gates;
  const where = { ...(s?.guildIds.length ? { guildIds: s.guildIds } : {}), ...(s?.channelIds.length ? { channelIds: s.channelIds } : {}) };
  await saveRule(r.id, { ...input, spec: { ...input.spec, gates: { ...gates, ...where } } });
}

/** A server and its archived channels under it; DMs (one or many) are found by filtering, so the list stays a list of places. */
function serverOptions(g: DirectoryGuild): SearchOption[] {
  const channels = g.channels.filter((c) => c.optedIn && !isThread(c));
  if (!channels.length) return [];
  const dms = g.id === DM_GUILD_ID;
  return [
    { value: SERVER + g.id, label: dms ? DM_GROUP_NAME : g.name, lead: () => (dms ? <Icon name="conversation" /> : <GuildIcon id={g.id} name={g.name} icon={g.icon} />) },
    ...channels.map((c) => ({ value: CHANNEL + c.id, label: c.name, nested: true, searchOnly: dms, lead: () => channelSigil(c) })),
  ];
}

/** Everything, each server with archived channels heading its channels, then direct messages; a scope it can't pick stays, named. */
export function ScopeSelect(props: { id?: string; class?: string; value: SummaryScope | null; onChange: (s: SummaryScope | null) => void }) {
  const options = (): SearchOption[] => [
    ...(valueOf(props.value) === OTHER ? [{ value: OTHER, label: scopeLabel(props.value), lead: () => <Icon name="filter" /> }] : []),
    { value: EVERYTHING, label: 'Everything', lead: () => <Icon name="archive" /> },
    // Servers in the directory's order, direct messages last.
    ...[...directory()].sort((a, b) => Number(a.id === DM_GUILD_ID) - Number(b.id === DM_GUILD_ID)).flatMap(serverOptions),
  ];
  return (
    <SearchSelect
      id={props.id}
      class={props.class}
      value={valueOf(props.value)}
      options={options()}
      onChange={(v) => {
        if (v !== OTHER) props.onChange(scopeOf(v));
      }}
    />
  );
}
