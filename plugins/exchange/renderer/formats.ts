// The export formats as the owner reads them, in Settings and in the Archive's selection action.
import type { ExportFormat } from '../shared/types';

export type { ExportFormat };

export const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'html', label: 'HTML page' },
  { value: 'json', label: 'JSON (DiscordChatExporter)' },
  { value: 'txt', label: 'Plain text' },
  { value: 'md', label: 'Markdown' },
  { value: 'csv', label: 'CSV (spreadsheet)' },
];
