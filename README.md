# csv-reader-speed-01

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/xszee/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/xszee/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast drop-in for csv-reader 1.0.0, written for the make.fun bounty
[Read broken CSV files faster](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
(`csv-reader-speed-01-run-20261121`).

## What it does

`solve.js` exports `run(input)`, returning exactly what csv-reader 1.0.0
returns for `{text, header}`: `{columns, rows, errors}` — including its
broken-row policy (stray CRs, unterminated quotes, junk after a closing
quote, short/long rows, blank lines, BOM). `main.ts` is the house driver:
it reads every case from `/input/cases.json`, answers each with `run`,
and writes `/output/answers.json`.

## How it is fast

The reference walks one character at a time and builds every field by
concatenation. This reader instead:

- splits a whole clean line natively (`String.split(',')`) when it holds
  no quote and no stray CR — the common case;
- otherwise jumps between delimiters with native `indexOf` scans and
  slices whole fields at once, with every scan bounded by the field or
  line it belongs to, never across the rest of the file;
- passes field results through shared slots instead of allocating one
  answer object per field (a case holds well over a hundred thousand).

Local check on the kit's practice set (6 cases, ~10 MB of CSV):
6/6 answers byte-identical to the reference, about 3.8x less CPU time
than csv-reader 1.0.0 (~0.21 s vs ~0.79 s per set on this machine),
plus 0 mismatches on 4,000 randomly generated broken CSVs.

## Files

- `solve.js` — the entry, a dependency-free ES module.
- `main.ts` — the house driver, unchanged from the kit baseline.
- `package.json` — `{"type": "module"}`.
