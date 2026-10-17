# Reproducing the baseball experiment

The exact September 17 source matrices, per-game predictions and manifests remain in the local dated archive:
`/Users/lestercrafton/Documents/Codex/2026-09-09/go/work/mlb-data-research-2026-09-17/model`.
They are deliberately kept out of the public Worker bundle. Set `BIG_VIN_RESEARCH_DIR` to a copy of that archive before running `feature_research.py`, `baseline-parity.test.mjs` or `build_report.py`. Python research requires NumPy; the daily collector does not. Preserve the original archive; reruns write outputs.

For a new study, copy the protocol into a new output directory and set `BIG_VIN_RESEARCH_DIR` there. `prepare_inputs.py` uses `BIG_VIN_MLB_DATA_DIR` or `~/.local/share/big-vin/baseball-stats` for the normalized source. Register the new hypothesis and cutoffs before looking at outcomes. A current download may revise old values and is not an exact replay of the frozen September 17 source.

The displayed findings come from the audited corrected run. They retain the existing formula and do not change original forecasts or prices.
