# Large archive benchmark (opt in)

Run from `E:\Development\Projects\ChattyPop` in PowerShell. Neither normal tests nor `plugin:check` execute this runner.

```powershell
node E:\Development\Projects\ChattyPop-Plugins-Public\plugins\stats\tests\bench\run.mjs E:\Development\Projects\ChattyPop E:\Development\Projects\ChattyPop-Plugins-Public\plugins\stats 400000
```

The optional arguments after the row count are a function name (default `all`) and an absolute directory for V8 `.cpuprofile` files. Functions: `activityStats`, `peopleStats`, `repeatedLinks`, `emojiStats`, `wordStats`, `sentimentStats`, `conversationStats`. Repeat at `100000`, `200000`, `400000` to compare scaling. Run serially, with no competing benchmark. The target plugin path may be an older detached worktree; functions absent there are reported as unavailable.

Each run creates and disposes a temporary **plugin test host** database with the current host's migrations, indexes, privacy-aware archive views, WAL mode, FTS triggers and `better-sqlite3-multiple-ciphers` driver. No profile or real archive is accessed. It inserts fixture rows directly through the test database adapter; it does not time ingestion or retain raw Discord payloads, attachments, derived text or link previews.

The fixed-seed archive has one channel, 30 authors, a 390-day span, 40k possible long-tail words, 16% link-bearing messages, roughly 96% nonblank messages, and reverse-time history ingestion. Message lengths mix short/medium/long prose and a small long tail. Assumption: this length mixture (about 84 characters per message) is representative; the observed archive's actual distribution was not available and is not claimed to match.

The test database is **unencrypted**, unlike a keyed app database. It holds 400k rows successfully. Numbers isolate core function costs on this synthetic shape, including SQLite reads and cooperative yields. They do not predict encryption overhead, concurrent history backfill, privacy with many hidden ids, other channels, runtime differences between Node and Electron, IPC, renderer layout, or abandoned scans after changing sections.

JSON output gives wall milliseconds, process V8 heap peak and baseline in MiB, ArrayBuffer peak, SQL time, per-statement query plans, and longest event-loop heartbeat gap. Heap measurements combine 5ms samples, SQL boundaries, function completion and V8 pre-GC sizes; this is the highest observed heap, excludes native SQLite memory and ArrayBuffers, and is not RSS. The fresh child runs with `--expose-gc --trace-gc-nvp`; collection happens **before** timing each function. No explicit GC happens within measured work. Profiler startup, fixture seeding, loader startup and cleanup are outside wall time. Query-plan instrumentation and sampling overhead are included. Keep profiler settings the same when comparing runs.

The heartbeat queues `setImmediate` while the function runs; its longest gap is an upper bound on an uninterrupted slice (also includes scheduling and measurement overhead). `yields` verifies that unrelated queued core work can execute during scanning. Synchronous SQL-only sections are reported too and have no yields.

To reproduce a historical comparison, create a detached worktree outside the shared checkout, pass its absolute `plugins\stats` path to this same runner, then remove that worktree. Do not switch the shared branch or install dependencies; the runner reuses this plugin's and the host's existing packages. Before rounds A/B (`b60bc4c`), `peopleStats` and `repeatedLinks` did not exist.
