# Task: site-generator-speed-01-run-20261122 — make.fun bounty ($100, opens 2026-11-22T20:00Z, closes 2026-11-24T20:00Z)
# BUNDLE mode: build + git push HERE; the parent bundles and submits after. Never ask questions. Do NOT submit. Do NOT pay. Never print API keys or claim codes.
# *** YOU ARE THE BUILDER, NOT AN ORCHESTRATOR. Write solve.js and every repo file DIRECTLY in THIS session with write_file. Do NOT create cron jobs, do NOT schedule anything, do NOT wait for other builds, do NOT rewrite this file as a design spec. ***

Write `solve.js`, a dependency-free ES module at the repo root whose `run(input)` returns EXACTLY what makefun-site 1.0.0's `build(input)` returns: the output tree as one JSON object of every path it writes (each page's index.html, index and tag pages, build-report.txt, each static file) and that file's text, byte for byte. Then beat makefun-site's CPU time.

READ FIRST, fully: C:/Users/Kaz/makefun-bounties/site-generator-speed-01-run-20261122-kit/site-generator-speed-01-run-20261122-kit/RULES.txt (the whole contract), and C:/Users/Kaz/makefun-bounties/site-generator-speed-01-run-20261122-kit/site-generator-speed-01-run-20261122-kit/baselines/makefun-site/vendor/makefun-site/README.md + all of vendor/makefun-site/lib/*.js and index.js — that code is the ground truth for edge cases. The kit's RULES and the vendor's code decide; the practice reference shows the exact bytes.

REPO: C:/Users/Kaz/makefun-bounties/entries/site-generator-speed-01-run-20261122 — empty. Create everything from scratch.
Kit: C:/Users/Kaz/makefun-bounties/site-generator-speed-01-run-20261122-kit/site-generator-speed-01-run-20261122-kit   gh: C:/Users/Kaz/AppData/Local/Programs/gh/bin/gh.exe   Node 26 on PATH (target runtime Node 22.18+).

FILES (all authored in full by you)
1. solve.js — `export function run(input)` returning the answer object. Start from the vendor logic (MIT, in the kit) so correctness is locked first; keep the vendor LICENSE and NOTICE text inside your repo credits if you port its code. Then optimize for CPU time.
2. main.ts — the driver, your own code, modeled on C:/Users/Kaz/makefun-bounties/site-generator-speed-01-run-20261122-kit/site-generator-speed-01-run-20261122-kit/baselines/makefun-site/main.ts: `setFlagsFromString('--no-incremental-marking')` from node:v8 BEFORE importing solve.js; read every case from `MAKEFUN_INPUT_DIR ?? /input` (cases.json), answer each with run, write `answers.json` to `MAKEFUN_OUTPUT_DIR ?? /output`. Node 22, stdlib only, no TypeScript features Node 22 cannot strip.
3. LICENSE — MIT text with `SPDX-License-Identifier: MIT` as its first line (the gate checks the SPDX identifier; the vendor tree's own LICENSE/NOTICE belong in a NOTICE/CREDITS file, not in place of yours).
4. README.md — title + one short line + these three live badges (owner djkaz97-cmd, repo site-generator-speed-01-run-20261122, owner NOT duplicated):
[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/djkaz97-cmd/site-generator-speed-01-run-20261122/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/djkaz97-cmd/site-generator-speed-01-run-20261122/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)
5. .makefun/owner.json — {"wallet": "5bUR9FL3rTeevwqZC97oH7agHyQqJD9H6C2jW4DGcLUk"}
6. .gitignore — out/, tmp/, *.tar.gz, bench files.
7. AGENTS.md — rewrite this file in full in your own words.
No scratch files, no bench scripts, no out/, no node_modules in the repo. Total repo size must stay under 4 MiB (4,194,304 bytes, every file counted).

CORRECTNESS LOOP (the real loop; run it after every edit family)
  cd C:/Users/Kaz/makefun-bounties/entries/site-generator-speed-01-run-20261122 && mkdir -p ../sg-out && MAKEFUN_INPUT_DIR=C:/Users/Kaz/makefun-bounties/site-generator-speed-01-run-20261122-kit/site-generator-speed-01-run-20261122-kit/practice/input MAKEFUN_OUTPUT_DIR=../sg-out node main.ts
  MAKEFUN_OUTPUT_DIR=../sg-out MAKEFUN_REFERENCE_DIR=C:/Users/Kaz/makefun-bounties/site-generator-speed-01-run-20261122-kit/site-generator-speed-01-run-20261122-kit/practice/reference MAKEFUN_SCORES_DIR=../sg-scores node C:/Users/Kaz/makefun-bounties/site-generator-speed-01-run-20261122-kit/site-generator-speed-01-run-20261122-kit/program/scorer/main.ts
  ../sg-scores/scores.json must read {"passed":1,"cases_passed":3,"cases_total":3}. Use paths OUTSIDE the repo for outputs/scores.
  When a case fails, diff your answer against expected.json case by case and fix the exact rule: front matter, template dialect, Markdown subset (NOT CommonMark), slug rule (Unicode NFD/NFC as node22's String.normalize does it), build-report.txt, static file copying, page/index/tag generation.

SPEED (this is what places; a correct entry that is not faster at 95% confidence wins nothing)
- Write a benchmark script OUTSIDE the repo (e.g. C:/Users/Kaz/makefun-bounties/tmp/bench-sg.mjs) importing your solve.js and C:/Users/Kaz/makefun-bounties/site-generator-speed-01-run-20261122-kit/site-generator-speed-01-run-20261122-kit/baselines/makefun-site/solve.js, with --no-incremental-marking, 1-2 warm-ups + 7 timed rounds over the practice cases, compare medians. Target >= 2x faster than the baseline.
- Hot paths to attack once correct: one-pass Markdown scanning instead of chained regexes; cache String.normalize per title; precompile each template once per case; avoid intermediate arrays of objects per page; `Buffer`/string concatenation over repeated `+=` of large strings; reuse maps; avoid `Intl` where a plain comparison matches; keep the JSON serialization identical.
- Each trial: 10 s wall, 1 CPU, 1024 MB; the entry runs twice and outputs must match byte for byte, so no caching across runs on disk, no clock, no randomness.

GRADE + CHECK (mandatory, iterate until green)
  cd C:/Users/Kaz/makefun-bounties/site-generator-speed-01-run-20261122-kit/site-generator-speed-01-run-20261122-kit && node cli/makefun.mjs grade-local --kit . --bot C:/Users/Kaz/makefun-bounties/entries/site-generator-speed-01-run-20261122 --driver process   (docker only if the machine has it)
  then node cli/makefun.mjs check --kit . --repo C:/Users/Kaz/makefun-bounties/entries/site-generator-speed-01-run-20261122 --worktree
A rejected check costs nothing but time; a rejected submit costs quota. Fix every FAIL before finishing.

GIT (repo must be created at/after 2026-11-22T20:00Z, which this session is)
  cd C:/Users/Kaz/makefun-bounties/entries/site-generator-speed-01-run-20261122 && git add main.ts solve.js LICENSE NOTICE README.md .gitignore AGENTS.md .makefun/owner.json && git commit -m "makefun-site: a faster drop-in for make.fun's static site generator"
  C:/Users/Kaz/AppData/Local/Programs/gh/bin/gh.exe repo create djkaz97-cmd/site-generator-speed-01-run-20261122 --public --source . --push --homepage https://make.fun/bounty/site-generator-speed-01-run-20261122
  C:/Users/Kaz/AppData/Local/Programs/gh/bin/gh.exe repo edit djkaz97-cmd/site-generator-speed-01-run-20261122 --add-topic makefun,ai-agents,bounties,static-site-generator --description "make.fun entry: a faster makefun-site 1.0.0"

QUALITY > JUST PASSING
- Names, README and repo must look deliberate and complete. The code must be your own faster implementation, not the vendor file copied unchanged (an unchanged copy only ties the baseline and wins nothing).
- CONTENT SAFETY: all content is code and neutral English technical prose. No violent, graphic or political content anywhere.

FINAL REPORT: commit sha, practice scores.json line, benchmark medians + speedup, repo file list + size, blockers. Do NOT submit.
