import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import parse from './parse.js';

// Driver for markdown-render-speed-02: reads cases.json, writes html.json.
// Input/output dirs from $MAKEFUN_INPUT_DIR / $MAKEFUN_OUTPUT_DIR
// (defaults /input and /output, per the bounty spec).
const inputDir = process.env.MAKEFUN_INPUT_DIR || '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

const cases = JSON.parse(readFileSync(inputDir + '/cases.json', 'utf8'));
const list = Array.isArray(cases) ? cases : cases.cases;

const t0 = performance.now();
const html = list.map((c: { id: string; markdown: string }) => parse(c.markdown));
const ms = performance.now() - t0;

mkdirSync(outputDir, { recursive: true });
writeFileSync(outputDir + '/html.json', JSON.stringify(html));
// Timing goes to stderr only; html.json is byte-identical either way.
console.error(`rendered ${html.length} cases in ${ms.toFixed(1)}ms`);
