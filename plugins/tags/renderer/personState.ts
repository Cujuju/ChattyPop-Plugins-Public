// Per-person tag resources, scoped to the mounted person section.
import { onCleanup } from 'solid-js';
import { onAppEvent, onEvent, pluginResource } from '@plugin-sdk/renderer';
import { plugin } from '../shared';

/** Refreshes visible tag counts when definitions, memberships or privacy change. */
export function createPersonTags(userId: () => string) {
  const values = pluginResource(plugin, 'personTags', () => {
    const id = userId();
    return id ? [id] : null;
  }, []);
  onCleanup(onEvent(plugin, 'changed', () => void values.refetch()));
  onCleanup(onAppEvent('privacy-changed', () => void values.refetch()));
  return values;
}
