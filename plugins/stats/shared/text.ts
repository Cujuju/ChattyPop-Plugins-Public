export interface TextCoverage {
  /** Visible messages with nonempty retained content read by this call. */
  textMessages: number;
}

export interface EmojiCount {
  id: string | null;
  name: string;
  animated: boolean;
  count: number;
}

export interface EmojiStats extends TextCoverage {
  custom: number;
  unicode: number;
  unicodeMatcher: 'RGI_Emoji' | 'Extended_Pictographic';
  emoji: EmojiCount[];
}
