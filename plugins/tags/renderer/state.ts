// Tags' renderer state and plugin channel clients.
import { desktopCoreClient, onAppEvent, onEvent, pluginData, pluginResource } from '@plugin-sdk/renderer';
import { jevSwitch, showPanel } from '@plugin-sdk/renderer/kit';
import { plugin } from '../shared';
import { createSignal } from 'solid-js';
import type { TagInput, TagRangeRequest, TagRangeResult } from '../shared/types';

/** Tagged messages listed under the open tag. */
const TAGGED_PAGE_SIZE = 100;
/** Where the Tags panel goes when something asks for it and the layout lacks it: under Alerts, else Summary, else its window. */
const TAGS_PANEL_ANCHORS = ['alerts', 'summary'] as const;
/** Editing tags and running Jev over a range: the Tags panel's and message menu's calls, served to desktop windows only. */
const desktop = desktopCoreClient(plugin);

/** Settings → Jev → Your own tags: Jev applies tags only while it is on. */
export const customTags = jevSwitch(plugin, 'customTags');

/** Active plugin tags, refreshed on definition or membership changes. */
export const tags = pluginResource(plugin, 'tags', () => [], []);

/** The tag open in the Tags panel's editor; 'new' = a tag being created; null = none. */
export const [editingTag, setEditingTag] = createSignal<number | 'new' | null>(null);

/** Visible messages carrying the selected tag. */
export const taggedMessages = pluginResource(plugin, 'taggedMessages', () => {
  const id = editingTag();
  return typeof id === 'number' && [id, TAGGED_PAGE_SIZE];
}, []);

/** Channel preselected in the range runner (channel menu → Tag messages with Jev…). */
export const [tagRangeChannel, setTagRangeChannel] = createSignal<string | null>(null);

onAppEvent(
  'privacy-changed',
  () => {
    void tags.refetch(); // counts cover visible messages only
    void taggedMessages.refetch();
  },
);

onEvent(
  plugin,
  'changed',
  () => {
    void tags.refetch();
    void taggedMessages.refetch();
  },
);

/** Creates a tag and opens its editor. */
export async function createTag(input: TagInput): Promise<void> {
  setEditingTag(await desktop.createTag(input));
  await tags.refetch();
}

/** Saves the selected tag definition. */
export async function saveTag(id: number, input: TagInput): Promise<void> {
  await desktop.updateTag(id, input);
  await tags.refetch();
}

/** Deletes a definition and closes its editor. */
export async function deleteTag(id: number): Promise<void> {
  await desktop.deleteTag(id);
  setEditingTag(null);
  await tags.refetch();
}

/** Applies or removes the owner’s manual choice. */
export const setMessageTag = (messageId: string, tagId: number, on: boolean): Promise<void> => desktop.setMessageTag(messageId, tagId, on);

/** Messages a range run would ask Jev about. */
export const tagRangeCount = (r: TagRangeRequest): Promise<number> => pluginData(() => desktop.tagRangeCount(r), 0);
/** Asks Jev the chosen tags' questions over a range and applies the answers. */
export const runTagRange = (r: TagRangeRequest): Promise<TagRangeResult> => desktop.tagRange(r);

/** Shows the Tags panel, adding it to the layout when missing. */
export const showTagsPanel = (): void => showPanel('tags', TAGS_PANEL_ANCHORS);

/** Shows the Tags panel with the range runner set to this channel. */
export function openTagRange(channelId: string): void {
  setTagRangeChannel(channelId);
  showTagsPanel();
}

/** Shows the Tags panel with a new tag's editor open. */
export function startNewTag(): void {
  setEditingTag('new');
  showTagsPanel();
}
