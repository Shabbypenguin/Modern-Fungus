# Modern Mode

Modern keeps every [[classic rule|Rules]] (pieces, placing, capture, connection, bites) and changes the setup so big games are fair and the pace is adjustable.

## Players and spawns
- **2–16 players**, spaced evenly on a circle 36% of the board's width from the centre:
  - 2 face each other.
  - 3 form a triangle.
  - 4 form a square, in the classic seat order.
  - 6 form a hexagon, and so on.
- Every seat in Modern is a player, either Human or CPU. Add or remove seats instead of leaving gaps.
- **Minimum board:** neighbouring spawns must be at least 5 cells apart.
  - Up to 8 players fit on Classic 20.
  - Up to 15 fit on Large 35.
  - 16 need XL 50.

## Fair teeth
- One tooth sits **halfway between each pair of neighbours**, out toward the edge (45% of the board's width from the centre). It's "outfield", so nobody gets a free one in their own backyard.
- One more sits in the **centre**: a single cell on odd-sized boards, the middle 2×2 on even ones.
- Every player is the same distance from the same set of teeth.

### How exact is it?
A perfect polygon can't sit exactly on a square grid for most player counts. The game tries small nudges of the ring's radius and rotation and keeps the fairest layout. Across every allowed player count and board, no player is more than **1.3 cells** better or worse off than another, measured by distance to rivals and to teeth. 2, 4 and 8 players are often exact.

## Speeds
Two independent settings, so asking for more teeth never forces bigger bites:

### New teeth
How often everyone gets a free bite.

| Setting | Every… |
|---|---|
| Very slow | 16–21 rounds |
| Slow | 12–17 rounds |
| Normal | 8–13 rounds (1994) |
| Fast | 5–8 rounds |
| Very fast | 3–5 rounds |

### Bite growth
How big a fungus must get for longer bites. A fungus grows about 4–5 cells a round **whatever the board size**, so this is measured in cells of body mass, not as a share of the board.

**Cells per bite level = base + the game's roll.** Big bites start at that many cells; monster bites at double.

| Setting | Base |
|---|---|
| Very slow | 90 |
| Slow | 70 |
| Normal | 55 |
| Fast | 40 |
| Very fast | 28 |

**The roll** is one random number picked at the start of each game. It's **the same for every player** and is shown in the sidebar, so everyone races to the same target. Its range widens on bigger boards:

| Board | Roll |
|---|---|
| Classic 20 | 2–11 |
| Large 35 | 4–16 |
| XL 50 | 6–21 |
| Mega 75 | 8–26 |
| Massive 100 | 10–31 |

Example: Normal on XL 50 rolls 6–21, so big bites start somewhere from 61 to 76 cells and monster bites from 122 to 152. In CPU test games on Normal, the first big bites arrived around rounds 8–16 on every board size.

### Game speed presets
One choice that sets both speeds together. Presets **never change the board**.

| Preset | New teeth | Bite growth |
|---|---|---|
| Slowest | Very slow | Very slow |
| Slow | Slow | Slow |
| Normal | Normal | Normal |
| Fast | Fast | Fast |
| Fastest | Very fast | Very fast |

Changing either speed under **Custom settings** turns the preset into **Custom**.

## Classic rules on big boards
You can also play Classic rules on any board. That keeps the 1994 setup exactly: up to 4 players, start spots scaled to the board, corner teeth, and bite levels at 80 and 160 cells.
