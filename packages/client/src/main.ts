import './style.css';
import { BOARD_SIZES, MAX_PLAYERS, classicConfig, minModernSize, modernConfig } from '@fungus/engine';
import type { GameConfig, PlayerConfig } from '@fungus/engine';
import { controlsTables } from './controls';
import { h, titlebar } from './dom';
import { GameScreen } from './game';
import { setSound } from './sound';
import { load, save } from './storage';
import type { Saved, Seat } from './storage';
import { PLAYER_STYLES, TILE, drawFace, makeTile } from './textures';
import { UI_SCALES, initUiScale, setUiScale } from './zoom';

const app = document.getElementById('app')!;
let current: GameScreen | null = null;

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

function showSetup(): void {
  current?.destroy();
  current = null;
  const st: Saved = load();
  setSound(st.sound);
  const error = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const persist = () => save({ ...load(), ...st });
  const rerender = () => {
    persist();
    showSetup();
  };

  const datalist = h('datalist', { id: 'roster-names' }, ...load().roster.map((r) => h('option', { value: r.name })));
  const nameInput = (seat: Seat, i: number) =>
    h('input', {
      type: 'text',
      value: seat.name,
      maxlength: 16,
      list: 'roster-names',
      'aria-label': `${PLAYER_STYLES[i]!.name} player name`,
      oninput: (e: Event) => {
        seat.name = (e.target as HTMLInputElement).value;
        persist();
      },
    });

  // ---- rules & board
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
    st.rules === 'classic'
      ? 'The 1994 game: up to 4 players, teeth in the corners.'
      : 'Up to 16 players spaced evenly in a ring, with teeth placed fairly between neighbours and in the centre.',
  );

  const activeModern = st.modernSeats.length;
  const minSize = st.rules === 'modern' ? minModernSize(activeModern) : 0;
  if (st.boardSize < minSize) st.boardSize = minSize;
  if (!BOARD_SIZES.some((b) => b.size === st.boardSize)) st.boardSize = 20;
  const board = segmented<number>(
    'board',
    'Board size',
    BOARD_SIZES.map((b) => ({
      value: b.size,
      text: `${b.label} ${b.size}`,
      disabled: b.size < minSize,
      title: b.size < minSize ? `Too small for ${activeModern} players` : `${b.size} × ${b.size} cells`,
    })),
    st.boardSize,
    (v) => {
      st.boardSize = v;
      persist();
    },
  );
  const boardNote =
    st.rules === 'modern' && minSize > 20
      ? h('p', { class: 'muted note' }, `${activeModern} players need at least the ${BOARD_SIZES.find((b) => b.size === minSize)!.label} board.`)
      : null;

  // ---- seats
  let seatsEl: HTMLElement;
  if (st.rules === 'classic') {
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
              'aria-label': `Remove ${seat.name || PLAYER_STYLES[i]!.name}`,
              title: 'Remove this player',
              disabled: activeModern <= 2,
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
          disabled: activeModern >= MAX_PLAYERS,
          onclick: () => {
            st.modernSeats.push({ name: `CPU ${st.modernSeats.length}`, kind: 'cpu-classic' });
            rerender();
          },
        },
        activeModern >= MAX_PLAYERS ? `${MAX_PLAYERS} players is the most` : 'Add player',
      ),
    );
  }

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
    ...UI_SCALES.map((s) => h('option', { value: s.value, selected: s.value === st.uiScale }, s.label)),
  );

  const start = () => {
    const seats =
      st.rules === 'classic'
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
    const players: PlayerConfig[] = seats.map((s, k) => ({ name: names[k]!, kind: s.kind as PlayerConfig['kind'] }));
    const config: GameConfig =
      st.rules === 'classic'
        ? classicConfig(players, { size: st.boardSize, turnTimeLimit: st.timeLimit })
        : modernConfig(players, st.boardSize, { turnTimeLimit: st.timeLimit });
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
        h('h1', { class: 'logo' }, 'Fungus'),
        best,
        h('div', { class: 'field' }, h('h2', {}, 'Rules'), rules, rulesNote),
        h('div', { class: 'field' }, h('h2', {}, 'Board'), board, boardNote),
        h('div', { class: 'field' }, h('h2', {}, `Players${st.rules === 'modern' ? ` (${activeModern})` : ''}`), seatsEl, datalist),
        h(
          'div',
          { class: 'options' },
          h('label', { for: 'time-on' }, timeOn, ' Turn time limit '),
          timeSecs,
          h('span', { class: 'muted' }, ' seconds'),
          h('label', { for: 'sound-on', class: 'sound' }, soundOn, ' Sound'),
          h('label', { for: 'ui-size' }, 'Interface size '),
          uiSize,
        ),
        error,
        h(
          'div',
          { class: 'setup-actions' },
          h('button', { type: 'button', onclick: showHelp }, 'How to play'),
          h('button', { type: 'submit', class: 'default' }, 'Begin'),
        ),
        h('p', { class: 'credit' }, 'A remake of Fungus 2.0 © 1992, 1994 Ryan Koopmans.'),
      ),
    ),
  );
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

// Engine indices are compact (0..n-1) but classic seats keep their colour, so swap the style table for the game.
const ORIGINAL_STYLES = [...PLAYER_STYLES];
function remapStyles(seats: number[]): void {
  seats.forEach((seat, i) => (PLAYER_STYLES[i] = ORIGINAL_STYLES[seat]!));
}
function restoreStyles(): void {
  ORIGINAL_STYLES.forEach((s, i) => (PLAYER_STYLES[i] = s));
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
showSetup();
