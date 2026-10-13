import { MS_PER_S, MS_PER_MIN, MS_PER_HOUR } from '@plugin-sdk/shared';

/** One decimal preserves fractional medians while keeping durations compact. */
const REPLY_DIGITS = 1;
const UNITS = [
  { unit: 'hour', span: MS_PER_HOUR }, { unit: 'minute', span: MS_PER_MIN }, { unit: 'second', span: MS_PER_S },
].map(({ unit, span }) => ({ span, format: new Intl.NumberFormat(undefined, { style: 'unit', unit, unitDisplay: 'long', maximumFractionDigits: REPLY_DIGITS }) }));

export function formatReplyDelay(ms: number): string {
  const unit = UNITS.find((unit) => ms >= unit.span) ?? UNITS.at(-1)!;
  return unit.format.format(ms / unit.span);
}
