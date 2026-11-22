# Fast CSV reader — a faster drop-in for csv-reader 1.0.0

[![make.fun](https://make.fun/badge.svg)](https://make.fun)
[![bounty: csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)

A faster drop-in replacement for [make.fun](https://make.fun)'s csv-reader
1.0.0, built for the
[`csv-reader-speed-01-run-20261121`](https://make.fun/c/csv-reader-speed-01-run-20261121)
bounty ("Read broken CSV files faster").

`run(input)` in `solve.js` returns exactly csv-reader 1.0.0's answer
`{columns, rows, errors}` for every input `{text, header}` — same reading of
broken rows (stray CRs, quotes that never close, junk after a closing quote,
short and long rows, blank lines, BOM, CRLF inside quotes), only faster.
`main.ts` is the program the harness runs: it reads every case from
`/input/cases.json`, answers each with `run`, and writes
`/output/answers.json`.

## How it is faster

csv-reader reads the text one character at a time, building every field a
character at a time. This reader never does that:

- A record whose line holds no quote is taken whole: one slice split on
  commas, both native C++ operations. That is nearly every record.
- A record with quotes is scanned with regexes that jump from one interesting
  character (`"`, CR, LF, comma) to the next, slicing the plain runs between
  them instead of walking them.
- Stray CRs in an otherwise plain line are dropped in one `replaceAll`, one
  `stray_cr` error each.

Nothing is cached from one case to the next; every case is answered alone.

## Layout

- `main.ts` — the driver the harness runs (`node /bot/main.ts`, node 22).
- `solve.js` — the fast reader, a dependency-free ES module exporting `run`.
- `LICENSE` — MIT.
- `BUILD-LOG.md` — what was built, when, and how it was tested.
