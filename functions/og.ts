// Dynamic OG image — generates personalized PNG per result ID
// Usage: /og?id=abc12345 returns 1200x630 PNG showing the score
//
// When a result URL is shared, social platforms unfurl /og?id=X via the
// og:image meta tag, getting a personalized score card.

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

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').slice(0, 16);

  let score = 0;
  let label = 'Test your hardware';
  let percentile: number | null = null;
  let total = 0;
  let cores = 0;
  let gflops = 0;
  let ram = 0;
  let cpuMulti = 0;
  let isResult = false;

  if (/^[a-f0-9]{8}$/.test(id)) {
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
        cpuMulti = row.score_cpu_multi;
        const v = verdictMeta(score);
        label = v.label;
        const totalRow = await env.DB.prepare('SELECT COUNT(*) as c FROM results').first<{ c: number }>();
        const lowerRow = await env.DB.prepare('SELECT COUNT(*) as c FROM results WHERE score_overall < ?').bind(score).first<{ c: number }>();
        total = totalRow?.c || 1;
        percentile = Math.round(((lowerRow?.c || 0) / total) * 100);
        isResult = true;
      }
    } catch (e) {
      // Fallback: render generic card
    }
  }

  const v = verdictMeta(score);

  const html = isResult ? `
    <div style="
      width: 1200px;
      height: 630px;
      display: flex;
      flex-direction: column;
      background: #0B1120;
      font-family: system-ui, sans-serif;
    ">
      <!-- Top accent -->
      <div style="
        width: 1200px;
        height: 12px;
        background: linear-gradient(90deg, #10B981 0%, #4F46E5 100%);
        display: flex;
      "></div>

      <!-- Header -->
      <div style="display: flex; justify-content: space-between; padding: 50px 70px 0 70px;">
        <div style="display: flex; flex-direction: column;">
          <div style="font-size: 22px; font-weight: 700; color: #10B981; letter-spacing: 0.5px; display: flex;">
            ⚡ TRUTH SERIES · HARDWARE
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

      <!-- Big score -->
      <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;">
        <div style="font-size: 180px; font-weight: 800; color: #F1F5F9; line-height: 1; letter-spacing: -3px; display: flex;">
          ${fmt(score)}
        </div>
        <div style="
          margin-top: 30px;
          padding: 14px 32px;
          border-radius: 32px;
          background: ${v.bg};
          border: 2px solid ${v.color};
          font-size: 26px;
          font-weight: 700;
          color: ${v.color};
          display: flex;
        ">
          ${v.icon} ${label}
        </div>
        ${percentile !== null ? `
        <div style="margin-top: 22px; font-size: 20px; color: #94A3B8; display: flex;">
          ${percentile}th percentile · ${fmt(total)} tests
        </div>` : ''}
      </div>

      <!-- Hardware row -->
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

      <!-- Footer -->
      <div style="
        width: 1200px;
        height: 60px;
        background: #4F46E5;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0 70px;
      ">
        <div style="font-size: 18px; font-weight: 700; color: #fff; display: flex;">🛠 9bench.com</div>
        <div style="font-size: 15px; font-weight: 500; color: #C7D2FE; display: flex;">Test your hardware · 15s · No download</div>
      </div>
    </div>
  ` : `
    <div style="
      width: 1200px;
      height: 630px;
      display: flex;
      flex-direction: column;
      background: linear-gradient(135deg, #0B1120 0%, #1E1B4B 100%);
      font-family: system-ui, sans-serif;
      align-items: center;
      justify-content: center;
    ">
      <div style="font-size: 28px; font-weight: 700; color: #10B981; letter-spacing: 0.5px; display: flex;">
        ⚡ TRUTH SERIES · HARDWARE
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
    </div>
  `;

  return new ImageResponse(html, {
    width: 1200,
    height: 630,
    format: 'png',
    headers: {
      'cache-control': isResult ? 'public, max-age=86400' : 'public, max-age=3600',
      'content-type': 'image/png'
    }
  } as any);
};
