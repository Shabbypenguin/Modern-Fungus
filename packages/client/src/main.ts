import './style.css';
import type { PlayerConfig } from '@fungus/engine';
import { h, titlebar } from './dom';
import { GameScreen } from './game';
import { setSound } from './sound';
import { load, save } from './storage';
import { initZoom } from './zoom';
import type { Saved, Seat } from './storage';
import { PLAYER_STYLES, TILE, drawFace, makeTile } from './textures';

const app = document.getElementById('app')!;
let current: GameScreen | null = null;

const KIND_LABEL: Record<Seat['kind'], string> = {
  human: 'Human',
  'cpu-classic': 'CPU',
  cpu: 'CPU',
  none: 'None',
};

function swatch(i: number, size = 96): HTMLCanvasElement {
  const cv = h('canvas', { class: 'swatch', width: size, height: size, 'aria-hidden': 'true' });
  const g = cv.getContext('2d')!;
  g.fillStyle = g.createPattern(makeTile(PLAYER_STYLES[i]!, i, size / TILE), 'repeat')!;
  g.fillRect(0, 0, size, size);
  drawFace(g, size * 0.2, size * 0.2, size * 0.6, PLAYER_STYLES[i]!, true);
  return cv;
}

function showSetup(): void {
  current?.destroy();
  current = null;
  const saved: Saved = load();
  setSound(saved.sound);
  const seats = saved.seats.map((s) => ({ ...s }));

  const error = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const datalist = h('datalist', { id: 'roster-names' }, ...saved.roster.map((r) => h('option', { value: r.name })));

  const seatEls = seats.map((seat, i) => {
    const name = h('input', {
      type: 'text',
      value: seat.name,
      maxlength: 16,
      list: 'roster-names',
      'aria-label': `${PLAYER_STYLES[i]!.name} player name`,
      oninput: (e: Event) => (seat.name = (e.target as HTMLInputElement).value),
    });
    const kinds: Seat['kind'][] = ['human', 'cpu-classic', 'none'];
    const group = h(
      'div',
      { class: 'seg', role: 'radiogroup', 'aria-label': `${PLAYER_STYLES[i]!.name} seat` },
      ...kinds.map((k) =>
        h(
          'label',
          {},
          h('input', {
            type: 'radio',
            name: `seat${i}`,
            value: k,
            checked: seat.kind === k,
            onchange: () => {
              seat.kind = k;
              el.classList.toggle('empty', k === 'none');
            },
          }),
          h('span', {}, KIND_LABEL[k]),
        ),
      ),
    );
    const el = h('fieldset', { class: `seat${seat.kind === 'none' ? ' empty' : ''}`, style: `--edge:${PLAYER_STYLES[i]!.edge}` }, swatch(i), name, group);
    return el;
  });

  const timeOn = h('input', { type: 'checkbox', checked: saved.timeLimit !== null, id: 'time-on' });
  const timeSecs = h('input', {
    type: 'number',
    min: 3,
    max: 60,
    value: saved.timeLimit ?? 15,
    'aria-label': 'Seconds per turn',
  });
  const soundOn = h('input', { type: 'checkbox', checked: saved.sound, id: 'sound-on' });

  const start = () => {
    const active = seats.flatMap((s, i) => (s.kind === 'none' ? [] : [{ ...s, i }]));
    if (active.length < 2) return void (error.textContent = 'Fill at least two seats to start.');
    const names = active.map((s) => s.name.trim() || PLAYER_STYLES[s.i]!.name);
    if (new Set(names.map((n) => n.toLowerCase())).size !== names.length)
      return void (error.textContent = 'Each player needs a different name.');
    const secs = Math.round(Number(timeSecs.value));
    if (timeOn.checked && !(secs >= 3 && secs <= 60))
      return void (error.textContent = 'Turn time limit must be 3–60 seconds.');
    const timeLimit = timeOn.checked ? secs : null;
    save({ ...load(), seats: seats.map((s, i) => ({ ...s, name: s.name.trim() || PLAYER_STYLES[i]!.name })), timeLimit, sound: soundOn.checked });
    setSound(soundOn.checked);
    const players: PlayerConfig[] = active.map((s, k) => ({ name: names[k]!, kind: s.kind as PlayerConfig['kind'] }));
    // Seats keep their colour: engine player index follows seat order, so remap styles by seat.
    showGame(players, timeLimit, active.map((s) => s.i));
  };

  const roster = [...saved.roster].sort((a, b) => b.wins - a.wins || a.losses - b.losses).slice(0, 8);
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
        'div',
        { class: 'setup' },
        h('h1', { class: 'logo' }, 'Fungus'),
        best,
        h('form', { class: 'seats', onsubmit: (e: Event) => (e.preventDefault(), start()) }, ...seatEls, datalist),
        h(
          'div',
          { class: 'options' },
          h('label', { for: 'time-on' }, timeOn, ' Turn time limit '),
          timeSecs,
          h('span', { class: 'muted' }, ' seconds'),
          h('label', { for: 'sound-on', class: 'sound' }, soundOn, ' Sound'),
        ),
        error,
        h(
          'div',
          { class: 'setup-actions' },
          h('button', { type: 'button', onclick: showHelp }, 'How to play'),
          h('button', { type: 'button', class: 'default', onclick: start }, 'Begin'),
        ),
        h('p', { class: 'credit' }, 'A remake of Fungus 2.0 © 1992, 1994 Ryan Koopmans.'),
      ),
    ),
  );
}

function showGame(players: PlayerConfig[], timeLimit: number | null, seats: number[]): void {
  remapStyles(seats);
  current = new GameScreen({
    players,
    timeLimit,
    onExit: () => {
      restoreStyles();
      initZoom();
showSetup();
    },
  });
  app.replaceChildren(current.root);
}

// Engine indices are compact (0..n-1) but seats keep their colour, so swap the style table for the game.
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
        h('p', {}, 'Each turn you get a piece. Rotate it with Space, the arrow keys, right-click or Shift + mouse wheel, then place it touching your fungus along an edge.'),
        h('h3', {}, 'Capture'),
        h('p', {}, 'Trap enemy fungus in a straight line between your own cells — across, down or diagonally — and it becomes yours. Captures can chain. Capture an enemy’s head and their whole fungus is yours, bites included.'),
        h('h3', {}, 'Stay connected'),
        h('p', {}, 'Every cell must connect back to its head along edges. Cut-off fungus shrivels and dies.'),
        h('h3', {}, 'Bite'),
        h('p', {}, 'Press B (or Bite), then press on enemy fungus next to yours and drag. A bite costs one tooth and doesn’t use up your turn — bite first, then grow into the gap. Heads can’t be bitten.'),
        h('p', {}, 'Teeth wait in the corners, and every so often everyone grows a new one. At 80 cells your bites become big bites (2 long); at 160, monster bites (3 long).'),
        h('h3', {}, 'Keys'),
        h('p', {}, 'B to bite, G to give up your turn, P to pause, Esc to cancel a bite.'),
        h('p', {}, 'Mouse wheel zooms the interface; + and − do too, and 0 resets it.'),
      ),
      h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'default', onclick: close }, 'Got it')),
    ),
  );
  dlg.addEventListener('keydown', (e) => e.key === 'Escape' && close());
  document.body.append(dlg);
  (dlg.querySelector('button') as HTMLButtonElement).focus();
}

initZoom();
showSetup();
