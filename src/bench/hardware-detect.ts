// 9bench — Honest Hardware Detection
//
// PRINCIPLE (Truth Series): we only report what the browser HONESTLY exposes.
// We never infer hardware from performance characteristics ("RTX 4070-class")
// because that's guesswork dressed as data. If the browser hides it, we say so.
//
// Sources of real hardware data (in priority order):
//
//   1. WebGL UNMASKED_RENDERER_WEBGL via WEBGL_debug_renderer_info extension
//      → industry-standard GPU detection, works in Chrome/Edge/Safari, often
//        in Firefox. Returns strings like "ANGLE (NVIDIA GeForce RTX 4070...)"
//        or "Apple M2 Pro" or "AMD Radeon RX 6800 XT (radeonsi, navi21, ...)".
//
//   2. WebGPU navigator.gpu.requestAdapter().info
//      → fields vendor, architecture, device, description. Chrome usually
//        populates vendor + architecture (e.g. "intel", "intel-arc") but
//        leaves description/device empty. Used as fallback.
//
//   3. navigator.userAgent (+ userAgentData when available)
//      → Browser + OS detection. Real, honest, never inferred.
//
//   4. navigator.hardwareConcurrency
//      → Logical CPU cores. Real (capped by browser to mitigate fingerprinting).
//
//   5. navigator.deviceMemory  (Chrome only)
//      → Approximate RAM in GB, rounded to 0.25/0.5/1/2/4/8 (capped at 8
//        for privacy). Marked as "approx" in UI when used.
//
// What we explicitly DO NOT do:
//   - Infer CPU model from SHA-256 throughput
//   - Infer GPU model from GFLOPS rate
//   - Estimate "RAM size" from bandwidth tests
//   - Guess at NVIDIA driver version, AMD chipset codename, etc.
//
// If the browser blocks GPU info (Firefox in strict privacy, Tor Browser,
// some Brave configurations), we expose an `unknown: true` flag so the UI
// can render a manual-input fallback ("Add your hardware") rather than
// fabricate.

export interface HardwareInfo {
  // Always populated (real, not inferred):
  cpu: {
    cores: number;
    /** From userAgent — Apple Silicon / Intel / AMD architecture hint, or null */
    archHint: string | null;
  };
  ram: {
    /** navigator.deviceMemory result (Chrome only). Null elsewhere. */
    deviceMemoryGB: number | null;
    /** True when we used deviceMemory (which is rounded + capped at 8GB). */
    isApproximate: boolean;
  };
  gpu: {
    /** Best-quality string we could obtain. Empty if all sources blocked. */
    name: string;
    /**
     * Where the name came from (provenance for transparency):
     *   webgl              — UNMASKED_RENDERER_WEBGL via WEBGL_debug_renderer_info
     *   webgpu-info        — WebGPU adapter.info.description / .device
     *   webgpu-vendor-arch — Only WebGPU vendor + architecture available
     *   self-reported      — User typed it in via manual-input fallback
     *   unknown            — No source available; UI shows manual-input prompt
     */
    source: 'webgl' | 'webgpu-info' | 'webgpu-vendor-arch' | 'self-reported' | 'unknown';
    /** Vendor extracted/normalized (NVIDIA / AMD / Intel / Apple / etc.) */
    vendor: string | null;
    /** True when no real GPU string was obtained — UI should offer manual input. */
    unknown: boolean;
  };
  browser: {
    name: string;
    version: string;
    os: string;
    osVersion: string;
    /** True when running in privacy-focused / strict modes that limit detection. */
    privacyMode: boolean;
  };
  /** When detection ran. Useful for cache invalidation. */
  detectedAt: number;
}


/* ─────────────────────────────────────────────────────────────────────
   GPU DETECTION
   ─────────────────────────────────────────────────────────────────────
   Order of attempts:
     1. WebGL2 UNMASKED_RENDERER (most informative on Chrome/Edge/Safari)
     2. WebGL1 UNMASKED_RENDERER (older browsers)
     3. WebGPU adapter.info.description / .device / vendor + architecture
     4. Mark unknown — never guess
   ──────────────────────────────────────────────────────────────────── */

interface GpuDetection {
  name: string;
  source: HardwareInfo['gpu']['source'];
  vendor: string | null;
}

function detectGPUFromWebGL(): GpuDetection | null {
  try {
    const canvas = document.createElement('canvas');
    // Try WebGL2 first (more modern), fall back to WebGL1
    const gl = (canvas.getContext('webgl2') ||
                canvas.getContext('webgl') ||
                canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return null;

    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return null;

    const rendererParam = (ext as any).UNMASKED_RENDERER_WEBGL;
    const vendorParam = (ext as any).UNMASKED_VENDOR_WEBGL;
    if (rendererParam == null) return null;

    const renderer = gl.getParameter(rendererParam);
    const vendor = gl.getParameter(vendorParam);

    if (!renderer || typeof renderer !== 'string') return null;

    return {
      name: cleanupRendererString(renderer),
      source: 'webgl',
      vendor: extractVendor(renderer, vendor)
    };
  } catch {
    return null;
  }
}

/**
 * Strip noisy ANGLE / Direct3D / driver-version cruft from the renderer string
 * to produce something a human would actually share on Reddit.
 *
 * Examples:
 *   "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002786) Direct3D11 vs_5_0 ps_5_0, D3D11)"
 *     → "NVIDIA GeForce RTX 4070"
 *   "Apple GPU"
 *     → "Apple GPU"
 *   "AMD Radeon RX 6800 XT (radeonsi, navi21, LLVM 15.0.7, DRM 3.42, 5.15.0-58-generic)"
 *     → "AMD Radeon RX 6800 XT"
 */
function cleanupRendererString(raw: string): string {
  let s = raw.trim();

  // Strip ANGLE wrapper: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x...) Direct3D11 vs_5_0, D3D11)"
  const angleMatch = s.match(/^ANGLE\s*\(([^,]+),\s*([^,)]+(?:\([^)]*\))?[^,)]*)/i);
  if (angleMatch) {
    s = angleMatch[2].trim();
  }

  // Strip device IDs in parentheses: "RTX 4070 (0x00002786)" → "RTX 4070"
  s = s.replace(/\s*\(0x[0-9a-fA-F]+\)/g, '');

  // Strip driver/Direct3D suffixes: "RTX 4070 Direct3D11 vs_5_0 ps_5_0" → "RTX 4070"
  s = s.replace(/\s+Direct3D\d+.*$/i, '');
  s = s.replace(/\s+OpenGL\s+ES\s+[\d.]+.*$/i, '');
  s = s.replace(/\s+vs_\d+_\d+.*$/i, '');

  // Strip Linux Mesa parenthetical: "RX 6800 XT (radeonsi, navi21, LLVM ...)"
  s = s.replace(/\s*\((?:radeonsi|nouveau|i965|iris|llvmpipe|softpipe)[^)]*\)/i, '');

  // Strip generic driver parentheticals when they're long noise
  s = s.replace(/\s*\([^)]{40,}\)/g, '');

  return s.trim();
}

function extractVendor(renderer: string, vendorString: unknown): string | null {
  const r = renderer.toLowerCase();
  const v = typeof vendorString === 'string' ? vendorString.toLowerCase() : '';

  // Order matters: more specific brands first
  if (r.includes('nvidia') || v.includes('nvidia')) return 'NVIDIA';
  if (r.includes('geforce') || r.includes('quadro') || r.includes('rtx') || r.includes('gtx')) return 'NVIDIA';
  if (r.includes('radeon') || r.includes('amd') || v.includes('amd') || v.includes('ati')) return 'AMD';
  if (r.includes('apple') || v.includes('apple')) return 'Apple';
  if (r.includes('intel') || v.includes('intel')) return 'Intel';
  if (r.includes('adreno')) return 'Qualcomm';
  if (r.includes('mali')) return 'ARM';
  if (r.includes('powervr')) return 'Imagination';
  return null;
}

/**
 * WebGPU adapter info is the secondary GPU source. It can return useful
 * vendor + architecture even when WebGL is fully masked.
 */
async function detectGPUFromWebGPU(): Promise<GpuDetection | null> {
  try {
    if (!('gpu' in navigator)) return null;
    const adapter = await (navigator as any).gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return null;
    const info = adapter.info || {};
    // Order of preference within WebGPU:
    if (info.description && typeof info.description === 'string' && info.description.length > 2) {
      return {
        name: cleanupRendererString(info.description),
        source: 'webgpu-info',
        vendor: extractVendor(info.description, info.vendor)
      };
    }
    if (info.device && typeof info.device === 'string' && info.device.length > 2) {
      return {
        name: info.device,
        source: 'webgpu-info',
        vendor: extractVendor(info.device, info.vendor)
      };
    }
    // Last resort: combine vendor + architecture, e.g. "intel intel-arc"
    if (info.vendor && info.architecture) {
      const composed = `${info.vendor} ${info.architecture}`.replace(/-/g, ' ');
      return {
        name: titleCase(composed),
        source: 'webgpu-vendor-arch',
        vendor: extractVendor(composed, info.vendor)
      };
    }
    return null;
  } catch {
    return null;
  }
}

function titleCase(s: string): string {
  return s.split(/\s+/).map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');
}

/**
 * Read a previously self-reported GPU name from localStorage. Returns null
 * on any failure (private mode, quota exceeded, parse error). Length-capped
 * defensively in case storage was tampered with.
 */
function readSelfReportedGPU(): string | null {
  try {
    const stored = localStorage.getItem('9bench:manual-gpu');
    if (!stored || typeof stored !== 'string') return null;
    const trimmed = stored.trim().slice(0, 80);
    return trimmed.length > 1 ? trimmed : null;
  } catch {
    return null;
  }
}


/* ─────────────────────────────────────────────────────────────────────
   BROWSER + OS DETECTION
   ─────────────────────────────────────────────────────────────────────
   We use userAgentData when available (Chromium 90+) since it's the
   privacy-respecting modern API. Fall back to userAgent string parsing.
   ──────────────────────────────────────────────────────────────────── */

interface BrowserDetection {
  name: string;
  version: string;
  os: string;
  osVersion: string;
  privacyMode: boolean;
}

function detectBrowser(): BrowserDetection {
  const ua = navigator.userAgent || '';
  const uaData = (navigator as any).userAgentData;
  let name = 'Unknown';
  let version = '';
  let os = 'Unknown';
  let osVersion = '';

  // ── Browser ──
  if (/Edg\/(\d+)/.test(ua)) {
    name = 'Edge';
    version = RegExp.$1;
  } else if (/OPR\/(\d+)/.test(ua) || /Opera\/(\d+)/.test(ua)) {
    name = 'Opera';
    version = RegExp.$1;
  } else if (/Brave/.test(ua) || (uaData?.brands || []).some((b: any) => /brave/i.test(b.brand))) {
    name = 'Brave';
    version = (uaData?.brands || []).find((b: any) => /brave/i.test(b.brand))?.version || '';
  } else if (/Chrome\/(\d+)/.test(ua) && !/Chromium/.test(ua)) {
    name = 'Chrome';
    version = RegExp.$1;
  } else if (/Chromium\/(\d+)/.test(ua)) {
    name = 'Chromium';
    version = RegExp.$1;
  } else if (/Firefox\/(\d+)/.test(ua)) {
    name = 'Firefox';
    version = RegExp.$1;
  } else if (/Version\/(\d+).*Safari/.test(ua)) {
    name = 'Safari';
    version = RegExp.$1;
  }

  // ── OS ──
  if (/Windows NT (\d+\.\d+)/.test(ua)) {
    os = 'Windows';
    const ntVer = RegExp.$1;
    osVersion = ntVer === '10.0' ? '10/11' : ntVer;
  } else if (/Mac OS X (\d+[_\.]\d+)/.test(ua)) {
    os = 'macOS';
    osVersion = RegExp.$1.replace(/_/g, '.');
  } else if (/Android (\d+)/.test(ua)) {
    os = 'Android';
    osVersion = RegExp.$1;
  } else if (/iPhone OS (\d+_\d+)/.test(ua) || /iPad.*OS (\d+_\d+)/.test(ua)) {
    os = 'iOS';
    osVersion = RegExp.$1.replace(/_/g, '.');
  } else if (/Linux/.test(ua)) {
    os = 'Linux';
  } else if (/CrOS/.test(ua)) {
    os = 'ChromeOS';
  }

  // ── Privacy mode hints ──
  // Firefox with privacy.resistFingerprinting locks UA to a generic value.
  // Tor / Brave Strict often produce shorter than expected UA strings.
  // We use this to inform UI ("your browser may hide hardware info").
  const privacyMode =
    ua === 'Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/115.0' ||  // RFP signature
    /Tor/i.test(ua) ||
    ua.length < 80;

  return { name, version, os, osVersion, privacyMode };
}


/* ─────────────────────────────────────────────────────────────────────
   CPU ARCHITECTURE HINT
   ─────────────────────────────────────────────────────────────────────
   We can't get the CPU model. But we can hint at the architecture
   based on userAgent + platform combinations. This is descriptive,
   not predictive (we say "arm64-class" not "Apple M2").
   ──────────────────────────────────────────────────────────────────── */

function detectCPUArchHint(browser: BrowserDetection): string | null {
  const ua = navigator.userAgent || '';
  const uaData = (navigator as any).userAgentData;

  // userAgentData.architecture is the modern, accurate source when present
  if (uaData && uaData.architecture) {
    const arch = uaData.architecture; // 'x86' | 'arm'
    const bitness = uaData.bitness || ''; // '32' | '64' (sometimes available)
    if (arch === 'arm') return browser.os === 'macOS' ? 'Apple Silicon (arm64)' : `arm${bitness ? bitness : ''}`;
    if (arch === 'x86') return `x86${bitness ? '_' + bitness : '_64'}`;
  }

  // Fallback: parse userAgent
  if (browser.os === 'macOS') {
    // Mac UA doesn't disclose architecture directly; userAgentData is the only way
    return null;
  }
  if (/WOW64|Win64|x64/.test(ua)) return 'x86_64';
  if (/Win32/.test(ua)) return 'x86_32';
  if (/aarch64|arm64/i.test(ua)) return 'arm64';
  if (/armv\d/i.test(ua)) return 'arm32';
  return null;
}


/* ─────────────────────────────────────────────────────────────────────
   PUBLIC API
   ──────────────────────────────────────────────────────────────────── */

/**
 * Detect hardware honestly. Never infers, never guesses.
 * Caller should treat `gpu.unknown === true` as the signal to offer
 * a manual-input fallback ("Add your hardware") in the UI.
 *
 * Detection priority for GPU:
 *   1. Live browser detection (WebGL renderer string, then WebGPU adapter)
 *      — this always wins when available because real hardware can change
 *        between sessions (eGPU plug, dual-GPU laptop switching, new driver)
 *   2. Cached self-reported value from a prior session (localStorage)
 *      — only used when live detection fails. Source flagged as
 *        'self-reported' so the UI keeps provenance transparent.
 */
export async function detectHardware(): Promise<HardwareInfo> {
  const browser = detectBrowser();

  // GPU: try WebGL first (more reliable for getting a human-readable name),
  // fall back to WebGPU info if WebGL is masked.
  let gpuDetect = detectGPUFromWebGL();
  if (!gpuDetect) {
    gpuDetect = await detectGPUFromWebGPU();
  }

  let gpu: HardwareInfo['gpu'];
  if (gpuDetect) {
    gpu = { name: gpuDetect.name, source: gpuDetect.source, vendor: gpuDetect.vendor, unknown: false };
  } else {
    // Check for prior self-reported value before declaring unknown
    const cachedSelfReport = readSelfReportedGPU();
    if (cachedSelfReport) {
      gpu = {
        name: cachedSelfReport,
        source: 'self-reported',
        vendor: extractVendor(cachedSelfReport, ''),
        unknown: false
      };
    } else {
      gpu = { name: '', source: 'unknown', vendor: null, unknown: true };
    }
  }

  // RAM: navigator.deviceMemory is Chrome-specific and capped at 8GB for privacy.
  // We always mark this as approximate so the UI can show "≈ 8 GB" not "8 GB".
  const deviceMemory = (navigator as any).deviceMemory;
  const ram: HardwareInfo['ram'] = {
    deviceMemoryGB: typeof deviceMemory === 'number' ? deviceMemory : null,
    isApproximate: typeof deviceMemory === 'number'
  };

  // CPU
  const cpu: HardwareInfo['cpu'] = {
    cores: navigator.hardwareConcurrency || 0,
    archHint: detectCPUArchHint(browser)
  };

  return {
    cpu,
    ram,
    gpu,
    browser,
    detectedAt: Date.now()
  };
}


/* ─────────────────────────────────────────────────────────────────────
   FORMAT HELPERS — for UI display
   ──────────────────────────────────────────────────────────────────── */

/**
 * Renders a GPU name for display. When unknown, returns a string that
 * makes the unknownness obvious so the user is prompted to add manually.
 */
export function formatGPU(gpu: HardwareInfo['gpu']): string {
  if (gpu.unknown || !gpu.name) {
    return 'Browser hides this — add manually';
  }
  return gpu.name;
}

/**
 * Renders the data-source provenance for transparency tooltips.
 * Real strings users can verify — never fabricated.
 */
export function formatGPUSource(gpu: HardwareInfo['gpu']): string {
  switch (gpu.source) {
    case 'webgl':              return 'detected via WebGL';
    case 'webgpu-info':        return 'detected via WebGPU adapter info';
    case 'webgpu-vendor-arch': return 'WebGPU vendor + architecture only';
    case 'self-reported':      return 'user-provided (manual input)';
    case 'unknown':            return 'no source available';
  }
}

export function formatBrowser(b: HardwareInfo['browser']): string {
  return b.version ? `${b.name} ${b.version}` : b.name;
}

export function formatOS(b: HardwareInfo['browser']): string {
  return b.osVersion ? `${b.os} ${b.osVersion}` : b.os;
}

export function formatRAM(ram: HardwareInfo['ram']): string {
  if (ram.deviceMemoryGB == null) return 'Browser hides this';
  // deviceMemory is rounded by the browser to 0.25/0.5/1/2/4/8 and capped at 8.
  // The "≈" prefix is critical for honesty: a 32GB machine reports 8.
  if (ram.deviceMemoryGB >= 8) return '≥ 8 GB (browser cap)';
  return `≈ ${ram.deviceMemoryGB} GB`;
}
