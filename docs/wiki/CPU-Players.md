# CPU Players

## Classic CPU
The computer player from 1994, rebuilt from the original program. It's the CPU you pick on the home screen.

Each turn it:
1. Picks a random living opponent and aims at a spot within about 4 cells of that opponent's head.
2. Starts from its own edge cell closest to that spot (or, 1 time in 10, a random cell of its own).
3. If it has bites, uses one toward the target 60% of the time.
4. Grows a winding trail of **5–6 single cells** toward the target, sidestepping 15% of the time.

The original CPU **doesn't use pieces**: it grows 5–6 cells a turn where a person places one piece. The remake keeps that, because it's how the 1994 game played. It's an aggressive, simple opponent: it charges at heads and doesn't defend.

Two bugs in the original were fixed. It only checked the first 16 rows and columns of the 20×20 board when deciding where to grow from, and it could try to bite heads, which the rules forbid.

## Stand-in CPU (online)
When an online player drops out for more than 60 seconds or leaves, a **stand-in CPU** plays their fungus. Unlike the Classic CPU, it plays by the same rules as people, one piece per turn:
- It takes a bite first if one would gain it at least 3 cells.
- Then it places the piece where it scores best. Eating a player counts most, cells gained count next, and moving toward the nearest enemy head breaks ties.

The stand-in hands the fungus back as soon as its player reconnects.

## Difficulty levels
A range of CPU difficulties that play by human rules is planned. Today there's the Classic CPU, plus the stand-in for online games.
