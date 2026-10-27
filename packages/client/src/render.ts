import type { GameState, Pos } from '@fungus/engine';
import { PLAYER_STYLES, TILE, TILE_CELLS, drawFace, drawTooth, makeTile } from './textures';

export interface Overlay {
  /** Piece preview under the cursor. */
  ghost?: { cells: Pos[]; player: number; valid: boolean };
  /** Bite line being dragged. */
  bite?: { cells: Pos[]; valid: boolean };
  /** Cells that can start a bite (shown while in bite mode). */
  biteStarts?: Pos[];
  /** Bite start under the cursor before pressing. */
  biteHover?: Pos;
}

/** A player being eaten: their fungus turns into the killer's, rippling out from the head. */
interface Death {
  victim: number;
  killer: number;
  head: Pos;
  cells: { pos: Pos; at: number }[];
  t0: number;
  end: number;
}

interface Effect {
  cells: Pos[];
  kind: 'flash' | 'die' | 'bite';
  t0: number;
}

/** What part of the board is on screen, in cell units. */
export interface Camera {
  /** Centre of the view. */
  cx: number;
  cy: number;
  /** How many cells fit across the (square) view. */
  across: number;
}

const EFFECT_MS = 380;
const DEATH_FACE_MS = 650;
const DEATH_STEP_MS = 45;
const DEATH_MAX_SPREAD_MS = 1100;
const CONVERT_FLASH_MS = 260;
const GLIDE_MS = 380;
/** Closest zoom: about 4×4 cells. */
export const MIN_ACROSS = 4;
const BOARD_BG = '#c9c9c9';
const GRID = '#b3b3b3';

export class BoardRenderer {
  readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  /** View size in CSS px (the canvas is square). */
  private side = 300;
  private n = 20;
  cam: Camera = { cx: 10, cy: 10, across: 20 };
  private glide: { from: Camera; to: Camera; t0: number } | null = null;
  private tiles = new Map<string, CanvasPattern>();
  private effects: Effect[] = [];
  private deaths: Death[] = [];
  private raf = 0;
  private last: { s: GameState; o: Overlay } | null = null;
  private reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** Called after every frame so the minimap can follow the camera. */
  onFrame: (() => void) | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  // ------------------------------------------------------------ layout & camera

  /** Fit the canvas to its parent; call on resize. Keeps the camera. */
  resize(boardSize: number): void {
    const first = this.n !== boardSize;
    this.n = boardSize;
    const parent = this.canvas.parentElement!;
    this.side = Math.max(160, Math.floor(Math.min(parent.clientWidth, parent.clientHeight)));
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.style.width = `${this.side}px`;
    this.canvas.style.height = `${this.side}px`;
    this.canvas.width = Math.round(this.side * this.dpr);
    this.canvas.height = Math.round(this.side * this.dpr);
    if (first) this.cam = this.fitCam();
    this.cam = this.clamp(this.cam);
    this.redrawLast();
  }

  private fitCam(): Camera {
    return { cx: this.n / 2, cy: this.n / 2, across: this.n };
  }

  private clamp(c: Camera): Camera {
    const n = this.n;
    const across = Math.min(n, Math.max(Math.min(MIN_ACROSS, n), c.across));
    if (across >= n) return { cx: n / 2, cy: n / 2, across: n };
    const h = across / 2;
    return { across, cx: Math.min(n - h, Math.max(h, c.cx)), cy: Math.min(n - h, Math.max(h, c.cy)) };
  }

  get zoomedIn(): boolean {
    return this.cam.across < this.n - 0.01;
  }

  /** Visible board area in cell units. */
  view(): { r0: number; c0: number; r1: number; c1: number } {
    const h = this.cam.across / 2;
    return { r0: this.cam.cy - h, c0: this.cam.cx - h, r1: this.cam.cy + h, c1: this.cam.cx + h };
  }

  /** Zoom by `factor` (>1 = closer) keeping the cell under the given screen point fixed. */
  zoomAt(factor: number, clientX?: number, clientY?: number): void {
    this.glide = null;
    const before = this.cam;
    const across = before.across / factor;
    const rect = this.canvas.getBoundingClientRect();
    const fx = clientX === undefined ? 0.5 : (clientX - rect.left) / rect.width;
    const fy = clientY === undefined ? 0.5 : (clientY - rect.top) / rect.height;
    const wx = before.cx - before.across / 2 + fx * before.across;
    const wy = before.cy - before.across / 2 + fy * before.across;
    this.cam = this.clamp({ across, cx: wx - fx * across + across / 2, cy: wy - fy * across + across / 2 });
    this.redrawLast();
  }

  /** Pan by a screen-pixel delta. */
  panBy(dxPx: number, dyPx: number): void {
    this.glide = null;
    const k = this.cam.across / this.side;
    this.cam = this.clamp({ ...this.cam, cx: this.cam.cx - dxPx * k, cy: this.cam.cy - dyPx * k });
    this.redrawLast();
  }

  /** Pan by a fraction of the view (keyboard). */
  panView(fx: number, fy: number): void {
    this.glideTo({ ...this.cam, cx: this.cam.cx + fx * this.cam.across, cy: this.cam.cy + fy * this.cam.across });
  }

  /** Smoothly move the camera (instant with reduced motion). */
  glideTo(target: Partial<Camera>): void {
    const to = this.clamp({ ...this.cam, ...target });
    if (this.reduceMotion) {
      this.cam = to;
      this.redrawLast();
      return;
    }
    this.glide = { from: { ...this.cam }, to, t0: performance.now() };
    this.kick();
  }

  fit(): void {
    this.glideTo(this.fitCam());
  }

  /** Centre on a cell, zooming in to a comfortable size if we're looking at the whole big board. */
  centreOn(p: Pos, comfortableAcross = 20): void {
    const across = this.cam.across > comfortableAcross ? Math.min(this.n, comfortableAcross) : this.cam.across;
    this.glideTo({ cx: p.c + 0.5, cy: p.r + 0.5, across });
  }

  isVisible(p: Pos): boolean {
    const v = this.view();
    return p.c + 1 > v.c0 && p.c < v.c1 && p.r + 1 > v.r0 && p.r < v.r1;
  }

  // ------------------------------------------------------------ coordinates

  /** Device-pixel x of a cell column edge (snapped so cells tile without seams). */
  private X(c: number): number {
    const k = (this.side * this.dpr) / this.cam.across;
    return Math.round((c - (this.cam.cx - this.cam.across / 2)) * k);
  }
  private Y(r: number): number {
    const k = (this.side * this.dpr) / this.cam.across;
    return Math.round((r - (this.cam.cy - this.cam.across / 2)) * k);
  }
  /** Device pixels per cell (unsnapped). */
  private get CS(): number {
    return (this.side * this.dpr) / this.cam.across;
  }

  cellAt(clientX: number, clientY: number, size: number): Pos | null {
    const p = this.pointAt(clientX, clientY);
    const r = Math.floor(p.r);
    const c = Math.floor(p.c);
    return r >= 0 && c >= 0 && r < size && c < size ? { r, c } : null;
  }

  /** Fractional cell coordinate under a screen point. */
  pointAt(clientX: number, clientY: number): { r: number; c: number } {
    const rect = this.canvas.getBoundingClientRect();
    const k = this.cam.across / rect.width;
    return {
      c: this.cam.cx - this.cam.across / 2 + (clientX - rect.left) * k,
      r: this.cam.cy - this.cam.across / 2 + (clientY - rect.top) * k,
    };
  }

  // ------------------------------------------------------------ patterns

  /** Board-anchored pattern for a player, from a tile cached at a resolution near the current zoom. */
  private pattern(i: number): CanvasPattern {
    const want = this.CS * TILE_CELLS; // anchored to the board so every repeat lands on a cell
    const px = Math.min(1024, Math.max(32, 2 ** Math.ceil(Math.log2(want))));
    const key = `${i}:${px}`;
    let p = this.tiles.get(key);
    if (!p) {
      p = this.ctx.createPattern(makeTile(PLAYER_STYLES[i]!, i, px / TILE), 'repeat')!;
      this.tiles.set(key, p);
    }
    const k = want / px;
    p.setTransform(new DOMMatrix([k, 0, 0, k, this.X(0), this.Y(0)]));
    return p;
  }

  // ------------------------------------------------------------ animation

  addEffect(cells: Pos[], kind: Effect['kind']): void {
    if (this.reduceMotion || cells.length === 0) return;
    this.effects.push({ cells, kind, t0: performance.now() });
    this.kick();
  }

  addDeath(victim: number, killer: number, head: Pos, cells: Pos[]): void {
    if (this.reduceMotion) return;
    const dist = (q: Pos) => Math.hypot(q.r - head.r, q.c - head.c);
    const far = Math.max(1, ...cells.map(dist));
    const k = Math.min(DEATH_STEP_MS, DEATH_MAX_SPREAD_MS / far);
    const t0 = performance.now();
    const list = cells.map((pos) => ({ pos, at: DEATH_FACE_MS + dist(pos) * k }));
    const end = t0 + Math.max(DEATH_FACE_MS, ...list.map((c) => c.at)) + CONVERT_FLASH_MS;
    this.deaths.push({ victim, killer, head, cells: list, t0, end });
    this.kick();
  }

  busyFor(): number {
    const end = Math.max(0, ...this.deaths.map((d) => d.end));
    return Math.max(0, end - performance.now());
  }

  private kick(): void {
    if (this.raf) return;
    const tick = () => {
      this.raf = 0;
      this.redrawLast();
      if (this.effects.length || this.deaths.length || this.glide) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private redrawLast(): void {
    if (this.last) this.draw(this.last.s, this.last.o);
  }

  // ------------------------------------------------------------ drawing

  draw(s: GameState, o: Overlay = {}): void {
    this.last = { s, o };
    const now = performance.now();
    if (this.glide) {
      const t = Math.min(1, (now - this.glide.t0) / GLIDE_MS);
      const e = 1 - (1 - t) ** 3;
      const { from, to } = this.glide;
      this.cam = {
        cx: from.cx + (to.cx - from.cx) * e,
        cy: from.cy + (to.cy - from.cy) * e,
        across: from.across + (to.across - from.across) * e,
      };
      if (t >= 1) this.glide = null;
    }

    const g = this.ctx;
    const n = s.size;
    const D = this.dpr;
    const CS = this.CS;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Visible cell range (with a one-cell margin).
    const v = this.view();
    const r0 = Math.max(0, Math.floor(v.r0) - 1);
    const c0 = Math.max(0, Math.floor(v.c0) - 1);
    const r1 = Math.min(n - 1, Math.ceil(v.r1) + 1);
    const c1 = Math.min(n - 1, Math.ceil(v.c1) + 1);
    const box = (r: number, c: number): [number, number, number, number] => {
      const x = this.X(c);
      const y = this.Y(r);
      return [x, y, this.X(c + 1) - x, this.Y(r + 1) - y];
    };

    // Board + grid.
    g.fillStyle = BOARD_BG;
    g.fillRect(this.X(0), this.Y(0), this.X(n) - this.X(0), this.Y(n) - this.Y(0));
    const thin = Math.max(1, Math.round(D));
    g.fillStyle = GRID;
    for (let c = c0; c <= c1 + 1; c++) g.fillRect(this.X(c), this.Y(r0), thin, this.Y(r1 + 1) - this.Y(r0));
    for (let r = r0; r <= r1 + 1; r++) g.fillRect(this.X(c0), this.Y(r), this.X(c1 + 1) - this.X(c0), thin);

    // Fungus cells.
    const at = (r: number, c: number) => (r < 0 || c < 0 || r >= n || c >= n ? -1 : s.cells[r * n + c]!);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const val = s.cells[r * n + c]!;
        const [x, y, w, h] = box(r, c);
        if (val) {
          g.fillStyle = this.pattern(val - 1);
          g.fillRect(x, y, w, h);
        } else if (s.teeth[r * n + c]) drawTooth(g, x, y, w);
      }

    // Deaths in progress: cells not yet reached still show the victim's pattern.
    this.deaths = this.deaths.filter((d) => now < d.end);
    for (const d of this.deaths) {
      const t = now - d.t0;
      for (const { pos, at: when } of d.cells) {
        const [x, y, w, h] = box(pos.r, pos.c);
        if (t < when) {
          g.fillStyle = this.pattern(d.victim);
          g.fillRect(x, y, w, h);
        } else if (t < when + CONVERT_FLASH_MS) {
          g.fillStyle = `rgba(255,255,255,${0.85 * (1 - (t - when) / CONVERT_FLASH_MS)})`;
          g.fillRect(x, y, w, h);
        }
      }
    }

    // Cell grid over fungus so you can count cells inside a blob.
    g.fillStyle = 'rgba(0,0,0,0.2)';
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        if (!s.cells[r * n + c]) continue;
        const [x, y, w, h] = box(r, c);
        g.fillRect(x, y, w, thin);
        g.fillRect(x, y, thin, h);
      }

    // Outline each fungus where it meets something else — keeps blobs crisp.
    const edge = Math.max(thin, Math.min(Math.round(CS / 12), Math.round(4 * D)));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const val = s.cells[r * n + c]!;
        if (!val) continue;
        const [x, y, w, h] = box(r, c);
        g.fillStyle = PLAYER_STYLES[val - 1]!.edge;
        if (at(r - 1, c) !== val) g.fillRect(x, y, w, edge);
        if (at(r + 1, c) !== val) g.fillRect(x, y + h - edge, w, edge);
        if (at(r, c - 1) !== val) g.fillRect(x, y, edge, h);
        if (at(r, c + 1) !== val) g.fillRect(x + w - edge, y, edge, h);
      }

    // Heads.
    s.players.forEach((p, i) => {
      if (!p.alive) return;
      const [x, y, w] = box(p.head.r, p.head.c);
      drawFace(g, x, y, w, PLAYER_STYLES[i]!, i === s.current ? 'active' : 'idle');
    });

    // Dying heads: X-eyes that pop, wobble and fade, with a shockwave ring.
    for (const d of this.deaths) {
      const t = now - d.t0;
      const st = PLAYER_STYLES[d.victim]!;
      const [hx, hy, hw] = box(d.head.r, d.head.c);
      const cx = hx + hw / 2;
      const cy = hy + hw / 2;
      const ring = Math.min(1, t / (DEATH_FACE_MS + 300));
      if (ring < 1) {
        g.strokeStyle = st.edge;
        g.globalAlpha = 1 - ring;
        g.lineWidth = Math.max(2 * D, CS / 6) * (1 - ring) + D;
        g.beginPath();
        g.arc(cx, cy, CS * (0.6 + ring * 4), 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
      const faceT = t / (DEATH_FACE_MS + 400);
      if (faceT < 1) {
        const pop = faceT < 0.2 ? 1 + faceT * 2.5 : 1.5 - (faceT - 0.2) * 0.9;
        const size = CS * pop;
        g.save();
        g.globalAlpha = faceT < 0.6 ? 1 : 1 - (faceT - 0.6) / 0.4;
        g.translate(cx, cy);
        g.rotate(Math.sin(t / 45) * 0.18 * (1 - faceT));
        drawFace(g, -size / 2, -size / 2, size, st, 'dead');
        g.restore();
      }
    }

    // Bite-start markers: white-and-black boxes that read on any pattern.
    if (o.biteStarts) {
      for (const q of o.biteStarts) {
        const [x, y, w] = box(q.r, q.c);
        const m = Math.max(2 * D, w * 0.18);
        g.lineWidth = Math.min(5 * D, Math.max(2 * D, w / 9));
        g.strokeStyle = '#fff';
        g.strokeRect(x + m, y + m, w - 2 * m, w - 2 * m);
        g.lineWidth = Math.min(2 * D, Math.max(D, w / 20));
        g.strokeStyle = '#000';
        g.strokeRect(x + m, y + m, w - 2 * m, w - 2 * m);
      }
    }
    if (o.biteHover && !o.bite) {
      const [x, y, w, h] = box(o.biteHover.r, o.biteHover.c);
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fillRect(x, y, w, h);
    }

    // Ghost piece.
    if (o.ghost) {
      g.globalAlpha = o.ghost.valid ? 0.75 : 0.35;
      g.fillStyle = o.ghost.valid ? this.pattern(o.ghost.player) : '#777';
      for (const q of o.ghost.cells) if (q.r >= 0 && q.c >= 0 && q.r < n && q.c < n) g.fillRect(...box(q.r, q.c));
      g.globalAlpha = 1;
      g.strokeStyle = o.ghost.valid ? '#000' : '#a00';
      // Dash and stroke grow with zoom but stay crisp, not cartoonish, up close.
      const dash = Math.min(8 * D, Math.max(2 * D, CS / 6));
      g.setLineDash([dash, dash]);
      g.lineWidth = Math.min(3 * D, Math.max(D, CS / 14));
      for (const q of o.ghost.cells) {
        const [x, y, w, h] = box(q.r, q.c);
        g.strokeRect(x + D, y + D, w - 2 * D, h - 2 * D);
      }
      g.setLineDash([]);
    }

    // Bite line: jagged teeth over the targeted cells.
    if (o.bite) {
      g.fillStyle = o.bite.valid ? '#000' : 'rgba(160,0,0,0.7)';
      for (const q of o.bite.cells) {
        const [x, y, w] = box(q.r, q.c);
        g.beginPath();
        for (let k = 0; k < 3; k++) {
          g.moveTo(x + (k * w) / 3, y);
          g.lineTo(x + ((k + 0.5) * w) / 3, y + w * 0.45);
          g.lineTo(x + ((k + 1) * w) / 3, y);
        }
        g.fill();
      }
    }

    // Effects.
    this.effects = this.effects.filter((e) => now - e.t0 < EFFECT_MS);
    for (const e of this.effects) {
      const t = (now - e.t0) / EFFECT_MS;
      for (const q of e.cells) {
        const [x, y, w, h] = box(q.r, q.c);
        if (e.kind === 'flash') {
          g.fillStyle = `rgba(255,255,255,${0.8 * (1 - t)})`;
          g.fillRect(x, y, w, h);
        } else {
          const k = (1 - t) * w;
          g.fillStyle = e.kind === 'bite' ? `rgba(0,0,0,${0.6 * (1 - t)})` : `rgba(90,60,30,${0.7 * (1 - t)})`;
          g.fillRect(x + (w - k) / 2, y + (h - k) / 2, k, k);
        }
      }
    }
    this.onFrame?.();
  }

  // ------------------------------------------------------------ minimap

  /** Whole board at a glance with the current view outlined. */
  drawMinimap(mini: HTMLCanvasElement, s: GameState): void {
    const css = mini.clientWidth || 120;
    const W = Math.round(css * this.dpr);
    if (mini.width !== W) {
      mini.width = W;
      mini.height = W;
    }
    const g = mini.getContext('2d')!;
    const n = s.size;
    const k = W / n;
    g.fillStyle = BOARD_BG;
    g.fillRect(0, 0, W, W);
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        const val = s.cells[r * n + c]!;
        if (val) {
          g.fillStyle = PLAYER_STYLES[val - 1]!.base;
          g.fillRect(Math.floor(c * k), Math.floor(r * k), Math.ceil(k), Math.ceil(k));
        } else if (s.teeth[r * n + c]) {
          g.fillStyle = '#fff';
          g.fillRect(Math.floor(c * k), Math.floor(r * k), Math.ceil(k), Math.ceil(k));
        }
      }
    // Heads as dots so you can find everyone, even when small.
    s.players.forEach((p, i) => {
      if (!p.alive) return;
      g.fillStyle = '#000';
      const rr = Math.max(2 * this.dpr, k * 0.9);
      g.beginPath();
      g.arc((p.head.c + 0.5) * k, (p.head.r + 0.5) * k, rr, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = PLAYER_STYLES[i]!.face;
      g.beginPath();
      g.arc((p.head.c + 0.5) * k, (p.head.r + 0.5) * k, rr * 0.6, 0, Math.PI * 2);
      g.fill();
    });
    const v = this.view();
    g.lineWidth = Math.max(1.5 * this.dpr, 2);
    g.strokeStyle = '#000';
    g.strokeRect(v.c0 * k, v.r0 * k, (v.c1 - v.c0) * k, (v.r1 - v.r0) * k);
    g.strokeStyle = '#fff';
    g.lineWidth = Math.max(0.75 * this.dpr, 1);
    g.strokeRect(v.c0 * k + 2, v.r0 * k + 2, (v.c1 - v.c0) * k - 4, (v.r1 - v.r0) * k - 4);
  }
}
