// Tickers an image's text shows when it is a chart or quote, written as cashtags ($TSLA) after its text so the Trading
// label and rules read a chart as they read a message naming the ticker. Patterns come from this archive's charts' OCR.

/** A symbol as charts print it: letters first, then letters, digits, `.`, `/`, `!`, `-` (BRK.B, ES1!, BTC/USD). */
const SYMBOL = String.raw`[A-Z][A-Z0-9.\/!-]{0,11}`;
/** A price in an OHLC legend. */
const PRICE = String.raw`\$?[\d.,]+`;
/**
 * The legend charting tools draw: `LULU - O: 98.02 H: 101.77 L: 97.97 C: 100.96`, colons and separators optional, and
 * the O as OCR may read it (0).
 */
const OHLC_LEGEND = new RegExp(String.raw`(?<![A-Za-z0-9])(${SYMBOL})\s*[-–—·•:,]?\s*[O0]\s*:?\s*${PRICE}\s+H\s*:?\s*${PRICE}\s+L\s*:?\s*${PRICE}\s+C\s*:?\s*${PRICE}`, 'g');
/** Exchanges and venues charts prefix a symbol with (`NASDAQ: TMC`, `BINANCE:BTCUSDT`); Google's indexes too (`INDEXNYSEGIS: MOVE`). */
const EXCHANGES = ['NASDAQ', 'NYSE', 'AMEX', 'ARCA', 'NYSEARCA', 'BATS', 'CBOE', 'OTC', 'TSX', 'LSE', 'CME', 'CME_MINI', 'COMEX', 'NYMEX', 'CBOT', 'BINANCE', 'COINBASE', 'BYBIT', 'KRAKEN', 'BITSTAMP', 'OKX', 'INDEX[A-Z]*'];
const EXCHANGE_PREFIXED = new RegExp(String.raw`\b(?:${EXCHANGES.join('|')})\s*:\s*(${SYMBOL})`, 'g');
/** A candle chart's title, as Unusual Whales' bot draws it: `SPY - 1 Day Heikin Ashi Candles`. */
const CANDLE_TITLE = new RegExp(String.raw`^\s*(${SYMBOL})\s*-\s*\d+\s*(?:Min(?:ute)?|Hour|Day|Week|Month)s?\b`, 'gm');
/** An option contract: `TLT 83 C 11/30/2026`, `RKT $13.50 C 09/18/2026` (symbol, strike, call or put, expiry). */
const OPTION_CONTRACT = new RegExp(String.raw`(?<![A-Za-z0-9])(${SYMBOL})\s+\$?\d+(?:\.\d+)?\s*[CP]\s+\d{1,2}\/\d{1,2}\/\d{2,4}\b`, 'g');
/** A broker's quote header: the symbol on its own line, then price, change and percent (`216.28 +25.84 (+13.57%)`). */
const QUOTE_HEADER = new RegExp(String.raw`^[ \t]*(${SYMBOL})[ \t]*(?:[•·].*)?\n[ \t]*\$?[\d,]+\.\d+[ \t]+[+\-−][ \t]*\$?[\d,]+\.\d+[ \t]*\([+\-−]?[\d.]+%\)`, 'gm');
/** A symbol and its exchange on a line of their own, as Google Finance lists compared stocks: `PYPL NASDAQ`. */
const SYMBOL_EXCHANGE = new RegExp(String.raw`^[ \t]*(${SYMBOL})[ \t]+(?:${EXCHANGES.join('|')})[ \t]*$`, 'gm');
/** The legend TradingView draws: `TSLA · 1D · NASDAQ` (the dot read as ·, •, . or -). */
const TRADINGVIEW_LEGEND = new RegExp(String.raw`(?<![A-Za-z0-9])(${SYMBOL})\s*[·•.-]\s*(?:\d{1,3}[smhDWM]?|[DWM])\s*[·•.-]\s*(?:${EXCHANGES.join('|')})\b`, 'gi');
/** Quote currencies a crypto pair ends with; the ticker is what's before it (BTCUSDT → BTC). */
const QUOTE_SUFFIX = /(?:USDT|USDC|USD|PERP|\.P)$/;
/** What the Trading label's cashtag rule reads as a ticker (classes.ts CASHTAG): 1–5 letters, an optional class letter. */
const CASHTAG_SYMBOL = /^[A-Z]{1,5}(?:\.[A-Z])?$/;
/** Single letters OCR finds in an OHLC legend's own labels (O, H, L, C), never a symbol by themselves there. */
const LEGEND_LETTERS: ReadonlySet<string> = new Set(['O', 'H', 'L', 'C']);

/** A symbol as a cashtag's body, or null when it can't be one (futures like ES1!, or too long). */
export function tickerOf(symbol: string): string | null {
  const s = symbol.toUpperCase().replace(/[\/-]/g, '');
  const base = s.length > 3 && QUOTE_SUFFIX.test(s) ? s.replace(QUOTE_SUFFIX, '') : s;
  return CASHTAG_SYMBOL.test(base) ? base : null;
}

/** The tickers a chart's or quote's OCR text names, in order, each once. */
export function chartTickers(text: string): string[] {
  const found: string[] = [];
  for (const re of [OHLC_LEGEND, EXCHANGE_PREFIXED, TRADINGVIEW_LEGEND, CANDLE_TITLE, OPTION_CONTRACT, QUOTE_HEADER, SYMBOL_EXCHANGE]) {
    for (const m of text.matchAll(re)) {
      const t = tickerOf(m[1]!);
      if (t && !LEGEND_LETTERS.has(t) && !found.includes(t)) found.push(t);
    }
  }
  return found;
}

/**
 * The derived text of an image: what it says, then each ticker it shows (an engine's, else those its text names) as a
 * cashtag the text doesn't already carry. '' when it shows neither.
 */
export function imageText(text: string, tickers: readonly string[]): string {
  const clean = text.trim();
  const named = [...new Set([...tickers.map(tickerOf), ...chartTickers(clean)].filter((t): t is string => t !== null))];
  const tags = named.filter((t) => !new RegExp(String.raw`(?<![\w$])\$${t.replace('.', '\\.')}(?![\w])`).test(clean)).map((t) => `$${t}`);
  return [clean, tags.join(' ')].filter(Boolean).join('\n');
}
