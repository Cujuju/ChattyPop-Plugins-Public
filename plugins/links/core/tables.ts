// Its tables, adopted from the host (where they were created before Links was a plugin): the descriptor's adopts.
import { pluginTable } from '@plugin-sdk/shared';
import { plugin } from '../shared';

/** Jev's reading of each link, keyed by URL (#61–#63). */
export const JUDGMENTS = pluginTable(plugin, 'judgments');
/** FxTwitter posts by status id, with how the fetch went. */
export const X_POSTS = pluginTable(plugin, 'x_posts');
