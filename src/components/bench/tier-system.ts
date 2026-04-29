/**
 * 9bench Tier System
 *
 * Anti-shame tier scheme: top half gets shareable letters (S/A),
 * bottom half gets descriptive labels (no D-tier stigma).
 * Source: 9bench Redesign drop, ASTRO-MAPPING.md §"Tier system".
 *
 * Sharing math: people screenshot S/A. People do NOT screenshot
 * "D-tier". Descriptive labels for the bottom 50% maintain dignity
 * while still being honest about performance class.
 */

export interface Tier {
  /** Internal key — used in storage and analytics, not shown to user. */
  key: 'S' | 'A' | 'B' | 'C' | 'D';
  /** Threshold (inclusive) — score must be ≥ min to qualify. */
  min: number;
  /** User-visible label. Letters for top, words for bottom. */
  label: string;
  /** Sub-label / classification description. */
  sub: string;
  /** CSS color hint for letter tiers. */
  color: string;
}

export const TIERS: readonly Tier[] = [
  { key: 'S', min: 1386, label: 'S-tier',              sub: 'Enthusiast / workstation',     color: 'var(--accent)' },
  { key: 'A', min: 900,  label: 'A-tier',              sub: 'Power user',                   color: 'var(--good)'   },
  { key: 'B', min: 600,  label: 'Solid daily driver',  sub: 'Comfortable for most work',    color: 'var(--fg)'     },
  { key: 'C', min: 300,  label: 'Working machine',     sub: 'Office class',                 color: 'var(--fg-2)'   },
  { key: 'D', min: 0,    label: 'Patient & honest',    sub: 'It still gets the job done',   color: 'var(--fg-3)'   },
];

/**
 * Resolve a score to its tier. Falls back to lowest tier if no match
 * (impossible in practice since min=0 catches everything, but defensive).
 */
export function tierFor(score: number): Tier {
  return TIERS.find(t => score >= t.min) ?? TIERS[TIERS.length - 1];
}

/**
 * Convenience for share-text generation:
 * "9bench: 1386 (S-tier) — 76th percentile globally."
 */
export function shareText(score: number, percentile?: number): string {
  const tier = tierFor(score);
  const pctSuffix = percentile != null ? ` — ${percentile}th percentile globally.` : '.';
  return `9bench: ${score.toLocaleString()} (${tier.label})${pctSuffix}`;
}

/**
 * Threshold below which percentile rankings are unreliable. UI should
 * render <EarlyDaysNotice> instead of percentile when total < this.
 */
export const PERCENTILE_MIN_N = 100;
