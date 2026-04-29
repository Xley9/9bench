// Dynamic OG image generator — per-page + per-result PNG cards
// Routes:
//   /og            → generic 9bench card
//   /og?id=abc123  → personalized result score card (D1 lookup)
//   /og?p=top      → static page card (top, compare, faq, etc.)
//   /og?p=slug     → article card with gradient + emoji

import { ImageResponse } from 'workers-og';

interface Env {
  DB: D1Database;
}

function fmt(n: number): string {
  return Number(n).toLocaleString('en-US');
}

function verdictMeta(score: number) {
  if (score >= 4000) return { label: 'Elite tier — top 5%', color: '#10B981', bg: '#064E3B', icon: '🏆' };
  if (score >= 2500) return { label: 'High-end performer', color: '#10B981', bg: '#065F46', icon: '✓' };
  if (score >= 1700) return { label: 'Strong mainstream', color: '#0EA5E9', bg: '#075985', icon: '◯' };
  if (score >= 1000) return { label: 'Mid-range standard', color: '#0EA5E9', bg: '#075985', icon: '~' };
  if (score >= 500) return { label: 'Mainstream / older', color: '#F59E0B', bg: '#78350F', icon: '~' };
  return { label: 'Office / Chromebook tier', color: '#DC2626', bg: '#7F1D1D', icon: '⚠' };
}

// ── Article metadata (gradient OG cards) ─────────────────────────────
const ARTICLES: Record<string, { title: string; emoji: string; c1: string; c2: string }> = {
  'userbenchmark-alternatives-2026': {
    title: 'UserBenchmark Alternatives 2026',
    emoji: '🚫', c1: '#DC2626', c2: '#7F1D1D'
  },
  'how-to-test-cpu-gpu-ram-online-no-download': {
    title: 'How to Test CPU, GPU & RAM Online — No Download',
    emoji: '🛠️', c1: '#10B981', c2: '#065F46'
  },
  'geekbench-vs-cinebench-vs-9bench': {
    title: 'Geekbench vs Cinebench vs 9bench',
    emoji: '⚖️', c1: '#0EA5E9', c2: '#075985'
  },
  'what-is-gflops-gpu-performance-explained': {
    title: 'What Is GFLOPS? GPU Performance Explained',
    emoji: '🎮', c1: '#7C3AED', c2: '#4C1D95'
  },
  'how-many-cpu-cores-do-you-need-2026': {
    title: 'How Many CPU Cores Do You Need in 2026?',
    emoji: '⚙️', c1: '#F59E0B', c2: '#78350F'
  },
  'why-browser-benchmarks-score-lower-than-native': {
    title: 'Why Browser Benchmarks Score Lower Than Native',
    emoji: '🔬', c1: '#0891B2', c2: '#155E75'
  },
  'complete-guide-online-hardware-benchmarking-2026': {
    title: 'Complete Guide to Online Hardware Benchmarking',
    emoji: '📚', c1: '#4F46E5', c2: '#312E81'
  }
};

// ── Static page metadata ─────────────────────────────────────────────
const PAGES: Record<string, { title: string; emoji: string; subtitle: string }> = {
  top: {
    title: 'Top Scores Leaderboard',
    emoji: '🏆',
    subtitle: 'The fastest hardware benchmark scores worldwide'
  },
  compare: {
    title: 'Compare Benchmark Results',
    emoji: '⚖️',
    subtitle: 'Side-by-side CPU, GPU & RAM comparison'
  },
  history: {
    title: 'Your Test History',
    emoji: '📊',
    subtitle: 'Track your hardware performance over time'
  },
  faq: {
    title: 'Frequently Asked Questions',
    emoji: '❓',
    subtitle: 'How 9bench works, accuracy, privacy & more'
  },
  methodology: {
    title: 'Methodology',
    emoji: '🔬',
    subtitle: 'How 9bench measures CPU, GPU & RAM performance'
  },
  about: {
    title: 'About 9bench',
    emoji: '💡',
    subtitle: 'Why 9bench exists and what Truth Series means'
  },
  articles: {
    title: 'Articles',
    emoji: '📰',
    subtitle: 'Hardware benchmarking insights & guides'
  }
};

// ── HTML Templates ───────────────────────────────────────────────────

function articleCard(a: { title: string; emoji: string; c1: string; c2: string }): string {
  return `
    <div style="
      width: 1200px; height: 630px; display: flex; flex-direction: column;
      background: linear-gradient(135deg, ${a.c1} 0%, ${a.c2} 100%);
      font-family: system-ui, sans-serif;
    ">
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 44px 70px 0;">
        <div style="font-size: 20px; font-weight: 700; color: rgba(255,255,255,0.85); letter-spacing: 0.5px; display: flex;">
          9BENCH · ARTICLES
        </div>
        <div style="font-size: 18px; font-weight: 600; color: rgba(255,255,255,0.6); display: flex;">9bench.com</div>
      </div>
      <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 0 80px;">
        <div style="font-size: 52px; font-weight: 800; color: #fff; line-height: 1.2; display: flex; text-align: center; max-width: 1040px;">
          ${a.title}
        </div>
      </div>
      <div style="
        width: 1200px; height: 56px; display: flex;
        background: rgba(0,0,0,0.35);
        justify-content: space-between; align-items: center; padding: 0 70px;
      ">
        <div style="font-size: 17px; font-weight: 700; color: #fff; display: flex;">9bench.com</div>
        <div style="font-size: 14px; font-weight: 500; color: rgba(255,255,255,0.7); display: flex;">The honest browser benchmark</div>
      </div>
    </div>`;
}

function pageCard(p: { title: string; emoji: string; subtitle: string }): string {
  return `
    <div style="
      width: 1200px; height: 630px; display: flex; flex-direction: column;
      background: #0B1120;
      font-family: system-ui, sans-serif;
    ">
      <div style="width: 1200px; height: 12px; background: linear-gradient(90deg, #10B981 0%, #4F46E5 100%); display: flex;"></div>
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 44px 70px 0;">
        <div style="font-size: 22px; font-weight: 700; color: #10B981; letter-spacing: 0.5px; display: flex;">
          TRUTH SERIES · HARDWARE
        </div>
        <div style="font-size: 18px; font-weight: 600; color: #94A3B8; display: flex;">9bench.com</div>
      </div>
      <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;">
        <div style="font-size: 60px; font-weight: 800; color: #F1F5F9; line-height: 1.15; display: flex; text-align: center; max-width: 1000px;">
          ${p.title}
        </div>
        <div style="font-size: 24px; color: #94A3B8; margin-top: 20px; display: flex;">
          ${p.subtitle}
        </div>
      </div>
      <div style="
        width: 1200px; height: 56px; background: #4F46E5; display: flex;
        justify-content: space-between; align-items: center; padding: 0 70px;
      ">
        <div style="font-size: 17px; font-weight: 700; color: #fff; display: flex;">9bench.com</div>
        <div style="font-size: 14px; font-weight: 500; color: #C7D2FE; display: flex;">Test your hardware · 15s · No download</div>
      </div>
    </div>`;
}

function resultCard(score: number, label: string, v: ReturnType<typeof verdictMeta>,
  percentile: number | null, total: number, gflops: number, cores: number, ram: number): string {
  return `
    <div style="
      width: 1200px; height: 630px; display: flex; flex-direction: column;
      background: #0B1120; font-family: system-ui, sans-serif;
    ">
      <div style="width: 1200px; height: 12px; background: linear-gradient(90deg, #10B981 0%, #4F46E5 100%); display: flex;"></div>
      <div style="display: flex; justify-content: space-between; padding: 50px 70px 0 70px;">
        <div style="display: flex; flex-direction: column;">
          <div style="font-size: 22px; font-weight: 700; color: #10B981; letter-spacing: 0.5px; display: flex;">
            TRUTH SERIES · HARDWARE
          </div>
          <div style="font-size: 38px; font-weight: 800; color: #F1F5F9; margin-top: 10px; display: flex;">
            9BENCH SCORE
          </div>
        </div>
        <div style="display: flex; flex-direction: column; align-items: flex-end;">
          <div style="font-size: 18px; font-weight: 600; color: #94A3B8; display: flex;">9bench.com</div>
          <div style="font-size: 14px; color: #64748B; margin-top: 6px; display: flex;">The honest browser benchmark</div>
        </div>
      </div>
      <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;">
        <div style="font-size: 180px; font-weight: 800; color: #F1F5F9; line-height: 1; letter-spacing: -3px; display: flex;">
          ${fmt(score)}
        </div>
        <div style="
          margin-top: 30px; padding: 14px 32px; border-radius: 32px;
          background: ${v.bg}; border: 2px solid ${v.color};
          font-size: 26px; font-weight: 700; color: ${v.color}; display: flex;
        ">
          ${v.icon} ${label}
        </div>
        ${percentile !== null ? `
        <div style="margin-top: 22px; font-size: 20px; color: #94A3B8; display: flex;">
          ${percentile}th percentile · ${fmt(total)} tests
        </div>` : ''}
      </div>
      <div style="display: flex; justify-content: space-around; padding: 0 70px; margin-bottom: 30px;">
        <div style="display: flex; flex-direction: column; align-items: center;">
          <div style="font-size: 14px; color: #64748B; text-transform: uppercase; letter-spacing: 0.5px; display: flex;">GPU</div>
          <div style="font-size: 24px; font-weight: 700; color: #10B981; margin-top: 4px; display: flex;">${gflops.toFixed(0)} GFLOPS</div>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center;">
          <div style="font-size: 14px; color: #64748B; text-transform: uppercase; letter-spacing: 0.5px; display: flex;">CPU</div>
          <div style="font-size: 24px; font-weight: 700; color: #10B981; margin-top: 4px; display: flex;">${cores} cores</div>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center;">
          <div style="font-size: 14px; color: #64748B; text-transform: uppercase; letter-spacing: 0.5px; display: flex;">RAM</div>
          <div style="font-size: 24px; font-weight: 700; color: #10B981; margin-top: 4px; display: flex;">${ram.toFixed(1)} GB/s</div>
        </div>
      </div>
      <div style="
        width: 1200px; height: 60px; background: #4F46E5; display: flex;
        justify-content: space-between; align-items: center; padding: 0 70px;
      ">
        <div style="font-size: 18px; font-weight: 700; color: #fff; display: flex;">9bench.com</div>
        <div style="font-size: 15px; font-weight: 500; color: #C7D2FE; display: flex;">Test your hardware · 15s · No download</div>
      </div>
    </div>`;
}

function genericCard(): string {
  return `
    <div style="
      width: 1200px; height: 630px; display: flex; flex-direction: column;
      background: linear-gradient(135deg, #0B1120 0%, #1E1B4B 100%);
      font-family: system-ui, sans-serif; align-items: center; justify-content: center;
    ">
      <div style="font-size: 28px; font-weight: 700; color: #10B981; letter-spacing: 0.5px; display: flex;">
        TRUTH SERIES · HARDWARE
      </div>
      <div style="font-size: 140px; font-weight: 800; color: #F1F5F9; line-height: 1; margin-top: 30px; display: flex;">
        9bench
      </div>
      <div style="font-size: 32px; font-weight: 600; color: #C7D2FE; margin-top: 30px; display: flex;">
        The honest browser benchmark
      </div>
      <div style="font-size: 24px; color: #94A3B8; margin-top: 16px; display: flex;">
        Test your CPU + GPU + RAM in 15 seconds
      </div>
      <div style="font-size: 20px; color: #64748B; margin-top: 60px; display: flex;">
        9bench.com · No download · No bias · No account
      </div>
    </div>`;
}

// ── Main handler ─────────────────────────────────────────────────────

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').slice(0, 16);
  const page = url.searchParams.get('p') || '';

  let html: string;
  let cacheSeconds = 86400; // 24h default for static pages

  // 1) Result card (personalized score)
  if (/^[a-f0-9]{8}$/.test(id)) {
    let score = 0, cores = 0, gflops = 0, ram = 0;
    let label = 'Test your hardware';
    let percentile: number | null = null;
    let total = 0;
    let isResult = false;

    try {
      const row = await env.DB.prepare(`
        SELECT score_overall, score_gpu, score_cpu_multi, score_ram, gpu_gflops, cpu_cores, ram_read_gbs
        FROM results WHERE id = ?
      `).bind(id).first<any>();
      if (row) {
        score = row.score_overall;
        cores = row.cpu_cores;
        gflops = row.gpu_gflops;
        ram = row.ram_read_gbs;
        label = verdictMeta(score).label;
        const totalRow = await env.DB.prepare('SELECT COUNT(*) as c FROM results').first<{ c: number }>();
        const lowerRow = await env.DB.prepare('SELECT COUNT(*) as c FROM results WHERE score_overall < ?').bind(score).first<{ c: number }>();
        total = totalRow?.c || 1;
        percentile = Math.round(((lowerRow?.c || 0) / total) * 100);
        isResult = true;
      }
    } catch (e) { /* fallback to generic */ }

    if (isResult) {
      html = resultCard(score, label, verdictMeta(score), percentile, total, gflops, cores, ram);
    } else {
      html = genericCard();
    }

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
      'content-type': 'image/png'
    }
  } as any);
};
