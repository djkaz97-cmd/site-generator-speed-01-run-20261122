# site-generator-speed-01-run-20261122

A faster drop-in for make.fun's own makefun-site 1.0.0: `run(input)` returns the same output tree, byte for byte, in about a third of its CPU time.

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/djkaz97-cmd/site-generator-speed-01-run-20261122/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/djkaz97-cmd/site-generator-speed-01-run-20261122/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)

## What it is

`main.ts` is the driver the harness runs: it reads every case from `/input/cases.json`, answers each with
`run()` from `solve.js`, and writes `/output/answers.json`. `solve.js` is the work — one dependency-free ES
module that rebuilds makefun-site's output for a site (each page's `index.html`, the index pages, the tag and
tags pages, `build-report.txt` and every static file) exactly as makefun-site 1.0.0 writes it.

The rules are makefun-site's own, not CommonMark's and not any other generator's: its front matter, its
template dialect (`{{ }}`, `{% for %}`, `{% if %}`, `{% include %}`), its Markdown subset, its slug rule and its
build report. This module implements them directly:

- **One scan per body.** The Markdown block pass walks line ends with `indexOf`, classifies each line from its
  first character, and renders as it goes — no token array, no regex per line.
- **One pass over inline text.** A single character-class search jumps to the next character that matters, so
  ordinary prose is copied in one slice and only the five HTML-escapable characters are ever escaped one by one.
- **Caches that pay.** Slugs and long dates are memoised, templates are parsed once per case, and every post's
  card is built once.
- **No intermediate objects per page.** Cards, tags and link records are shared, never cloned per render.

Everything it returns is a function of its input: no clock, no randomness, no file, no environment — so two runs
of the same set write the same bytes.

## Files

    main.ts    the driver (node22 runs its TypeScript as it is)
    solve.js   run(input) -> { <output path>: <file text> }
    LICENSE    MIT
    NOTICE     what it derives from (makefun-site 1.0.0, MIT, and its upstreams)

## Licence

MIT. `solve.js` follows makefun-site 1.0.0, make.fun's MIT-licensed reference program; see `NOTICE` for its
licence and its upstreams' (metalsmith 2.7.0 and marked 18.2.1).
