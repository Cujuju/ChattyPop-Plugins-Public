// Line icons for link platforms, on the icons' 24-unit grid (look.lineIcon strokes them). A platform without one shows
// its text badge. YouTube, Instagram and Twitch are after Lucide (ISC); Bluesky and Threads after Tabler Icons (MIT);
// the rest are drawn here.
import type { Platform } from '@plugin-sdk/shared';

export const PLATFORM_ICON_PATHS: Partial<Record<Platform, string>> = {
  youtube:
    'M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17M10 15l5-3-5-3z',
  // Snoo: the head, its antenna and ball, two eyes and a smile.
  reddit:
    'M12 9.5c-4.7 0-8.5 2.3-8.5 5.2S7.3 20 12 20s8.5-2.4 8.5-5.3-3.8-5.2-8.5-5.2zM12 9.5l1.1-5 3.9.9M17 5.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0zM8 14a1 1 0 1 0 2 0 1 1 0 0 0-2 0zM14 14a1 1 0 1 0 2 0 1 1 0 0 0-2 0zM9.5 17c1.6.9 3.4.9 5 0',
  x: 'M4 4l11.7 16H20L8.3 4zM4 20l6.8-7.4M20 4l-6.8 7.4',
  instagram: 'M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zM16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37zM17 6.5a.5.5 0 1 0 1 0 .5.5 0 0 0-1 0z',
  bluesky:
    'M6.335 5.144c-1.654-1.199-4.335-2.127-4.335.826 0 .59.35 4.953.556 5.661.713 2.463 3.13 2.75 5.444 2.369-4.045.665-4.889 3.208-2.667 5.41 1.03 1.018 1.913 1.59 2.667 1.59 2 0 3.134-2.769 3.5-3.5.333-.667.5-1.167.5-1.5 0 .333.167.833.5 1.5.366.731 1.5 3.5 3.5 3.5.754 0 1.637-.571 2.667-1.59 2.222-2.203 1.378-4.746-2.667-5.41 2.314.38 4.73.094 5.444-2.369.206-.708.556-5.072.556-5.661 0-2.953-2.68-2.025-4.335-.826-2.293 1.662-4.76 5.048-5.665 6.856-.905-1.808-3.372-5.194-5.665-6.856z',
  // A note: its head, stem and flag.
  tiktok: 'M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5',
  twitch: 'M21 2H3v16h5v4l4-4h5l4-4V2zM11 11V7M16 11V7',
  threads:
    'M19 7.5c-1.333-3-3.667-4.5-7-4.5-5 0-8 2.5-8 9s3.5 9 8 9 7-3 7-5-1-5-7-5c-2.5 0-3 1.25-3 2.5 0 1.5 1 2.5 2.5 2.5 2.5 0 3.5-1.5 3.5-5s-2-4-3-4-1.833.333-2.5 1',
  // Any other site: a globe.
  other: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20',
};
