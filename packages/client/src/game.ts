import {
  SHAPES,
  applyAction,
  biteLevel,
  checkBite,
  checkPlacement,
  classicConfig,
  classicCpuTurn,
  createGame,
  hasAnyMove,
  shapeCells,
} from '@fungus/engine';
import type { Action, GameEvent, GameState, PlayerConfig, Pos } from '@fungus/engine';
import { h, titlebar } from './dom';
import { BoardRenderer } from './render';
import type { Overlay } from './render';
import { sfx } from './sound';
import { recordResult } from './storage';
import { PLAYER_STYLES, drawFace, makeTile, TILE } from './textures';
import { changeZoom } from './zoom';

const CPU_THINK_MS = 450;
const CPU_STEP_MS = 280;

const ERRORS: Record<string, string> = {
  'must touch your fungus (edge to edge)': 'Pieces must touch your fungus along an edge.',
  'cell occupied': 'That spot is taken.',
  'off board': 'That piece would hang off the board.',
  'bite must start next to your fungus': 'Start a bite right next to your fungus.',
  'heads cannot be bitten': 'Heads can’t be bitten — surround them instead.',
  'no bites': 'You have no bites yet. Grab a corner tooth or wait for teeth to grow.',
  'bite too long for your size': 'Grow bigger for longer bites.',
  'can only bite enemy fungus': 'Bite enemy fungus, not empty space.',
  'cannot bite yourself': 'That’s your own fungus.',
  'bite must be a straight line': 'Bites go in a straight line.',
};

const biteWord = (level: number) => (level >= 3 ? 'Monster bites' : level === 2 ? 'Big bites' : 'Bites');

export interface GameOptions {
  players: PlayerConfig[];
  timeLimit: number | null;
  onExit: () => void;
}

export class GameScreen {
  readonly root: HTMLElement;
  private s: GameState;
  private renderer: BoardRenderer;
  private canvas: HTMLCanvasElement;
  private rotation = 0;
  private hover: Pos | null = null;
  private mode: 'place' | 'bite' = 'place';
  private bite: { start: Pos; cells: Pos[] } | null = null;
  private touchAim: string | null = null;
  private paused = false;
  private busy = false;
  private cpuTimer = 0;
  private deadline = 0;
  private timerHandle = 0;
  private cards: HTMLElement[] = [];
  private preview: HTMLCanvasElement;
  private status: HTMLElement;
  private timerBar: HTMLElement;
  private btn: Record<string, HTMLButtonElement> = {};
  private dialog: HTMLElement;
  private resizeObs: ResizeObserver;

  constructor(private opts: GameOptions) {
    const cfg = classicConfig(opts.players, { turnTimeLimit: opts.timeLimit });
    this.s = createGame(cfg, (Math.random() * 2 ** 32) >>> 0);

    this.canvas = h('canvas', { class: 'board', 'aria-label': 'Game board' });
    const boardWrap = h('div', { class: 'board-wrap' }, this.canvas);
    this.renderer = new BoardRenderer(this.canvas);

    this.cards = this.s.players.map((p, i) =>
      h(
        'div',
        { class: 'card', style: `--edge:${PLAYER_STYLES[i]!.edge}` },
        this.swatch(i),
        h('div', { class: 'card-text' }, h('div', { class: 'card-name' }, p.name), h('div', { class: 'card-bites' })),
      ),
    );
    this.preview = h('canvas', { class: 'preview', 'aria-label': 'Your piece' });
    this.status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
    this.timerBar = h('div', { class: 'timer-fill' });

    const mk = (key: string, label: string, title: string, fn: () => void) =>
      (this.btn[key] = h('button', { type: 'button', title, class: `${key}-btn`, onclick: fn }, label));

    this.dialog = h('div', { class: 'dialog', hidden: true });

    this.root = h(
      'section',
      { class: 'window game-window' },
      titlebar('Fungus', () => this.confirmExit(), 'Exit game'),
      h(
        'div',
        { class: 'game' },
        boardWrap,
        h(
          'aside',
          { class: 'side' },
          h('div', { class: 'cards' }, ...this.cards),
          h(
            'div',
            { class: 'piece-box' },
            this.preview,
            h('div', { class: 'timer', hidden: !opts.timeLimit }, this.timerBar),
          ),
          h(
            'div',
            { class: 'controls' },
            mk('rotate', 'Rotate', 'Rotate piece (Space / arrow keys / right-click)', () => this.rotate(1)),
            mk('place', 'Place', 'Place the piece where it’s aimed', () => this.placeAtHover()),
            mk('bite', 'Bite', 'Bite enemy fungus (B)', () => this.toggleBite()),
            mk('pass', 'Pass', 'Give up your turn (G)', () => this.humanAct({ type: 'pass' })),
            mk('pause', 'Pause', 'Pause (P)', () => this.togglePause()),
            mk('exit', 'Exit', 'Leave this game', () => this.confirmExit()),
          ),
          this.status,
          matchMedia('(hover: hover)').matches
            ? h('p', { class: 'hint' }, 'Mouse wheel zooms. Shift + wheel rotates your piece.')
            : null,
        ),
      ),
      this.dialog,
    );

    this.bindInput();
    this.resizeObs = new ResizeObserver(() => this.layout());
    this.resizeObs.observe(boardWrap);
    queueMicrotask(() => {
      this.layout();
      this.beginTurn();
    });
  }

  destroy(): void {
    clearTimeout(this.cpuTimer);
    clearInterval(this.timerHandle);
    this.resizeObs.disconnect();
    window.removeEventListener('keydown', this.onKey);
  }

  // ------------------------------------------------------------ helpers

  private swatch(i: number): HTMLCanvasElement {
    const S = 96; // drawn large, shown at 2.2rem, so it stays sharp at any zoom
    const cv = h('canvas', { class: 'swatch', width: S, height: S });
    const g = cv.getContext('2d')!;
    g.fillStyle = g.createPattern(makeTile(PLAYER_STYLES[i]!, i, S / TILE), 'repeat')!;
    g.fillRect(0, 0, S, S);
    drawFace(g, S * 0.2, S * 0.2, S * 0.6, PLAYER_STYLES[i]!, true);
    return cv;
  }

  private get me(): number {
    return this.s.current;
  }
  private get isHumanTurn(): boolean {
    return this.s.winner === null && this.s.players[this.me]!.kind === 'human';
  }

  private say(msg: string): void {
    this.status.textContent = msg;
  }

  private layout(): void {
    this.renderer.resize(this.s.size);
    this.redraw();
  }

  /** Piece cells for the current rotation, anchored so the hovered cell sits on the piece's middle. */
  private ghostAt(p: Pos): { cells: Pos[]; r: number; c: number } {
    const offs = shapeCells(this.s.piece, this.rotation);
    const mr = offs.reduce((a, o) => a + o.r, 0) / offs.length;
    const mc = offs.reduce((a, o) => a + o.c, 0) / offs.length;
    const pivot = offs.reduce((b, o) => (Math.hypot(o.r - mr, o.c - mc) < Math.hypot(b.r - mr, b.c - mc) ? o : b));
    const r = p.r - pivot.r;
    const c = p.c - pivot.c;
    return { cells: offs.map((o) => ({ r: r + o.r, c: c + o.c })), r, c };
  }

  private overlay(): Overlay {
    if (!this.isHumanTurn || this.paused || this.busy) return {};
    if (this.mode === 'bite') {
      const starts: Pos[] = [];
      for (let r = 0; r < this.s.size; r++)
        for (let c = 0; c < this.s.size; c++) if (checkBite(this.s, this.me, [{ r, c }]) === null) starts.push({ r, c });
      const hov = this.hover;
      return {
        biteStarts: starts,
        biteHover: hov && checkBite(this.s, this.me, [hov]) === null ? hov : undefined,
        bite: this.bite ? { cells: this.bite.cells, valid: checkBite(this.s, this.me, this.bite.cells) === null } : undefined,
      };
    }
    if (!this.hover) return {};
    const g = this.ghostAt(this.hover);
    const valid = typeof checkPlacement(this.s, this.me, this.rotation, g.r, g.c) !== 'string';
    return { ghost: { cells: g.cells, player: this.me, valid } };
  }

  private redraw(): void {
    this.renderer.draw(this.s, this.overlay());
    this.drawPreview();
    this.updatePanel();
  }

  private drawPreview(): void {
    const css = this.preview.clientWidth || 96;
    const W = Math.round(css * Math.min(3, window.devicePixelRatio || 1));
    if (this.preview.width !== W) {
      this.preview.width = W;
      this.preview.height = W;
    }
    const g = this.preview.getContext('2d')!;
    g.clearRect(0, 0, W, W);
    const showing = this.s.winner === null && this.s.players[this.me]!.kind === 'human';
    if (!showing) return;
    const offs = shapeCells(this.s.piece, this.rotation);
    const maxR = Math.max(...offs.map((o) => o.r)) + 1;
    const maxC = Math.max(...offs.map((o) => o.c)) + 1;
    const cs = Math.floor(W / 4.5);
    const ox = (W - maxC * cs) / 2;
    const oy = (W - maxR * cs) / 2;
    g.fillStyle = g.createPattern(makeTile(PLAYER_STYLES[this.me]!, this.me, (cs * 3) / TILE), 'repeat')!;
    g.strokeStyle = PLAYER_STYLES[this.me]!.edge;
    g.lineWidth = 2;
    for (const o of offs) {
      g.fillRect(ox + o.c * cs, oy + o.r * cs, cs, cs);
      g.strokeRect(ox + o.c * cs + 1, oy + o.r * cs + 1, cs - 2, cs - 2);
    }
  }

  private updatePanel(): void {
    this.s.players.forEach((p, i) => {
      const card = this.cards[i]!;
      card.classList.toggle('current', i === this.me && this.s.winner === null);
      card.classList.toggle('dead', !p.alive);
      const lv = biteLevel(this.s, i);
      card.querySelector('.card-bites')!.textContent = p.alive
        ? `${biteWord(lv)}: ${p.bites}`
        : 'Eaten';
    });
    const human = this.isHumanTurn && !this.paused && !this.busy;
    this.btn.rotate!.disabled = !human || this.mode === 'bite' || SHAPES[this.s.piece]!.masks.length === 1;
    this.btn.place!.disabled = !human || this.mode === 'bite' || !this.hover;
    this.btn.bite!.disabled = !human || this.s.players[this.me]!.bites < 1;
    this.btn.bite!.setAttribute('aria-pressed', String(this.mode === 'bite'));
    this.btn.pass!.disabled = !human;
    this.btn.pause!.textContent = this.paused ? 'Resume' : 'Pause';
    this.btn.pause!.disabled = this.s.winner !== null;
  }

  // ------------------------------------------------------------ turn flow

  private beginTurn(): void {
    clearInterval(this.timerHandle);
    // Let a death play out before anyone moves again.
    const wait = this.renderer.busyFor();
    if (wait > 0) {
      this.busy = true;
      this.redraw();
      this.cpuTimer = window.setTimeout(() => {
        this.busy = false;
        this.beginTurn();
      }, wait + 60);
      return;
    }
    this.mode = 'place';
    this.bite = null;
    this.rotation = 0;
    this.touchAim = null;
    if (this.s.winner !== null) return this.gameOver();
    const p = this.s.players[this.me]!;
    if (p.kind === 'human') {
      if (!hasAnyMove(this.s, this.me)) {
        this.say(`${p.name} has nowhere to grow and passes.`);
        this.busy = true;
        this.cpuTimer = window.setTimeout(() => {
          this.busy = false;
          this.commit({ type: 'pass' });
        }, 900);
      } else {
        this.say(`${p.name}, your move.`);
        this.startTimer();
      }
    } else {
      this.say(`${p.name} is growing…`);
      this.runCpu();
    }
    this.redraw();
  }

  private startTimer(): void {
    const limit = this.s.config.turnTimeLimit;
    if (!limit) return;
    this.deadline = performance.now() + limit * 1000;
    this.timerHandle = window.setInterval(() => {
      if (this.paused) {
        this.deadline += 100;
        return;
      }
      const left = this.deadline - performance.now();
      this.timerBar.style.width = `${Math.max(0, (left / (limit * 1000)) * 100)}%`;
      if (left <= 0) {
        clearInterval(this.timerHandle);
        this.say('Out of time — turn passed.');
        this.commit({ type: 'pass' });
      }
    }, 100);
  }

  private runCpu(): void {
    this.busy = true;
    const step = (queue: Action[]) => {
      if (this.paused) {
        this.cpuTimer = window.setTimeout(() => step(queue), 200);
        return;
      }
      const a = queue.shift();
      if (!a) return;
      const res = applyAction(this.s, this.me, a);
      if (!res.ok) {
        // Should never happen (engine-validated CPU); fail safe by passing.
        console.error('CPU action rejected', a, res.error);
        queue.length = 0;
        queue.push({ type: 'pass' });
        return step(queue);
      }
      const endsTurn = a.type !== 'bite';
      this.absorb(res.state, res.events);
      if (endsTurn) {
        this.busy = false;
        this.beginTurn();
      } else this.cpuTimer = window.setTimeout(() => step(queue), CPU_STEP_MS);
    };
    this.cpuTimer = window.setTimeout(() => step(classicCpuTurn(this.s)), CPU_THINK_MS);
  }

  /** Apply a validated result and play its effects. */
  private absorb(state: GameState, events: GameEvent[]): void {
    this.s = state;
    const captured: Pos[] = [];
    const died: Pos[] = [];
    const bitten: Pos[] = [];
    let placed = false;
    const victims = new Set(events.flatMap((e) => (e.type === 'killed' ? [e.victim] : [])));
    for (const e of events) {
      if (e.type === 'killed') {
        const cells = events.flatMap((x) => (x.type === 'captured' && x.from === e.victim ? [x.pos] : []));
        this.renderer.addDeath(e.victim, e.player, this.s.players[e.victim]!.head, cells);
      }
    }
    for (const e of events) {
      if (e.type === 'captured' && victims.has(e.from)) continue; // shown by the death animation
      if (e.type === 'captured') captured.push(e.pos);
      else if (e.type === 'died') died.push(e.pos);
      else if (e.type === 'bitten') bitten.push(e.pos);
      else if (e.type === 'placed') placed = true;
      else if (e.type === 'tooth') {
        sfx.tooth();
        this.say(`${this.s.players[e.player]!.name} found a tooth.`);
      } else if (e.type === 'toothRegrow') {
        sfx.tooth();
        this.say('New teeth grew — everyone gets a bite.');
      } else if (e.type === 'killed') {
        sfx.kill();
        const killer = this.s.players[e.player]!.name;
        const victim = this.s.players[e.victim]!.name;
        this.say(`${killer} ate ${victim}${e.bitesTaken ? ` and took ${e.bitesTaken} bite${e.bitesTaken > 1 ? 's' : ''}` : ''}.`);
      } else if (e.type === 'biteLevel') {
        this.say(`${this.s.players[e.player]!.name} now has ${biteWord(e.level).toLowerCase()}.`);
      }
    }
    if (placed) sfx.place();
    if (captured.length) sfx.capture();
    if (bitten.length) sfx.bite();
    if (died.length) sfx.die();
    this.renderer.addEffect(captured, 'flash');
    this.renderer.addEffect(bitten, 'bite');
    this.renderer.addEffect(died, 'die');
    this.redraw();
  }

  /** Apply an action for the current (human) player. */
  private commit(a: Action): boolean {
    const res = applyAction(this.s, this.me, a);
    if (!res.ok) {
      sfx.error();
      this.say(ERRORS[res.error] ?? res.error);
      return false;
    }
    this.absorb(res.state, res.events);
    if (a.type === 'bite') {
      this.mode = 'place';
      this.bite = null;
      this.redraw();
    } else this.beginTurn();
    return true;
  }

  private humanAct(a: Action): void {
    if (!this.isHumanTurn || this.paused || this.busy) return;
    this.commit(a);
  }

  private placeAtHover(): void {
    if (!this.hover) return;
    const g = this.ghostAt(this.hover);
    this.humanAct({ type: 'place', rotation: this.rotation, r: g.r, c: g.c });
  }

  private rotate(dir: 1 | -1): void {
    if (!this.isHumanTurn || this.mode === 'bite') return;
    const n = SHAPES[this.s.piece]!.masks.length;
    this.rotation = (this.rotation + dir + n) % n;
    this.touchAim = null;
    this.redraw();
  }

  private toggleBite(): void {
    if (!this.isHumanTurn || this.paused || this.busy) return;
    if (this.mode === 'place' && this.s.players[this.me]!.bites < 1) {
      this.say(ERRORS['no bites']!);
      return;
    }
    this.mode = this.mode === 'bite' ? 'place' : 'bite';
    this.bite = null;
    this.say(this.mode === 'bite' ? 'Press on enemy fungus next to yours, then drag to bite.' : '');
    this.redraw();
  }

  private togglePause(): void {
    if (this.s.winner !== null) return;
    this.paused = !this.paused;
    this.root.classList.toggle('paused', this.paused);
    this.say(this.paused ? 'Paused.' : '');
    this.redraw();
  }

  // ------------------------------------------------------------ input

  private bindInput(): void {
    const cv = this.canvas;
    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.rotate(1);
    });
    this.root.addEventListener(
      'wheel',
      (e) => {
        if (e.ctrlKey) return; // leave browser zoom alone
        // Some browsers turn Shift + wheel into horizontal scrolling.
        const d = e.deltaY || e.deltaX;
        if (!d) return;
        e.preventDefault();
        if (e.shiftKey) {
          if (this.isHumanTurn) this.rotate(d > 0 ? 1 : -1);
        } else changeZoom(d > 0 ? -1 : 1);
      },
      { passive: false },
    );
    cv.addEventListener('pointermove', (e) => {
      if (this.mode === 'bite') {
        if (this.bite) this.extendBite(e);
        else if (e.pointerType !== 'touch') this.setHover(this.renderer.cellAt(e.clientX, e.clientY, this.s.size));
        return;
      }
      if (e.pointerType === 'touch' && e.buttons === 0) return;
      this.setHover(this.renderer.cellAt(e.clientX, e.clientY, this.s.size));
    });
    cv.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'touch') this.setHover(null);
    });
    cv.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.isHumanTurn || this.paused || this.busy) return;
      const cell = this.renderer.cellAt(e.clientX, e.clientY, this.s.size);
      if (!cell) return;
      cv.setPointerCapture(e.pointerId);
      if (this.mode === 'bite') {
        this.bite = { start: cell, cells: [cell] };
        this.redraw();
        return;
      }
      this.setHover(cell);
    });
    cv.addEventListener('pointerup', (e) => {
      if (e.button !== 0 || !this.isHumanTurn || this.paused || this.busy) return;
      if (this.mode === 'bite') {
        if (this.bite) {
          const cells = this.bite.cells;
          this.bite = null;
          if (!this.commit({ type: 'bite', cells })) this.redraw();
        }
        return;
      }
      const cell = this.renderer.cellAt(e.clientX, e.clientY, this.s.size);
      if (!cell) return;
      this.setHover(cell);
      if (e.pointerType === 'touch') {
        // Touch: first tap aims, second tap on the same spot confirms.
        const key = `${cell.r},${cell.c},${this.rotation}`;
        if (this.touchAim === key) this.placeAtHover();
        else {
          this.touchAim = key;
          this.say('Tap again (or press Place) to grow here.');
        }
      } else this.placeAtHover();
    });
    window.addEventListener('keydown', this.onKey);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || !this.dialog.hidden) return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'arrowright' || k === 'arrowup') (e.preventDefault(), this.rotate(1));
    else if (k === 'arrowleft' || k === 'arrowdown') (e.preventDefault(), this.rotate(-1));
    else if (k === 'b') this.toggleBite();
    else if (k === 'g') this.humanAct({ type: 'pass' });
    else if (k === 'p') this.togglePause();
    else if (k === 'escape' && this.mode === 'bite') this.toggleBite();
    else if (k === 'enter') this.placeAtHover();
  };

  private setHover(cell: Pos | null): void {
    const same = cell && this.hover && cell.r === this.hover.r && cell.c === this.hover.c;
    if (same || (!cell && !this.hover)) return;
    this.hover = cell;
    this.redraw();
  }

  /** Drag a bite out along the dominant axis, up to the current bite level. */
  private extendBite(e: PointerEvent): void {
    if (!this.bite) return;
    const pt = this.renderer.pointAt(e.clientX, e.clientY);
    const st = this.bite.start;
    const dr = pt.r - (st.r + 0.5);
    const dc = pt.c - (st.c + 0.5);
    const level = biteLevel(this.s, this.me);
    const along = Math.abs(dc) > Math.abs(dr) ? { r: 0, c: Math.sign(dc) } : { r: Math.sign(dr), c: 0 };
    const len = Math.min(level, 1 + Math.round(Math.max(Math.abs(dr), Math.abs(dc))));
    const cells: Pos[] = [];
    for (let i = 0; i < Math.max(1, len); i++) {
      const q = { r: st.r + along.r * i, c: st.c + along.c * i };
      if (q.r < 0 || q.c < 0 || q.r >= this.s.size || q.c >= this.s.size) break;
      // Stop the line at the first cell that can't be bitten so the preview stays meaningful.
      if (i > 0 && checkBite(this.s, this.me, [...cells, q]) !== null) break;
      cells.push(q);
    }
    if (cells.length !== this.bite.cells.length || cells.some((q, i) => q.r !== this.bite!.cells[i]!.r || q.c !== this.bite!.cells[i]!.c)) {
      this.bite.cells = cells;
      this.redraw();
    }
  }

  // ------------------------------------------------------------ end

  private gameOver(): void {
    clearInterval(this.timerHandle);
    const w = this.s.players[this.s.winner!]!;
    sfx.win();
    recordResult(
      this.s.players.map((p) => p.name),
      w.name,
    );
    this.say(`${w.name} wins.`);
    this.redraw();
    this.showDialog(
      `${w.name}’s fungus wins`,
      this.s.players.length > 1 ? `${this.s.round} rounds of growth.` : '',
      [
        ['Play again', () => this.restart()],
        ['Back to setup', () => this.opts.onExit()],
      ],
    );
  }

  private restart(): void {
    this.hideDialog();
    const cfg = classicConfig(this.opts.players, { turnTimeLimit: this.opts.timeLimit });
    this.s = createGame(cfg, (Math.random() * 2 ** 32) >>> 0);
    this.beginTurn();
  }

  private confirmExit(): void {
    if (this.s.winner !== null) return this.opts.onExit();
    const wasPaused = this.paused;
    if (!wasPaused) this.togglePause();
    this.showDialog('Leave this game?', 'The game in progress will be lost.', [
      ['Leave', () => this.opts.onExit()],
      [
        'Keep playing',
        () => {
          this.hideDialog();
          if (!wasPaused) this.togglePause();
        },
      ],
    ]);
  }

  private showDialog(title: string, body: string, actions: [string, () => void][]): void {
    this.dialog.replaceChildren(
      h(
        'div',
        { class: 'window dialog-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('h2', {}, title),
        body ? h('p', {}, body) : null,
        h('div', { class: 'dialog-actions' }, ...actions.map(([label, fn]) => h('button', { type: 'button', onclick: fn }, label))),
      ),
    );
    this.dialog.hidden = false;
    (this.dialog.querySelector('button') as HTMLButtonElement | null)?.focus();
  }

  private hideDialog(): void {
    this.dialog.hidden = true;
    this.dialog.replaceChildren();
  }
}
