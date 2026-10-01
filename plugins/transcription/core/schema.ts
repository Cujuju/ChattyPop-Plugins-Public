// Transcription's table: the queue and its results (the text itself is also the host's derived text). Adopted from
// `transcripts`, from when it was built in (the descriptor's adopts); its indexes followed the rename.
import { pluginTable } from '@plugin-sdk/shared';
import { plugin } from '../shared';

export const JOBS_TABLE = pluginTable(plugin, 'jobs');
