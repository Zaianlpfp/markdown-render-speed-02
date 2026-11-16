// main.ts — driver for the markdown-render-speed-02 entry.
// Reads /input/cases.json (or $MAKEFUN_INPUT_DIR/cases.json), renders each
// case with parse() from ./parse.js, and writes the HTML strings in case
// order to /output/html.json (or $MAKEFUN_OUTPUT_DIR/html.json).
// Node 22, standard library only. Deterministic: no clock, no randomness,
// no network, no state carried between cases.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const inputDir = process.env.MAKEFUN_INPUT_DIR || '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

const raw = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8'));
// Accept either a bare array of cases or an object with a `cases` array.
const cases = Array.isArray(raw) ? raw : raw.cases;
const html = new Array(cases.length);
for (let i = 0; i < cases.length; i++) {
  html[i] = parse(cases[i].markdown);
}

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'html.json'), JSON.stringify(html));
