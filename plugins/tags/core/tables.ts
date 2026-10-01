// Tables adopted from the host through the Tags descriptor.
import { pluginTable } from '@plugin-sdk/shared';
import { plugin } from '../shared';

/** The owner's tag definitions. */
export const TAGS = pluginTable(plugin, 'tags');
/** Tag membership and application source for each message. */
export const MESSAGE_TAGS = pluginTable(plugin, 'message_tags');
