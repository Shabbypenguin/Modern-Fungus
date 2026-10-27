/**
 * Online play: the menu (nickname, quick play, host, join by code, open games),
 * and the controller that moves between menu → lobby → game as the server says.
 */
import { BOARD_SIZES } from '@fungus/engine';
import { NAME_MAX, ROOM_CODE_LENGTH, TURN_LIMIT_DEFAULT, TURN_LIMIT_MAX, TURN_LIMIT_MIN, cleanCode, cleanName } from '@fungus/protocol';
import type { RoomSettings, RoomSummary, RoomView, ServerMessage } from '@fungus/protocol';
import { h, titlebar } from './dom';
import { GameScreen } from './game';
import { LobbyScreen } from './lobby';
import { NetClient, saveName, savedName } from './net';
import type { NetStatus } from './net';
import { remapStyles, restoreStyles } from './textures';

const TURN_CHOICES = [15, 20, 30, 45, 60, 90, 120].filter((s) => s >= TURN_LIMIT_MIN && s <= TURN_LIMIT_MAX);
const PREFS_KEY = 'fungus.net.prefs';

interface Prefs {
  turnTimeLimit: number;
  public: boolean;
}
function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
    return {
      turnTimeLimit: TURN_CHOICES.includes(p.turnTimeLimit as number) ? (p.turnTimeLimit as number) : TURN_LIMIT_DEFAULT,
      public: typeof p.public === 'boolean' ? p.public : true,
    };
  } catch {
    return { turnTimeLimit: TURN_LIMIT_DEFAULT, public: true };
  }
}
function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export interface OnlineOptions {
  /** The room to create when hosting, from the setup screen (seats, rules, board, speeds). */
  hostSettings: () => Omit<RoomSettings, 'turnTimeLimit' | 'public'>;
  /** A short description of what hosting will create. */
  hostSummary: () => string;
  /** Leave online play. */
  onBack: () => void;
  /** Join this room straight away (from an invite link). */
  joinCode?: string;
}

type Screen = { kind: 'menu' } | { kind: 'lobby'; lobby: LobbyScreen } | { kind: 'game'; game: GameScreen };

export class Online {
  private net: NetClient | null = null;
  private screen: Screen = { kind: 'menu' };
  private room: RoomView | null = null;
  /** After a game ends, stay on the board until the player picks "Back to room". */
  private holdGame = false;
  private menuStatus: HTMLElement;
  private roomList: HTMLElement;
  private banner: HTMLElement;
  private listTimer = 0;
  private rooms: RoomSummary[] = [];
  private offs: (() => void)[] = [];
  private nameInput!: HTMLInputElement;
  private codeInput!: HTMLInputElement;

  constructor(
    private app: HTMLElement,
    private opts: OnlineOptions,
  ) {
    this.menuStatus = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
    this.roomList = h('div', { class: 'room-list', 'aria-live': 'polite' });
    this.banner = h('div', { class: 'net-banner', role: 'status', hidden: true });
    document.body.append(this.banner);
    this.showMenu();
    if (opts.joinCode) {
      this.codeInput.value = opts.joinCode;
      if (cleanName(this.nameInput.value)) this.go({ t: 'join', code: opts.joinCode });
      else {
        this.menuStatus.textContent = `Pick a nickname to join room ${opts.joinCode}.`;
        this.nameInput.focus();
      }
    }
  }

  // ------------------------------------------------------------ connection

  /** Make sure we're connected under the current nickname, then send m. */
  private go(m: Parameters<NetClient['send']>[0]): void {
    const name = cleanName(this.nameInput?.value ?? savedName());
    if (!name) {
      this.menuStatus.textContent = 'Pick a nickname first.';
      this.nameInput?.focus();
      return;
    }
    saveName(name);
    if (!this.net) {
      this.net = new NetClient(name);
      this.offs.push(this.net.on((msg) => this.onMessage(msg)));
      this.offs.push(this.net.onStatus((s) => this.onStatus(s)));
    } else this.net.setName(name);
    this.net.send(m);
  }

  private onStatus(s: NetStatus): void {
    const text =
      s === 'reconnecting' ? 'Connection lost — reconnecting…' : s === 'offline' ? 'Disconnected. This game is open in another tab, or you left.' : '';
    this.banner.textContent = text;
    this.banner.hidden = !text || (s === 'offline' && this.screen.kind === 'menu');
    if (this.screen.kind === 'game') this.screen.game.onNetStatus(s === 'online');
    if (s === 'online' && this.screen.kind === 'menu') this.refreshList();
  }

  private onMessage(m: ServerMessage): void {
    switch (m.t) {
      case 'welcome':
        // A reconnect with no room means our seat is gone (server restart or timeout).
        if (!m.room && this.screen.kind !== 'menu') {
          this.showMenu();
          this.menuStatus.textContent = 'The game you were in has ended.';
        }
        return;
      case 'rooms':
        this.rooms = m.rooms;
        return this.renderRooms();
      case 'room':
        return this.onRoom(m.room);
      case 'left':
        this.room = null;
        if (this.screen.kind !== 'menu') this.showMenu();
        return;
      case 'game':
        return this.onGame(m);
      case 'applied':
      case 'timer':
      case 'emote':
        if (this.screen.kind === 'game') this.screen.game.onServer(m);
        return;
      case 'notice':
        if (this.screen.kind === 'game') this.screen.game.onServer(m);
        else if (this.screen.kind === 'lobby') this.screen.lobby.say(m.text);
        return;
      case 'error':
        if (m.code === 'version') {
          this.net?.close();
          this.banner.textContent = m.text;
          this.banner.hidden = false;
          return;
        }
        if (this.screen.kind === 'game') this.screen.game.onServer(m);
        else if (this.screen.kind === 'lobby') this.screen.lobby.say(m.text);
        else this.menuStatus.textContent = m.text;
        return;
      case 'pong':
        return;
    }
  }

  private onRoom(room: RoomView): void {
    this.room = room;
    if (this.screen.kind === 'game') {
      // Game over: keep the final board up until the player picks "Back to room".
      if (room.phase === 'ended') this.holdGame = true;
      else if (room.phase === 'lobby' && !this.holdGame) this.showLobby(room);
      return;
    }
    if (room.phase === 'playing') return; // a 'game' snapshot follows
    if (this.screen.kind === 'lobby') this.screen.lobby.update(room);
    else this.showLobby(room);
  }

  private onGame(m: Extract<ServerMessage, { t: 'game' }>): void {
    if (this.screen.kind === 'game' && !this.holdGame) return this.screen.game.onServer(m);
    // A new game (or joining one in progress).
    this.holdGame = false;
    const snap = m.game;
    remapStyles(snap.styles);
    const net = this.net!;
    const game = new GameScreen({
      config: snap.state.config,
      onExit: () => this.leaveRoom(),
      online: {
        net,
        snapshot: snap,
        onBackToRoom: () => this.backToRoom(),
      },
    });
    this.setScreen({ kind: 'game', game });
    this.app.replaceChildren(game.root);
    if (this.room) history.replaceState(null, '', `?room=${this.room.code}`);
    if (this.net?.status !== 'online') game.onNetStatus(false);
  }

  private backToRoom(): void {
    this.holdGame = false;
    const r = this.room;
    if (!r) return this.showMenu();
    // The host resets the room for a rematch; everyone else waits in the lobby.
    if (r.youAreHost && r.phase === 'ended') this.net?.send({ t: 'start' });
    this.showLobby(r);
  }

  private leaveRoom(): void {
    this.net?.send({ t: 'leave' });
    this.room = null;
    this.showMenu();
  }

  // ------------------------------------------------------------ screens

  private setScreen(s: Screen): void {
    if (this.screen.kind === 'game' && (s.kind !== 'game' || s.game !== this.screen.game)) {
      this.screen.game.destroy();
      restoreStyles();
    }
    this.screen = s;
    clearInterval(this.listTimer);
    if (s.kind === 'menu') this.listTimer = window.setInterval(() => this.refreshList(), 5000);
  }

  private showLobby(room: RoomView): void {
    const lobby = new LobbyScreen(room, this.net!, () => {
      this.room = null;
      this.showMenu();
    });
    this.setScreen({ kind: 'lobby', lobby });
    this.app.replaceChildren(lobby.root);
    history.replaceState(null, '', `?room=${room.code}`);
  }

  private refreshList(): void {
    if (this.net?.status === 'online') this.net.send({ t: 'list' });
  }

  private exit(): void {
    if (this.room) this.net?.send({ t: 'leave' });
    for (const off of this.offs) off();
    this.net?.close();
    this.net = null;
    this.setScreen({ kind: 'menu' });
    clearInterval(this.listTimer);
    this.banner.remove();
    history.replaceState(null, '', location.pathname);
    this.opts.onBack();
  }

  private renderRooms(): void {
    if (!this.net) {
      this.roomList.replaceChildren(h('p', { class: 'muted' }, 'Connect to see open games.'), this.connectButton());
      return;
    }
    if (!this.rooms.length) {
      this.roomList.replaceChildren(h('p', { class: 'muted' }, 'No open games right now. Host one, or use Quick play.'));
      return;
    }
    this.roomList.replaceChildren(
      h(
        'table',
        { class: 'rooms' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Host'), h('th', {}, 'Game'), h('th', {}, 'Players'), h('th', {}, h('span', { class: 'sr-only' }, 'Join')))),
        h(
          'tbody',
          {},
          ...this.rooms.map((r) => {
            const board = BOARD_SIZES.find((b) => b.size === r.boardSize)?.label ?? '';
            const canSit = r.phase === 'lobby' && r.open > 0;
            return h(
              'tr',
              {},
              h('td', {}, r.host),
              h('td', {}, `${r.rules === 'classic' ? 'Classic' : 'Modern'}, ${board} ${r.boardSize}`),
              h('td', {}, `${r.humans} / ${r.seats}${r.phase === 'playing' ? ' · playing' : ''}`),
              h(
                'td',
                {},
                h('button', { type: 'button', onclick: () => this.go({ t: 'join', code: r.code }) }, canSit ? 'Join' : 'Watch'),
              ),
            );
          }),
        ),
      ),
    );
  }

  private connectButton(): HTMLElement {
    return h('button', { type: 'button', onclick: () => this.go({ t: 'list' }) }, 'Show open games');
  }

  private showMenu(): void {
    this.setScreen({ kind: 'menu' });
    history.replaceState(null, '', location.pathname);
    const prefs = loadPrefs();
    this.nameInput = h('input', {
      type: 'text',
      id: 'net-name',
      maxlength: NAME_MAX,
      value: savedName(),
      autocomplete: 'nickname',
      placeholder: 'Your nickname',
    });
    this.codeInput = h('input', {
      type: 'text',
      id: 'net-code',
      maxlength: ROOM_CODE_LENGTH,
      autocomplete: 'off',
      autocapitalize: 'characters',
      spellcheck: false,
      class: 'code-input',
      placeholder: 'ABCD',
      oninput: (e: Event) => {
        const el = e.target as HTMLInputElement;
        el.value = el.value.toUpperCase();
      },
    });
    const turn = h(
      'select',
      {
        id: 'net-turn',
        onchange: (e: Event) => savePrefs({ ...loadPrefs(), turnTimeLimit: Number((e.target as HTMLSelectElement).value) }),
      },
      ...TURN_CHOICES.map((s) => h('option', { value: s, selected: s === prefs.turnTimeLimit }, `${s} seconds`)),
    );
    const pub = h('input', {
      type: 'checkbox',
      id: 'net-public',
      checked: prefs.public,
      onchange: (e: Event) => savePrefs({ ...loadPrefs(), public: (e.target as HTMLInputElement).checked }),
    });
    const join = () => {
      const code = cleanCode(this.codeInput.value);
      if (!code) {
        this.menuStatus.textContent = `Room codes are ${ROOM_CODE_LENGTH} letters.`;
        this.codeInput.focus();
        return;
      }
      this.go({ t: 'join', code });
    };
    const host = () => {
      const p = loadPrefs();
      this.go({ t: 'create', settings: { ...this.opts.hostSettings(), turnTimeLimit: p.turnTimeLimit, public: p.public } });
    };

    this.app.replaceChildren(
      h(
        'section',
        { class: 'window online-window' },
        titlebar('Play online', () => this.exit(), 'Back to setup'),
        h(
          'div',
          { class: 'online' },
          h(
            'div',
            { class: 'online-left' },
            h('div', { class: 'field' }, h('h2', {}, h('label', { for: 'net-name' }, 'Nickname')), this.nameInput),
            h(
              'div',
              { class: 'field' },
              h('h2', {}, 'Quick play'),
              h('p', { class: 'muted note' }, 'Jump into the fullest open game, or start a new one.'),
              h('button', { type: 'button', class: 'default', onclick: () => this.go({ t: 'quick' }) }, 'Find a game'),
            ),
            h(
              'div',
              { class: 'field' },
              h('h2', {}, h('label', { for: 'net-code' }, 'Join with a code')),
              h(
                'form',
                { class: 'join-row', onsubmit: (e: Event) => (e.preventDefault(), join()) },
                this.codeInput,
                h('button', { type: 'submit' }, 'Join'),
              ),
            ),
            h(
              'div',
              { class: 'field' },
              h('h2', {}, 'Host a game'),
              h('p', { class: 'muted note' }, this.opts.hostSummary()),
              h('div', { class: 'opt' }, h('label', { for: 'net-turn' }, 'Turn time'), turn),
              h('div', { class: 'opt' }, h('label', { for: 'net-public' }, pub, ' List publicly')),
              h('button', { type: 'button', onclick: host }, 'Host'),
            ),
          ),
          h('div', { class: 'online-right' }, h('h2', {}, 'Open games'), this.roomList),
          h(
            'div',
            { class: 'setup-actions' },
            this.menuStatus,
            h('button', { type: 'button', onclick: () => this.exit() }, 'Back'),
          ),
        ),
      ),
    );
    this.renderRooms();
    // With a saved nickname, connect straight away so the open games show up.
    if (this.net) this.refreshList();
    else if (cleanName(savedName())) this.go({ t: 'list' });
  }
}
