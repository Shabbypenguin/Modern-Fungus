import {
  SHAPES,
  applyAction,
  biteLevel,
  biteStarts,
  checkBite,
  checkPlacement,
  classicCpuTurn,
  createGame,
  hasAnyMove,
  legalPlacements,
  shapeCells,
  stateHash,
} from '@fungus/engine';
import type { Action, GameConfig, GameEvent, GameState, Pos } from '@fungus/engine';
import { EMOTES, EMOTE_LABEL } from '@fungus/protocol';
import type { Emote, GameSnapshot, ServerMessage } from '@fungus/protocol';
import { controlsDialog } from './controls';
import { h, titlebar } from './dom';
import { BoardRenderer } from './render';
import type { Overlay } from './render';
import type { NetClient } from './net';
import { sfx } from './sound';
import { recordResult } from './storage';
import { PLAYER_STYLES, TILE, TILE_CELLS, drawFace, makeTile } from './textures';

const CPU_THINK_MS = 450;
const CPU_STEP_MS = 280;
/** Pointer travel (px) below which a press counts as a click/tap, not a drag. */
const CLICK_SLOP = 6;
/** On boards bigger than this, start zoomed in on your fungus instead of showing everything. */
const START_ZOOMED_ABOVE = 35;
const COMFORT_ACROSS = 30;

const ERRORS: Record<string, string> = {
  'must touch your fungus (edge to edge)': 'Pieces must touch your fungus along an edge.',
  'cell occupied': 'That spot is taken.',
  'off board': 'That piece would hang off the board.',
  'bite must start next to your fungus': 'Start a bite right next to your fungus.',
  'heads cannot be bitten': 'Heads can’t be bitten — surround them instead.',
  'no bites': 'You have no bites yet. Grab a tooth or wait for teeth to grow.',
  'bite too long for your size': 'Grow bigger for longer bites.',
  'can only bite enemy fungus': 'Bite enemy fungus, not empty space.',
  'cannot bite yourself': 'That’s your own fungus.',
  'bite must be a straight line': 'Bites go in a straight line.',
};

const biteWord = (level: number) => (level >= 3 ? 'Monster bites' : level === 2 ? 'Big bites' : 'Bites');

/** Present when the game is played on the server instead of in this tab. */
export interface OnlineLink {
  net: NetClient;
  snapshot: GameSnapshot;
  /** Game over: go back to the room's lobby. */
  onBackToRoom: () => void;
}

export interface GameOptions {
  config: GameConfig;
  onExit: () => void;
  online?: OnlineLink;
}

interface Press {
  id: number;
  button: number;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  /** What this press is doing once it moves. */
  role: 'pan' | 'bite' | 'aim';
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
  private starts: { state: GameState; cells: Pos[] } | null = null;
  private touchAim: string | null = null;
  private paused = false;
  private busy = false;
  private cpuTimer = 0;
  private deadline = 0;
  private timerHandle = 0;
  private cards: HTMLElement[] = [];
  private preview: HTMLCanvasElement;
  private minimap: HTMLCanvasElement;
  private miniBox: HTMLElement;
  private status: HTMLElement;
  private timerBar: HTMLElement;
  private btn: Record<string, HTMLButtonElement> = {};
  private dialog: HTMLElement;
  private resizeObs: ResizeObserver;
  private presses = new Map<number, Press>();
  private pinch: { dist: number; mx: number; my: number } | null = null;
  private wheelRotate = 0;
  // Online state
  private net: NetClient | null = null;
  /** Your engine player online, or null when watching. */
  private you: number | null = null;
  private seq = 0;
  private standIns = new Set<number>();
  /** An action was sent and the server hasn't answered yet. */
  private waiting = false;
  private resyncing = false;
  private emoteRow: HTMLElement | null = null;

  constructor(private opts: GameOptions) {
    const on = opts.online;
    if (on) {
      this.net = on.net;
      this.s = on.snapshot.state;
      this.you = on.snapshot.you;
      this.seq = on.snapshot.seq;
      this.standIns = new Set(on.snapshot.standIns);
    } else this.s = createGame(opts.config, (Math.random() * 2 ** 32) >>> 0);

    this.canvas = h('canvas', { class: 'board', 'aria-label': 'Game board', tabindex: 0 });
    const boardWrap = h('div', { class: 'board-wrap' }, this.canvas);
    this.renderer = new BoardRenderer(this.canvas);

    this.cards = this.s.players.map((p, i) =>
      h(
        'div',
        { class: 'card', style: `--edge:${PLAYER_STYLES[i]!.edge}` },
        this.swatch(i),
        h(
          'div',
          { class: 'card-text' },
          h('div', { class: 'card-name' }, p.name),
          h('div', { class: 'card-bites' }),
        ),
        i === this.you ? h('span', { class: 'badge you card-you' }, 'You') : null,
        h('span', { class: 'emote-bubble', hidden: true, 'aria-live': 'polite' }),
      ),
    );
    this.preview = h('canvas', {
      class: 'preview',
      role: 'button',
      tabindex: 0,
      'aria-label': 'Your piece — click or tap to rotate',
      title: 'Click or tap to rotate',
    });
    this.minimap = h('canvas', { class: 'minimap', 'aria-label': 'Whole board — click to move the view' });
    this.miniBox = h('div', { class: 'mini-box', hidden: true }, this.minimap);
    this.status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
    this.timerBar = h('div', { class: 'timer-fill' });

    const mk = (key: string, label: string, title: string, fn: () => void) =>
      (this.btn[key] = h('button', { type: 'button', title, class: `${key}-btn`, onclick: fn }, label));

    this.dialog = h('div', { class: 'dialog', hidden: true });
    if (this.net && this.you !== null) {
      const net = this.net;
      this.emoteRow = h(
        'div',
        { class: 'emotes', role: 'group', 'aria-label': 'Quick messages' },
        ...EMOTES.map((id) => h('button', { type: 'button', class: 'emote', onclick: () => net.send({ t: 'emote', id }) }, EMOTE_LABEL[id])),
      );
    }
    const timed = on ? on.snapshot.state.config.turnTimeLimit !== null : !!opts.config.turnTimeLimit;

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
          h('div', { class: `cards${this.s.players.length > 6 ? ' many' : ''}` }, ...this.cards),
          h(
            'div',
            { class: 'view-row' },
            h(
              'div',
              { class: 'piece-box' },
              this.preview,
              h('div', { class: 'timer', hidden: !timed }, this.timerBar),
            ),
            this.miniBox,
          ),
          h(
            'div',
            { class: 'controls' },
            mk('rotate', 'Rotate', 'Rotate piece (Q / E, Space, right-click)', () => this.rotate(1)),
            mk('place', 'Place', 'Place the piece where it’s aimed', () => this.placeAtHover()),
            mk('bite', 'Bite', 'Bite enemy fungus (B)', () => this.toggleBite()),
            mk('pass', 'Pass', 'Give up your turn (G)', () => this.humanAct({ type: 'pass' })),
            mk('fit', 'Whole board', 'See the whole board (0)', () => this.renderer.fit()),
            mk('mine', 'My fungus', 'Centre on your fungus (C)', () => this.centreOnMine()),
            on ? null : mk('pause', 'Pause', 'Pause (P)', () => this.togglePause()),
            mk('help', 'Controls', 'Show controls (?)', () => this.showControls()),
            mk('exit', on ? 'Leave' : 'Exit', 'Leave this game', () => this.confirmExit()),
          ),
          this.emoteRow,
          this.status,
        ),
      ),
      this.dialog,
    );

    if (import.meta.env.DEV) this.exposeForTests();
    this.renderer.onFrame = () => this.drawMinimap();
    this.bindInput();
    this.resizeObs = new ResizeObserver(() => this.layout());
    this.resizeObs.observe(boardWrap);
    queueMicrotask(() => {
      this.layout();
      this.initialCamera();
      this.beginTurn();
      if (on) this.setServerTimer(on.snapshot.timeLeft);
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
    const S = 96; // drawn large, shown small, so it stays sharp at any size
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
  /** Is it the turn of a person at this screen? */
  private get isHumanTurn(): boolean {
    if (this.s.winner !== null) return false;
    if (this.net) return this.me === this.you && !this.standIns.has(this.me);
    return this.s.players[this.me]!.kind === 'human';
  }
  private get canAct(): boolean {
    return this.isHumanTurn && !this.paused && !this.busy && !this.waiting;
  }
  /** Whose fungus to look at by default. */
  private get home(): number {
    if (this.net) return this.you ?? 0;
    return Math.max(0, this.s.players.findIndex((p) => p.kind === 'human'));
  }

  private say(msg: string): void {
    this.status.textContent = msg;
  }

  private layout(): void {
    this.renderer.resize(this.s.size);
    this.redraw();
  }

  private initialCamera(): void {
    if (this.s.size <= START_ZOOMED_ABOVE) return;
    const target = this.s.players[this.home]!.head;
    this.renderer.cam = { cx: target.c + 0.5, cy: target.r + 0.5, across: COMFORT_ACROSS };
    this.renderer.resize(this.s.size); // re-clamps the camera
  }

  /** At the start of a human turn, bring their fungus into view if none of it is on screen. */
  private followCurrent(): void {
    const p = this.me;
    const v = this.renderer.view();
    const n = this.s.size;
    for (let r = Math.max(0, Math.floor(v.r0)); r < Math.min(n, Math.ceil(v.r1)); r++)
      for (let c = Math.max(0, Math.floor(v.c0)); c < Math.min(n, Math.ceil(v.c1)); c++)
        if (this.s.cells[r * n + c] === p + 1) return;
    this.renderer.centreOn(this.s.players[p]!.head, COMFORT_ACROSS);
  }

  private centreOnMine(): void {
    const p = this.isHumanTurn ? this.me : this.net ? this.home : Math.max(0, this.s.players.findIndex((pl) => pl.kind === 'human' && pl.alive));
    this.renderer.centreOn(this.s.players[p]!.head, COMFORT_ACROSS);
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

  /** Bite starts, computed once per state (cheap to reuse every frame). */
  private biteStartCells(): Pos[] {
    if (this.starts?.state !== this.s) this.starts = { state: this.s, cells: biteStarts(this.s, this.me) };
    return this.starts.cells;
  }

  private overlay(): Overlay {
    if (!this.canAct) return {};
    if (this.mode === 'bite') {
      const starts = this.biteStartCells();
      const hov = this.hover;
      return {
        biteStarts: starts,
        biteHover: hov && starts.some((q) => q.r === hov.r && q.c === hov.c) ? hov : undefined,
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

  private drawMinimap(): void {
    const show = this.renderer.zoomedIn;
    if (this.miniBox.hidden === show) this.miniBox.hidden = !show;
    if (show) this.renderer.drawMinimap(this.minimap, this.s);
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
    if (!this.isHumanTurn) return;
    const offs = shapeCells(this.s.piece, this.rotation);
    const maxR = Math.max(...offs.map((o) => o.r)) + 1;
    const maxC = Math.max(...offs.map((o) => o.c)) + 1;
    const cs = Math.floor(W / 4.5);
    const ox = (W - maxC * cs) / 2;
    const oy = (W - maxR * cs) / 2;
    const pat = g.createPattern(makeTile(PLAYER_STYLES[this.me]!, this.me, (cs * TILE_CELLS) / TILE), 'repeat')!;
    pat.setTransform(new DOMMatrix([1, 0, 0, 1, ox, oy])); // line the pattern up with the piece's cells
    g.fillStyle = pat;
    g.strokeStyle = PLAYER_STYLES[this.me]!.edge;
    g.lineWidth = 2;
    for (const o of offs) {
      g.fillRect(ox + o.c * cs, oy + o.r * cs, cs, cs);
      g.strokeRect(ox + o.c * cs + 1, oy + o.r * cs + 1, cs - 2, cs - 2);
    }
  }

  private lastCurrent = -1;

  private updatePanel(): void {
    if (this.lastCurrent !== this.me) {
      this.lastCurrent = this.me;
      // In a long (scrolling) player list, keep whoever's turn it is in view.
      this.cards[this.me]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    this.s.players.forEach((p, i) => {
      const card = this.cards[i]!;
      card.classList.toggle('current', i === this.me && this.s.winner === null);
      card.classList.toggle('dead', !p.alive);
      card.classList.toggle('standin', this.standIns.has(i) && p.alive);
      const tag = this.standIns.has(i) && p.alive ? ' · CPU playing' : '';
      card.querySelector('.card-bites')!.textContent = p.alive ? `${biteWord(biteLevel(this.s, i))}: ${p.bites}${tag}` : 'Eaten';
    });
    const act = this.canAct;
    const rotates = SHAPES[this.s.piece]!.masks.length > 1;
    this.btn.rotate!.disabled = !act || this.mode === 'bite' || !rotates;
    this.btn.place!.disabled = !act || this.mode === 'bite' || !this.hover;
    this.btn.bite!.disabled = !act || this.s.players[this.me]!.bites < 1;
    this.btn.bite!.setAttribute('aria-pressed', String(this.mode === 'bite'));
    this.btn.pass!.disabled = !act;
    if (this.btn.pause) {
      this.btn.pause.textContent = this.paused ? 'Resume' : 'Pause';
      this.btn.pause.disabled = this.s.winner !== null;
    }
    this.emoteRow?.classList.toggle('dead', this.you !== null && !this.s.players[this.you]!.alive);
    this.preview.classList.toggle('can-rotate', act && this.mode === 'place' && rotates);
  }

  // ------------------------------------------------------------ turn flow

  private beginTurn(): void {
    clearTimeout(this.cpuTimer);
    if (!this.net) clearInterval(this.timerHandle);
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
    if (this.net) {
      // The server runs the clock, the CPUs and auto-passes; we only show what's happening.
      if (this.isHumanTurn) {
        this.followCurrent();
        this.say(hasAnyMove(this.s, this.me) ? `${p.name}, your move.` : 'You have nowhere to grow — passing.');
      } else this.say(`${p.name}${this.standIns.has(this.me) ? ' (CPU)' : ''} is growing…`);
      this.redraw();
      return;
    }
    if (p.kind === 'human') {
      this.followCurrent();
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
    // Big CPU-only stretches would be slow at full pace; speed up when there are many seats.
    const pace = this.s.players.length > 6 ? 0.4 : 1;
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
      } else this.cpuTimer = window.setTimeout(() => step(queue), CPU_STEP_MS * pace);
    };
    this.cpuTimer = window.setTimeout(() => step(classicCpuTurn(this.s)), CPU_THINK_MS * pace);
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
    if (this.net) {
      // Checked locally for instant feedback; the server has the final word.
      this.waiting = true;
      this.net.send({ t: 'act', seq: this.seq, action: a });
      this.redraw();
      return true;
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
    if (this.canAct) this.commit(a);
  }

  private placeAtHover(): void {
    if (!this.hover) return;
    const g = this.ghostAt(this.hover);
    this.humanAct({ type: 'place', rotation: this.rotation, r: g.r, c: g.c });
  }

  private rotate(dir: 1 | -1): void {
    if (!this.canAct || this.mode === 'bite') return;
    const n = SHAPES[this.s.piece]!.masks.length;
    this.rotation = (this.rotation + dir + n) % n;
    this.touchAim = null;
    this.redraw();
  }

  private toggleBite(): void {
    if (!this.canAct) return;
    if (this.mode === 'place' && this.s.players[this.me]!.bites < 1) {
      this.say(ERRORS['no bites']!);
      return;
    }
    this.mode = this.mode === 'bite' ? 'place' : 'bite';
    this.bite = null;
    if (this.mode === 'bite' && this.biteStartCells().length === 0) this.say('No enemy fungus is touching yours yet — nothing to bite.');
    else this.say(this.mode === 'bite' ? 'Press on a marked enemy cell next to yours, then drag to bite.' : '');
    this.redraw();
  }

  private togglePause(): void {
    if (this.s.winner !== null || this.net) return;
    this.paused = !this.paused;
    this.root.classList.toggle('paused', this.paused);
    this.say(this.paused ? 'Paused.' : '');
    this.redraw();
  }

  private showControls(): void {
    const close = () => this.hideDialog();
    this.dialog.replaceChildren(controlsDialog(close));
    this.dialog.hidden = false;
    (this.dialog.querySelector('button.default') as HTMLButtonElement | null)?.focus();
  }

  // ------------------------------------------------------------ input

  private bindInput(): void {
    const cv = this.canvas;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    // Firefox/Windows start page autoscroll on middle-click; we use middle-drag to pan.
    cv.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });

    // Wheel: zoom the board at the cursor. Shift + wheel: rotate.
    cv.addEventListener(
      'wheel',
      (e) => {
        if (e.ctrlKey) return; // leave browser zoom / trackpad pinch-zoom alone
        e.preventDefault();
        // Some browsers turn Shift + wheel into horizontal scrolling.
        const d = e.deltaY || e.deltaX;
        if (!d) return;
        const px = e.deltaMode === 1 ? d * 33 : e.deltaMode === 2 ? d * 400 : d;
        if (e.shiftKey) {
          // Accumulate so a trackpad's many small deltas don't spin the piece.
          this.wheelRotate += px;
          if (Math.abs(this.wheelRotate) >= 60) {
            this.rotate(this.wheelRotate > 0 ? 1 : -1);
            this.wheelRotate = 0;
          }
          return;
        }
        this.renderer.zoomAt(Math.exp(-Math.max(-300, Math.min(300, px)) * 0.0018), e.clientX, e.clientY);
        this.refreshHover(e);
      },
      { passive: false },
    );

    cv.addEventListener('pointerdown', (e) => {
      cv.focus({ preventScroll: true });
      const cell = this.renderer.cellAt(e.clientX, e.clientY, this.s.size);
      const touch = e.pointerType === 'touch';
      let role: Press['role'] = 'pan';
      if (e.button === 0) {
        if (this.mode === 'bite' && this.canAct && cell && this.biteStartCells().some((q) => q.r === cell.r && q.c === cell.c))
          role = 'bite';
        else role = touch ? 'pan' : 'aim';
      }
      this.presses.set(e.pointerId, { id: e.pointerId, button: e.button, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false, role });
      cv.setPointerCapture(e.pointerId);
      if (this.presses.size === 2) {
        // Second finger: switch to pinch; cancel any bite or tap in progress.
        this.bite = null;
        this.startPinch();
        return;
      }
      if (role === 'bite' && cell) {
        this.bite = { start: cell, cells: [cell] };
        this.redraw();
      } else if (e.pointerType === 'mouse' && e.button === 0) this.setHover(cell);
    });

    cv.addEventListener('pointermove', (e) => {
      const press = this.presses.get(e.pointerId);
      if (!press) {
        // Plain mouse hover.
        if (e.pointerType !== 'touch') this.setHover(this.renderer.cellAt(e.clientX, e.clientY, this.s.size));
        return;
      }
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_SLOP) press.moved = true;
      if (this.pinch && this.presses.size >= 2) {
        press.lastX = e.clientX;
        press.lastY = e.clientY;
        this.updatePinch();
        return;
      }
      if (press.role === 'bite') this.extendBite(e);
      else if (press.role === 'pan' && press.moved) {
        this.renderer.panBy(e.clientX - press.lastX, e.clientY - press.lastY);
        if (e.pointerType !== 'touch') this.setHover(this.renderer.cellAt(e.clientX, e.clientY, this.s.size));
      } else if (press.role === 'aim') this.setHover(this.renderer.cellAt(e.clientX, e.clientY, this.s.size));
      press.lastX = e.clientX;
      press.lastY = e.clientY;
    });

    const end = (e: PointerEvent, cancelled: boolean) => {
      const press = this.presses.get(e.pointerId);
      if (!press) return;
      this.presses.delete(e.pointerId);
      if (this.pinch) {
        if (this.presses.size < 2) this.pinch = null;
        // Remaining finger keeps panning without jumping.
        for (const p of this.presses.values()) {
          p.moved = true;
          p.role = 'pan';
        }
        return;
      }
      if (cancelled) return;
      const cell = this.renderer.cellAt(e.clientX, e.clientY, this.s.size);
      if (press.role === 'bite') {
        if (this.bite) {
          const cells = this.bite.cells;
          this.bite = null;
          if (!this.commit({ type: 'bite', cells })) this.redraw();
        }
        return;
      }
      if (press.moved) return; // it was a pan
      // A click / tap.
      if (press.button === 2) return this.rotate(1); // right-click rotates
      if (press.button !== 0 || !cell || !this.canAct || this.mode === 'bite') return;
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
    };
    cv.addEventListener('pointerup', (e) => end(e, false));
    cv.addEventListener('pointercancel', (e) => end(e, true));
    cv.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !this.presses.size) this.setHover(null);
    });

    // Click / tap the piece preview to rotate.
    this.preview.addEventListener('click', () => this.rotate(1));
    this.preview.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        this.rotate(1);
      }
    });

    // Minimap: click or drag to move the view.
    const jump = (e: PointerEvent) => {
      const rect = this.minimap.getBoundingClientRect();
      const n = this.s.size;
      this.renderer.glideTo({ cx: ((e.clientX - rect.left) / rect.width) * n, cy: ((e.clientY - rect.top) / rect.height) * n });
    };
    this.minimap.addEventListener('pointerdown', (e) => {
      this.minimap.setPointerCapture(e.pointerId);
      jump(e);
    });
    this.minimap.addEventListener('pointermove', (e) => {
      if (e.buttons) jump(e);
    });

    window.addEventListener('keydown', this.onKey);
  }

  private startPinch(): void {
    const [a, b] = [...this.presses.values()];
    if (!a || !b) return;
    this.pinch = { dist: Math.hypot(a.lastX - b.lastX, a.lastY - b.lastY), mx: (a.lastX + b.lastX) / 2, my: (a.lastY + b.lastY) / 2 };
    this.touchAim = null;
  }

  private updatePinch(): void {
    const [a, b] = [...this.presses.values()];
    if (!a || !b || !this.pinch) return;
    const dist = Math.hypot(a.lastX - b.lastX, a.lastY - b.lastY);
    const mx = (a.lastX + b.lastX) / 2;
    const my = (a.lastY + b.lastY) / 2;
    this.renderer.panBy(mx - this.pinch.mx, my - this.pinch.my);
    if (this.pinch.dist > 0) this.renderer.zoomAt(dist / this.pinch.dist, mx, my);
    this.pinch = { dist, mx, my };
  }

  private refreshHover(e: { clientX: number; clientY: number }): void {
    this.setHover(this.renderer.cellAt(e.clientX, e.clientY, this.s.size), true);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!this.dialog.hidden) {
      if (e.key === 'Escape') this.hideDialogIfControls();
      return;
    }
    const k = e.key.toLowerCase();
    const r = this.renderer;
    switch (k) {
      case 'w':
        return r.panView(0, -0.25);
      case 's':
        return r.panView(0, 0.25);
      case 'a':
        return r.panView(-0.25, 0);
      case 'd':
        return r.panView(0.25, 0);
      case 'q':
        return this.rotate(-1);
      case 'e':
        return this.rotate(1);
      case ' ':
      case 'arrowright':
      case 'arrowup':
        e.preventDefault();
        return this.rotate(1);
      case 'arrowleft':
      case 'arrowdown':
        e.preventDefault();
        return this.rotate(-1);
      case '+':
      case '=':
        return r.glideTo({ across: r.cam.across / 1.35 });
      case '-':
      case '_':
        return r.glideTo({ across: r.cam.across * 1.35 });
      case '0':
        return r.fit();
      case 'c':
        return this.centreOnMine();
      case 'b':
        return this.toggleBite();
      case 'g':
        return this.humanAct({ type: 'pass' });
      case 'p':
        return this.togglePause();
      case '?':
      case '/':
        return this.showControls();
      case 'escape':
        if (this.mode === 'bite') this.toggleBite();
        return;
      case 'enter':
        return this.placeAtHover();
    }
  };

  private setHover(cell: Pos | null, force = false): void {
    const same = cell && this.hover && cell.r === this.hover.r && cell.c === this.hover.c;
    if (!force && (same || (!cell && !this.hover))) return;
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
    const prev = this.bite.cells;
    if (cells.length !== prev.length || cells.some((q, i) => q.r !== prev[i]!.r || q.c !== prev[i]!.c)) {
      this.bite.cells = cells;
      this.redraw();
    }
  }

  /** Development builds only: a handle for automated tests to drive the game. */
  private exposeForTests(): void {
    if (!import.meta.env.DEV) return; // dead in production builds, so the bundler drops it
    (window as unknown as { __fungus: unknown }).__fungus = {
      state: () => this.s,
      seq: () => this.seq,
      you: () => this.you,
      canAct: () => this.canAct,
      hash: () => stateHash(this.s),
      placeAny: () => {
        if (!this.canAct) return false;
        const moves = legalPlacements(this.s, this.me);
        const m = moves[Math.floor(Math.random() * moves.length)];
        return this.commit(m ? { type: 'place', rotation: m.rotation, r: m.r, c: m.c } : { type: 'pass' });
      },
    };
  }

  // ------------------------------------------------------------ online

  /** Messages from the server for this game (the app routes them here). */
  onServer(m: ServerMessage): void {
    if (!this.net) return;
    switch (m.t) {
      case 'applied':
        return this.onApplied(m);
      case 'game':
        return this.loadSnapshot(m.game);
      case 'timer':
        return this.setServerTimer(m.timeLeft);
      case 'emote':
        return this.showEmote(m.player, m.id);
      case 'notice':
        return this.say(m.text);
      case 'error':
        if (m.code === 'not-your-turn' || m.code === 'illegal') {
          this.waiting = false;
          sfx.error();
          this.say(ERRORS[m.text] ?? m.text);
          this.redraw();
        } else this.say(m.text);
        return;
    }
  }

  /** Connection dropped or came back. */
  onNetStatus(online: boolean): void {
    if (!online) {
      this.waiting = false;
      this.say('Connection lost — reconnecting…');
    }
    this.root.classList.toggle('offline', !online);
    this.redraw();
  }

  private onApplied(m: Extract<ServerMessage, { t: 'applied' }>): void {
    if (this.resyncing || m.seq <= this.seq) return; // already have it, or a snapshot is on its way
    if (m.seq !== this.seq + 1) return this.resync();
    const res = applyAction(this.s, m.player, m.action);
    if (!res.ok || stateHash(res.state) !== m.hash) {
      console.warn('fungus: out of step with the server, resyncing', res.ok ? 'hash mismatch' : res.error);
      return this.resync();
    }
    this.seq = m.seq;
    this.standIns = new Set(m.standIns);
    if (m.player === this.you) this.waiting = false;
    const endsTurn = m.action.type !== 'bite' || res.state.winner !== null;
    this.absorb(res.state, res.events);
    this.setServerTimer(m.timeLeft);
    if (endsTurn) this.beginTurn();
    else if (m.player === this.you) {
      this.mode = 'place';
      this.bite = null;
      this.redraw();
    }
  }

  private resync(): void {
    this.resyncing = true;
    this.net?.send({ t: 'resync' });
  }

  private loadSnapshot(g: GameSnapshot): void {
    const fresh = g.state.size !== this.s.size;
    this.resyncing = false;
    this.waiting = false;
    this.s = g.state;
    this.seq = g.seq;
    this.you = g.you;
    this.standIns = new Set(g.standIns);
    if (fresh) this.layout();
    this.beginTurn();
    this.setServerTimer(g.timeLeft);
  }

  /** Show the server's turn clock counting down. */
  private setServerTimer(timeLeft: number | null): void {
    clearInterval(this.timerHandle);
    const limit = (this.s.config.turnTimeLimit ?? 0) * 1000;
    if (timeLeft === null || !limit) {
      this.timerBar.style.width = '0%';
      return;
    }
    this.deadline = performance.now() + timeLeft;
    const tick = () => {
      const left = this.deadline - performance.now();
      this.timerBar.style.width = `${Math.max(0, Math.min(1, left / limit)) * 100}%`;
      if (left <= 0) clearInterval(this.timerHandle);
    };
    tick();
    this.timerHandle = window.setInterval(tick, 100);
  }

  private showEmote(player: number, id: Emote): void {
    const bubble = this.cards[player]?.querySelector<HTMLElement>('.emote-bubble');
    if (!bubble) return;
    bubble.textContent = EMOTE_LABEL[id];
    bubble.hidden = false;
    bubble.classList.remove('pop');
    void bubble.offsetWidth; // restart the animation
    bubble.classList.add('pop');
    clearTimeout(Number(bubble.dataset.timer));
    bubble.dataset.timer = String(window.setTimeout(() => (bubble.hidden = true), 2600));
  }

  // ------------------------------------------------------------ end

  private gameOver(): void {
    clearInterval(this.timerHandle);
    const w = this.s.players[this.s.winner!]!;
    sfx.win();
    if (this.opts.online) {
      const on = this.opts.online;
      const mine = this.s.winner === this.you;
      this.say(`${w.name} wins.`);
      this.redraw();
      this.showDialog(mine ? 'Your fungus wins!' : `${w.name}’s fungus wins`, `${this.s.round} rounds of growth.`, [
        ['Back to room', () => on.onBackToRoom()],
        ['Leave', () => this.opts.onExit()],
      ]);
      return;
    }
    recordResult(
      this.s.players.map((p) => p.name),
      w.name,
    );
    this.say(`${w.name} wins.`);
    this.redraw();
    this.showDialog(`${w.name}’s fungus wins`, `${this.s.round} rounds of growth.`, [
      ['Play again', () => this.restart()],
      ['Back to setup', () => this.opts.onExit()],
    ]);
  }

  private restart(): void {
    this.hideDialog();
    this.s = createGame(this.opts.config, (Math.random() * 2 ** 32) >>> 0);
    this.renderer.resize(this.s.size);
    this.renderer.cam = { cx: this.s.size / 2, cy: this.s.size / 2, across: this.s.size };
    this.initialCamera();
    this.beginTurn();
  }

  private confirmExit(): void {
    if (this.s.winner !== null) return this.opts.onExit();
    if (this.net) {
      const playing = this.you !== null && this.s.players[this.you]!.alive;
      if (!playing) return this.opts.onExit();
      this.showDialog('Leave this game?', 'A CPU will play your fungus for the rest of the game.', [
        ['Leave', () => this.opts.onExit()],
        ['Keep playing', () => this.hideDialog()],
      ]);
      return;
    }
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

  private hideDialogIfControls(): void {
    if (this.dialog.querySelector('.controls-dialog')) this.hideDialog();
  }

  private hideDialog(): void {
    this.dialog.hidden = true;
    this.dialog.replaceChildren();
    this.canvas.focus({ preventScroll: true });
  }
}
