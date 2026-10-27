# Fungus — Classic Rules (reference spec)

Source of truth: disassembly of **Fungus 2.0 (©1992, 1994 Ryan Koopmans)**, 68K `CODE` resources 2–4.
Hex addresses (`3:xxxxx` = CODE segment 3, offset) are noted so any rule can be re-verified.
Where the original is silent, the gap is marked **[ours]**.

## C1. Board & setup
- Grid **20 × 20**. Cells are empty, or owned by player 1–4.
- 2–4 players, each slot Human / CPU / None.
- Head start positions (row, col, 0-indexed) — `3:01124`. The original stores the board column-major; these are converted:
  - 2 players: (14,5), (5,14)
  - 3 players: (13,5), (5,9), (12,14)
  - 4 players: (5,5) red, (5,14) green, (14,14) blue, (14,5) yellow (matches the original's screenshots)
- A **tooth** sits on each of the 4 corner cells (overlay only; the cell is still empty and placeable) — `3:0120c`.
- Everyone starts with **0 bites** (2.0 behaviour; the code clears bites at game start — `2:00de0`).
- Optional turn time limit, **3–60 s**.

## C2. Turn order
- Players act in slot order, skipping dead ones. A full cycle = one **round** — `3:00276`.
- On their turn a Human gets **one random piece** (uniform over 11 shapes) and may rotate it — `3:0033e`.
- Within one turn a player may **bite any number of times (1 bite each), then place the piece**. Biting does not end the turn; placing does. `G` passes.

## C3. Pieces (exactly 11) — `3:0122c`
```
0 single   #
1 domino   ##
2 bar-3    ###
3 small L  #.  /  ##
4 bar-4    ####
5 L        #.. / #.. / ##.
6 J        .#  / .#  / ##
7 T        .#. / ###
8 square   ## / ##
9 S        .## / ##.
10 Z       ##. / .##
```
Rotation counts: single/square 1; domino/bars/S/Z 2; L/J/T/small-L 4.

## C4. Placement — `3:014fe`
- Every cell of the piece must be on the board and **empty**.
- The piece must connect **orthogonally** to your own fungus (diagonal contact doesn't count).
- Covering a corner tooth → **+1 bite** — `3:017c0`.

## C5. Capture — `3:02852` (run from every newly owned cell)
- Look in all **8 directions**. If the line from the new cell is a run of ≥1 non-empty, non-own cells ending in an **own cell**, the first enemy cell in that line is converted to yours, and the check **runs again from that converted cell**. This produces Othello-style line flips and chain reactions.
- **Diagonal captures** survive only if the converted cell is orthogonally connected to your head; otherwise it is **destroyed** (becomes empty) — `3:0291e`.
- Capturing an enemy **head** kills that player. You **inherit all of their cells and all of their bites** — `3:01a72`, `3:01af8`.
- Last player alive wins — `3:01776`.

## C6. Disconnection
- After any capture or bite, a player's cells not orthogonally connected to their head **die and become empty** — `3:02b60`.

## C7. Teeth regrowth (the "every N turns" rule) — `3:002c4`, `3:003ba`
- A round counter starts at 1. The next tooth round = `current + 8 + random(0..5)`.
- When it is reached, **every living player gets +1 bite** (with a sound), and the next tooth round is rescheduled.
- Result: everyone gets a free tooth every **8–13 rounds**.

## C8. Bites — `3:0239e`, `3:025de`
- Bite level = `1 + floor(cells / 80)`, capped at 3 — `3:027ca`:
  - 1–79 cells: **Bites** (1 cell)
  - 80–159 cells: **Big Bites** (up to 2 cells)
  - 160+ cells: **Monster Bites** (up to 3 cells)
- The level is recomputed whenever your size changes, so it steps up (and back down).
- Requires ≥1 bite. The first cell must be **orthogonally adjacent** to your fungus. You drag out a **straight orthogonal line** of 1…level cells.
- Bitable cells: any enemy **body** cell (several enemies can be in one line). **Heads cannot be bitten.** Empty and own cells end the line.
- Costs **1 bite regardless of length**. Bitten cells become empty, then disconnection (C6) is applied to the victims.

## C9. Classic CPU (single difficulty) — `3:01b3e`
- Picks a random living opponent and aims at a point within ~0–4 cells of that opponent's head.
- From the own frontier cell closest to that point (10% chance: a random own cell)…
- …if it has bites, **60%** chance to bite a line toward the target…
- …then **grows a winding path of 5–6 single cells** toward the target (15% chance per step to sidestep).
- Note: the original CPU **ignores the piece system**. It places 5–6 cells per turn instead of one piece. Reproduce this as the "Classic CPU"; our difficulty ladder plays by human rules. **[ours]**
- Known bug: the CPU's frontier scan bounds-checks against 16 instead of 20 — `3:01f9e`. **[ours: fix]**

## Gaps the original leaves open **[ours]**
- G1. What happens on a turn timeout (pass assumed).
- G2. Corner tooth amount in Modern mode (1 in Classic).
- G3. Board size, head positions and tooth spots for 5–16 players (Modern / battle royale).

---

# Board sizes (both rule sets)

Classic 20, Large 35, XL 50, Mega 75, Massive 100. **[ours]**

- **Classic rules on a bigger board** keep everything from 1994: up to 4 players, the original start spots (scaled to the board), corner teeth, and bite levels every 80 cells.

# Modern rules **[ours]**

- **Players:** 2–16, spaced evenly on a circle at 36% of the board width from the centre. So 2 face each other, 3 make a triangle, 4 a square (in the classic seat order), 6 a hexagon.
- **Minimum board:** a size is offered only if neighbouring spawns are at least 5 cells apart. Up to 8 players fit Classic 20, up to 15 fit Large 35, and 16 need XL 50.
- **Fair teeth:** one tooth exactly halfway between each pair of neighbours, out past the spawn ring toward the edge (45% of the board width from the centre, versus 36% for spawns), plus the centre. The centre is one cell on odd boards and the middle 2×2 on even boards. Every player is the same distance from the same set of teeth.
- **Grid fairness:** snapping a regular polygon to a grid can't be perfect for most player counts. The layout searches small radius and rotation nudges and keeps the fairest one. Across every offered player count and board size, no player's distances to rivals or teeth differ from anyone else's by more than 1.3 cells, and 2, 4 and 8 players are often exact.
- **Bite levels come from body mass, not board area.** A fungus grows about 4–5 cells a round on any board, so a threshold tied to board area made big bites unreachable on big boards (for example, 2000 cells at 100×100 with 4 players). Instead:
  - cells per bite level = **base** (from Bite growth) + **one shared roll**, made once per game from the seed. Every player gets the same number, and it's shown in the game.
  - Big bites at that many cells, monster bites at double.
  - The roll range widens on bigger boards: Classic 20 → 2–11, Large 35 → 4–16, XL 50 → 6–21, Mega 75 → 8–26, Massive 100 → 10–31.
  - With Normal growth (base 55), big bites arrive around rounds 8–16 on every board size in CPU simulations, and monster bites around rounds 10–30.
- **Everything else** (pieces, capture, bites, the free tooth every 8–13 rounds) is the classic rule set.

## Modern options **[ours]**

These two are independent, so more teeth never force bigger bites:

| Step | New teeth (everyone +1 bite every…) | Bite growth (base cells per bite level) |
|---|---|---|
| Very slow | 16–21 rounds | 90 |
| Slow | 12–17 rounds | 70 |
| Normal | 8–13 rounds (1994) | 55 |
| Fast | 5–8 rounds | 40 |
| Very fast | 3–5 rounds | 28 |

The shared roll is added to the base, so Normal on Classic 20 gives 57–66 cells.

**Game speed presets** set New teeth and Bite growth together. They never change the board, which is always the player's choice:

| Preset | New teeth | Bite growth |
|---|---|---|
| Slowest | Very slow | Very slow |
| Slow | Slow | Slow |
| Normal | Normal | Normal |
| Fast | Fast | Fast |
| Fastest | Very fast | Very fast |

Setting the two speeds to different steps makes the setup **Custom**.
