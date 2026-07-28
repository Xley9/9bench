// Dynamic OG image generator — per-page + per-result PNG cards
//
// Architecture: workers-og library renders Tailwind-style CSS in a Worker.
// Each route returns a 1200×630 PNG used by Twitter/Reddit/LinkedIn/etc
// when the URL is shared.
//
// Routes:
//   /og            → generic 9bench card (cyan editorial)
//   /og?id=abc123  → personalized Trading Card (D1 lookup + Phase G AI block)
//   /og?p=top      → static page card
//   /og?p=slug     → article card
//
// Phase I rewrite (2026-04-29): full visual update to editorial dark
// system (#0A0A0A bg + #00D9FF cyan accent + JetBrains Mono + Inter).
// Match the in-page Trading Card so users see the SAME design when
// they share vs when they're on the page. Brand consistency.

import { ImageResponse } from 'workers-og';

interface Env {
  DB: D1Database;
}

function fmt(n: number): string {
  return Number(n).toLocaleString('en-US');
}

// ── Tier mapping (matches tier-system.ts in src/components/bench/) ──
// Anti-shame: letters for top half, descriptive labels for bottom half.
function tierFor(score: number): { key: string; label: string; sub: string; color: string; bg: string } {
  if (score >= 1386) return { key: 'S', label: 'S-tier',             sub: 'Enthusiast / workstation',  color: '#00D9FF', bg: 'rgba(0,217,255,0.10)' };
  if (score >= 900)  return { key: 'A', label: 'A-tier',             sub: 'Power user',                color: '#7CFFB2', bg: 'rgba(124,255,178,0.10)' };
  if (score >= 600)  return { key: 'B', label: 'Solid daily driver', sub: 'Comfortable for most work', color: '#F5F5F5', bg: 'rgba(245,245,245,0.06)' };
  if (score >= 300)  return { key: '◯', label: 'Working machine',    sub: 'Office class',              color: '#B8B8B8', bg: 'rgba(184,184,184,0.06)' };
  return                    { key: '○', label: 'Patient & honest',   sub: 'It still gets the job done', color: '#6E6E6E', bg: 'rgba(110,110,110,0.06)' };
}

const PERCENTILE_MIN_N = 100;

// ── Article + page metadata (kept from previous version, restyled) ──
const ARTICLES: Record<string, { title: string; subtitle?: string }> = {
  'userbenchmark-alternatives-2026':                    { title: 'UserBenchmark Alternatives 2026' },
  'how-to-test-cpu-gpu-ram-online-no-download':         { title: 'How to Test CPU, GPU & RAM Online — No Download' },
  'geekbench-vs-cinebench-vs-9bench':                   { title: 'Geekbench vs Cinebench vs 9bench' },
  'what-is-gflops-gpu-performance-explained':           { title: 'What Is GFLOPS? GPU Performance Explained' },
  'how-many-cpu-cores-do-you-need-2026':                { title: 'How Many CPU Cores Do You Need in 2026?' },
  'why-browser-benchmarks-score-lower-than-native':     { title: 'Why Browser Benchmarks Score Lower Than Native' },
  'complete-guide-online-hardware-benchmarking-2026':   { title: 'Complete Guide to Online Hardware Benchmarking' },
  'userbenchmark-banned-honest-alternatives-2026':      { title: 'UserBenchmark Was Banned — 5 Honest Alternatives' },
  'best-gpu-for-local-llm-2026':                        { title: 'Best GPU for Local LLM in 2026' },
  'how-much-vram-do-you-need-for-local-llm-2026':       { title: 'How Much VRAM Do You Need for Local LLMs?' },
  'run-local-llm-on-8gb-vram-2026-reality-check':       { title: 'Run Local LLMs on 8 GB VRAM — Reality Check' },
  'best-laptop-for-local-ai-2026':                      { title: 'Best Laptop for Local AI in 2026' },
  'browser-vs-native-llm-performance':                  { title: 'Browser vs Native LLM Performance' },
  'can-my-pc-run-it-15-second-test-2026':               { title: 'Can My PC Run It? Test in 15 Seconds' },
  'apple-m3-max-vs-rtx-4090-local-ai':                  { title: 'Apple M3 Max vs RTX 4090 for Local AI' },
  'test-pc-stable-diffusion-xl-15-seconds':             { title: 'Test Your PC for Stable Diffusion XL' },
};

const PAGES: Record<string, { title: string; subtitle: string }> = {
  top:         { title: 'Top Scores Leaderboard',      subtitle: 'The fastest hardware benchmark scores worldwide' },
  compare:     { title: 'Compare Benchmark Results',   subtitle: 'Side-by-side CPU, GPU & RAM comparison' },
  history:     { title: 'Your Test History',           subtitle: 'Track your hardware performance over time' },
  faq:         { title: 'Frequently Asked Questions',  subtitle: 'How 9bench works, accuracy, privacy & more' },
  methodology: { title: 'Methodology',                 subtitle: 'How 9bench measures CPU, GPU & RAM performance' },
  about:       { title: 'About 9bench',                subtitle: 'Why 9bench exists and what Truth Series means' },
  articles:    { title: 'Articles',                    subtitle: 'Hardware benchmarking insights & guides' },
};

// Tokens — match global.css editorial system
const TOKENS = {
  bg:      '#0A0A0A',
  bg2:     '#111111',
  bg3:     '#161616',
  line:    '#2A2A2A',
  fg:      '#F5F5F5',
  fg2:     '#B8B8B8',
  fg3:     '#6E6E6E',
  accent:  '#00D9FF',
  warn:    '#FF5722',
  good:    '#7CFFB2',
};

// ─────────────────────────────────────────────────────────────────────
// Card 1 — RESULT (Trading Card style, matches in-page rendering)
// ─────────────────────────────────────────────────────────────────────
function resultCard(args: {
  score: number;
  tier: ReturnType<typeof tierFor>;
  hash: string;
  gpuName: string | null;
  cores: number;
  gflops: number;
  ram: number;
  scoreGpu: number;
  scoreCpuSingle: number;
  scoreCpuMulti: number;
  scoreRam: number;
  total: number;
  percentile: number;
  aiTier: string | null;
  /** false when this run had no WebGPU — the card must say so */
  gpuMeasured: boolean;
  /** per-component measurement flags — an unmeasured cell renders "—" */
  measured: { gpu: boolean; cpuSingle: boolean; cpuMulti: boolean; ram: boolean };
  /** false ⇒ below the scoring floor */
  scorable: boolean;
}): string {
  const { score, tier, hash, gpuName, cores, gflops, ram,
          scoreGpu, scoreCpuSingle, scoreCpuMulti, scoreRam,
          total, percentile, aiTier, gpuMeasured, measured, scorable } = args;

  const basis: 'full' | 'cpu+ram' | 'gpu+cpu' | 'insufficient' =
    !scorable ? 'insufficient'
    : measured.gpu && measured.ram ? 'full'
    : measured.gpu ? 'gpu+cpu' : 'cpu+ram';
  const basisLabel =
    basis === 'full' ? tier.sub
    : basis === 'cpu+ram' ? 'CPU + RAM ONLY · GPU NOT MEASURED'
    : basis === 'gpu+cpu' ? 'GPU + CPU ONLY · MEMORY NOT MEASURED'
    : 'INCOMPLETE RUN · NOT SCORED';
  const poolName =
    basis === 'cpu+ram' ? 'CPU+RAM-only runs'
    : basis === 'gpu+cpu' ? 'GPU+CPU-only runs'
    : 'runs';

  // HTML-escape user-supplied strings before interpolating into the
  // workers-og template. gpu_name and ai_tier come from D1 → originally
  // submitted by client → could contain malformed markup. Satori sandbox
  // means no JS execution, but malformed HTML can still corrupt layout.
  const escape = (s: string | null | undefined): string =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const safeGpuName = escape(gpuName);
  const safeAiTier  = escape(aiTier);

  // Show percentile only when N ≥ minimum (matches in-page gate logic).
  // Counts are class-scoped, so name the pool rather than say "all runs".
  const percentileLine = !scorable
    ? 'Not scored — too few components measured'
    : total >= PERCENTILE_MIN_N
      ? (basis === 'full'
          ? `Faster than ${percentile}% of all runs · ${fmt(total)} tests submitted`
          : `Faster than ${percentile}% of ${poolName} · ${fmt(total)} in this pool`)
      : `Early days · ${fmt(total)} ${basis === 'full' ? '' : poolName.replace(' runs', '') + ' '}test${total === 1 ? '' : 's'} so far · percentile unlocks at 100+`;

  // Hardware sub-line — fall back gracefully when GPU is masked.
  // "hidden by browser" is the wrong cause when there was no WebGPU at all.
  const hwLine = gpuMeasured
    ? (safeGpuName ? `${safeGpuName} · ${cores}-core CPU` : `${cores}-core CPU · GPU hidden by browser`)
    : (safeGpuName ? `${safeGpuName} · ${cores}-core CPU · GPU not benchmarked`
                   : `${cores}-core CPU · GPU not benchmarked`);

  // AI tier badge — suppressed without a GPU measurement: it renders in
  // accent cyan like an achievement, and the tier it would show is derived
  // from hardware we never probed.
  const aiBadge = (safeAiTier && gpuMeasured) ? `
    <div style="
      display: flex; align-items: center; gap: 8px;
      padding: 6px 12px; border: 1px solid ${TOKENS.accent};
      background: rgba(0,217,255,0.06);
      font-family: 'JetBrains Mono', monospace; font-size: 13px;
      font-weight: 600; letter-spacing: 0.06em; color: ${TOKENS.accent};
      text-transform: uppercase;
    ">
      LOCAL AI · ${safeAiTier}
    </div>
  ` : '';

  return `
    <div style="
      width: 1200px; height: 630px; display: flex; flex-direction: column;
      background: ${TOKENS.bg};
      font-family: 'Inter', -apple-system, sans-serif;
      color: ${TOKENS.fg};
      position: relative;
    ">
      <!-- Top bar: Truth Series badge + URL -->
      <div style="
        display: flex; justify-content: space-between; align-items: center;
        padding: 32px 56px 0;
        border-bottom: 1px solid ${TOKENS.line};
        padding-bottom: 18px;
      ">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="
            width: 32px; height: 32px; background: ${TOKENS.accent};
            display: flex; align-items: center; justify-content: center;
            font-family: 'Inter', sans-serif; font-weight: 800; font-size: 18px;
            color: #000;
          ">9</div>
          <div style="
            font-family: 'JetBrains Mono', monospace; font-size: 14px;
            font-weight: 700; letter-spacing: 0.08em; color: ${TOKENS.accent};
            text-transform: uppercase; display: flex;
          ">9bench · Truth Series</div>
        </div>
        <div style="
          font-family: 'JetBrains Mono', monospace; font-size: 14px;
          color: ${TOKENS.fg3}; letter-spacing: 0.04em; display: flex;
        ">9bench.com/r/${hash}</div>
      </div>

      <!-- Main grid: score on left, tier + hardware on right -->
      <div style="
        flex: 1; display: flex; flex-direction: row; align-items: center;
        padding: 0 56px; gap: 48px;
      ">
        <!-- Score column -->
        <div style="display: flex; flex-direction: column; flex: 1.4;">
          <div style="
            font-family: 'JetBrains Mono', monospace; font-size: 13px;
            font-weight: 600; letter-spacing: 0.12em; color: ${TOKENS.fg3};
            text-transform: uppercase; display: flex; margin-bottom: 8px;
          ">9BENCH SCORE</div>
          <div style="
            font-family: 'Inter', sans-serif; font-weight: 800;
            font-size: 200px; line-height: 0.85; letter-spacing: -0.04em;
            color: ${TOKENS.fg}; display: flex; font-variant-numeric: tabular-nums;
          ">${fmt(score)}</div>
        </div>

        <!-- Tier + components column -->
        <div style="display: flex; flex-direction: column; flex: 1; gap: 18px;">
          <!-- Tier badge -->
          <div style="
            display: flex; flex-direction: column; gap: 4px;
            padding: 16px 20px;
            border: 1px solid ${tier.color};
            background: ${tier.bg};
          ">
            <div style="
              font-family: 'Inter', sans-serif; font-weight: 800;
              font-size: 56px; line-height: 0.9; letter-spacing: -0.02em;
              color: ${tier.color}; display: flex;
            ">${tier.label}</div>
            <div style="
              font-family: 'Inter', sans-serif; font-size: 16px;
              color: ${TOKENS.fg2}; display: flex;
            ">${basisLabel}</div>
          </div>

          ${aiBadge}

          <!-- Component breakdown (4 small cells) -->
          <div style="display: flex; gap: 0; border: 1px solid ${TOKENS.line};">
            ${([
              ['GPU',   measured.gpu ? fmt(scoreGpu) : '—'],
              ['CPU·1', measured.cpuSingle ? fmt(scoreCpuSingle) : '—'],
              ['CPU·M', measured.cpuMulti ? fmt(scoreCpuMulti) : '—'],
              ['RAM',   measured.ram ? fmt(scoreRam) : '—'],
            ] as Array<[string, string]>).map(([lbl, val], i) => `
              <div style="
                flex: 1; display: flex; flex-direction: column;
                padding: 10px 12px;
                ${i < 3 ? `border-right: 1px solid ${TOKENS.line};` : ''}
              ">
                <div style="
                  font-family: 'JetBrains Mono', monospace; font-size: 9px;
                  font-weight: 600; letter-spacing: 0.1em;
                  color: ${TOKENS.accent}; text-transform: uppercase;
                  display: flex;
                ">— ${lbl}</div>
                <div style="
                  font-family: 'Inter', sans-serif; font-weight: 700;
                  font-size: 22px; color: ${TOKENS.fg};
                  font-variant-numeric: tabular-nums; display: flex;
                ">${val}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- Bottom strip: hardware line + percentile -->
      <div style="
        padding: 18px 56px;
        border-top: 1px solid ${TOKENS.line};
        background: ${TOKENS.bg2};
        display: flex; flex-direction: column; gap: 6px;
      ">
        <div style="
          font-family: 'JetBrains Mono', monospace; font-size: 14px;
          color: ${TOKENS.fg2}; display: flex;
          font-variant-numeric: tabular-nums;
        ">${hwLine}${measured.gpu ? ` · ${gflops.toFixed(0)} GFLOPS` : ''}${measured.ram ? ` · ${ram.toFixed(1)} GB/s` : ''}</div>
        <div style="
          font-family: 'JetBrains Mono', monospace; font-size: 12px;
          color: ${TOKENS.fg3}; display: flex; letter-spacing: 0.04em;
        ">${percentileLine}</div>
      </div>

      <!-- Bottom accent bar (matches in-app trading card) -->
      <div style="
        width: 1200px; height: 6px; background: ${TOKENS.accent}; display: flex;
      "></div>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────
// Card 2 — GENERIC (homepage / fallback)
// ─────────────────────────────────────────────────────────────────────
function genericCard(): string {
  return `
    <div style="
      width: 1200px; height: 630px; display: flex; flex-direction: column;
      background: ${TOKENS.bg};
      font-family: 'Inter', -apple-system, sans-serif;
      color: ${TOKENS.fg};
      align-items: center; justify-content: center;
      position: relative;
    ">
      <!-- Editorial nameplate strip -->
      <div style="
        position: absolute; top: 32px; left: 56px; right: 56px;
        display: flex; justify-content: space-between; align-items: center;
        padding-bottom: 14px; border-bottom: 1px solid ${TOKENS.line};
        font-family: 'JetBrains Mono', monospace; font-size: 12px;
        letter-spacing: 0.1em; color: ${TOKENS.fg3};
        text-transform: uppercase;
      ">
        <div style="display: flex;">VOL. III · ISSUE 04 · APR 2026</div>
        <div style="display: flex;">TRUTH SERIES — HARDWARE EDITION</div>
        <div style="display: flex;">FREE · BROWSER · 0 MB</div>
      </div>

      <!-- Massive headline -->
      <div style="display: flex; flex-direction: column; align-items: center; padding: 0 60px;">
        <div style="
          font-family: 'JetBrains Mono', monospace; font-weight: 700;
          font-size: 130px; line-height: 0.85; letter-spacing: -0.055em;
          color: ${TOKENS.fg}; display: flex; text-align: center;
        ">Your PC<br/>in <span style="color: ${TOKENS.accent}; padding-left: 30px;">15</span><br/>seconds.</div>

        <div style="
          margin-top: 36px;
          font-family: 'Inter', sans-serif; font-size: 22px;
          color: ${TOKENS.fg2}; display: flex; text-align: center;
          max-width: 800px;
        ">
          The honest browser benchmark. CPU + GPU + RAM. No download. No vendor money.
        </div>
      </div>

      <!-- Bottom strip -->
      <div style="
        position: absolute; bottom: 0; left: 0;
        width: 1200px; padding: 16px 56px;
        background: ${TOKENS.bg2}; border-top: 1px solid ${TOKENS.line};
        display: flex; justify-content: space-between; align-items: center;
      ">
        <div style="
          font-family: 'JetBrains Mono', monospace; font-size: 14px;
          font-weight: 700; letter-spacing: 0.06em; color: ${TOKENS.accent};
          display: flex;
        ">9bench.com</div>
        <div style="
          font-family: 'JetBrains Mono', monospace; font-size: 12px;
          color: ${TOKENS.fg3}; letter-spacing: 0.04em; display: flex;
        ">Sister of Toololis · MIT licensed · Truth Series</div>
      </div>

      <!-- Accent bar -->
      <div style="
        position: absolute; top: 0; left: 0;
        width: 1200px; height: 4px; background: ${TOKENS.accent};
        display: flex;
      "></div>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────
// Card 3 — PAGE (top, compare, methodology, etc)
// ─────────────────────────────────────────────────────────────────────
function pageCard(p: { title: string; subtitle: string }): string {
  return `
    <div style="
      width: 1200px; height: 630px; display: flex; flex-direction: column;
      background: ${TOKENS.bg};
      font-family: 'Inter', sans-serif;
      color: ${TOKENS.fg};
    ">
      <div style="width: 1200px; height: 4px; background: ${TOKENS.accent}; display: flex;"></div>

      <div style="
        display: flex; justify-content: space-between; align-items: center;
        padding: 32px 56px 0;
      ">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="
            width: 32px; height: 32px; background: ${TOKENS.accent};
            display: flex; align-items: center; justify-content: center;
            font-weight: 800; font-size: 18px; color: #000;
          ">9</div>
          <div style="
            font-family: 'JetBrains Mono', monospace; font-size: 14px;
            font-weight: 700; letter-spacing: 0.08em; color: ${TOKENS.accent};
            text-transform: uppercase; display: flex;
          ">9bench · Truth Series</div>
        </div>
        <div style="
          font-family: 'JetBrains Mono', monospace; font-size: 13px;
          color: ${TOKENS.fg3}; letter-spacing: 0.04em; display: flex;
        ">9bench.com</div>
      </div>

      <div style="
        flex: 1; display: flex; flex-direction: column;
        align-items: center; justify-content: center; padding: 0 70px;
      ">
        <div style="
          font-family: 'JetBrains Mono', monospace; font-weight: 700;
          font-size: 76px; line-height: 0.95; letter-spacing: -0.04em;
          color: ${TOKENS.fg}; display: flex; text-align: center;
          max-width: 1060px;
        ">${p.title}</div>
        <div style="
          margin-top: 24px;
          font-family: 'Inter', sans-serif; font-size: 24px;
          color: ${TOKENS.fg2}; display: flex; text-align: center;
          max-width: 900px;
        ">${p.subtitle}</div>
      </div>

      <div style="
        padding: 18px 56px;
        background: ${TOKENS.bg2}; border-top: 1px solid ${TOKENS.line};
        display: flex; justify-content: space-between; align-items: center;
      ">
        <div style="
          font-family: 'JetBrains Mono', monospace; font-size: 14px;
          font-weight: 700; color: ${TOKENS.accent}; display: flex;
        ">Test your hardware · 15s · No download</div>
        <div style="
          font-family: 'JetBrains Mono', monospace; font-size: 12px;
          color: ${TOKENS.fg3}; display: flex;
        ">Sister of Toololis</div>
      </div>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────
// Card 4 — ARTICLE (cyan accent bar + bold title)
// ─────────────────────────────────────────────────────────────────────
function articleCard(a: { title: string }): string {
  return `
    <div style="
      width: 1200px; height: 630px; display: flex; flex-direction: column;
      background: ${TOKENS.bg};
      font-family: 'Inter', sans-serif;
      color: ${TOKENS.fg};
    ">
      <div style="width: 1200px; height: 4px; background: ${TOKENS.accent}; display: flex;"></div>

      <div style="
        display: flex; justify-content: space-between; align-items: center;
        padding: 32px 56px 0;
      ">
        <div style="
          font-family: 'JetBrains Mono', monospace; font-size: 13px;
          font-weight: 700; letter-spacing: 0.1em; color: ${TOKENS.accent};
          text-transform: uppercase; display: flex;
        ">// 9BENCH ARTICLES</div>
        <div style="
          font-family: 'JetBrains Mono', monospace; font-size: 13px;
          color: ${TOKENS.fg3}; display: flex;
        ">9bench.com</div>
      </div>

      <div style="
        flex: 1; display: flex; flex-direction: column;
        justify-content: center; padding: 0 70px;
      ">
        <div style="
          font-family: 'Inter', sans-serif; font-weight: 800;
          font-size: 64px; line-height: 1.1; letter-spacing: -0.025em;
          color: ${TOKENS.fg}; display: flex;
          max-width: 1060px;
        ">${a.title}</div>
      </div>

      <div style="
        padding: 18px 56px;
        background: ${TOKENS.bg2}; border-top: 1px solid ${TOKENS.line};
        display: flex; justify-content: space-between; align-items: center;
      ">
        <div style="
          font-family: 'JetBrains Mono', monospace; font-size: 13px;
          color: ${TOKENS.accent}; font-weight: 700; display: flex;
        ">9bench.com · Truth Series</div>
        <div style="
          font-family: 'JetBrains Mono', monospace; font-size: 12px;
          color: ${TOKENS.fg3}; display: flex;
        ">No vendor money. Open methodology.</div>
      </div>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────────────
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').slice(0, 16);
  const page = url.searchParams.get('p') || '';

  let html: string;
  // Result cards cache aggressively (immutable per hash); generic / page
  // cards cache for 24h; fallbacks shorter so we can update them faster.
  let cacheSeconds = 86400;

  // 1) Result card (personalized score) — Phase I rewrite
  if (/^[a-f0-9]{8}$/.test(id)) {
    let isResult = false;
    let cardHtml: string | null = null;

    try {
      const row = await env.DB.prepare(`
        SELECT score_overall, score_gpu, score_cpu_single, score_cpu_multi, score_ram,
               gpu_gflops, gpu_name, cpu_cores, cpu_hashes_single, cpu_hashes_multi,
               ram_read_gbs, ram_write_gbs,
               ai_tier
        FROM results WHERE id = ?
      `).bind(id).first<any>();

      if (row) {
        // Percentile must be scoped to the same measurement class as the
        // result page (functions/api/r/[id].ts), otherwise the shared card
        // and the page state different things about the same result: an
        // unfiltered count ranks a CPU+RAM-only score against GPU-inclusive
        // ones and crosses the N>=100 gate on a different total.
        const gpuMeasured = Number(row.gpu_gflops ?? 0) > 0;
        const multiMeasured = Number(row.cpu_hashes_multi ?? 0) > 0;
        const ramMeasured = Number(row.ram_read_gbs ?? 0) > 0 && Number(row.ram_write_gbs ?? 0) > 0;
        const scorable = multiMeasured && (gpuMeasured || ramMeasured);

        const POOL = `FROM results WHERE cpu_hashes_multi > 0
          AND (gpu_gflops > 0) = ?
          AND (ram_read_gbs > 0 AND ram_write_gbs > 0) = ?`;
        const totalRow = await env.DB.prepare(`SELECT COUNT(*) as c ${POOL}`)
          .bind(gpuMeasured ? 1 : 0, ramMeasured ? 1 : 0).first<{ c: number }>();
        const lowerRow = await env.DB.prepare(`SELECT COUNT(*) as c ${POOL} AND score_overall < ?`)
          .bind(gpuMeasured ? 1 : 0, ramMeasured ? 1 : 0, row.score_overall).first<{ c: number }>();
        const total = totalRow?.c || 1;
        const percentile = Math.round(((lowerRow?.c || 0) / total) * 100);

        cardHtml = resultCard({
          score:          row.score_overall,
          tier:           tierFor(row.score_overall),
          hash:           id,
          gpuName:        row.gpu_name || null,
          cores:          row.cpu_cores,
          gflops:         row.gpu_gflops,
          ram:            row.ram_read_gbs,
          scoreGpu:       row.score_gpu,
          scoreCpuSingle: row.score_cpu_single,
          scoreCpuMulti:  row.score_cpu_multi,
          scoreRam:       row.score_ram,
          total,
          percentile,
          aiTier:         row.ai_tier || null,
          gpuMeasured,
          measured: {
            gpu: gpuMeasured,
            cpuSingle: Number(row.cpu_hashes_single ?? 0) > 0,
            cpuMulti: multiMeasured,
            ram: ramMeasured,
          },
          scorable,
        });
        isResult = true;
      }
    } catch (e) {
      // Fall through to generic — never block social-share rendering
      console.warn('og.ts result lookup failed', (e as any)?.message);
    }

    html = isResult && cardHtml ? cardHtml : genericCard();

  // 2) Article card
  } else if (ARTICLES[page]) {
    html = articleCard(ARTICLES[page]);

  // 3) Static page card
  } else if (PAGES[page]) {
    html = pageCard(PAGES[page]);

  // 4) Generic fallback
  } else {
    html = genericCard();
    cacheSeconds = 3600;
  }

  return new ImageResponse(html, {
    width: 1200,
    height: 630,
    format: 'png',
    headers: {
      'cache-control': `public, max-age=${cacheSeconds}`,
      'content-type': 'image/png',
    },
  } as any);
};
