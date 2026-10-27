import { Rng } from '@fungus/engine';

/**
 * Each player gets a distinct colour AND a distinct pattern — the original's
 * tie-dye, triangles, stripes and squiggles — so fungi stay distinguishable
 * for colour-blind players and at a glance on tiny screens.
 */
export type PatternKind = 'blotch' | 'triangles' | 'stripes' | 'squiggle';

export interface PlayerStyle {
  name: string;
  base: string;
  accent: string;
  edge: string;
  face: string;
  pattern: PatternKind;
}

const KINDS: PatternKind[] = ['blotch', 'triangles', 'stripes', 'squiggle'];

/** First four are the 1994 colour set; the rest serve 5–16 player games. */
const COLORS: [string, string, string, string, string][] = [
  ['Red', '#d8261c', '#ff7a52', '#6e0c07', '#ff9b80'],
  ['Green', '#239650', '#c8f3d5', '#0b4322', '#8fe0ad'],
  ['Blue', '#2c34c4', '#e3379a', '#10135a', '#9aa0ff'],
  ['Yellow', '#f2cf1d', '#2a9d55', '#7a6400', '#fff08a'],
  ['Orange', '#ee7a12', '#ffd08a', '#6a3200', '#ffbd7a'],
  ['Purple', '#7b2fbf', '#e2b8ff', '#33104f', '#c79bf0'],
  ['Cyan', '#14a7c2', '#e7fbff', '#044a57', '#8ee5f2'],
  ['Pink', '#e0539a', '#ffe0ef', '#6a1840', '#ffa8cf'],
  ['Lime', '#8ac220', '#2c5a00', '#3d5a00', '#d0f080'],
  ['Brown', '#8a5a2b', '#f0c890', '#3a220a', '#d6a878'],
  ['Teal', '#0f8a7a', '#bff5ea', '#033d36', '#7fd8ca'],
  ['Navy', '#1c2f6e', '#7fb0ff', '#070f2a', '#7f95d6'],
  ['Magenta', '#b0179c', '#ffd0f5', '#4a0640', '#ea86da'],
  ['Olive', '#7a7a1e', '#eeee9a', '#33330a', '#cfcf7a'],
  ['Salmon', '#f08070', '#7a1e10', '#7a2c22', '#ffc0b5'],
  ['Slate', '#5a6b7a', '#e3edf5', '#202a33', '#b5c3cf'],
];

export const PLAYER_STYLES: PlayerStyle[] = COLORS.map(([name, base, accent, edge, face], i) => ({
  name,
  base,
  accent,
  edge,
  face,
  pattern: KINDS[i % 4]!,
}));

/** Size of one pattern tile in CSS pixels before scaling. */
export const TILE = 48;

/** Same hue at zero alpha, so gradients fade without a dark halo. */
function transparent(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0)`;
}

function wrapDraw(draw: (dx: number, dy: number) => void): void {
  for (const dx of [-TILE, 0, TILE]) for (const dy of [-TILE, 0, TILE]) draw(dx, dy);
}

/** Build a seamless pattern tile for a player style (deterministic per index). */
export function makeTile(style: PlayerStyle, index: number, scale: number): HTMLCanvasElement {
  const px = Math.max(8, Math.round(TILE * scale));
  const cv = document.createElement('canvas');
  cv.width = px;
  cv.height = px;
  const g = cv.getContext('2d')!;
  g.scale(px / TILE, px / TILE);
  const rng = new Rng(0xf0f0 + index * 7919);
  g.fillStyle = style.base;
  g.fillRect(0, 0, TILE, TILE);
  g.fillStyle = style.accent;
  g.strokeStyle = style.accent;

  switch (style.pattern) {
    case 'blotch': {
      // Tie-dye: soft overlapping blooms.
      for (let i = 0; i < 9; i++) {
        const x = rng.next() * TILE;
        const y = rng.next() * TILE;
        const r = 4 + rng.next() * 9;
        wrapDraw((dx, dy) => {
          const grad = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
          grad.addColorStop(0, style.accent);
          grad.addColorStop(1, transparent(style.accent));
          g.fillStyle = grad;
          g.beginPath();
          g.arc(x + dx, y + dy, r, 0, Math.PI * 2);
          g.fill();
        });
      }
      break;
    }
    case 'triangles': {
      const s = TILE / 4;
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) {
          g.beginPath();
          g.moveTo(x * s, y * s);
          g.lineTo(x * s + s, y * s);
          g.lineTo(x * s, y * s + s);
          g.closePath();
          g.fill();
        }
      break;
    }
    case 'stripes': {
      g.lineWidth = 4;
      for (let k = -TILE; k <= TILE * 2; k += 12) {
        g.beginPath();
        g.moveTo(k, 0);
        g.lineTo(k - TILE, TILE);
        g.stroke();
      }
      break;
    }
    case 'squiggle': {
      g.lineWidth = 2.5;
      g.lineCap = 'round';
      for (let row = 0; row < 4; row++) {
        const y0 = row * 12 + 6;
        const phase = rng.next() * Math.PI * 2;
        g.beginPath();
        for (let x = 0; x <= TILE; x += 2) {
          const y = y0 + Math.sin((x / TILE) * Math.PI * 4 + phase) * 3;
          if (x === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
      break;
    }
  }
  return cv;
}

/** Draw a fungus head: a little face, like the original. */
export type FaceMood = 'active' | 'idle' | 'dead';

export function drawFace(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  style: PlayerStyle,
  mood: FaceMood | boolean,
): void {
  const m: FaceMood = mood === true ? 'active' : mood === false ? 'idle' : mood;
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size * 0.42;
  g.save();
  g.fillStyle = style.face;
  g.strokeStyle = '#000';
  g.lineWidth = Math.max(1, Math.min(size / 14, 3 + size / 40));
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#000';
  const eye = Math.max(1, size * 0.07);
  if (m === 'dead') {
    // X eyes and a wobbly frown.
    const e = r * 0.2;
    g.beginPath();
    for (const ex of [cx - r * 0.38, cx + r * 0.38]) {
      g.moveTo(ex - e, cy - r * 0.2 - e);
      g.lineTo(ex + e, cy - r * 0.2 + e);
      g.moveTo(ex + e, cy - r * 0.2 - e);
      g.lineTo(ex - e, cy - r * 0.2 + e);
    }
    g.stroke();
    g.beginPath();
    g.arc(cx, cy + r * 0.62, r * 0.4, 1.15 * Math.PI, 1.85 * Math.PI);
    g.stroke();
    g.restore();
    return;
  }
  g.beginPath();
  g.arc(cx - r * 0.38, cy - r * 0.2, eye, 0, Math.PI * 2);
  g.arc(cx + r * 0.38, cy - r * 0.2, eye, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  if (m === 'active') g.arc(cx, cy + r * 0.05, r * 0.5, 0.15 * Math.PI, 0.85 * Math.PI);
  else {
    g.moveTo(cx - r * 0.4, cy + r * 0.4);
    g.lineTo(cx + r * 0.4, cy + r * 0.4);
  }
  g.stroke();
  g.restore();
}

/** A tooth marker, like the original's corner ▼. */
export function drawTooth(g: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  g.save();
  g.fillStyle = '#fff';
  g.strokeStyle = '#000';
  g.lineWidth = Math.max(1, size / 16);
  g.beginPath();
  g.moveTo(x + size * 0.2, y + size * 0.25);
  g.lineTo(x + size * 0.8, y + size * 0.25);
  g.lineTo(x + size * 0.5, y + size * 0.8);
  g.closePath();
  g.fill();
  g.stroke();
  g.restore();
}
