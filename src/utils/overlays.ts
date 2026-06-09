import { invoke } from '@tauri-apps/api/core';
import { v4 as uuidv4 } from 'uuid';
import { Invokes } from '../components/ui/AppProperties';
import { Overlay } from './adjustments';

export interface OverlayAsset {
  source: string;
  name: string;
  category: string;
  contentBox?: number[] | null;
}

const ROOT_RE = /<svg\b[^>]*?\bwidth="([0-9.]+)"[^>]*?\bheight="([0-9.]+)"/is;
const VIEWBOX_RE = /<svg\b[^>]*?\bviewBox="[0-9.-]+\s+[0-9.-]+\s+([0-9.]+)\s+([0-9.]+)"/is;
const RECT_RE = /<rect\b[^>]*?\/>/is;
const FILL_RE = /(fill|stroke)="#[0-9a-f]{3,8}"/gi;

function numAttr(tag: string, name: string): number | null {
  const m = tag.match(new RegExp(`\\b${name}="([0-9.-]+)"`, 'i'));
  if (!m) {
    return null;
  }
  const v = parseFloat(m[1]);
  return Number.isFinite(v) ? v : null;
}

function rootDimensions(svg: string): [number, number] | null {
  const root = svg.match(ROOT_RE);
  if (root) {
    const w = parseFloat(root[1]);
    const h = parseFloat(root[2]);
    if (Number.isFinite(w) && Number.isFinite(h)) {
      return [w, h];
    }
  }
  const vb = svg.match(VIEWBOX_RE);
  if (vb) {
    const w = parseFloat(vb[1]);
    const h = parseFloat(vb[2]);
    if (Number.isFinite(w) && Number.isFinite(h)) {
      return [w, h];
    }
  }
  return null;
}

/**
 * Strips a single full-canvas opaque background <rect> (present on the "Design Layouts"
 * assets) so they act as transparent overlays, and optionally recolors every fill/stroke.
 * MUST stay in lockstep with `clean_and_recolor_svg` in `src-tauri/src/overlay_processing.rs`
 * so the live preview and the baked export match.
 */
export function cleanAndRecolorSvg(svg: string, color: string | null): string {
  let out = svg;

  const dims = rootDimensions(out);
  if (dims) {
    const [rw, rh] = dims;
    const m = out.match(RECT_RE);
    if (m && m.index !== undefined) {
      const tag = m[0];
      const w = numAttr(tag, 'width');
      const h = numAttr(tag, 'height');
      const x = numAttr(tag, 'x');
      const y = numAttr(tag, 'y');
      const approx = (a: number, b: number) => Math.abs(a - b) <= 0.5;
      const xZero = x === null || Math.abs(x) <= 0.5;
      const yZero = y === null || Math.abs(y) <= 0.5;
      if (w !== null && h !== null && approx(w, rw) && approx(h, rh) && xZero && yZero) {
        out = out.slice(0, m.index) + out.slice(m.index + tag.length);
      }
    }
  }

  if (color) {
    out = out.replace(FILL_RE, `$1="${color}"`);
  }

  return out;
}

export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Tightens an SVG's viewBox to its content box (normalized [x,y,w,h]) so it renders without margins. */
export function frameSvgToContent(svg: string, contentBox?: number[] | null): string {
  if (!contentBox || contentBox.length !== 4) {
    return svg;
  }
  const dims = rootDimensions(svg);
  if (!dims) {
    return svg;
  }
  const [sw, sh] = dims;
  const [bx, by, bw, bh] = contentBox;
  const w = bw * sw;
  const h = bh * sh;
  if (w <= 0 || h <= 0) {
    return svg;
  }
  const viewBox = `${(bx * sw).toFixed(2)} ${(by * sh).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}`;
  let out = svg.replace(/viewBox="[^"]*"/i, `viewBox="${viewBox}"`);
  out = out.replace(/(<svg\b[^>]*?)\bwidth="[^"]*"/i, `$1width="${w.toFixed(2)}"`);
  out = out.replace(/(<svg\b[^>]*?)\bheight="[^"]*"/i, `$1height="${h.toFixed(2)}"`);
  return out;
}

let catalogCache: OverlayAsset[] | null = null;
const rawSvgCache = new Map<string, string>();
const imageCache = new Map<string, HTMLImageElement>();

export async function listOverlayAssets(): Promise<OverlayAsset[]> {
  if (catalogCache) {
    return catalogCache;
  }
  const assets = await invoke<OverlayAsset[]>(Invokes.ListOverlayAssets);
  catalogCache = assets;
  return assets;
}

export async function getRawOverlaySvg(source: string): Promise<string> {
  const cached = rawSvgCache.get(source);
  if (cached) {
    return cached;
  }
  const svg = await invoke<string>(Invokes.GetOverlayAsset, { source });
  rawSvgCache.set(source, svg);
  return svg;
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load overlay image'));
    img.src = url;
  });
}

/** Loads (and caches) a recolored, background-stripped overlay as an HTMLImageElement for Konva. */
export async function loadOverlayImage(source: string, color: string | null): Promise<HTMLImageElement> {
  const key = `${source}|${color ?? ''}`;
  const cached = imageCache.get(key);
  if (cached) {
    return cached;
  }
  const raw = await getRawOverlaySvg(source);
  const processed = cleanAndRecolorSvg(raw, color);
  const img = await loadImageElement(svgToDataUrl(processed));
  imageCache.set(key, img);
  return img;
}

export function createOverlay(asset: OverlayAsset): Overlay {
  return {
    id: uuidv4(),
    name: asset.name,
    source: asset.source,
    visible: true,
    x: 0.5,
    y: 0.5,
    scale: 0.3,
    rotation: 0,
    color: null,
    opacity: 100,
    contentBox: asset.contentBox ?? null,
  };
}

export type AutoPattern = 'corners' | 'edges' | 'scatter' | 'grid' | 'bento';

export const AUTO_PATTERNS: AutoPattern[] = ['corners', 'edges', 'scatter', 'grid', 'bento'];

export interface AutoArrangeOptions {
  pattern: AutoPattern;
  count: number;
  // Base overlay width as a fraction of the image's smaller dimension.
  size: number;
  // 0..1 — how much per-overlay size varies around `size`.
  sizeRandomness: number;
}

const MARGIN = 0.13;

function jitter(amount: number): number {
  return (Math.random() * 2 - 1) * amount;
}

function perimeterPoint(t: number): [number, number] {
  const span = 1 - 2 * MARGIN;
  const perimeter = 4 * span;
  let d = ((t % 1) + 1) % 1;
  d *= perimeter;
  if (d < span) {
    return [MARGIN + d, MARGIN];
  }
  d -= span;
  if (d < span) {
    return [1 - MARGIN, MARGIN + d];
  }
  d -= span;
  if (d < span) {
    return [1 - MARGIN - d, 1 - MARGIN];
  }
  d -= span;
  return [MARGIN, 1 - MARGIN - d];
}

function sampleCandidate(pattern: AutoPattern, attempt: number, cols: number, rows: number): [number, number] {
  const span = 1 - 2 * MARGIN;
  if (pattern === 'corners') {
    const anchors: Array<[number, number]> = [
      [MARGIN, MARGIN],
      [1 - MARGIN, MARGIN],
      [MARGIN, 1 - MARGIN],
      [1 - MARGIN, 1 - MARGIN],
      [0.5, MARGIN],
      [0.5, 1 - MARGIN],
      [MARGIN, 0.5],
      [1 - MARGIN, 0.5],
    ];
    const [ax, ay] = anchors[Math.floor(Math.random() * anchors.length)];
    // Spread further from the anchor on later attempts so items can pack around each corner.
    const spread = 0.03 + attempt * 0.004;
    return [ax + jitter(spread), ay + jitter(spread)];
  }
  if (pattern === 'edges') {
    return perimeterPoint(Math.random());
  }
  if (pattern === 'scatter') {
    return [MARGIN + Math.random() * span, MARGIN + Math.random() * span];
  }
  // grid / bento: snap to a random grid cell (bento jitters more for an irregular look).
  const cell = Math.floor(Math.random() * cols * rows);
  const c = cell % cols;
  const r = Math.floor(cell / cols);
  const jit = pattern === 'bento' ? 0.025 : 0;
  return [MARGIN + ((c + 0.5) / cols) * span + jitter(jit), MARGIN + ((r + 0.5) / rows) * span + jitter(jit)];
}

/**
 * Auto-arranges up to `count` random graphics from `assets` across the frame using the chosen
 * pattern, with randomized sizes/rotation. Placement is collision-aware (overlays never overlap),
 * so the number actually placed may be fewer than `count` when they don't all fit.
 */
export function generateAutoOverlays(
  opts: AutoArrangeOptions,
  assets: OverlayAsset[],
  imageWidth: number,
  imageHeight: number,
): Overlay[] {
  if (assets.length === 0 || opts.count < 1) {
    return [];
  }

  const w = imageWidth > 0 ? imageWidth : 1;
  const h = imageHeight > 0 ? imageHeight : 1;
  const minDim = Math.min(w, h);
  // Bento exaggerates size variation for a mixed-scale look.
  const randomness = opts.pattern === 'bento' ? Math.max(opts.sizeRandomness, 0.5) : opts.sizeRandomness;
  const rotates = opts.pattern === 'scatter' || opts.pattern === 'bento';

  // Place largest first — it packs better.
  const sizes = Array.from({ length: opts.count }, () =>
    Math.max(0.03, Math.min(1, opts.size * (1 + jitter(randomness)))),
  ).sort((a, b) => b - a);

  const cols = Math.max(1, Math.ceil(Math.sqrt(opts.count)));
  const rows = Math.max(1, Math.ceil(opts.count / cols));
  const SPACING = 0.92;

  const placed: Array<{ x: number; y: number; scale: number }> = [];
  // Approximate each overlay as a circle of radius scale/2 (in min-dimension units); reject overlaps.
  const overlaps = (x: number, y: number, scale: number) =>
    placed.some((p) => {
      const dx = ((x - p.x) * w) / minDim;
      const dy = ((y - p.y) * h) / minDim;
      return Math.hypot(dx, dy) < ((scale + p.scale) / 2) * SPACING;
    });

  for (const scale of sizes) {
    for (let attempt = 0; attempt < 80; attempt++) {
      let [x, y] = sampleCandidate(opts.pattern, attempt, cols, rows);
      x = Math.max(0.02, Math.min(0.98, x));
      y = Math.max(0.02, Math.min(0.98, y));
      if (!overlaps(x, y, scale)) {
        placed.push({ x, y, scale });
        break;
      }
    }
  }

  return placed.map((p) => {
    const asset = assets[Math.floor(Math.random() * assets.length)];
    return {
      ...createOverlay(asset),
      x: p.x,
      y: p.y,
      scale: p.scale,
      rotation: rotates ? Math.round(jitter(12)) : 0,
    };
  });
}
