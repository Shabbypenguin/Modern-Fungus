# Online Play

Play with people on other devices: phones, tablets and computers can all share a game. There are no accounts. You pick a nickname and play.

## Getting into a game
From the home screen press **Play online**, enter a **nickname** (up to 16 characters), then choose one of these:

| Option | What it does |
|---|---|
| **Find a game** (Quick play) | Joins the public lobby with the most players that still has a free seat. If there isn't one, it opens a new public room. |
| **Join with a code** | Type the 4-letter room code a friend gave you. |
| **Host** | Creates a room with your home-screen rules, board and speeds. Pick the turn time and whether it's listed publicly. |
| **Open games** | Public rooms. **Join** takes a free seat; **Watch** looks on at a game in progress. The list refreshes every few seconds. |

### Invite links
Every room has a link like `https://fungus.shabbygames.club/?room=ABCD`. Opening it goes straight to that room. If you haven't picked a nickname yet, it asks for one first. In the lobby, **Copy invite link** copies it for you.

## The lobby
- **Room code:** big and easy to read out loud.
- **Seats:** who's sitting where. Badges show **Host**, **You**, and **Reconnecting…** for anyone who has dropped.
- **Sit here / Move here:** take or switch to an open seat. Without a seat, you're a watcher.
- **The host** can:
  - set empty seats to **Player** (open), **CPU** or **Closed** (Classic only);
  - list the room publicly or keep it private;
  - press **Start**.
  The host can't bump someone who is already sitting.
- **Start:** open seats nobody took become CPU players, and the game begins for everyone.
- If the host leaves, another connected player becomes host.

## During the game
- Play exactly as you would locally (see [[Controls]]). The **server checks every move**, so nobody can cheat by changing their own copy of the game.
- **Turn clock:** every turn has a limit (set by the host). When it runs out, your turn passes. If you have nowhere to grow, your turn passes automatically.
- **No pause:** the game keeps going.
- **Emotes:** gg, Nice!, Oops, Whoa, Grr, Yum. They pop up on your card for everyone. There's no text chat.
- **Your card** has a **You** tag.

## Dropping out and coming back
- **Lost connection** (Wi-Fi blip, phone locked, tab reloaded):
  - The game reconnects by itself.
  - You have **60 seconds** to come back before a **CPU stands in** for you. Your card shows "CPU playing" with a dashed outline.
  - When you return, the CPU hands your fungus straight back.
- **Reloading the page** puts you back in your seat. The room code stays in the address bar for this.
- **Pressing Leave** during a game hands your fungus to a CPU **for the rest of that game**.
- If everyone in a room disconnects, the game **pauses** until someone returns. Rooms nobody returns to are removed after 10 minutes.
- Each browser tab is its own player. Two tabs on one computer can play each other, which is handy for testing.

## After the game
- The final board stays up for each player until they choose.
- **Back to room** returns to the lobby with the same seats. When the host goes back, the room resets for a **rematch**, then the host presses Start again.
- **Leave** goes back to the online menu.

## Limits and safety
- Nicknames are cleaned up: no invisible or control characters, spaces collapsed.
- The server limits how fast each player can send messages and how many connections one address can open.
- Rooms and connections are capped server-wide. If it's full, you'll be told to try again shortly.
- There are no accounts and no saved profiles. Your session is forgotten 30 minutes after you leave. Nicknames and room codes do appear in the server's logs.

## Troubleshooting
| Problem | Try |
|---|---|
| "This page is out of date — reload" | The server was updated. Reload the page. |
| Stuck on "Reconnecting…" | Check your connection. It retries automatically, every 10 seconds at most. |
| "No game with that code" | Check the letters. Codes never use the look-alike characters 0, O, 1, I or L. The room may also have closed. |
| "That seat is taken" | Someone got there first. Pick another open seat. |
| "Disconnected. This game is open in another tab" | The same session was opened somewhere newer. Use that tab. |
