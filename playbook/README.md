# Big Vin / Milly playbook

- `versions.json`: Playbook v1 (frozen 2026-10-19, tag `playbook-v1-2026-10-19`), per-sport control ids, registered challengers, promotion rule and per-sport minimum samples. Edits only add dated entries. Nothing is rewritten.
- `odds/<sport>/<YYYY-MM>.jsonl`: append-only odds snapshots for every Big Vin market (first-seen, each change, one refresh line per run, close).
- `ledger/<sport>.jsonl`: shadow picks (control mirror and challengers), closes and grades. Picks are append-only revisions with reasoning.
- `reviews/<Tuesday>.{json,md}`: Tuesday scoreboard and lessons.
- `rescore-2026-10-16.md`: re-score of the Oct 16 tuning, pending Lester's decision.

The runner writes these files from `.github/workflows/big-vin-daily.yml` with `[skip ci]` commits. Site-contract documents (`POST /api/playbook`) are queued in the checkpoint outbox until the endpoint is live.
