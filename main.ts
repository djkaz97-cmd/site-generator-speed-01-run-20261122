// The entry's driver: node22 runs this file. It reads every case from the input directory's cases.json
// (a JSON array of { id, input }), answers each one with run() from solve.js, and writes the answers to the
// output directory's answers.json — a JSON array, one per case and in the cases' order.
//
// MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input and /output outside a container.

import { readFileSync, writeFileSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';

/**
 * The engine's side of a one-shot build, set before solve.js is imported so all of its work runs under it:
 * incremental marking off, the tier above Maglev off (compiling this workload for it costs more than its
 * code saves — and only where Maglev exists, V8 11.7+; node 22 carries 12.4), and a larger young generation
 * so the build's short-lived page strings do not keep triggering scavenges. None of these change what run()
 * returns, only how fast it gets there.
 */
function tuneEngine() {
  setFlagsFromString('--no-incremental-marking');
  if (Number(process.versions.v8.split('.')[0]) >= 12) {
    setFlagsFromString('--no-turbofan --max-semi-space-size=32');
  }
}
tuneEngine();

const { run } = await import('./solve.js');

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** Every case of the instance, in the order the scorer expects its answers. */
function readCases(dir: string): { id: string; input: unknown }[] {
  return JSON.parse(readFileSync(`${dir}/cases.json`, 'utf8'));
}

/** One answer per case, in the cases' order: the only thing the scorer reads back. */
function answerAll(cases: { id: string; input: unknown }[]): unknown[] {
  const answers = new Array(cases.length);
  for (let i = 0; i < cases.length; i++) answers[i] = run(cases[i].input);
  return answers;
}

const cases = readCases(INPUT_DIR);
writeFileSync(`${OUTPUT_DIR}/answers.json`, JSON.stringify(answerAll(cases)));
