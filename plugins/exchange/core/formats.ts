// Export formats. Each writes a file's head, its messages one at a time and its foot, so a channel of any size is written in pages.
import { timeFormat } from '@plugin-sdk/shared';
import type { ExportFormat } from '../shared/types';
import type { DceExport, DceMessage } from './dce';
import { count, exportTitle, htmlWriter, safeUrl, when } from './exportHtml';

/** What a file says about its channel before any message. */
export type ExportHead = Pick<DceExport, 'guild' | 'channel'> & { exportedAt: string };

export interface FormatWriter {
  /** File text before the first message. */
  head: string;
  /** One message's text, in the order written. */
  message(m: DceMessage): string;
  /** File text after the last of `written` messages. */
  foot(written: number): string;
}

const JSON_INDENT = 2;
const UTF8_BOM = '﻿';
/** RFC 4180's line ending. */
const CSV_LINE_END = '\r\n';
const CSV_COLUMNS = ['id', 'timestamp', 'edited', 'authorId', 'author', 'content', 'attachments', 'reactions', 'replyToId'];
/** A cell starting with one of these is run as a formula by spreadsheets (OWASP CSV injection). */
const FORMULA_LEAD = /^[=+\-@\t\r]/;
const CODE_FENCE = /```/g;
/** Characters Markdown reads as markup inside a line of plain text. */
const MARKDOWN_MARKUP = /[\\`*_[\]<>]/g;
/** Indent that keeps a following line inside its list item. */
const LIST_CONTINUATION = '  ';
const DAY = timeFormat({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const TIME = timeFormat({ hour: 'numeric', minute: '2-digit', second: '2-digit' });

const authorName = (m: DceMessage): string => m.author.nickname || m.author.name;
const reactionText = (m: DceMessage): string => (m.reactions ?? []).map((r) => `${r.emoji?.name ?? ''} ${count(r.count)}`.trim()).join(' · ');

/** DCE's document, written key by key so messages can be appended: the same text as JSON.stringify(doc, null, 2). */
function jsonWriter(doc: ExportHead): FormatWriter {
  const pad = ' '.repeat(JSON_INDENT);
  // A string's own line breaks are escaped, so every line break here is formatting.
  const nested = (v: unknown, depth: number): string => JSON.stringify(v, null, JSON_INDENT).replace(/\n/g, `\n${pad.repeat(depth)}`);
  let first = true;
  return {
    head: `{\n${pad}"guild": ${nested(doc.guild, 1)},\n${pad}"channel": ${nested(doc.channel, 1)},\n${pad}"exportedAt": ${JSON.stringify(doc.exportedAt)},\n${pad}"messages": [`,
    message: (m) => {
      const lead = first ? '\n' : ',\n';
      first = false;
      return `${lead}${pad}${pad}${nested(m, 2)}`;
    },
    foot: (written) => `${written ? `\n${pad}` : ''}],\n${pad}"messageCount": ${written}\n}`,
  };
}

function textWriter(doc: ExportHead): FormatWriter {
  return {
    head: `${exportTitle(doc)}\nExported from ChattyPop ${when(doc.exportedAt)}\n\n`,
    message: (m) => {
      const lines = [`[${when(m.timestamp)}] ${authorName(m)}${m.timestampEdited ? ' (edited)' : ''}`];
      if (m.reference?.messageId) lines.push('↪ reply');
      if (m.content) lines.push(m.content);
      for (const a of m.attachments ?? []) lines.push(`📎 ${a.fileName} ${a.url}`);
      for (const e of m.embeds ?? []) lines.push(...[[e.title, e.url].filter(Boolean).join(' '), e.description].filter((line): line is string => !!line));
      const reactions = reactionText(m);
      if (reactions) lines.push(reactions);
      return `${lines.join('\n')}\n\n`;
    },
    foot: (written) => `${written} messages\n`,
  };
}

const plain = (text: unknown): string => String(text ?? '').replace(MARKDOWN_MARKUP, '\\$&');
/** A link when the address is http(s) or a copied file's path, else its text alone. */
const markdownLink = (text: unknown, address: unknown): string => {
  const url = safeUrl(address);
  return url ? `[${plain(text)}](<${url.replace(/[<>\s]/g, encodeURIComponent)}>)` : plain(text);
};
/** Discord shows every line break; Markdown shows one only after two trailing spaces, and code fences keep theirs. */
const hardBreaks = (text: string): string => {
  let fenced = false;
  return text
    .split('\n')
    .map((line) => {
      const wasFenced = fenced;
      if ((line.match(CODE_FENCE)?.length ?? 0) % 2) fenced = !fenced;
      return wasFenced || fenced || !line ? line : `${line}  `;
    })
    .join('\n');
};

/** Message text stays as written: Discord's own markup is Markdown. */
function markdownWriter(doc: ExportHead): FormatWriter {
  let day = '';
  return {
    head: `# ${plain(exportTitle(doc))}\n\nExported from ChattyPop ${when(doc.exportedAt)}\n\n`,
    message: (m) => {
      const at = new Date(m.timestamp);
      const today = DAY.format(at);
      const blocks: string[] = [];
      if (today !== day) blocks.push(`## ${today}`);
      day = today;
      const lines = [`**${plain(authorName(m))}** · ${TIME.format(at)}${m.timestampEdited ? ' _(edited)_' : ''}${m.reference?.messageId ? ' · ↪ reply' : ''}  `];
      if (m.content) lines.push(hardBreaks(m.content));
      blocks.push(lines.join('\n'));
      const extras = [
        ...(m.attachments ?? []).map((a) => `- 📎 ${markdownLink(a.fileName, a.url)}`),
        ...(m.embeds ?? []).flatMap((e) => {
          const title = e.title || e.url ? markdownLink(e.title || e.url, e.url) : '';
          const parts = [title, e.description ? hardBreaks(e.description) : ''].filter(Boolean);
          return parts.length ? [`- ${parts.join('  \n').replace(/\n/g, `\n${LIST_CONTINUATION}`)}`] : [];
        }),
      ];
      if (extras.length) blocks.push(extras.join('\n'));
      const reactions = reactionText(m);
      if (reactions) blocks.push(plain(reactions));
      return `${blocks.join('\n\n')}\n\n`;
    },
    foot: (written) => `---\n\n${written} messages\n`,
  };
}

const csvCell = (value: unknown): string => {
  const text = String(value ?? '');
  return `"${(FORMULA_LEAD.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
};
const csvRow = (cells: unknown[]): string => `${cells.map(csvCell).join(',')}${CSV_LINE_END}`;

/** One row per message, every cell quoted; the byte-order mark tells spreadsheets the file is UTF-8. */
function csvWriter(): FormatWriter {
  return {
    head: `${UTF8_BOM}${csvRow(CSV_COLUMNS)}`,
    message: (m) =>
      csvRow([
        m.id,
        m.timestamp,
        m.timestampEdited,
        m.author.id,
        authorName(m),
        m.content,
        (m.attachments ?? []).map((a) => a.url).join('\n'),
        reactionText(m),
        m.reference?.messageId,
      ]),
    foot: () => '',
  };
}

export const FORMAT_WRITERS: Record<ExportFormat, (doc: ExportHead) => FormatWriter> = {
  html: htmlWriter,
  json: jsonWriter,
  txt: textWriter,
  md: markdownWriter,
  csv: csvWriter,
};
