# Large archive benchmark (opt in)

Run from `E:\Development\Projects\ChattyPop` in PowerShell. Neither normal tests nor `plugin:check` execute this runner.

```powershell
node E:\Development\Projects\ChattyPop-Plugins-Public\plugins\stats\tests\bench\run.mjs E:\Development\Projects\ChattyPop E:\Development\Projects\ChattyPop-Plugins-Public\plugins\stats 400000
```

The optional arguments after the row count are a function name (default `all`), an absolute directory for V8 `.cpuprofile` files, and an author id (omitted or empty: Everyone). The fixture author `u0` exercises a person filter. Functions: `activityStats`, `peopleStats`, `repeatedLinks`, `emojiStats`, `wordStats`, `sentimentStats`, `conversationStats`. Repeat at `100000`, `200000`, `400000` to compare scaling. Run serially, with no competing benchmark. The target plugin path may be an older detached worktree; functions absent there are reported as unavailable.

Each run creates and disposes a temporary **plugin test host** database with the current host's migrations, indexes, privacy-aware archive views, WAL mode, FTS triggers and `better-sqlite3-multiple-ciphers` driver. No profile or real archive is accessed. It inserts fixture rows directly through the test database adapter; it does not time ingestion or retain raw Discord payloads, attachments, derived text or link previews.

The fixed-seed archive has one channel, 30 authors, a 390-day span, 40k possible long-tail words, 16% link-bearing messages, roughly 96% nonblank messages, and reverse-time history ingestion. Message lengths mix short/medium/long prose and a small long tail. Assumption: this length mixture (about 84 characters per message) is representative; the observed archive's actual distribution was not available and is not claimed to match.

The test database is **unencrypted**, unlike a keyed app database. It holds 400k rows successfully. Numbers isolate core function costs on this synthetic shape, including SQLite reads and cooperative yields. They do not predict encryption overhead, concurrent history backfill, privacy with many hidden ids, other channels, runtime differences between Node and Electron, IPC, renderer layout, or abandoned scans after changing sections.

JSON output gives wall milliseconds, process V8 heap peak and baseline in MiB, ArrayBuffer peak, SQL time, per-statement query plans, and longest event-loop heartbeat gap. Heap measurements combine 5ms samples, SQL boundaries, function completion and V8 pre-GC sizes; this is the highest observed heap, excludes native SQLite memory and ArrayBuffers, and is not RSS. The fresh child runs with `--expose-gc --trace-gc-nvp`; collection happens **before** timing each function. No explicit GC happens within measured work. Profiler startup, fixture seeding, loader startup and cleanup are outside wall time. Query-plan instrumentation and sampling overhead are included. Keep profiler settings the same when comparing runs.

The heartbeat queues `setImmediate` while the function runs; its longest gap is an upper bound on an uninterrupted slice (also includes scheduling and measurement overhead). `yields` verifies that unrelated queued core work can execute during scanning. Synchronous SQL-only sections are reported too and have no yields.

To reproduce a historical comparison, create a detached worktree outside the shared checkout, pass its absolute `plugins\stats` path to this same runner, then remove that worktree. Do not switch the shared branch or install dependencies; the runner reuses this plugin's and the host's existing packages. Before rounds A/B (`b60bc4c`), `peopleStats` and `repeatedLinks` did not exist.

## Recorded results — 2026-10-12

AMD Ryzen 9 5950X, Windows, Node v24.21.0. Host 7aa6004; fixed core 37f88af. Runs serial, same fixture, CPU profiling enabled. Exact measurements: E:/Development/Projects/ChattyPop-Plugins-Public/plugins/stats/tests/bench/results.json.

Before rounds A/B (`b60bc4c`), 400k:

| Function | Wall seconds | Peak heap MiB |
|---|---:|---:|
| activityStats | 14.369 | 51.7 |
| peopleStats | N/A | N/A |
| repeatedLinks | N/A | N/A |
| emojiStats | 117.400 | 50.4 |
| wordStats | 121.334 | 57.0 |
| sentimentStats | 125.663 | 51.8 |
| conversationStats | 110.749 | 49.3 |

At the supplied HEAD (`736c869`), 400k:

| Function | Wall seconds | Peak heap MiB |
|---|---:|---:|
| activityStats | 17.471 | 48.8 |
| peopleStats | 0.882 | 42.3 |
| repeatedLinks | 2.501 | 35.2 |
| emojiStats | 134.860 | 37.2 |
| wordStats | 135.418 | 345.6 |
| sentimentStats | 134.374 | 85.9 |
| conversationStats | 124.543 | 45.6 |

After fixes, each cell is wall seconds / observed V8 heap MiB:

| Function | 100k seconds / MiB | 200k seconds / MiB | 400k seconds / MiB |
|---|---:|---:|---:|
| activityStats | 1.107 / 51.4 | 5.465 / 51.3 | 11.060 / 51.4 |
| peopleStats | 0.201 / 67.3 | 0.405 / 67.2 | 0.738 / 67.2 |
| repeatedLinks | 0.082 / 37.9 | 0.210 / 37.9 | 0.378 / 37.9 |
| emojiStats | 0.476 / 89.0 | 1.004 / 89.1 | 1.908 / 89.2 |
| wordStats | 2.042 / 118.4 | 4.821 / 111.7 | 8.158 / 122.3 |
| sentimentStats | 1.462 / 94.1 | 3.243 / 90.8 | 5.771 / 91.0 |
| conversationStats | 0.342 / 89.1 | 0.796 / 89.1 | 1.547 / 89.1 |

People history and repeated links did not exist at b60bc4c; N/A is not zero.

### Profile findings and changes

1. **SQL batch reads/sorts dominate.** SQL consumes 94.4–99.7% of the four streaming functions at 736c869. Channel text pages use `messages_channel_author (channel_id=?)`, then `USE TEMP B-TREE FOR ORDER BY`; they do not seek the sequence cursor. Conversations also traverses and sorts the remaining channel for each time page. Roughly 800 pages repeatedly revisit the channel. This plan already exists at b60bc4c: the main failure is scale, with additional word-history memory introduced in A/B.
2. **Tokenizing is the largest remaining Words CPU cost.** ICU segmentation is preserved; direct iteration avoids materializing all segment objects before filtering. Eligibility is cached once per distinct word in the history reducer. Length ranking was already bounded by the output limit.
3. **Word-history allocation/finishing was secondary waste.** Previously, a nested word map was retained for every message timestamp, then maps were built for every eligible word in every bucket. Compact timestamp/sequence/token-id pages replace those maps; only selected words receive bucket counts. Local calendar-day boundaries cache bucket calculations correctly across DST. Word heap falls from 345.6 to 122.3 MiB; the new Words call additionally peaks at 19.4 MiB of ArrayBuffers, excluded from V8 heap. Memory still grows linearly with messages and eligible token occurrences; raw text is not retained.
4. **Rankings and ties.** Fixed-size word/emoji rankings replace full vocabulary sorts. Original first-ingested emoji metadata and Unicode collation ties are preserved, including timestamp-group insertion order in word-trend ties.

The shared pager traverses channels in channel/time/sequence order using `messages_channel_ts`. Its continuation branches seek `(channel_id, ts, rowid)` for equal timestamps and `(channel_id, ts)` for later timestamps; `MERGE (UNION ALL)` avoids sorting remaining messages. Tests verify both ranges, even when all timestamps are equal. Sequence ceilings exclude arrivals; scope and archive visibility are rechecked each page. Aggregate channel membership is one IN set, removing the multi-index OR.

Streaming work is linear in messages/token occurrences, with rankings bounded by their output limits. Four streaming times grow approximately 4x from 100k to 400k. SQL-only aggregates retain SQLite grouping sorts; activityStats has a measured step between 100k and 200k and remains synchronous. No quadratic page-rescan step remains.

### Cooperation, progress and limits

Every 500-row batch still awaits `setImmediate`. At 400k, Emoji, Sentiment and Conversations each service 800 queued heartbeats; Words services 2,336 including chunked final reduction. Longest complete-call gaps: Emoji 253.3ms, Words 396.8ms, Sentiment 390.2ms, Conversations 362.5ms. Words' maximum covers initial SQL extent and channel-ceiling setup; its largest batch SQL read is 2.18ms. Conversations' final identity aggregate takes 360.5ms. These synchronous setup/final queries remain a short blocking floor. SQL-only activityStats blocks for 11.06s; People 0.738s and repeated links 0.378s are synchronous too.

**No function exceeds 15 seconds on this fixture.** A persisted aggregate design is unnecessary for that measured budget and was not built. These measurements do not establish a 15-second guarantee for an encrypted real archive or concurrent backfill.

Progress can use the existing typed plugin events: declare a progress event, pass a batch callback into scans, emit with `ctx.channels.emit`, and consume with renderer `onEvent`. Count processed rows at batch boundaries; an initial `COUNT(*)` alongside channel ceilings would give an approximate denominator without another traversal. Include a request id, scope and phase (scan/reduction), ignore stale events after switching sections, and throttle emission. `pluginResource` has one final Promise result and no progress/cancellation channel. Progress was not built. Changing sections can leave an earlier core scan running; simultaneous scans/backfill were not reproduced.

All 182 existing tests and 11 new tests pass. Existing fixture result assertions remain unchanged; prepared-SQL probes now expect two page statements. Added coverage checks indexed ranges, equal timestamps, reversed history, privacy changes, late arrivals, queued work, exact trend counts, multilingual tokenization and stable rankings/collation.

The app was not driven, closed or restarted; its profile and real archive were not read. No CSS, dependencies or schema changed. The detached b60bc4c worktree was removed; pre-existing worktrees were preserved. The session usage command was unavailable on this machine.

## Round C person filter — 2026-10-12

At 400k, CPU profiling enabled, full recorded section sequence: `wordStats` Everyone **9.594s**, `u0` **0.440s**; `conversationStats` Everyone **1.666s**, `u0` **1.103s**. The person conversation read intentionally still scans everyone to retain runs and scope-wide medians.

Standalone repeat comparisons on this session: Words **8.994s** versus an exact `8892072` source snapshot's **9.477s**; Conversations **1.421s** versus **1.535s**. Initial standalone measurements were Words **10.978s / 0.556s** and Conversations **1.552s / 1.127s** (Everyone / `u0`). Snapshot blobs were copied beneath the plugin's temporary benchmark directory; sibling shared descriptors retained registry anchors. The fixture databases were disposed; source snapshots, logs and profiles remain in the plugin's ignored cache.

The historical absolute no-regression check is **not established**: the full-sequence Everyone times exceed the recorded **8.158s / 1.547s**. The current read-only host is `663662d4`, rather than recorded `7aa6004`; the cause of timing variation is unverified. The same-session standalone comparisons show no slowdown. Exact metrics for all runs: E:/Development/Projects/ChattyPop-Plugins-Public/plugins/stats/tests/bench/person-results.json. These synthetic, unencrypted measurements retain the limitations above.

## Archive-refresh measurements — 2026-10-19

The `rollups` section activates the production core plugin, waits for every host rollup, records table sizes, and measures each panel through its real channel client. It reports the first uncached call and the median of five exact-query cache hits separately.

```powershell
node E:\Development\Projects\worktrees\ChattyPop-Plugins-Public-archive-refresh\plugins\stats\tests\bench\run.mjs E:\Development\Projects\ChattyPop\.claude\worktrees\archive-refresh E:\Development\Projects\worktrees\ChattyPop-Plugins-Public-archive-refresh\plugins\stats 400000 rollups
```

The same 400k synthetic fixture and unencrypted driver were used before and after. Before is one instrumented read; after is one uncached read followed by five repetitions. First reads for new queries or revisions still miss the 100 ms budget in five sections. These numbers do not establish real-archive, encryption or renderer latency.

| Read | Before ms | After uncached ms | After warm median ms |
| --- | ---: | ---: | ---: |
| activityStats | 17,201.80 | 303.49 | 1.14 |
| peopleStats | 1,077.79 | 103.02 | 0.93 |
| postersPage | Not measured | 55.52 | 0.74 |
| personStreaks | Not measured | 74.89 | 0.74 |
| personHistory | Not measured | 65.74 | 0.71 |
| voiceStats | Not measured | 68.21 | 0.84 |
| repeatedLinks | 765.39 | 58.62 | 0.66 |
| emojiStats | 2,702.25 | 330.25 | 0.42 |
| wordStats | 10,589.97 | 1,453.21 | 0.85 |
| sentimentStats | 11,957.46 | 335.87 | 0.42 |
| conversationStats | 3,276.60 | 15.24 | 4.68 |

The completed build took 26,994.92 ms. The rejected term-row grain used 1,954,879 rows and 214,208,512 table bytes. Packed lexical frequencies, exact length histograms and bounded longest-message candidates use 95,160 rows and 90,873,856 table bytes. URL shares also have a materialized all-time fold. Table sizes exclude indexes. Exact JSON measurements are in `E:\Development\Projects\worktrees\ChattyPop-Plugins-Public-archive-refresh\plugins\stats\tests\bench\phase4-results.json`; the public record is [issue #164](https://github.com/Cujuju/ChattyPop/issues/164).

Completed reads are bounded to 64 entries per activation and keyed by exact query plus host snapshot tokens, including visibility and zone state. Dirty builds bypass caching; partial range and trend-midpoint days fold live. Known channel/server references remain live, and a conversation channel containing visible references folds its runs live for adjacency. A rebuild cannot recover retention-pruned text. Runs belong to their opener's UTC day and ranges select their opener timestamp.


## Archive-refresh fix round 2 — 2026-10-19

The `review` benchmark mode uses 200,000 stored runs in one channel. P4-1 measures five batches of 100 newest-message inserts with the same mutation-safe triggers, swapping only the index's start/end column order. Median insert cost is **11.284 ms → 0.112 ms**. Query plans change from `channel_id=? AND first_ts<?` to `channel_id=? AND last_ts>?`.

Q4 runs the same conversation projection inline, then through the production worker and bounded cache. Inline wall time is **284.268 ms**, with the first Core turn taking **278.665 ms**. The cold worker call takes **552.878 ms** total and **1.025 ms** for its first Core turn; the cached median is **0.052 ms** total and **0.046 ms** for its first turn. The worker returns **667 bytes**, rather than the run history. Cold worker latency remains above the 100 ms panel budget at this run count.

The standard 400,000-message rollup benchmark rebuilt in **27,924.698 ms**. Conversation reads take **12.58 ms** cold / **4.63 ms** warm median; Words takes **1,362.75 ms** cold / **1.20 ms** warm median. All eleven warm medians pass 100 ms. Five cold reads exceed it: activity, voice, emoji, words and sentiment. Exact per-panel values and the comparison method are recorded in `review-round2-results.json`.

Core caches projected results under normalized query keys, with both a 64-entry limit and an 8 MiB serialized-data budget. Production text reads use the worker; the legacy trend reference lives only in test helpers. Tests cover 200,000-message reference bootstrap, 200,000-row lexical/count folds and 200,000-run conversation projections.

Residual triggers: new or removed channel/guild ids cause channel/day text checks in privacy views until catalog classification drains; frequent same-channel writes can retry span publication; eligible distinct word spellings with equal ICU collation request a worker text scan to preserve timestamp-group tie order. Historical backfills can visit many future runs through the end-time index. These synthetic measurements do not establish encrypted or real-archive latency.
# Write-path follow-up (2026-10-19)

`write-path-results.json` records the fixed baseline and follow-up sources, the same 400k-message fixture, cold calls, five-hit warm medians, accumulated snapshot time and worker SQL timings. The runner now builds the current helper dependencies, configures the helper entry, and loads the explicitly selected historical plugin for rollup comparisons.

| Cold read | Before ms | After ms |
| --- | ---: | ---: |
| activityStats | 900.80 | 782.03 |
| peopleStats | 280.51 | 245.09 |
| emojiStats | 1,003.68 | 789.03 |
| wordStats | 5,711.51 | 5,553.79 |
| sentimentStats | 991.74 | 733.07 |

**Residual: #319 remains open.** These cache misses still exceed 100 ms. Trigger: first section read, or changed scope/data/privacy/time zone. Snapshot checks took 1.81–8.33 ms after the changes. Emoji input returned to JavaScript shrank from 48,360 to 1,952 rows; sentiment from 46,800 to 392. Their worker SQL still scans and aggregates daily input; sentiment's measured SQL was 687.14 ms. Words still read 95,160 daily rows from about 91 MB of lexical storage, then parse/fold word packets and an exact midpoint boundary. Warm hits remain below budget. Wall times vary; external machine load was not controlled; no running-app measurement was performed.
