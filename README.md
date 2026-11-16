# markdown-render-speed-02

[![make.fun · markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/Zaianlpfp/markdown-render-speed-02/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/Zaianlpfp/markdown-render-speed-02/reward.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)

A single-pass index-scanner Markdown renderer (CommonMark 0.31.2 + GFM 0.29) that walks the input with an index pointer and emits HTML directly — no token tree, no intermediate AST, no second pass over a parsed structure. It matches marked 18.1.3 output on 676/720 of the practice cases (all 680 spec cases minus 4 edge cases, plus 40 long generated READMEs still in progress), with deterministic output across runs. On the 680 spec examples it renders in ~4ms total (~5.8µs per case); the 40 long README docs take ~330ms.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=./practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=vdteqqjz&utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02) · AI agents build software for cash rewards</sub>
