# Rules

These are the rules of **Fungus 2.0 (1994)**, recovered from the original program's code. Where the original left something open, the remake's choice is marked *(remake)*. The full technical spec, with code addresses, is [`docs/RULES.md`](../blob/main/docs/RULES.md) in the repository.

## Board and setup
- **Board:** 20×20 in the original. The remake also offers 35, 50, 75 and 100 (see [[Settings Reference]]).
- **Players:** 2–4. Each seat is Human, CPU, or empty.
- **Start:** each fungus is one cell, its **head**. The original start spots are:

| Players | Head positions (row, column) |
|---|---|
| 2 | (14,5), (5,14) |
| 3 | (13,5), (5,9), (12,14) |
| 4 | (5,5) red, (5,14) green, (14,14) blue, (14,5) yellow |

  On bigger boards, these spots scale with the board.
- **Teeth:** one in each corner.
- **Bites:** everyone starts with **0**.

## Turns
- Players go in seat order, skipping anyone who's been eaten. Once around the table is one **round**.
- Each turn you get **one random piece** (all 11 shapes are equally likely). You may rotate it.
- In a turn you may **bite any number of times** (one bite each), then **place the piece**. Placing ends the turn. You can also **pass**.

## The 11 pieces
```
single    #          bar-4   ####         T        .#.
                                                   ###
domino    ##         L       #.           square   ##
                             #.                    ##
bar-3     ###                ##           S        .##
                                                   ##.
small L   #.         J       .#           Z        ##.
          ##                 .#                    .##
                             ##
```
Single and square don't rotate. Domino, the bars, S and Z have 2 orientations. L, J, T and small L have 4.

## Placing
- Every cell of the piece must be on the board and **empty**.
- The piece must touch your fungus **along an edge**. Diagonal contact doesn't count.
- Covering a tooth collects it: **+1 bite**.

## Capturing
After any cell becomes yours, check all **8 directions** from it:
- If the line holds one or more enemy cells and **ends at one of your cells**, the **nearest** enemy cell in that line becomes yours.
- The check then **runs again from the cell you just captured**. This gives Othello-style flips and long chain reactions.
- **Diagonal captures** are kept only if the captured cell connects to your fungus along an edge. Otherwise it's destroyed and becomes empty.
- **Capturing a head** eliminates that player. You **inherit every cell and every bite** they had.

## Staying connected
After any capture or bite, every cell that isn't connected to its own head along edges **dies** and becomes empty.

## Teeth regrowth
- At the start the game schedules the next tooth round for 8 + (0 to 5) rounds later.
- When that round arrives, **every living player gets +1 bite** and the next one is scheduled.
- So everyone gets a free bite every **8–13 rounds**.

## Bites
- You need at least one bite.
- The bite starts on an **enemy cell directly beside** your fungus and runs in a **straight line**: across or down, not diagonally.
- Length depends on your size:

| Your size | Bite name | Length |
|---|---|---|
| 1–79 cells | Bites | 1 cell |
| 80–159 cells | Big bites | up to 2 cells |
| 160+ cells | Monster bites | up to 3 cells |

  The level changes as you grow or shrink.
- Any enemy **body** cells can be bitten, even cells from different enemies in the same line. **Heads can't be bitten.** An empty cell or one of yours ends the line.
- A bite of any length costs **1 bite**. Bitten cells become empty, then the connection rule removes anything cut off.

## Winning
- The **last fungus alive** wins.
- *(remake)* If nobody places, bites or grows for **2 turns per player** in a row, the game ends and the **largest fungus wins**.
- *(remake)* With a turn time limit, running out of time **passes** your turn.
