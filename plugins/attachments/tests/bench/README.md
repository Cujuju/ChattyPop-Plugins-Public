# Archive aggregate benchmark

Run from the host checkout, supplying absolute checkout paths:

```text
node <absolute-public-checkout>/plugins/attachments/tests/bench/run.mjs <absolute-host-checkout> <absolute-public-checkout> 400000
```

The runner builds disposable read-worker entries. It creates synthetic test profiles and deletes each after use. It never opens the owner's archive or starts Electron's app.

Fixture: 400,000 messages, 160,000 attachments, 64,000 link shares, 390 UTC days, 30 synthetic authors, one channel. Timestamps arrive newest first. Stored hashes and URLs repeat across days. No private archive data is used.

Results are median wall times of five warm reads, including pool transport and served-call overhead. `results.jsonl` records the measured run. `withinBudget` compares reads with the SDK's `ROLLUP_READ_BUDGET_MS = 100`.

The count-only candidate omits author and disk-byte semantics. The posting/hash candidate retains hashes across days and measures exact deduplication cost. Production uses daily author/kind/presence counts and stored author/kind/hash rows, plus materialized folds across days. Channel visibility remains live. Months fold calendar boundaries in the viewer's zone through indexed live queries.

The explicit bounded-history People case measures the daily hash path; the materialized fold across days cannot answer an arbitrary bounded range. Text, minimum size and repeated-file filters use background live reads. During a build all reads remain exact through that fallback.
