import { describe, expect, it } from 'vitest';
import { modelFacts } from '../core/modelFacts';

describe('a Claude model line', () => {
  it('lists its price apart from what the model is', () => {
    expect(modelFacts('Haiku 5.5 · Fastest for quick answers · $0.10/$0.50 per Mtok ($0.50/$2.50 for prompts over 100k)')).toEqual({
      description: 'Haiku 5.5 · Fastest for quick answers',
      price: '$0.10/$0.50 per Mtok ($0.50/$2.50 for prompts over 100k)',
    });
  });

  it('is all description without a price', () => {
    expect(modelFacts('Use the default model (currently Opus 5.5)')).toEqual({ description: 'Use the default model (currently Opus 5.5)' });
  });

  it('is nothing when Claude Code gives no line', () => {
    expect(modelFacts(undefined)).toEqual({});
    expect(modelFacts('')).toEqual({});
  });
});
