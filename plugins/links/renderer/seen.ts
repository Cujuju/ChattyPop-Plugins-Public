import { createEffect, createSignal, on } from 'solid-js';
import { pluginSetting, type Platform } from '@plugin-sdk/shared';
import { callable, containedRoot, coreClient, lastSeenAt, onAppEvent, onArchiveChange, pluginData, pluginPreference } from '@plugin-sdk/renderer';
import { plugin } from '../shared';

const client = coreClient(plugin);
const feedOn = (): boolean => callable(plugin, 'counts');
const sum = (counts: Partial<Record<Platform, number>>): number => Object.values(counts).reduce((a, n) => a + (n ?? 0), 0);

// --- Seen watermark ----------------------------------------------------------

/** New-link watermark advances while Links is visible. Null until loaded; first run starts at the previous app session's end. */
const [seenUpTo, , { loaded: watermarkLoaded }] = pluginPreference(plugin, 'seenUpTo', {
  seed: lastSeenAt,
});
/** The watermark as it was when the panel last came on screen: the "caught up" divider sits there. */
export const [linkDivider, setLinkDivider] = createSignal<number | null>(null);
/** Links shared since the watermark, across every filter. */
const [newCount, setNewCount] = createSignal(0);
export { newCount as newLinkCount };

/** Count reads started; only the latest one's answer lands (a privacy change mid-read starts a newer one). */
let countReads = 0;

export async function refreshNewCount(): Promise<void> {
  const since = seenUpTo();
  if (!feedOn()) return;
  const read = ++countReads;
  const count = since === null ? 0 : sum(await pluginData(() => client.counts({ sinceTs: since }), {}));
  if (read === countReads) setNewCount(count);
}

export function onLinksShown(): void {
  setLinkDivider(seenUpTo());
}

/** Core stores the watermark for desktop and phone. Clears the count immediately, discards stale reads, and recounts after the setting change. */
export function markLinksSeen(): void {
  if (newCount() === 0 && seenUpTo() !== null) return;
  countReads++;
  setNewCount(0);
  void pluginData(() => client.markSeen(), undefined);
}

// Core or another window moved the watermark (createSetting, registered first, has already adopted it).
onAppEvent('setting-changed', (e) => {
  if (e.key === pluginSetting(plugin, 'seenUpTo')) void refreshNewCount();
});

void watermarkLoaded.then(() => {
  setLinkDivider((d) => d ?? seenUpTo());
  return refreshNewCount();
});

// Turned on while the app runs: count what's new.
containedRoot(() => createEffect(on(feedOn, (isOn) => isOn && void refreshNewCount(), { defer: true })));

onArchiveChange({ kinds: ['links', 'deletes'] }, refreshNewCount);
