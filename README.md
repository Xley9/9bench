# 9bench

**The honest browser hardware benchmark.** Test your CPU, GPU, and RAM in 15 seconds — directly in the browser. WebGPU + WebAssembly powered. No download. No login. No bias.

🌐 Live: [9bench.com](https://9bench.com)

---

## Why 9bench exists

Most hardware benchmarks have one of three problems:

1. **They require a download** (Geekbench, Cinebench, 3DMark) — friction kills accessibility
2. **They have known bias** (UserBenchmark's CPU weighting changes mid-stream, downranks competitors)
3. **They lie about their limits** — most browser benchmarks pretend their numbers match native, when RAM browser-API typically scores 30-50% of true hardware

9bench is the third option: instant, in-browser, honest about what it can and cannot measure.

---

## What it measures

| Metric | Method |
|---|---|
| **GPU compute** | WebGPU shader benchmark (matrix multiplication, GFLOPS) |
| **CPU single-core** | SHA-256 single-threaded loop |
| **CPU multi-core** | SHA-256 across all available cores via Web Workers |
| **RAM bandwidth** | Read/write throughput via typed arrays |
| **RAM latency** | Random-access pointer chasing |

Each component scores independently. The composite **9bench score** weighs them roughly equivalent to typical 2026 workloads.

**What it explicitly does NOT measure:** real-world game frame rates, video encoding throughput, native AI inference speed. For those, install a native benchmark.

---

## Honest disclaimers

- **RAM scores low in all browser benchmarks** (typically 30-50% of native). This is a JavaScript memory model limitation, not your hardware. We say so on every result page.
- **GPU detection is limited** in browsers. Many users see "Unknown GPU" — that's a Chrome/Firefox privacy feature, not our omission.
- **Multi-core efficiency depends on the browser's Web Worker scheduler.** Your real OS-level multi-core efficiency is typically higher than what we measure.

We tell users this in the result page. UserBenchmark doesn't.

---

## Tech Stack

- **Astro 4** — Static site framework
- **Cloudflare Pages** — Hosting + edge deploys
- **Cloudflare D1** — SQLite for shareable result IDs + global percentile data
- **Cloudflare Workers** — `/api/submit` POST + `/api/r/[id]` GET endpoints
- **WebGPU** — GPU compute via shader pipelines
- **Web Workers** — Multi-core CPU benchmarking
- **WebAssembly SIMD** — RAM throughput tests

No external analytics SDKs. No tracking pixels. No ad networks during benchmark execution (loading would skew results).

---

## Brand Family

9bench is part of the same brand family as:

- [Promptolis](https://promptolis.com) — Curated AI prompts library
- [Toololis](https://toololis.com) — 668 honest browser-native tools
- [seoscore.tools](https://seoscore.tools) — SEO/AEO/GEO scanner

Same editorial design system. Same "tell-the-truth" voice. Same MIT license.

---

## Quick Start (for forks)

```bash
git clone https://github.com/Xley9/9bench.git
cd 9bench
npm install
npm run dev
```

Production deploy:
```bash
npm run build
npx wrangler pages deploy dist --project-name=9bench --branch=main
```

D1 schema in `schema.sql`. Cloudflare configuration in `wrangler.toml`.

---

## License

MIT — see [LICENSE](./LICENSE).

You can fork it, ship your own variant, run it commercially. Truth-series tools should not be locked behind proprietary licenses.

---

Built solo with [Claude Code](https://claude.com/claude-code) by [Atilla Kürük](https://github.com/Xley9).
