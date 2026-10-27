import { BOARD_SIZES, SPEEDS, modernBiteRange } from '@fungus/engine';
import type { RoomView, SeatSpec, SeatView } from '@fungus/protocol';
import { h, titlebar } from './dom';
import type { NetClient } from './net';
import { PLAYER_STYLES, TILE, drawFace, makeTile } from './textures';

function swatch(i: number): HTMLCanvasElement {
  const S = 96;
  const cv = h('canvas', { class: 'swatch', width: S, height: S, 'aria-hidden': 'true' });
  const g = cv.getContext('2d')!;
  g.fillStyle = g.createPattern(makeTile(PLAYER_STYLES[i]!, i, S / TILE), 'repeat')!;
  g.fillRect(0, 0, S, S);
  drawFace(g, S * 0.2, S * 0.2, S * 0.6, PLAYER_STYLES[i]!, true);
  return cv;
}

const speedLabel = (id: string) => SPEEDS.find((s) => s.id === id)?.label.toLowerCase() ?? id;

export function inviteLink(code: string): string {
  return `${location.origin}${location.pathname}?room=${code}`;
}

/** The pre-game room: who's sitting where, and (for the host) the seat controls. */
export class LobbyScreen {
  readonly root: HTMLElement;
  private status: HTMLElement;
  private body: HTMLElement;
  private room: RoomView;

  constructor(
    room: RoomView,
    private net: NetClient,
    private onLeave: () => void,
  ) {
    this.room = room;
    this.status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
    this.body = h('div', { class: 'lobby' });
    this.root = h('section', { class: 'window lobby-window' }, titlebar('Fungus', () => this.leave(), 'Leave room'), this.body);
    this.render();
  }

  update(room: RoomView): void {
    this.room = room;
    this.render();
  }

  say(text: string): void {
    this.status.textContent = text;
  }

  private leave(): void {
    this.net.send({ t: 'leave' });
    this.onLeave();
  }

  private seatRow(seat: SeatView, i: number): HTMLElement {
    const r = this.room;
    const host = r.youAreHost;
    let who: HTMLElement;
    if (seat.kind === 'human')
      who = h(
        'div',
        { class: 'who' },
        h('span', { class: 'who-name' }, seat.name),
        seat.host ? h('span', { class: 'badge' }, 'Host') : null,
        seat.you ? h('span', { class: 'badge you' }, 'You') : null,
        seat.connected ? null : h('span', { class: 'badge away' }, 'Reconnecting…'),
      );
    else if (seat.kind === 'open') who = h('div', { class: 'who muted' }, 'Open seat');
    else if (seat.kind === 'cpu') who = h('div', { class: 'who' }, 'CPU');
    else who = h('div', { class: 'who muted' }, 'Closed');

    const actions: HTMLElement[] = [];
    if (seat.kind === 'open' && r.yourSeat !== i)
      actions.push(h('button', { type: 'button', onclick: () => this.net.send({ t: 'sit', seat: i }) }, r.yourSeat === null ? 'Sit here' : 'Move here'));
    // The host sets up empty seats; people already sitting can't be bumped by a stray click.
    if (host && seat.kind !== 'human') {
      const kinds: SeatSpec[] = r.settings.rules === 'classic' ? ['open', 'cpu', 'closed'] : ['open', 'cpu'];
      const current: SeatSpec = seat.kind;
      actions.push(
        h(
          'div',
          { class: 'seg small', role: 'radiogroup', 'aria-label': `Seat ${i + 1}` },
          ...kinds.map((k) =>
            h(
              'label',
              {},
              h('input', {
                type: 'radio',
                name: `lseat${i}`,
                value: k,
                checked: current === k,
                onchange: () => this.net.send({ t: 'seat', seat: i, kind: k }),
              }),
              h('span', {}, k === 'open' ? 'Player' : k === 'cpu' ? 'CPU' : 'Closed'),
            ),
          ),
        ),
      );
    }
    return h(
      'div',
      { class: `lobby-seat${seat.kind === 'closed' ? ' closed' : ''}`, style: `--edge:${PLAYER_STYLES[i]!.edge}` },
      swatch(i),
      who,
      h('div', { class: 'seat-actions' }, ...actions),
    );
  }

  private render(): void {
    const r = this.room;
    const s = r.settings;
    const board = BOARD_SIZES.find((b) => b.size === s.boardSize);
    const openLeft = r.seats.filter((x) => x.kind === 'open').length;
    const summary =
      `${s.rules === 'classic' ? 'Classic' : 'Modern'} rules on the ${board?.label ?? s.boardSize} ${s.boardSize}×${s.boardSize} board, ` +
      `${s.turnTimeLimit}-second turns` +
      (s.rules === 'modern'
        ? `, new teeth ${speedLabel(s.newTeeth)}, bite growth ${speedLabel(s.biteGrowth)} ` +
          `(big bites at ${modernBiteRange(s.boardSize, s.biteGrowth).min}–${modernBiteRange(s.boardSize, s.biteGrowth).max} cells, rolled at the start).`
        : '.');

    const copy = h('button', { type: 'button', class: 'copy' }, 'Copy invite link');
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(inviteLink(r.code));
        copy.textContent = 'Link copied';
      } catch {
        copy.textContent = inviteLink(r.code);
      }
      setTimeout(() => (copy.textContent = 'Copy invite link'), 2000);
    });

    const publicToggle = r.youAreHost
      ? h(
          'label',
          { class: 'opt' },
          h('input', {
            type: 'checkbox',
            checked: s.public,
            onchange: (e: Event) =>
              this.net.send({ t: 'settings', settings: { ...s, public: (e.target as HTMLInputElement).checked } }),
          }),
          ' List this game publicly',
        )
      : h('p', { class: 'muted note' }, s.public ? 'This game is listed publicly.' : 'This game is private — join by code only.');

    const start = r.youAreHost
      ? h(
          'button',
          { type: 'button', class: 'default', onclick: () => this.net.send({ t: 'start' }) },
          openLeft ? `Start (${openLeft} open seat${openLeft > 1 ? 's' : ''} become${openLeft > 1 ? '' : 's'} CPU)` : 'Start',
        )
      : h('p', { class: 'muted' }, 'Waiting for the host to start…');

    this.body.replaceChildren(
      h(
        'div',
        { class: 'lobby-left' },
        h('h2', {}, 'Room code'),
        h('p', { class: 'room-code', 'aria-label': `Room code ${r.code.split('').join(' ')}` }, r.code),
        h('p', { class: 'muted note' }, 'Friends join with this code, or with the invite link.'),
        copy,
        publicToggle,
        h('h2', {}, 'Game'),
        h('p', {}, summary),
        r.watchers ? h('p', { class: 'muted note' }, `${r.watchers} watching`) : null,
      ),
      h(
        'div',
        { class: 'lobby-right' },
        h('h2', {}, 'Seats'),
        h('div', { class: 'lobby-seats' }, ...r.seats.map((x, i) => this.seatRow(x, i))),
      ),
      h(
        'div',
        { class: 'setup-actions' },
        this.status,
        h('button', { type: 'button', onclick: () => this.leave() }, 'Leave'),
        start,
      ),
    );
  }
}
