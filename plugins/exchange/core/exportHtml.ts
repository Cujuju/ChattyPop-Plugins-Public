// Standalone HTML page for an exported channel: readable offline in any browser, no scripts, no remote styles.
// Styling lives here because the page leaves the app: it can't use the app's theme tokens.
import type { DceExport, DceMessage } from './dce';

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|avif)$/i;

const PAGE_CSS = `
  body { margin: 0; background: #1e1f22; color: #dbdee1; font: 15px/1.4 "Segoe UI", system-ui, sans-serif; }
  header { position: sticky; top: 0; padding: 12px 20px; background: #2b2d31; border-bottom: 1px solid #111214; }
  header h1 { margin: 0; font-size: 16px; } header p { margin: 2px 0 0; color: #949ba4; font-size: 12px; }
  main { padding: 8px 20px 40px; max-width: 960px; }
  .msg { padding: 6px 0; border-bottom: 1px solid #26282c; }
  .meta { color: #949ba4; font-size: 12px; } .author { color: #f2f3f5; font-weight: 600; font-size: 15px; margin-right: 6px; }
  .text { white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 2px; }
  .reply { color: #949ba4; font-size: 12px; } .edited { color: #949ba4; font-size: 11px; }
  .att img { max-width: 480px; max-height: 360px; border-radius: 6px; margin-top: 4px; display: block; }
  .embed { border-left: 4px solid #4e5058; background: #2b2d31; border-radius: 4px; padding: 8px 12px; margin-top: 4px; max-width: 520px; }
  .embed .t { font-weight: 600; } .embed img { max-width: 100%; border-radius: 4px; margin-top: 6px; }
  .reactions span { display: inline-block; background: #2b2d31; border-radius: 8px; padding: 1px 6px; margin: 4px 4px 0 0; font-size: 12px; }
  a { color: #00a8fc; }
`;

/**
 * Scripts never run in the page, whatever a payload smuggles past escaping (inline, javascript: links, plugins); styles,
 * images and links stay as they are.
 */
const PAGE_CSP = "script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
/** Link and image schemes the page may use; a URL with no scheme is a copied media file's relative path. */
const SAFE_SCHEMES = new Set(['http:', 'https:']);
const URL_SCHEME = /^([a-z][a-z\d+.-]*):/i;
/** An embed's side color as DCE writes it; anything else could carry CSS. */
const HEX_COLOR = /^#[\da-f]{6}$/i;

/** Every interpolation goes through here: text of any type, escaped for element text and quoted attributes. */
const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
/** `u` when it is an http(s) URL or a relative path, else null. Browsers ignore leading spaces and control characters. */
const safeUrl = (u: unknown): string | null => {
  if (typeof u !== 'string') return null;
  const scheme = URL_SCHEME.exec(u.replace(/[\u0000-\u0020]/g, ''))?.[1];
  return scheme === undefined || SAFE_SCHEMES.has(`${scheme.toLowerCase()}:`) ? u : null;
};
const when = (iso: unknown): string => new Date(String(iso)).toLocaleString();
/** A reaction count: a whole number, else nothing. */
const count = (n: unknown): string => (Number.isSafeInteger(n) ? String(n) : '');

function renderMessage(m: DceMessage): string {
  const author = m.author.nickname || m.author.name;
  const parts = [`<div class="meta"><span class="author">${esc(author)}</span>${esc(when(m.timestamp))}</div>`];
  if (m.reference?.messageId) parts.push(`<div class="reply">↪ reply to <a href="#m${esc(m.reference.messageId)}">a message</a></div>`);
  if (m.content)
    parts.push(`<div class="text">${esc(m.content)}${m.timestampEdited ? ` <span class="edited">(edited ${esc(when(m.timestampEdited))})</span>` : ''}</div>`);
  for (const a of m.attachments ?? []) {
    const url = safeUrl(a.url);
    parts.push(
      url === null
        ? `<div class="att">📎 ${esc(a.fileName)}</div>`
        : IMAGE_FILE.test(String(a.fileName))
          ? `<div class="att"><a href="${esc(url)}"><img src="${esc(url)}" alt="${esc(a.fileName)}" loading="lazy"></a></div>`
          : `<div class="att">📎 <a href="${esc(url)}">${esc(a.fileName)}</a></div>`,
    );
  }
  for (const e of m.embeds ?? []) {
    const url = safeUrl(e.url);
    const title = e.title
      ? url
        ? `<a class="t" href="${esc(url)}">${esc(e.title)}</a>`
        : `<div class="t">${esc(e.title)}</div>`
      : url
        ? `<a href="${esc(url)}">${esc(url)}</a>`
        : '';
    const img = safeUrl(e.images?.[0]?.url ?? e.thumbnail?.url);
    const color = typeof e.color === 'string' && HEX_COLOR.test(e.color) ? e.color : null;
    parts.push(
      `<div class="embed"${color ? ` style="border-left-color:${color}"` : ''}>${e.author?.name ? `<div class="meta">${esc(e.author.name)}</div>` : ''}${title}${e.description ? `<div class="text">${esc(e.description)}</div>` : ''}${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ''}</div>`,
    );
  }
  if (m.reactions?.length) parts.push(`<div class="reactions">${m.reactions.map((r) => `<span>${esc(r.emoji?.name)} ${count(r.count)}</span>`).join('')}</div>`);
  return `<article class="msg" id="m${esc(m.id)}">${parts.join('')}</article>`;
}

export function renderHtml(doc: DceExport): string {
  const title = `${doc.guild.name ? `${doc.guild.name} · ` : ''}#${doc.channel.name}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${PAGE_CSS}</style></head>
<body><header><h1>${esc(title)}</h1><p>${doc.messages.length} messages · exported from ChattyPop ${esc(when(doc.exportedAt ?? new Date().toISOString()))}</p></header>
<main>${doc.messages.map(renderMessage).join('\n')}</main></body></html>`;
}
