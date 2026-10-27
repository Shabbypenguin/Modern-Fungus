import { h, titlebar } from './dom';

/** The control map, in one place: shown in the Controls panel and How to play. */
export const CONTROL_MAP: { device: string; rows: [string, string][] }[] = [
  {
    device: 'Mouse',
    rows: [
      ['Left click', 'Place your piece'],
      ['Right click', 'Rotate your piece'],
      ['Right-drag or middle-drag', 'Move around the board'],
      ['Wheel', 'Zoom in and out where you point'],
      ['Shift + wheel', 'Rotate your piece'],
      ['Click the piece preview', 'Rotate your piece'],
      ['In bite mode: press and drag', 'Bite in a straight line'],
    ],
  },
  {
    device: 'Keyboard',
    rows: [
      ['W A S D', 'Move around the board'],
      ['Q / E', 'Rotate left / right'],
      ['Space, arrow keys', 'Rotate (the classic keys)'],
      ['+ / −', 'Zoom in / out'],
      ['0', 'See the whole board'],
      ['C', 'Centre on your fungus'],
      ['Enter', 'Place at the cursor'],
      ['B', 'Bite mode (Esc cancels)'],
      ['G', 'Give up your turn'],
      ['P', 'Pause'],
      ['?', 'Show these controls'],
    ],
  },
  {
    device: 'Touch',
    rows: [
      ['Tap, then tap again', 'Aim, then place'],
      ['Tap the piece preview', 'Rotate your piece'],
      ['Drag with one finger', 'Move around the board'],
      ['Pinch', 'Zoom in and out'],
      ['In bite mode: press a marked cell and drag', 'Bite in a straight line'],
    ],
  },
];

export function controlsTables(): HTMLElement {
  return h(
    'div',
    { class: 'control-tables' },
    ...CONTROL_MAP.map(({ device, rows }) =>
      h(
        'section',
        {},
        h('h3', {}, device),
        h('table', {}, h('tbody', {}, ...rows.map(([input, action]) => h('tr', {}, h('th', { scope: 'row' }, input), h('td', {}, action))))),
      ),
    ),
  );
}

export function controlsDialog(close: () => void): HTMLElement {
  return h(
    'div',
    { class: 'window dialog-box controls-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Controls' },
    titlebar('Controls', close, 'Close'),
    h('div', { class: 'help-body' }, controlsTables()),
    h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'default', onclick: close }, 'Got it')),
  );
}
