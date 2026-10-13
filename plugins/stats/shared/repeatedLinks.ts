/** A URL enters the repeated-link ranking after its second share. */
export const REPEATED_LINK_MIN_SHARES = 2;

export interface RepeatedLink {
  url: string;
  host: string;
  shares: number;
  people: number;
}

export interface RepeatedLinksStats {
  urls: RepeatedLink[];
  reposts: { userId: string; count: number }[];
}
