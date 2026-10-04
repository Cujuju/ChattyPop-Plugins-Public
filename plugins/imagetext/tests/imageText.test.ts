// Image text (#196): charts' tickers as cashtags, and the plugin reading an embed's image through main end to end.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { testPlugin } from '@plugin-sdk/core/testing';
import type { CompletionRequest, LlmProvider } from '@core/ai/types';
import { IS_WINDOWS } from '@core/ai/resolveCli';
import { tempDir } from '@chattypop/host-testing';
import imageTextCore from '../core';
import { chartTickers, imageText, tickerOf } from '../core/chartTickers';
import { counts, JOBS_TABLE } from '../core/store';
import { WindowsOcr } from '../core/windowsOcr';
import { DEFAULT_IMAGE_TEXT_SETTINGS } from '../shared/types';

/** Starting the Windows OCR worker (status() does) takes seconds on a loaded machine or a CI runner. */
const OCR_START_TIMEOUT_MS = 60_000;

describe('chart tickers', () => {
  // Lines as Windows OCR read them from this archive's charts and trading screens.
  it.each([
    ['LULU - O: 98.02 H: 101.77 L: 97.97 C: 100.96 Vol: 4.5M', ['LULU']],
    ['BURL - O: 257.22 H: 257.22 L: 239.0 C: 239.18 vol•. 1.9M', ['BURL']],
    ['NVDA - 0 181.2 H: 184.9 L: 180.1 C: 184.0', ['NVDA']],
    ['NASDAQ: TMC', ['TMC']],
    ['Merrill Lynch Option Volatility Estimate\nINDEXNYSEGIS: MOVE', ['MOVE']],
    ['SPY - 1 Day Heikin Ashi Candles (Extended Market Times)', ['SPY']],
    ['Contract: TLT 67 P 06/16/2028 (630D)', ['TLT']],
    ['RKT $13.50 C 09/18/2026 summary', ['RKT']],
    ['CBRS • 10\n216.28 +25.84 (+13.57%)', ['CBRS']],
    ['iShares 20+ Year Treasury ETF\nTLT NASDAQ\nPayPal Holdings, Inc.\nPYPL NASDAQ', ['TLT', 'PYPL']],
    ['BINANCE:BTCUSDT', ['BTC']],
    ['TSLA · 1D · NASDAQ', ['TSLA']],
  ])('%j → %j', (text, tickers) => {
    expect(chartTickers(text)).toEqual(tickers);
  });

  it.each([
    // A fund's name above its price, as Google Finance draws it: no symbol.
    'iShares 20+ Year Treasury Bond\nETF\n$79.63\n-$7.78 (-8.90%)',
    'Ranked Solo/Duo W:263 - L:259',
    'Sunny\nH:750 L:480',
    'Volume normalisation',
  ])('none in %j', (text) => {
    expect(chartTickers(text)).toEqual([]);
  });

  it('writes tickers as cashtags the text lacks, so the Trading label reads a chart', () => {
    expect(imageText('AAPL - O: 315.23 H: 318.13 L: 310.97 C: 311.36', [])).toBe('AAPL - O: 315.23 H: 318.13 L: 310.97 C: 311.36\n$AAPL');
    expect(imageText('$MDB down 16%', ['MDB'])).toBe('$MDB down 16%');
    expect(imageText('a chart', ['es1!', 'nvda', 'BTCUSD'])).toBe('a chart\n$NVDA $BTC');
    expect(imageText('  ', [])).toBe('');
    expect(tickerOf('BRK.B')).toBe('BRK.B');
    expect(tickerOf('TOOLONG')).toBeNull();
  });
});

describe('the Image text plugin', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  /** What the fake model translates to: a function of the text, or an error to throw. */
  type Translating = { language: string; translation: string } | Error;

  /** A provider answering an image with `reading` and text with `translating`, recording what it was sent. */
  function vision(reading: { text: string; tickers: string[] }, translating: Translating = { language: 'Japanese', translation: 'translated' }) {
    const sent: CompletionRequest[] = [];
    const provider: LlmProvider = {
      id: 'eyes',
      maxInputChars: 10_000,
      complete: async (req) => {
        sent.push(req);
        const answer = req.images?.length ? reading : translating;
        if (answer instanceof Error) throw answer;
        return { text: JSON.stringify(answer), json: answer };
      },
      listModels: async () => [{ id: 'vl', label: 'vl', images: true }],
    };
    return { sent, provider };
  }

  function start(images: boolean, reading = { text: 'Tesla chart', tickers: ['TSLA'] }, opts: { translate?: boolean; translating?: Translating } = {}) {
    const v = vision(reading, opts.translating);
    const t = testPlugin(imageTextCore, {
      archive: { channels: [{ id: 'c1' }] },
      ai: { providers: [{ id: 'eyes', local: true, images, provider: v.provider }] },
      preferences: {
        settings: { ...DEFAULT_IMAGE_TEXT_SETTINGS, engine: 'vision', visionProvider: 'eyes', visionModel: 'vl', translate: opts.translate ?? false, translateProvider: 'eyes', translateModel: 'tx' },
      },
    });
    onTestFinished(() => t.dispose());
    const [id] = t.archive.arrive([{ channelId: 'c1', content: 'look', extra: { embeds: [{ type: 'image', url: 'https://i.example/c.png', thumbnail: { proxy_url: 'https://media.discordapp.net/c.png' } }] } }]);
    return { t, id: id!, sent: v.sent };
  }

  /** Main's side: writes the image where core asked and reports it. */
  async function fetchAsMain(t: ReturnType<typeof start>['t']): Promise<void> {
    await vi.waitFor(() => expect(t.events('fetchImage')).toHaveLength(1));
    const r = t.events('fetchImage')[0]!;
    expect(r).toMatchObject({ kind: 'shown', url: 'https://media.discordapp.net/c.png' });
    writeFileSync(r.path, PNG);
    await t.client('main').imageFetched(r.requestId, null);
  }

  it('reads an embed’s image through main, and its text and tickers become the message’s derived text', async () => {
    const { t, id, sent } = start(true);
    await fetchAsMain(t);
    const derived = () => t.db.prepare('SELECT text FROM derived_texts WHERE message_id = ?').pluck().all(id);
    await vi.waitFor(() => expect(derived()).toEqual(['Tesla chart\n$TSLA']));
    expect(sent[0]).toMatchObject({ model: 'vl', images: [{ mediaType: 'image/png', data: PNG.toString('base64') }] });
    expect(await t.client('renderer').status()).toMatchObject({ vision: { ready: true }, providers: [{ id: 'eyes', models: [{ id: 'vl' }] }], counts: { done: 1 } });
  }, OCR_START_TIMEOUT_MS);

  it('two messages showing the same image each keep their own text', async () => {
    const { t, id } = start(true);
    await fetchAsMain(t);
    const [second] = t.archive.arrive([{ channelId: 'c1', content: 'again', extra: { embeds: [{ type: 'image', url: 'https://i.example/c.png', thumbnail: { proxy_url: 'https://media.discordapp.net/c.png' } }] } }]);
    await vi.waitFor(() => expect(t.events('fetchImage')).toHaveLength(2));
    const r = t.events('fetchImage')[1]!;
    writeFileSync(r.path, PNG);
    await t.client('main').imageFetched(r.requestId, null);
    const owners = () => t.db.prepare('SELECT message_id FROM derived_texts ORDER BY seq').pluck().all();
    await vi.waitFor(() => expect(owners()).toEqual([id, second]));
  });

  it('a request with a picked model reads with it this once; Settings keep their own', async () => {
    const { t, id, sent } = start(true);
    await fetchAsMain(t);
    await vi.waitFor(() => expect(counts(t.db).done).toBe(1));
    await t.client('renderer').request(id, { engine: 'vision', provider: 'eyes', model: 'other' });
    await vi.waitFor(() => expect(t.events('fetchImage')).toHaveLength(2));
    const r = t.events('fetchImage')[1]!;
    writeFileSync(r.path, PNG);
    await t.client('main').imageFetched(r.requestId, null);
    await vi.waitFor(() => expect(sent.map((s) => s.model)).toEqual(['vl', 'other']));
    expect(t.preferences.get('settings')).toMatchObject({ visionModel: 'vl' });
  });

  it('refuses a pick that is no engine, or whose provider can’t run', async () => {
    const { t, id } = start(true);
    await expect(t.client('renderer').request(id, { engine: 'vision', provider: 'eyes' } as never)).rejects.toThrow();
    await expect(t.client('renderer').request(id, { engine: 'vision', provider: 'missing', model: 'x' })).rejects.toThrow();
  });

  const derivedOf = (t: ReturnType<typeof start>['t'], id: string) => t.db.prepare('SELECT text FROM derived_texts WHERE message_id = ?').pluck().all(id);

  it('translates each reading automatically with the translation model, keeping the text too', async () => {
    const { t, id, sent } = start(true, undefined, { translate: true });
    await fetchAsMain(t);
    await vi.waitFor(() => expect(derivedOf(t, id)).toEqual(['Tesla chart\n$TSLA\ntranslated']));
    expect(sent[1]).toMatchObject({ model: 'tx' });
    expect(sent[1]!.prompt).toContain('the whole text in English');
  });

  it('keeps only the text when it is already in the language', async () => {
    const { t, id } = start(true, undefined, { translate: true, translating: { language: 'English', translation: 'Tesla chart, in English' } });
    await fetchAsMain(t);
    await vi.waitFor(() => expect(derivedOf(t, id)).toEqual(['Tesla chart\n$TSLA']));
  });

  it('a failed translation keeps the reading and notes why', async () => {
    const { t, id } = start(true, undefined, { translate: true, translating: new Error('model gone') });
    await fetchAsMain(t);
    await vi.waitFor(() => expect(derivedOf(t, id)).toEqual(['Tesla chart\n$TSLA']));
    expect(t.db.prepare(`SELECT state, translation_error FROM ${JOBS_TABLE}`).get()).toEqual({ state: 'done', translation_error: 'model gone' });
  });

  it('Translate image text translates the text already read, without reading the image again', async () => {
    const { t, id, sent } = start(true);
    await fetchAsMain(t);
    await vi.waitFor(() => expect(derivedOf(t, id)).toEqual(['Tesla chart\n$TSLA']));
    await t.client('renderer').translate(id, { provider: 'eyes', model: 'tx' });
    await vi.waitFor(() => expect(derivedOf(t, id)).toEqual(['Tesla chart\n$TSLA\ntranslated']));
    expect(t.events('fetchImage')).toHaveLength(1);
    expect(sent.map((s) => s.model)).toEqual(['vl', 'tx']);
  });

  it('a provider not declared to read images refuses them: the job fails, nothing is sent', async () => {
    const { t, sent } = start(false);
    await fetchAsMain(t);
    // The queue's own counts: status() also starts the Windows OCR worker, seconds on a loaded machine.
    await vi.waitFor(() => expect(counts(t.db).failed).toBe(1));
    expect(sent).toEqual([]);
  });
});

describe.runIf(IS_WINDOWS)('Windows OCR', () => {
  it('reads an image’s text through its worker, and says why a missing file can’t be read', async () => {
    const dir = tempDir();
    const png = join(dir, 'quote.png');
    // A quote drawn by Windows itself, as a screenshot would show it.
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Drawing; $b = New-Object Drawing.Bitmap 640,120; $g = [Drawing.Graphics]::FromImage($b); $g.Clear([Drawing.Color]::White); $g.DrawString('NVDA - O: 181.2 H: 184.9 L: 180.1 C: 184.0', (New-Object Drawing.Font 'Arial',20), [Drawing.Brushes]::Black, 10, 40); $b.Save('${png}', [Drawing.Imaging.ImageFormat]::Png)`]);
    const ocr = new WindowsOcr(dir);
    onTestFinished(() => ocr.dispose());
    const text = await ocr.read(png, new AbortController().signal);
    expect(chartTickers(text)).toEqual(['NVDA']);
    await expect(ocr.read(join(dir, 'missing.png'), new AbortController().signal)).rejects.toThrow();
    expect(await ocr.status()).toMatchObject({ ready: true });
  }, OCR_START_TIMEOUT_MS);
});
