"use client";

const GRID_W = 5;
const GRID_H = 7;

/** Simple deterministic hash producing enough bits for the pixel grid. */
function hashSeed(seed: string): number[] {
  const bytes: number[] = [];
  let h = 0x9e3779b9; // golden ratio seed
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 0x5bd1e995);
    h ^= h >>> 15;
  }
  for (let i = 0; i < GRID_H * 3; i++) {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
    h ^= h >>> 15;
    bytes.push((h >>> 0) & 0xff);
  }
  return bytes;
}

/** Generate a 5×7 symmetric pixel pattern that resembles a small character. */
function generatePattern(seed: string): boolean[][] {
  const bytes = hashSeed(seed);
  const grid: boolean[][] = [];

  for (let y = 0; y < GRID_H; y++) {
    grid[y] = new Array(GRID_W).fill(false);
    // Only generate left half + center (cols 0,1,2), mirror to cols 3,4
    for (let x = 0; x < 3; x++) {
      grid[y][x] = (bytes[y * 3 + x] & 1) === 1;
    }
    grid[y][3] = grid[y][1];
    grid[y][4] = grid[y][0];
  }

  // Structural constraints to look more like a character:
  // Head: rows 0-1 — ensure at least some pixels
  if (!grid[0].some(Boolean) && !grid[1].some(Boolean)) {
    grid[0][1] = true;
    grid[0][2] = true;
    grid[0][3] = true;
  }
  // Body: rows 2-4 — ensure center column has something
  if (!grid[2][2] && !grid[3][2] && !grid[4][2]) {
    grid[3][2] = true;
  }
  // Legs: rows 5-6 — ensure at least one pixel on each side
  if (!grid[5][0] && !grid[5][1] && !grid[6][0] && !grid[6][1]) {
    grid[6][1] = true;
    grid[6][3] = true;
  }

  return grid;
}

type PixelAvatarProps = {
  seed: string;
  color: string;
  size?: number;
};

export function PixelAvatar({ seed, color, size = 24 }: PixelAvatarProps) {
  const pattern = generatePattern(seed);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`-0.5 -0.25 ${GRID_W + 1} ${GRID_H + 0.5}`}
      className="shrink-0"
      style={{ imageRendering: "pixelated" }}
    >
      {pattern.map((row, y) =>
        row.map((filled, x) =>
          filled ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={color} rx={0.05} /> : null,
        ),
      )}
    </svg>
  );
}
