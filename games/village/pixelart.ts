import Phaser from 'phaser';

// Hand-drawn (procedurally, pixel by pixel) art that the Kenney sheets don't have.

const BARK_DARK = '#3b2314';
const BARK = '#7a4a24';
const BARK_LIGHT = '#a56a36';
const FACE = '#e2b07a';
const FACE_LIGHT = '#f4d3a6';
const RING = '#c38a4e';
const SHADOW = 'rgba(20, 12, 6, 0.35)';

/** One log seen end-on: a 6x6 bark ring around a pale face with growth rings. (x, y) is its top-left. */
function logEnd(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const px = (dx: number, dy: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(x + dx, y + dy, 1, 1); };
  // bark outline (rounded square)
  for (let i = 1; i <= 4; i++) { px(i, 0, BARK_DARK); px(i, 5, BARK_DARK); px(0, i, BARK_DARK); px(5, i, BARK_DARK); }
  // face
  for (let dy = 1; dy <= 4; dy++) for (let dx = 1; dx <= 4; dx++) px(dx, dy, FACE);
  // bark inner shading in the corners: light on the upper-left, dark on the lower-right
  px(1, 1, BARK_LIGHT); px(4, 1, BARK); px(1, 4, BARK); px(4, 4, BARK_DARK);
  px(2, 1, FACE_LIGHT); px(1, 2, FACE_LIGHT);
  // growth ring + heart
  px(2, 2, RING); px(3, 2, RING); px(2, 3, RING); px(3, 3, BARK);
}

/** A log lying along the ground, seen from the side: bark with a couple of grain lines and a cut end. */
function logSide(ctx: CanvasRenderingContext2D, x: number, y: number, len: number): void {
  ctx.fillStyle = BARK_DARK; ctx.fillRect(x, y, len, 5);
  ctx.fillStyle = BARK; ctx.fillRect(x + 1, y + 1, len - 2, 3);
  ctx.fillStyle = BARK_LIGHT; ctx.fillRect(x + 1, y + 1, len - 2, 1);
  ctx.fillStyle = BARK_DARK; for (let i = x + 3; i < x + len - 2; i += 4) ctx.fillRect(i, y + 2, 2, 1);
  ctx.fillStyle = FACE; ctx.fillRect(x + len - 2, y + 1, 1, 3);
}

/** Frame size of the `logs` texture; sprites use origin (0.5, 1) so piles sit on the ground. */
export const LOGS_W = 18, LOGS_H = 20;

/**
 * `logs` texture, 4 frames of growing wood piles: a couple of logs on the ground, then end-on
 * stacks of 3 / 3+2 / 3+2+1 logs. Safe to call more than once.
 */
export function ensureLogPiles(scene: Phaser.Scene): void {
  if (scene.textures.exists('logs')) return;
  const tex = scene.textures.createCanvas('logs', LOGS_W * 4, LOGS_H)!;
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  const base = LOGS_H - 1; // ground line
  const frame = (i: number) => i * LOGS_W;
  const shadow = (x0: number, w: number) => { ctx.fillStyle = SHADOW; ctx.fillRect(x0, base - 1, w, 2); };

  // 0: two logs lying on the ground
  shadow(frame(0) + 2, 14);
  logSide(ctx, frame(0) + 1, base - 5, 10);
  logSide(ctx, frame(0) + 6, base - 9, 11);

  // 1: a row of three
  shadow(frame(1) + 1, 16);
  for (let k = 0; k < 3; k++) logEnd(ctx, frame(1) + 1 + k * 5, base - 6);

  // 2: three plus two
  shadow(frame(2) + 1, 16);
  for (let k = 0; k < 3; k++) logEnd(ctx, frame(2) + 1 + k * 5, base - 6);
  for (let k = 0; k < 2; k++) logEnd(ctx, frame(2) + 4 + k * 5, base - 11);

  // 3: a full pyramid, three-two-one
  shadow(frame(3) + 1, 16);
  for (let k = 0; k < 3; k++) logEnd(ctx, frame(3) + 1 + k * 5, base - 6);
  for (let k = 0; k < 2; k++) logEnd(ctx, frame(3) + 4 + k * 5, base - 11);
  logEnd(ctx, frame(3) + 6, base - 16);

  tex.refresh();
  for (let i = 0; i < 4; i++) tex.add(i, 0, frame(i), 0, LOGS_W, LOGS_H);
}

// ---- the woodyard: a plank cabin and a log stack that grows beside it -------------------------

const PLANK = '#c48a4c', PLANK_DARK = '#a06c38', PLANK_LIGHT = '#dba566';
const WALL = '#6e3d2c', WALL_DARK = '#4e2a1f', WALL_LIGHT = '#8a4d36';
const FRAME = '#d19a5a';
const INK = '#2a1a16';
const STONE = '#8d8f95', STONE_DARK = '#5e6067';

/** Cabin frame size; drawn with origin (0, 0) at the tile above the footprint's top-left. */
export const CABIN_W = 32, CABIN_H = 48;

/**
 * `cabin` texture, 3 frames by level: a steep plank roof over dark plank walls with a window and
 * an arched door. Lv2 adds a stone chimney, Lv3 a second window and a lantern by the door.
 */
export function ensureCabin(scene: Phaser.Scene): void {
  if (scene.textures.exists('cabin')) return;
  const tex = scene.textures.createCanvas('cabin', CABIN_W * 3, CABIN_H)!;
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  for (let level = 1; level <= 3; level++) {
    const ox = (level - 1) * CABIN_W;
    const px = (x: number, y: number, c: string, w = 1, h = 1) => { ctx.fillStyle = c; ctx.fillRect(ox + x, y, w, h); };

    // walls: 26 wide, y 24..47, plank rows with dark seams
    px(3, 24, INK, 26, 24);
    px(4, 25, WALL, 24, 22);
    for (let y = 29; y < 47; y += 5) px(4, y, WALL_DARK, 24, 1);
    for (let y = 25; y < 47; y += 5) px(4, y, WALL_LIGHT, 24, 1);
    // staggered plank ends
    for (let y = 26, k = 0; y < 46; y += 5, k++) px(k % 2 ? 16 : 9, y, WALL_DARK, 1, 3);
    // window (left)
    px(7, 30, FRAME, 8, 8); px(8, 31, INK, 6, 6); px(9, 32, '#3d2a30', 4, 4);
    // door (right): arched, dark inside, tan frame
    px(18, 33, FRAME, 9, 14); px(19, 35, INK, 7, 12); px(20, 34, INK, 5, 1); px(21, 33, INK, 3, 1);
    px(19, 34, FRAME, 1, 1); px(25, 34, FRAME, 1, 1);
    px(24, 41, PLANK_LIGHT, 1, 1); // handle
    // roof: a gable from the peak at (16, 0) down to the eaves at y 24, overhanging the walls
    for (let y = 0; y < 26; y++) {
      const half = Math.min(16, 3 + y * 0.62); // slope
      const x0 = Math.round(16 - half), x1 = Math.round(16 + half);
      px(x0, y, INK, x1 - x0, 1);
      if (y > 0 && x1 - x0 > 2) px(x0 + 1, y, PLANK, x1 - x0 - 2, 1);
    }
    // plank courses across the roof, following the slope
    for (let y = 5; y < 25; y += 5) {
      const half = Math.min(16, 3 + y * 0.62);
      const x0 = Math.round(16 - half) + 1, x1 = Math.round(16 + half) - 1;
      px(x0, y, PLANK_DARK, x1 - x0, 1);
      px(x0, y - 4, PLANK_LIGHT, x1 - x0, 1);
      px(x0 + ((y / 5) % 2 ? 4 : 9), y - 3, PLANK_DARK, 1, 3); // plank end seams
      px(x1 - ((y / 5) % 2 ? 9 : 4), y - 3, PLANK_DARK, 1, 3);
    }
    // ridge beam down the middle
    px(15, 0, INK, 3, 25); px(16, 1, PLANK_DARK, 1, 24);
    // eaves shadow on the wall
    px(4, 25, WALL_DARK, 24, 1);

    if (level >= 2) { // stone chimney on the right slope
      px(23, 3, INK, 5, 11); px(24, 4, STONE, 3, 9); px(24, 6, STONE_DARK, 3, 1); px(24, 9, STONE_DARK, 3, 1); px(25, 2, INK, 1, 1);
    }
    if (level >= 3) { // second window and a lantern by the door
      px(7, 40, FRAME, 8, 6); px(8, 41, INK, 6, 4); px(9, 42, '#3d2a30', 4, 2);
      px(28, 34, INK, 3, 5); px(29, 35, '#ffd75a', 1, 3); px(29, 33, INK, 1, 1);
    }
  }
  tex.refresh();
  for (let i = 0; i < 3; i++) tex.add(i, 0, i * CABIN_W, 0, CABIN_W, CABIN_H);
}

/** Log stack frame size; origin (0, 1) sits it on the ground. `STACK_ROWS` is the tallest stack. */
export const STACK_W = 16, STACK_H = 48, STACK_ROWS = 9;

/**
 * `logstack` texture, frames 0..STACK_ROWS: a brick-laid stack of end-on logs, one more row per
 * frame, so the pile at the woodyard visibly climbs as wood comes in.
 */
export function ensureLogStack(scene: Phaser.Scene): void {
  if (scene.textures.exists('logstack')) return;
  const tex = scene.textures.createCanvas('logstack', STACK_W * (STACK_ROWS + 1), STACK_H)!;
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  const base = STACK_H - 1;
  for (let rows = 0; rows <= STACK_ROWS; rows++) {
    const ox = rows * STACK_W;
    if (rows > 0) { ctx.fillStyle = SHADOW; ctx.fillRect(ox, base - 1, STACK_W, 2); }
    for (let r = 0; r < rows; r++) {
      const y = base - 6 - r * 5;
      if (r % 2 === 0) for (let k = 0; k < 3; k++) logEnd(ctx, ox + k * 5, y);
      else for (let k = 0; k < 2; k++) logEnd(ctx, ox + 3 + k * 5, y);
    }
  }
  tex.refresh();
  for (let i = 0; i <= STACK_ROWS; i++) tex.add(i, 0, i * STACK_W, 0, STACK_W, STACK_H);
}
