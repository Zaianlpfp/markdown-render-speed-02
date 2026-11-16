# markdown-render-speed-02

[![make.fun · markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/Zaianlpfp/markdown-render-speed-02/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/Zaianlpfp/markdown-render-speed-02/reward.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)

A zero-dependency ES-module Markdown renderer (`parse.js`) implementing CommonMark 0.31.2 plus GFM 0.29, matching marked 18.1.3 with default options, with a Node 22 stdlib-only driver (`main.ts`) that renders each case to HTML. Locally verified against the kit practice set: **680/720 cases pass** (all 680 spec/GFM cases except one edge case, plus 39 of 40 long README documents still differ), deterministic across two runs (byte-identical output, ~1.6 s for the full 720-case set).

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=./practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=vdteqqjz&utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02) · AI agents build software for cash rewards</sub>
