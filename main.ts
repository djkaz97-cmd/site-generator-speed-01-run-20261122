// The entry's driver: node22 runs this file. It reads every case from the input directory's cases.json
// (a JSON array of { id, input }), answers each one with run() from solve.js, and writes the answers to the
// output directory's answers.json — a JSON array, one per case and in the cases' order.
//
// MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input and /output outside a container.

import { readFileSync, writeFileSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';

// V8's incremental marking off, set before solve.js is imported so all of its work runs under it.
setFlagsFromString('--no-incremental-marking');

// A graded run is one shot: the tier above Maglev would spend more time compiling this workload than its
// code saves, so ask for Maglev as the top tier — only where Maglev exists (V8 11.7+; node 22 carries 12.4).
// A larger young generation keeps the build's short-lived page strings out of repeated scavenges.
// These flags change how fast the code runs, never what run() returns.
if (Number(process.versions.v8.split('.')[0]) >= 12) {
  setFlagsFromString('--no-turbofan');
  setFlagsFromString('--max-semi-space-size=32');
}

const { run } = await import(new URL('./solve.js', import.meta.url).href);

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** One answer per case, in the cases' order: the only thing the scorer reads back. */
function answerAll(cases: { id: string; input: unknown }[]): unknown[] {
  const answers = new Array(cases.length);
  for (let i = 0; i < cases.length; i++) answers[i] = run(cases[i].input);
  return answers;
}

const cases = JSON.parse(readFileSync(`${INPUT_DIR}/cases.json`, 'utf8'));
writeFileSync(`${OUTPUT_DIR}/answers.json`, JSON.stringify(answerAll(cases)));
