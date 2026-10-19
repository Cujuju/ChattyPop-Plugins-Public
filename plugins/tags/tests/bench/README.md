# Archive-refresh round 3: benchmark and served-member audit

Run in PowerShell using the archive-refresh worktrees:

```powershell
node E:\Development\Projects\worktrees\ChattyPop-Plugins-Public-archive-refresh\plugins\tags\tests\bench\run.mjs E:\Development\Projects\ChattyPop\.claude\worktrees\archive-refresh 400000
```

The optional final argument is the baseline host commit; default `7abceb754247e973eddd5bbdf997817130db75cf`.
The runner creates temporary test archives and a separate publication database under the host's ignored output folder. It never uses an app profile or connects to an app.

## Measurements — 2026-10-19

Host `fe300068f11bee4edd62d0b0b28f9296bd1b645a`; Tags `648af2f26848e860fc1cc0fe48c7be0de0233be4`; Node v24.21.0, Windows.
The fixed-seed Stats fixture has 400,000 messages, 30 authors and 390 days; every third message gets one tag. The driver is unencrypted.
Assumption: this synthetic shape is useful for comparing scheduling and query plans; it does not reproduce the encrypted app's distribution.

Five samples per read, median milliseconds. **Core turn** measures the initial synchronous invocation until its Promise returns, excluding later continuations and worker wait. The production stall guard separately accounts for synchronous async continuations.

| Read | Before wall ms | After wall ms | Before Core turn ms | After Core turn ms |
| --- | ---: | ---: | ---: | ---: |
| Tags live chips | 2.99 | 21.60 | 2.98 | 0.69 |
| Directory | 759.22 | 723.31 | 759.21 | 0.70 |
| Judge candidates | 69.43 | 5.67 | 69.43 | 0.61 |

Cold Tags helper startup takes **193.56 ms** wall time. A synchronous host message page takes **2.52 ms** for 50 rows, below the named 16 ms budget.

The Tags baseline runs the original DISTINCT join with the new membership index absent. The additive index is then restored and the real served member runs through the read process. The baseline already chooses channel/time and membership index seeks on this fixture. These numbers establish removal of Core SQL work and added worker latency; they do not reproduce the reported 750–850 ms stall.

The replacement plan has two seeks and removes DISTINCT: `messages_channel_ts (channel_id=?)`, then `p_tags_message_tags_message_state (message_id=? AND state=?)`.
Directory retains exact counts, so its database work remains archive-sized in the worker. The judge baseline omits the new `(kind, ts DESC)` index; afterward the indexed production query runs in the background lane. Its plan seeks `conversation_links_kind_ts (kind=? AND ts>?)`, then judgment/owner-mark primary keys; its only scan is the tiny JSON policy parameter. Before/after results are checked for equality.

Publication uses ten partitions of 1,000 daily keys with correct cumulative SUM folds. Compute and fixture setup are outside the timed Core transaction. The original `replacePartition` is loaded from the baseline commit and compared with the current function in the same process. Median publication is **9.34 → 8.28 ms**; maximum is **17.70 → 15.62 ms**. Upserts retain existing all-time keys and skip unchanged values. Atomic replacement and yields between partitions remain.

Raw samples, query plans, fixture details and commit identities are in `results.json` beside this file.

## Public audit: all 17 plugins

Every served member is checked, including write members and members without a reads flag. Pure readers use `ctx.storage.read`. Explicit `syncReads` exceptions require a reason, indexed entity lookups, at most 64 returned rows and a 16 ms synchronous statement budget.

| Plugin | Every served Core member | Verdict | Final plugin:check exit; tests |
| --- | --- | --- | --- |
| alerts | alerts, unread, markRead | Both readers migrated; markRead writes. | 0; 83 passed |
| attachments | rollupStatus, page, totals, people, places, months, sharedBy, postings, breakdown, rebuildRollups | Existing async readers; status is memory; rebuild schedules work. | 0; 125 passed |
| claude | None | Provider extension; no migration. | 0; 56 passed |
| codex | None | Provider extension; no migration. | 0; 54 passed |
| exchange | importDce, exportChannels, cancelExport, exportMessages (main audience) | Both export readers migrated; import writes; cancel is memory. | 0; 21 passed |
| imagetext | status, failedImages, request, retryFailed; imageFetched completion | Counts, failed lists and retry selection migrated. request has a budgeted indexed lookup exception. | 0; 36 passed, 1 skipped |
| links | rollupStatus, page, window, counts, sharedBy, rebuildRollups, markSeen | Existing async readers; status is memory; remaining members write/schedule. | 0; 54 passed |
| ollama | pulls, pull, cancelPull, deleteModel | Memory/network; no PluginDb reads. | 0; 54 passed |
| openrouter | None | Provider extension; no migration. | 0; 41 passed |
| plans | list, keys | Existing async readers. | 0; 26 passed |
| rerank | None | Extension only; no migration. | 0; 8 passed |
| stats | activityStats, peopleStats, postersPage, personStreaks, personHistory, voiceStats, repeatedLinks, emojiStats, wordStats, sentimentStats, conversationStats, rollupStatus, rebuildRollups | Existing worker reads/folds; status is memory; rebuild schedules work. | 0; 221 passed |
| summaries | summarize, page, failures, retryFailure, estimate, prompts, usageSince, spending, linkPerson, notifyAuto, compare, cancelCompare, comparisons, comparison, deleteComparison | Display/estimate/usage/comparison reads and both generation log readers migrated. summarize, compare and linkPerson permit indexed stored-result lookups. Others use host metadata, memory or writes. | 0; 115 passed |
| tags | tags, createTag, updateTag, deleteTag, setMessageTag, messageTags, taggedMessages, tagRangeCount, tagRange, liveTagChips, personTags | All archive readers migrated, including range/manual-tag input. Registration uses activation-owned definitions. create/update/delete/range permit indexed lookup exceptions. | 0; 31 passed |
| transcription | status, install, cancel, deleteModel, request; audioFetched completion | Status is memory/toolchain; request permits a budgeted per-message transcript lookup; others schedule/write. | 0; 46 passed |
| translation | status, translate, retryFailed | Counts and retry selection migrated. translate permits a budgeted per-message lookup. | 0; 15 passed |
| usage | None | Usage extension; no migration. | 0; 4 passed |

Total: **17/17 checks exit 0; 990 tests pass, one skips**. Host: typecheck, 407 test files / 3,314 passing tests / seven skips, build and the packaged read-process probe all exit 0.

## Source proof

Enumerate served declarations and native-query sites with:

```powershell
rg -n 'channels\.serve|reads:\s*true|syncReads' E:\Development\Projects\worktrees\ChattyPop-Plugins-Public-archive-refresh\plugins -g '*.ts' -g '!**/tests/**'
rg -n '\.prepare\(|\.all\(|\.iterate\(|\.get\(' E:\Development\Projects\worktrees\ChattyPop-Plugins-Public-archive-refresh\plugins -g '**/core/*.ts'
```

Trace those sites from each served member through its helpers. `plugin:check` now performs that local source call-graph check and rejects unmarked synchronous reads before tests run. Result: **zero unbounded synchronous archive-read violations from public served members**. Previously prepared statements and iterator advancement are fenced at execution time. Contract tests cover omitted reads flags, write members and an untested served scan rejected by the CLI.

Dynamic reflection remains outside static analysis. Production records `plugin-sync-read` and `core-call-stall` with member names.

## Residual triggers

- Cold helper startup adds latency; warm Tags wall time is recorded separately.
- Sparse tags may require walking older messages in the selected channel to preserve the newest 500 tagged-message behavior. That work stays in the read process.
- Large unread histories retain directory count latency in the worker; indexed message pages keep an independent Core budget.
- Initial backfill publication remains an atomic Core transaction. Larger partitions or wider rows can cost more than this two-column fixture; each completed partition yields.
- Large result formatting or filesystem writes can exceed the synchronous call budget. The new member-naming diagnostic exposes that work.

No app interaction or real-archive re-profile was performed. The owner can verify the landed build against the original channel-switch profile.
