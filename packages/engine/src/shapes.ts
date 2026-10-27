/**
 * The 11 pieces of Fungus 2.0, decoded from the original shape table
 * (CODE 3 @ 0x0122C). Each rotation is a 4x4 bitmask, MSB = top-left,
 * row-major — exactly the original encoding.
 */
export interface Shape {
  readonly id: number;
  readonly name: string;
  /** One 16-bit mask per distinct rotation. */
  readonly masks: readonly number[];
}

export const SHAPES: readonly Shape[] = [
  { id: 0, name: 'single', masks: [0x8000] },
  { id: 1, name: 'domino', masks: [0xc000, 0x8800] },
  { id: 2, name: 'bar-3', masks: [0x8880, 0xe000] },
  { id: 3, name: 'small-L', masks: [0x8c00, 0xc800, 0xc400, 0x4c00] },
  { id: 4, name: 'bar-4', masks: [0x8888, 0xf000] },
  { id: 5, name: 'L', masks: [0x88c0, 0xe800, 0xc440, 0x2e00] },
  { id: 6, name: 'J', masks: [0x44c0, 0x8e00, 0xc880, 0xe200] },
  { id: 7, name: 'T', masks: [0x4e00, 0x8c80, 0xe400, 0x4c40] },
  { id: 8, name: 'square', masks: [0xcc00] },
  { id: 9, name: 'S', masks: [0x6c00, 0x8c40] },
  { id: 10, name: 'Z', masks: [0xc600, 0x4c80] },
];

export interface Offset {
  readonly r: number;
  readonly c: number;
}

/** Cell offsets (relative to the 4x4 box's top-left) for a shape rotation. */
export function shapeCells(shapeId: number, rotation: number): Offset[] {
  const shape = SHAPES[shapeId];
  if (!shape) throw new Error(`unknown shape ${shapeId}`);
  const mask = shape.masks[((rotation % shape.masks.length) + shape.masks.length) % shape.masks.length]!;
  const out: Offset[] = [];
  for (let i = 0; i < 16; i++) {
    if (mask & (1 << (15 - i))) out.push({ r: Math.floor(i / 4), c: i % 4 });
  }
  return out;
}

export function rotationCount(shapeId: number): number {
  return SHAPES[shapeId]!.masks.length;
}
