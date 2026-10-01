// Codex's renderer side: its cost note in Settings → AI.
import { defineRendererPlugin, type ProviderView } from '@plugin-sdk/renderer';
import { aiText } from '@plugin-sdk/renderer/kit';
import { plugin } from '../shared';
import { overheadNote } from './overhead';

const codex: ProviderView = {
  // Only once Codex listed models: its sign-in works and calls will run.
  note: (s) => (s.models ? overheadNote(aiText().requests) : undefined),
};

export default defineRendererPlugin(plugin, { providers: { codex } });
