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
