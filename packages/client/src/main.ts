import './style.css';
import {
  BOARD_SIZES,
  GAME_SPEEDS,
  MAX_PLAYERS,
  SPEEDS,
  TOOTH_RATES,
  classicConfig,
  gameSpeedSettings,
  matchGameSpeed,
  minModernSize,
  modernBiteStep,
  modernConfig,
} from '@fungus/engine';
import type { GameConfig, GameSpeed, PlayerConfig, Speed } from '@fungus/engine';
import { controlsTables } from './controls';
import { h, titlebar } from './dom';
import { GameScreen } from './game';
import { Online } from './online';
import { cleanCode } from '@fungus/protocol';
import type { RoomSettings, SeatSpec } from '@fungus/protocol';
import { setSound } from './sound';
import { load, save } from './storage';
import type { Saved, Seat } from './storage';
import { PLAYER_STYLES, TILE, drawFace, makeTile, remapStyles, restoreStyles } from './textures';
import { UI_SCALES, initUiScale, setUiScale } from './zoom';

const app = document.getElementById('app')!;
let current: GameScreen | null = null;
let online: Online | null = null;

const KIND_LABEL: Record<Seat['kind'], string> = { human: 'Human', 'cpu-classic': 'CPU', cpu: 'CPU', none: 'None' };

function swatch(i: number, size = 96): HTMLCanvasElement {
  const cv = h('canvas', { class: 'swatch', width: size, height: size, 'aria-hidden': 'true' });
  const g = cv.getContext('2d')!;
  g.fillStyle = g.createPattern(makeTile(PLAYER_STYLES[i]!, i, size / TILE), 'repeat')!;
  g.fillRect(0, 0, size, size);
  drawFace(g, size * 0.2, size * 0.2, size * 0.6, PLAYER_STYLES[i]!, true);
  return cv;
}

/** A row of radio buttons styled as one segmented control. */
function segmented<T extends string | number>(
  name: string,
  label: string,
  options: { value: T; text: string; disabled?: boolean; title?: string }[],
  value: T,
  onChange: (v: T) => void,
): HTMLElement {
  return h(
    'div',
    { class: 'seg', role: 'radiogroup', 'aria-label': label },
    ...options.map((o) =>
      h(
        'label',
        { title: o.title, class: o.disabled ? 'disabled' : undefined },
        h('input', { type: 'radio', name, value: String(o.value), checked: o.value === value, disabled: o.disabled, onchange: () => onChange(o.value) }),
        h('span', {}, o.text),
      ),
    ),
  );
}

/** Keeps the disclosure open and the player list scrolled across re-renders. */
const ui = { customOpen: false, playersScroll: 0 };

function showSetup(): void {
  current?.destroy();
  current = null;
  // Remember focus so keyboard users keep their place when the form re-renders.
  const focused = document.activeElement as HTMLInputElement | null;
  const focusKey = focused?.name ? `${focused.name}=${focused.value}` : focused?.dataset.key ?? null;

  const st: Saved = load();
  setSound(st.sound);
  const error = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const persist = () => save({ ...load(), ...st });
  const rerender = () => {
    ui.playersScroll = document.querySelector('.players-scroll')?.scrollTop ?? 0;
    persist();
    showSetup();
  };
  const modern = st.rules === 'modern';
  const nModern = st.modernSeats.length;

  // ---- keep modern settings consistent with the chosen preset and player count
  if (modern) {
    // Presets only set the two speeds; the board is always the player's own choice.
    if (st.gameSpeed !== 'custom') Object.assign(st, gameSpeedSettings(st.gameSpeed));
    else st.gameSpeed = matchGameSpeed(st) ?? 'custom';
    const min = minModernSize(nModern);
    if (st.boardSize < min) st.boardSize = min;
  }
  if (!BOARD_SIZES.some((b) => b.size === st.boardSize)) st.boardSize = 20;
  /** After a manual change, show which preset (if any) the settings now match. */
  const syncPreset = () => {
    st.gameSpeed = matchGameSpeed(st) ?? 'custom';
  };

  const datalist = h('datalist', { id: 'roster-names' }, ...load().roster.map((r) => h('option', { value: r.name })));
  const nameInput = (seat: Seat, i: number) =>
    h('input', {
      type: 'text',
      value: seat.name,
      maxlength: 16,
      list: 'roster-names',
      'data-key': `name${i}`,
      'aria-label': `${PLAYER_STYLES[i]!.name} player name`,
      oninput: (e: Event) => {
        seat.name = (e.target as HTMLInputElement).value;
        persist();
      },
    });

  // ---- rules
  const rules = segmented<'classic' | 'modern'>(
    'rules',
    'Rules',
    [
      { value: 'classic', text: 'Classic' },
      { value: 'modern', text: 'Modern' },
    ],
    st.rules,
    (v) => {
      st.rules = v;
      rerender();
    },
  );
  const rulesNote = h(
    'p',
    { class: 'muted note' },
    modern
      ? 'Up to 16 players in a fair ring. Pick a game speed, or set everything yourself.'
      : 'The 1994 game: up to 4 players, teeth in the corners.',
  );

  // ---- game speed (modern)
  const speed = modern
    ? h(
        'div',
        { class: 'field' },
        h('h2', {}, 'Game speed'),
        segmented<GameSpeed>(
          'gameSpeed',
          'Game speed',
          GAME_SPEEDS.map((g) => ({ value: g.id, text: g.label })),
          st.gameSpeed === 'custom' ? ('none' as GameSpeed) : st.gameSpeed,
          (v) => {
            st.gameSpeed = v;
            rerender();
          },
        ),
        h(
          'p',
          { class: 'muted note' },
          st.gameSpeed === 'custom'
            ? 'Custom — your own mix of new teeth and bite growth.'
            : 'Faster games grow new teeth more often and bites get bigger sooner.',
        ),
      )
    : null;

  // ---- board
  const minSize = modern ? minModernSize(nModern) : 0;
  const board = h(
    'div',
    { class: 'field' },
    h('h2', {}, 'Board'),
    segmented<number>(
      'board',
      'Board size',
      BOARD_SIZES.map((b) => ({
        value: b.size,
        text: `${b.label} ${b.size}`,
        disabled: b.size < minSize,
        title: b.size < minSize ? `Too small for ${nModern} players` : `${b.size} × ${b.size} cells`,
      })),
      st.boardSize,
      (v) => {
        st.boardSize = v;
        rerender();
      },
    ),
    modern && minSize > 20
      ? h('p', { class: 'muted note' }, `${nModern} players need at least the ${BOARD_SIZES.find((b) => b.size === minSize)!.label} board.`)
      : null,
  );

  // ---- custom settings (modern): new teeth + bite growth, independent of each other
  let custom: HTMLElement | null = null;
  if (modern) {
    const t = TOOTH_RATES[st.newTeeth];
    const step = modernBiteStep(st.boardSize, nModern, st.biteGrowth);
    const label = (sp: Speed) => SPEEDS.find((x) => x.id === sp)!.label;
    const picker = (name: string, title: string, value: Speed, set: (v: Speed) => void) =>
      segmented<Speed>(name, title, SPEEDS.map((sp) => ({ value: sp.id, text: sp.label })), value, (v) => {
        set(v);
        syncPreset();
        rerender();
      });
    custom = h(
      'details',
      {
        class: 'custom',
        open: ui.customOpen, // only the player opens or closes it
        ontoggle: (e: Event) => (ui.customOpen = (e.target as HTMLDetailsElement).open),
      },
      h(
        'summary',
        {},
        h('span', { class: 'summary-title' }, 'Custom settings'),
        h('span', { class: 'muted' }, ` New teeth ${label(st.newTeeth).toLowerCase()}, bite growth ${label(st.biteGrowth).toLowerCase()}`),
      ),
      h(
        'div',
        { class: 'custom-body' },
        h(
          'div',
          { class: 'field' },
          h('h3', {}, 'New teeth'),
          picker('newTeeth', 'How often new teeth grow', st.newTeeth, (v) => (st.newTeeth = v)),
          h('p', { class: 'muted note' }, `Everyone gets a free bite every ${t.base}–${t.base + t.jitter - 1} rounds.`),
        ),
        h(
          'div',
          { class: 'field' },
          h('h3', {}, 'Bite growth'),
          picker('biteGrowth', 'How soon bites get bigger', st.biteGrowth, (v) => (st.biteGrowth = v)),
          h('p', { class: 'muted note' }, `Big bites (2 long) at ${step} cells, monster bites (3 long) at ${step * 2}.`),
        ),
      ),
    );
  }

  // ---- players
  let seatsEl: HTMLElement;
  if (!modern) {
    seatsEl = h(
      'div',
      { class: 'seats' },
      ...st.seats.map((seat, i) => {
        const el = h(
          'fieldset',
          { class: `seat${seat.kind === 'none' ? ' empty' : ''}`, style: `--edge:${PLAYER_STYLES[i]!.edge}` },
          swatch(i),
          nameInput(seat, i),
          segmented<Seat['kind']>(
            `seat${i}`,
            `${PLAYER_STYLES[i]!.name} seat`,
            (['human', 'cpu-classic', 'none'] as const).map((k) => ({ value: k, text: KIND_LABEL[k] })),
            seat.kind,
            (k) => {
              seat.kind = k;
              el.classList.toggle('empty', k === 'none');
              persist();
            },
          ),
        );
        return el;
      }),
    );
  } else {
    seatsEl = h(
      'div',
      { class: 'seat-list' },
      ...st.modernSeats.map((seat, i) =>
        h(
          'fieldset',
          { class: 'seat-row', style: `--edge:${PLAYER_STYLES[i]!.edge}` },
          swatch(i),
          nameInput(seat, i),
          segmented<Seat['kind']>(
            `mseat${i}`,
            `${PLAYER_STYLES[i]!.name} seat`,
            (['human', 'cpu-classic'] as const).map((k) => ({ value: k, text: KIND_LABEL[k] })),
            seat.kind === 'none' ? 'cpu-classic' : seat.kind,
            (k) => {
              seat.kind = k;
              persist();
            },
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'remove',
              'data-key': `remove${i}`,
              'aria-label': `Remove ${seat.name || PLAYER_STYLES[i]!.name}`,
              title: 'Remove this player',
              disabled: nModern <= 2,
              onclick: () => {
                st.modernSeats.splice(i, 1);
                rerender();
              },
            },
            '×',
          ),
        ),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'add-player',
          'data-key': 'add',
          disabled: nModern >= MAX_PLAYERS,
          onclick: () => {
            st.modernSeats.push({ name: `CPU ${st.modernSeats.length}`, kind: 'cpu-classic' });
            rerender();
          },
        },
        nModern >= MAX_PLAYERS ? `${MAX_PLAYERS} players is the most` : 'Add player',
      ),
    );
  }
  const players = h(
    'div',
    { class: 'field players-field' },
    h('h2', {}, `Players${modern ? ` (${nModern})` : ''}`),
    h('div', { class: 'players-scroll' }, seatsEl),
    datalist,
  );

  // ---- options
  const timeOn = h('input', { type: 'checkbox', checked: st.timeLimit !== null, id: 'time-on' });
  const timeSecs = h('input', { type: 'number', min: 3, max: 60, value: st.timeLimit ?? 15, 'aria-label': 'Seconds per turn' });
  const soundOn = h('input', { type: 'checkbox', checked: st.sound, id: 'sound-on' });
  const uiSize = h(
    'select',
    {
      id: 'ui-size',
      onchange: (e: Event) => {
        st.uiScale = Number((e.target as HTMLSelectElement).value);
        setUiScale(st.uiScale);
      },
    },
    ...UI_SCALES.map((sc) => h('option', { value: sc.value, selected: sc.value === st.uiScale }, sc.label)),
  );
  const options = h(
    'div',
    { class: 'options' },
    h('div', { class: 'opt' }, h('label', { for: 'time-on' }, timeOn, ' Turn time limit'), timeSecs, h('span', { class: 'muted' }, 'seconds')),
    h('div', { class: 'opt' }, h('label', { for: 'sound-on' }, soundOn, ' Sound')),
    h('div', { class: 'opt' }, h('label', { for: 'ui-size' }, 'Interface size'), uiSize),
  );

  const start = () => {
    const seats = !modern
      ? st.seats.flatMap((s, i) => (s.kind === 'none' ? [] : [{ ...s, i }]))
      : st.modernSeats.map((s, i) => ({ ...s, kind: s.kind === 'none' ? ('cpu-classic' as const) : s.kind, i }));
    if (seats.length < 2) return void (error.textContent = 'Fill at least two seats to start.');
    const names = seats.map((s) => s.name.trim() || PLAYER_STYLES[s.i]!.name);
    if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) return void (error.textContent = 'Each player needs a different name.');
    const secs = Math.round(Number(timeSecs.value));
    if (timeOn.checked && !(secs >= 3 && secs <= 60)) return void (error.textContent = 'Turn time limit must be 3–60 seconds.');
    st.timeLimit = timeOn.checked ? secs : null;
    st.sound = soundOn.checked;
    persist();
    setSound(st.sound);
    const ps: PlayerConfig[] = seats.map((s, k) => ({ name: names[k]!, kind: s.kind as PlayerConfig['kind'] }));
    const config: GameConfig = !modern
      ? classicConfig(ps, { size: st.boardSize, turnTimeLimit: st.timeLimit })
      : modernConfig(ps, st.boardSize, { turnTimeLimit: st.timeLimit }, { newTeeth: st.newTeeth, biteGrowth: st.biteGrowth });
    showGame(config, seats.map((s) => s.i));
  };

  const roster = [...load().roster].sort((a, b) => b.wins - a.wins || a.losses - b.losses).slice(0, 8);
  const best = h(
    'section',
    { class: 'best' },
    h('h2', {}, 'Best fungal growths'),
    roster.length
      ? h(
          'table',
          {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Won'), h('th', {}, 'Lost'), h('th', {}, 'Avg'))),
          h(
            'tbody',
            {},
            ...roster.map((r) =>
              h(
                'tr',
                {},
                h('td', {}, r.name),
                h('td', {}, String(r.wins)),
                h('td', {}, String(r.losses)),
                h('td', {}, (r.wins + r.losses ? r.wins / (r.wins + r.losses) : 0).toFixed(3).replace(/^0/, '')),
              ),
            ),
          ),
        )
      : h('p', { class: 'muted' }, 'No games yet. Wins and losses show up here.'),
  );

  app.replaceChildren(
    h(
      'section',
      { class: 'window setup-window' },
      titlebar('Fungus'),
      h(
        'form',
        { class: 'setup', onsubmit: (e: Event) => (e.preventDefault(), start()) },
        h('div', { class: 'setup-left' }, h('h1', { class: 'logo' }, 'Fungus'), best, options, h('p', { class: 'credit' }, 'A remake of Fungus 2.0 © 1992, 1994 Ryan Koopmans.')),
        h(
          'div',
          { class: 'setup-right' },
          h('div', { class: 'field' }, h('h2', {}, 'Rules'), rules, rulesNote),
          speed,
          board,
          custom,
          players,
        ),
        h(
          'div',
          { class: 'setup-actions' },
          error,
          h('button', { type: 'button', 'data-key': 'help', onclick: showHelp }, 'How to play'),
          h('button', { type: 'button', 'data-key': 'online', onclick: () => (persist(), showOnline()) }, 'Play online'),
          h('button', { type: 'submit', class: 'default' }, 'Begin'),
        ),
      ),
    ),
  );

  const scroller = document.querySelector('.players-scroll');
  if (scroller) scroller.scrollTop = ui.playersScroll;
  if (focusKey) {
    const [name, value] = focusKey.split('=');
    const el = value !== undefined
      ? document.querySelector<HTMLElement>(`input[name="${name}"][value="${value}"]`)
      : document.querySelector<HTMLElement>(`[data-key="${focusKey}"]`);
    el?.focus({ preventScroll: true });
  }
}

function showGame(config: GameConfig, seats: number[]): void {
  remapStyles(seats);
  current = new GameScreen({
    config,
    onExit: () => {
      restoreStyles();
      showSetup();
    },
  });
  app.replaceChildren(current.root);
}

// ---------------------------------------------------------------- online

/**
 * The room the setup screen describes. Every seat starts open for people to join;
 * any still empty at the start are played by CPUs (the host can also reserve CPU seats).
 */
function hostSettings(): Omit<RoomSettings, 'turnTimeLimit' | 'public'> {
  const st = load();
  let seats: SeatSpec[] = st.rules === 'classic' ? st.seats.map((x) => (x.kind === 'none' ? 'closed' : 'open')) : st.modernSeats.map(() => 'open');
  // A game needs two seats.
  if (seats.filter((x) => x !== 'closed').length < 2) seats = seats.map((x, i) => (i < 2 ? 'open' : x));
  const boardSize = st.rules === 'modern' ? Math.max(st.boardSize, minModernSize(seats.length)) : st.boardSize;
  return { rules: st.rules, boardSize, newTeeth: st.newTeeth, biteGrowth: st.biteGrowth, seats };
}

function hostSummary(): string {
  const r = hostSettings();
  const n = r.seats.filter((x) => x !== 'closed').length;
  const board = BOARD_SIZES.find((b) => b.size === r.boardSize)!;
  return (
    `From your setup: ${r.rules === 'classic' ? 'Classic' : 'Modern'} rules, ${board.label} ${r.boardSize} board, ${n} seats. ` +
    `CPUs fill any seats nobody takes.`
  );
}

function showOnline(joinCode?: string): void {
  current?.destroy();
  current = null;
  online = new Online(app, {
    hostSettings,
    hostSummary,
    joinCode,
    onBack: () => {
      online = null;
      showSetup();
    },
  });
}

function showHelp(): void {
  const close = () => dlg.remove();
  const dlg = h(
    'div',
    { class: 'dialog' },
    h(
      'div',
      { class: 'window dialog-box help', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'How to play' },
      titlebar('How to play', () => close(), 'Close'),
      h(
        'div',
        { class: 'help-body' },
        h('p', {}, 'One night in the lab, after the biologists have gone home, an experiment takes on a life of its own. Be the last fungus alive.'),
        h('h3', {}, 'Grow'),
        h('p', {}, 'Each turn you get a piece. Rotate it, then place it touching your fungus along an edge.'),
        h('h3', {}, 'Capture'),
        h('p', {}, 'Trap enemy fungus in a straight line between your own cells — across, down or diagonally — and it becomes yours. Captures can chain. Capture an enemy’s head and their whole fungus is yours, bites included.'),
        h('h3', {}, 'Stay connected'),
        h('p', {}, 'Every cell must connect back to its head along edges. Cut-off fungus shrivels and dies.'),
        h('h3', {}, 'Bite'),
        h('p', {}, 'Press B (or Bite), then press on a marked enemy cell next to yours and drag. A bite costs one tooth and doesn’t use up your turn — bite first, then grow into the gap. Heads can’t be bitten.'),
        h('p', {}, 'Grow onto a tooth to collect it, and every so often everyone grows a new one. As your fungus grows, bites get longer: big bites reach 2 cells, monster bites 3.'),
        h('h3', {}, 'Classic and Modern'),
        h('p', {}, 'Classic is the 1994 game: up to four players and teeth in the corners. Modern seats up to 16 players in a ring, with teeth placed so everyone is equally far from them. Both work on any board size.'),
        h('h3', {}, 'Controls'),
        controlsTables(),
      ),
      h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'default', onclick: close }, 'Got it')),
    ),
  );
  dlg.addEventListener('keydown', (e) => e.key === 'Escape' && close());
  document.body.append(dlg);
  (dlg.querySelector('button.default') as HTMLButtonElement).focus();
}

initUiScale();
const invite = cleanCode(new URLSearchParams(location.search).get('room'));
if (invite) showOnline(invite);
else showSetup();
