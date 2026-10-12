// Claude Code words a model as one line of facts ("Haiku 5.5 · Fastest for quick answers · $0.10/$0.50 per Mtok"); ChattyPop lists its price apart.
import type { ModelOption } from '@plugin-sdk/shared';

/** What Claude Code joins a model's facts with. */
const FACT_SEPARATOR = ' · ';
/** A fact that states a price: it carries a dollar amount. */
const PRICE = /\$\d/;

/** A model line's description and price; a line without a price is all description. */
export function modelFacts(line: string | undefined): Pick<ModelOption, 'description' | 'price'> {
  const facts = (line ?? '').split(FACT_SEPARATOR).filter(Boolean);
  const description = facts.filter((f) => !PRICE.test(f)).join(FACT_SEPARATOR);
  const price = facts.filter((f) => PRICE.test(f)).join(FACT_SEPARATOR);
  return { ...(description ? { description } : {}), ...(price ? { price } : {}) };
}
