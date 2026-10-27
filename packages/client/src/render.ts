import type { GameState, Pos } from '@fungus/engine';
import { PLAYER_STYLES, TILE, drawFace, drawTooth, makeTile } from './textures';

export interface Overlay {
  /** Piece preview under the cursor. */
  ghost?: { cells: Pos[]; player: number; valid: boolean };
  /** Bite line being dragged. */
  bite?: { cells: Pos[]; valid: boolean };
  /** Cells that can start a bite (shown while in bite mode). */
  biteStarts?: Pos[];
}

interface Effect {
  cells: Pos[];
  kind: 'flash' | 'die' | 'bite';
  t0: number;
}

const EFFECT_MS = 380;
const BOARD_BG = '#c9c9c9';
const GRID = '#b3b3b3';

export class BoardRenderer {
  readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  cell = 20;
  private ox = 0;
  private oy = 0;
  private patterns: CanvasPattern[] = [];
  private patternCell = 0;
  private effects: Effect[] = [];
  private raf = 0;
  private last: { s: GameState; o: Overlay } | null = null;
  private reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** Fit the canvas to its parent; call on resize. */
  resize(size: number): void {
    const parent = this.canvas.parentElement!;
    const side = Math.max(160, Math.floor(Math.min(parent.clientWidth, parent.clientHeight)));
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.style.width = `${side}px`;
    this.canvas.style.height = `${side}px`;
    this.canvas.width = Math.round(side * this.dpr);
    this.canvas.height = Math.round(side * this.dpr);
    this.cell = Math.floor((side - 2) / size);
    this.ox = Math.floor((side - this.cell * size) / 2);
    this.oy = this.ox;
    if (this.cell !== this.patternCell) this.patterns = [];
    if (this.last) this.draw(this.last.s, this.last.o);
  }

  private pattern(i: number): CanvasPattern {
    if (!this.patterns[i]) {
      // One tile spans three cells so the pattern reads as one organism, not a checkerboard.
      const tilePx = this.cell * 3 * this.dpr;
      const tile = makeTile(PLAYER_STYLES[i]!, i, tilePx / TILE);
      const p = this.ctx.createPattern(tile, 'repeat')!;
      p.setTransform(new DOMMatrix().scale(1 / this.dpr));
      this.patterns[i] = p;
      this.patternCell = this.cell;
    }
    return this.patterns[i]!;
  }

  cellAt(clientX: number, clientY: number, size: number): Pos | null {
    const rect = this.canvas.getBoundingClientRect();
    const c = Math.floor((clientX - rect.left - this.ox) / this.cell);
    const r = Math.floor((clientY - rect.top - this.oy) / this.cell);
    return r >= 0 && c >= 0 && r < size && c < size ? { r, c } : null;
  }

  /** Fractional cell coordinate (for choosing a drag direction). */
  pointAt(clientX: number, clientY: number): { r: number; c: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { c: (clientX - rect.left - this.ox) / this.cell, r: (clientY - rect.top - this.oy) / this.cell };
  }

  addEffect(cells: Pos[], kind: Effect['kind']): void {
    if (this.reduceMotion || cells.length === 0) return;
    this.effects.push({ cells, kind, t0: performance.now() });
    this.kick();
  }

  private kick(): void {
    if (this.raf) return;
    const tick = () => {
      this.raf = 0;
      if (this.last) this.draw(this.last.s, this.last.o);
      if (this.effects.length) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  draw(s: GameState, o: Overlay = {}): void {
    this.last = { s, o };
    const g = this.ctx;
    const cs = this.cell;
    const n = s.size;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.translate(this.ox, this.oy);

    // Board + grid.
    g.fillStyle = BOARD_BG;
    g.fillRect(0, 0, cs * n, cs * n);
    g.strokeStyle = GRID;
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i <= n; i++) {
      g.moveTo(i * cs + 0.5, 0);
      g.lineTo(i * cs + 0.5, cs * n);
      g.moveTo(0, i * cs + 0.5);
      g.lineTo(cs * n, i * cs + 0.5);
    }
    g.stroke();

    // Fungus cells.
    const at = (r: number, c: number) => (r < 0 || c < 0 || r >= n || c >= n ? -1 : s.cells[r * n + c]!);
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        const v = s.cells[r * n + c]!;
        if (v) {
          g.fillStyle = this.pattern(v - 1);
          g.fillRect(c * cs, r * cs, cs, cs);
        } else if (s.teeth[r * n + c]) drawTooth(g, c * cs, r * cs, cs);
      }

    // Outline each fungus where it meets something else — keeps blobs crisp.
    g.lineWidth = Math.max(1, cs / 12);
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        const v = s.cells[r * n + c]!;
        if (!v) continue;
        g.strokeStyle = PLAYER_STYLES[v - 1]!.edge;
        g.beginPath();
        if (at(r - 1, c) !== v) (g.moveTo(c * cs, r * cs), g.lineTo(c * cs + cs, r * cs));
        if (at(r + 1, c) !== v) (g.moveTo(c * cs, r * cs + cs), g.lineTo(c * cs + cs, r * cs + cs));
        if (at(r, c - 1) !== v) (g.moveTo(c * cs, r * cs), g.lineTo(c * cs, r * cs + cs));
        if (at(r, c + 1) !== v) (g.moveTo(c * cs + cs, r * cs), g.lineTo(c * cs + cs, r * cs + cs));
        g.stroke();
      }

    // Heads.
    s.players.forEach((p, i) => {
      if (p.alive) drawFace(g, p.head.c * cs, p.head.r * cs, cs, PLAYER_STYLES[i]!, i === s.current);
    });

    // Bite-start hints.
    if (o.biteStarts) {
      g.fillStyle = 'rgba(0,0,0,0.18)';
      for (const q of o.biteStarts) g.fillRect(q.c * cs + cs * 0.3, q.r * cs + cs * 0.3, cs * 0.4, cs * 0.4);
    }

    // Ghost piece.
    if (o.ghost) {
      g.globalAlpha = o.ghost.valid ? 0.75 : 0.35;
      g.fillStyle = o.ghost.valid ? this.pattern(o.ghost.player) : '#777';
      for (const q of o.ghost.cells) if (q.r >= 0 && q.c >= 0 && q.r < n && q.c < n) g.fillRect(q.c * cs, q.r * cs, cs, cs);
      g.globalAlpha = 1;
      g.strokeStyle = o.ghost.valid ? '#000' : '#a00';
      g.setLineDash([Math.max(2, cs / 6), Math.max(2, cs / 6)]);
      g.lineWidth = Math.max(1, cs / 14);
      for (const q of o.ghost.cells) g.strokeRect(q.c * cs + 1, q.r * cs + 1, cs - 2, cs - 2);
      g.setLineDash([]);
    }

    // Bite line: jagged teeth over the targeted cells.
    if (o.bite) {
      g.fillStyle = o.bite.valid ? '#000' : 'rgba(160,0,0,0.7)';
      for (const q of o.bite.cells) {
        const x = q.c * cs;
        const y = q.r * cs;
        g.beginPath();
        for (let k = 0; k < 3; k++) {
          g.moveTo(x + (k * cs) / 3, y);
          g.lineTo(x + ((k + 0.5) * cs) / 3, y + cs * 0.45);
          g.lineTo(x + ((k + 1) * cs) / 3, y);
        }
        g.fill();
      }
    }

    // Effects.
    const now = performance.now();
    this.effects = this.effects.filter((e) => now - e.t0 < EFFECT_MS);
    for (const e of this.effects) {
      const t = (now - e.t0) / EFFECT_MS;
      for (const q of e.cells) {
        const x = q.c * cs;
        const y = q.r * cs;
        if (e.kind === 'flash') {
          g.fillStyle = `rgba(255,255,255,${0.8 * (1 - t)})`;
          g.fillRect(x, y, cs, cs);
        } else {
          const k = (1 - t) * cs;
          g.fillStyle = e.kind === 'bite' ? `rgba(0,0,0,${0.6 * (1 - t)})` : `rgba(90,60,30,${0.7 * (1 - t)})`;
          g.fillRect(x + (cs - k) / 2, y + (cs - k) / 2, k, k);
        }
      }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
}
