import Phaser from 'phaser';

// Hand-drawn (procedurally, pixel by pixel) art that the Kenney sheets don't have: the village's
// buildings and their stockpiles. One visual language throughout — steep plank gable roofs with
// courses and a centre beam, plank (or stone) walls, framed windows, arched doors, ink outlines.

type Ctx = CanvasRenderingContext2D;

const INK = '#2a1a16';
const SHADOW = 'rgba(20, 12, 6, 0.35)';
const GLASS = '#3d2a30';
const GLOW = '#ffd75a';
const BRASS = '#e0b04a';
const STONE = '#8d8f95', STONE_DARK = '#5e6067', STONE_LIGHT = '#b0b3b9';
const IRON = '#4a4e57';
const RED = '#c23b3b', RED_DARK = '#7d2424';
const BLUE = '#3f6fd1';
const HAY = '#e0b954', HAY_DARK = '#b8912f';
const LEAF_BOX = '#4f9a3c';

// log ends
const BARK_DARK = '#3b2314', BARK = '#7a4a24', BARK_LIGHT = '#a56a36';
const FACE = '#e2b07a', FACE_LIGHT = '#f4d3a6', RING = '#c38a4e';

/** Roof / wall / trim colours for one building kind. */
export interface Palette {
  roof: string; roofDark: string; roofLight: string;
  wall: string; wallDark: string; wallLight: string;
  frame: string;
  stone?: boolean; // walls laid as stone blocks instead of planks
}

export const PALETTES = {
  house: { roof: '#c48a4c', roofDark: '#a06c38', roofLight: '#dba566', wall: '#6e3d2c', wallDark: '#4e2a1f', wallLight: '#8a4d36', frame: '#d19a5a' },
  barracks: { roof: '#6f7d8c', roofDark: '#4f5b68', roofLight: '#8b99a8', wall: '#7a7e86', wallDark: '#5a5e66', wallLight: '#969aa2', frame: '#b7a27a', stone: true },
  granary: { roof: '#b8463a', roofDark: '#8f3229', roofLight: '#d3675a', wall: '#8a4632', wallDark: '#61301f', wallLight: '#a85a3e', frame: '#e0b078' },
  woodyard: { roof: '#c48a4c', roofDark: '#a06c38', roofLight: '#dba566', wall: '#6e3d2c', wallDark: '#4e2a1f', wallLight: '#8a4d36', frame: '#d19a5a' },
} satisfies Record<string, Palette>;

// ---- primitives -----------------------------------------------------------------------------

/** While true, only the parts that glow at night are painted (see `litPx`) — used to build the lights overlays. */
let LIT_ONLY = false;
function px(ctx: Ctx, x: number, y: number, c: string, w = 1, h = 1): void { if (LIT_ONLY) return; ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
/** A pixel that glows at night: painted in both modes. */
function litPx(ctx: Ctx, x: number, y: number, c: string, w = 1, h = 1): void { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
const PANE = '#ffd75a', PANE_HOT = '#fff0b0', FLAME = '#ff8a2a';

/** A steep gable roof: peak at (x + w/2, y), eaves at y + h across the full width. Plank courses, seams, ridge beam. */
function gableRoof(ctx: Ctx, x: number, y: number, w: number, h: number, p: Palette): void {
  const cx = x + w / 2, maxHalf = w / 2;
  const slope = (maxHalf - 3) / (h - 4);
  const half = (r: number) => Math.min(maxHalf, 3 + r * slope);
  for (let r = 0; r < h; r++) {
    const x0 = Math.round(cx - half(r)), x1 = Math.round(cx + half(r));
    px(ctx, x0, y + r, INK, x1 - x0, 1);
    if (r > 0 && x1 - x0 > 2) px(ctx, x0 + 1, y + r, p.roof, x1 - x0 - 2, 1);
  }
  for (let r = 5; r < h - 1; r += 5) {
    const x0 = Math.round(cx - half(r)) + 1, x1 = Math.round(cx + half(r)) - 1;
    px(ctx, x0, y + r, p.roofDark, x1 - x0, 1);
    const xl = Math.round(cx - half(r - 4)) + 1, xr = Math.round(cx + half(r - 4)) - 1;
    px(ctx, xl, y + r - 4, p.roofLight, xr - xl, 1);
    const off = (r / 5) % 2 ? 4 : 9;
    if (x0 + off < cx - 2) px(ctx, x0 + off, y + r - 3, p.roofDark, 1, 3);
    if (x1 - off > cx + 2) px(ctx, x1 - off, y + r - 3, p.roofDark, 1, 3);
  }
  px(ctx, Math.round(cx) - 1, y, INK, 3, h - 1);
  px(ctx, Math.round(cx), y + 1, p.roofDark, 1, h - 2);
}

/** Plank (or stone-block) wall with an ink border; the top row is the eaves shadow. */
function wall(ctx: Ctx, x: number, y: number, w: number, h: number, p: Palette): void {
  px(ctx, x, y, INK, w, h);
  px(ctx, x + 1, y + 1, p.wall, w - 2, h - 2);
  if (p.stone) {
    for (let r = y + 4; r < y + h - 1; r += 4) px(ctx, x + 1, r, p.wallDark, w - 2, 1);
    for (let r = y + 1, k = 0; r < y + h - 1; r += 4, k++)
      for (let c = x + 1 + (k % 2 ? 3 : 0); c < x + w - 1; c += 6) { px(ctx, c, r, p.wallDark, 1, 3); px(ctx, c + 1, r, p.wallLight, 2, 1); }
  } else {
    for (let r = y + 5; r < y + h - 1; r += 5) px(ctx, x + 1, r, p.wallDark, w - 2, 1);
    for (let r = y + 1; r < y + h - 1; r += 5) px(ctx, x + 1, r, p.wallLight, w - 2, 1);
    for (let r = y + 2, k = 0; r < y + h - 2; r += 5, k++) {
      for (let c = x + (k % 2 ? 7 : 3); c < x + w - 2; c += 13) px(ctx, c, r, p.wallDark, 1, 3);
    }
  }
  px(ctx, x + 1, y + 1, p.wallDark, w - 2, 1);
}

function windowAt(ctx: Ctx, x: number, y: number, w: number, h: number, p: Palette, lit = false): void {
  px(ctx, x, y, p.frame, w, h);
  px(ctx, x + 1, y + 1, INK, w - 2, h - 2);
  px(ctx, x + 2, y + 2, lit ? GLOW : GLASS, w - 4, h - 4);
  // the panes light up at night
  litPx(ctx, x + 2, y + 2, PANE, w - 4, h - 4);
  if (!LIT_ONLY) px(ctx, x + 2, y + 2, lit ? GLOW : GLASS, w - 4, h - 4);
  if (LIT_ONLY && w >= 8 && h >= 8) litPx(ctx, x + 2, y + 2, PANE_HOT, 2, 2);
  if (w >= 8 && h >= 8) { px(ctx, x + Math.floor(w / 2), y + 2, INK, 1, h - 4); px(ctx, x + 2, y + Math.floor(h / 2), INK, w - 4, 1); }
}

/** Arched door: frame, dark opening with a rounded top, a handle. */
function archDoor(ctx: Ctx, x: number, y: number, w: number, h: number, p: Palette): void {
  px(ctx, x, y, p.frame, w, h);
  px(ctx, x + 1, y + 2, INK, w - 2, h - 2);
  px(ctx, x + 2, y + 1, INK, w - 4, 1);
  px(ctx, x + 1, y + 1, p.frame, 1, 1); px(ctx, x + w - 2, y + 1, p.frame, 1, 1);
  px(ctx, x + w - 3, y + Math.floor(h / 2), p.roofLight, 1, 1);
  if (LIT_ONLY) litPx(ctx, x + 2, y + h - 2, PANE, w - 4, 1); // light under the door
}

/** Iron-banded double door (barracks, barn). */
function doubleDoor(ctx: Ctx, x: number, y: number, w: number, h: number, p: Palette, banded = true): void {
  px(ctx, x, y, p.frame, w, h);
  px(ctx, x + 1, y + 1, p.wallDark, w - 2, h - 1);
  px(ctx, x + Math.floor(w / 2), y + 1, INK, 1, h - 1);
  if (banded) { px(ctx, x + 1, y + 3, IRON, w - 2, 1); px(ctx, x + 1, y + h - 5, IRON, w - 2, 1); px(ctx, x + 2, y + 3, STONE_LIGHT, 1, 1); px(ctx, x + w - 3, y + h - 5, STONE_LIGHT, 1, 1); }
  else { px(ctx, x + 1, y + 1, INK, w - 2, 1); }
  px(ctx, x + 1, y + h - 1, INK, w - 2, 1);
}

function chimney(ctx: Ctx, x: number, y: number, h = 11): void {
  px(ctx, x, y, INK, 5, h); px(ctx, x + 1, y + 1, STONE, 3, h - 2);
  px(ctx, x + 1, y + 3, STONE_DARK, 3, 1); px(ctx, x + 1, y + 6, STONE_DARK, 3, 1);
  px(ctx, x + 2, y - 1, INK, 1, 1);
  px(ctx, x, y, INK, 5, 1); px(ctx, x - 1, y + 1, INK, 7, 1); px(ctx, x, y + 1, STONE_LIGHT, 5, 1);
}

function lantern(ctx: Ctx, x: number, y: number): void { px(ctx, x, y, INK, 3, 5); litPx(ctx, x + 1, y + 1, GLOW, 1, 3); px(ctx, x + 1, y - 1, INK, 1, 1); }
function torch(ctx: Ctx, x: number, y: number): void { px(ctx, x, y + 2, BARK_DARK, 1, 5); litPx(ctx, x - 1, y, FLAME, 3, 2); litPx(ctx, x, y - 1, PANE_HOT, 1, 1); }

function banner(ctx: Ctx, x: number, y: number, colour: string, dark: string): void {
  px(ctx, x, y, INK, 1, 16);
  px(ctx, x + 1, y + 1, INK, 7, 11); px(ctx, x + 2, y + 2, colour, 5, 9); px(ctx, x + 2, y + 9, dark, 5, 2);
  px(ctx, x + 4, y + 10, INK, 1, 2); // notched hem
  px(ctx, x + 4, y + 4, GLOW, 1, 2);
}

function shield(ctx: Ctx, x: number, y: number): void {
  px(ctx, x + 1, y, INK, 5, 7); px(ctx, x, y + 1, INK, 7, 4);
  px(ctx, x + 2, y + 1, RED, 3, 5); px(ctx, x + 1, y + 2, RED, 5, 2);
  px(ctx, x + 3, y + 3, BRASS, 1, 1); px(ctx, x + 2, y + 1, '#e46a6a', 1, 1);
}

/** A row of sharpened stakes along the ground. */
function stakes(ctx: Ctx, x: number, y: number, w: number, skipFrom: number, skipTo: number): void {
  for (let c = x; c < x + w - 2; c += 4) {
    if (c >= skipFrom && c < skipTo) continue;
    px(ctx, c, y + 1, INK, 3, 3); px(ctx, c + 1, y, INK, 1, 1);
    px(ctx, c + 1, y + 1, BARK_LIGHT, 1, 1); px(ctx, c + 1, y + 2, BARK, 1, 2);
  }
}

/** Level plaque above the door: a little wooden sign with one brass stud per level. */
function plaque(ctx: Ctx, x: number, y: number, level: number, p: Palette): void {
  px(ctx, x, y, INK, 11, 6); px(ctx, x + 1, y + 1, p.frame, 9, 4);
  for (let i = 0; i < level; i++) px(ctx, x + 2 + i * 3, y + 2, BRASS, 2, 2);
}

/** Crenellations: merlons 4 wide every 8 px with a lighter cap, dark embrasures between. */
function merlons(ctx: Ctx, x: number, y: number, w: number, p: Palette): void {
  for (let c = x; c < x + w; c += 8) {
    px(ctx, c, y, INK, 5, 7); px(ctx, c + 1, y + 1, p.wall, 3, 5); px(ctx, c + 1, y + 1, p.wallLight, 3, 1);
  }
  px(ctx, x, y + 6, INK, w, 1);
}
/** Arrow slit: a dark 2x6 slot with a stone lip. */
function slit(ctx: Ctx, x: number, y: number): void { px(ctx, x - 1, y - 1, STONE_DARK, 4, 8); px(ctx, x, y, INK, 2, 6); litPx(ctx, x, y + 1, '#c99a3a', 2, 4); }

function flowerBox(ctx: Ctx, x: number, y: number, w: number): void {
  px(ctx, x, y, INK, w, 3); px(ctx, x + 1, y + 1, BARK, w - 2, 1);
  for (let c = x + 1; c < x + w - 1; c += 2) px(ctx, c, y - 1, c % 4 ? '#e85a7a' : GLOW, 1, 1);
  for (let c = x + 2; c < x + w - 1; c += 2) px(ctx, c, y, LEAF_BOX, 1, 1);
}

/** Grain silo: a banded stone cylinder with a domed cap and a weather vane. */
function silo(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  px(ctx, x, y + 2, INK, w, h - 2); px(ctx, x + 1, y + 3, STONE, w - 2, h - 4);
  px(ctx, x + 1, y + 3, STONE_LIGHT, 1, h - 4); px(ctx, x + w - 2, y + 3, STONE_DARK, 1, h - 4);
  for (let r = y + 7; r < y + h - 2; r += 5) px(ctx, x + 1, r, IRON, w - 2, 1);
  px(ctx, x + 1, y, INK, w - 2, 2); px(ctx, x + 2, y + 1, RED_DARK, w - 4, 1); px(ctx, x, y + 2, INK, w, 1); px(ctx, x + 1, y + 2, RED, w - 2, 1);
  const vx = x + Math.floor(w / 2);
  px(ctx, vx, y - 4, INK, 1, 4); px(ctx, vx - 2, y - 4, INK, 5, 1); px(ctx, vx + 2, y - 5, INK, 1, 1); px(ctx, vx - 2, y - 3, INK, 1, 1);
}

/** One log seen end-on: a 6x6 bark ring around a pale face with growth rings. */
function logEnd(ctx: Ctx, x: number, y: number): void {
  for (let i = 1; i <= 4; i++) { px(ctx, x + i, y, BARK_DARK); px(ctx, x + i, y + 5, BARK_DARK); px(ctx, x, y + i, BARK_DARK); px(ctx, x + 5, y + i, BARK_DARK); }
  px(ctx, x + 1, y + 1, FACE, 4, 4);
  px(ctx, x + 1, y + 1, BARK_LIGHT); px(ctx, x + 4, y + 1, BARK); px(ctx, x + 1, y + 4, BARK); px(ctx, x + 4, y + 4, BARK_DARK);
  px(ctx, x + 2, y + 1, FACE_LIGHT); px(ctx, x + 1, y + 2, FACE_LIGHT);
  px(ctx, x + 2, y + 2, RING); px(ctx, x + 3, y + 2, RING); px(ctx, x + 2, y + 3, RING); px(ctx, x + 3, y + 3, BARK);
}

/** One 6x6 produce crate: plank box with a cross brace and a red tomato peeking out. */
function crateFace(ctx: Ctx, x: number, y: number): void {
  px(ctx, x, y, INK, 6, 6); px(ctx, x + 1, y + 1, '#c48a4c', 4, 4);
  px(ctx, x + 1, y + 1, '#dba566', 4, 1); px(ctx, x + 1, y + 4, '#a06c38', 4, 1);
  px(ctx, x + 2, y + 2, '#a06c38', 1, 1); px(ctx, x + 3, y + 3, '#a06c38', 1, 1);
  px(ctx, x + 3, y + 2, RED, 1, 1); px(ctx, x + 2, y + 3, RED, 1, 1);
}

/** Frame size of the cabin texture; origin (0, 0) sits at the tile above the footprint's top-left. */
export const CABIN_W = 32, CABIN_H = 48;
/** Frames of the 4x4 buildings: the footprint plus one roof-overhang row above. */
export const BIG_W = 64, BIG_H = 80;
/** Stock column (logs, crates): origin (0, 1) sits it on the ground. */
export const STACK_W = 16, STACK_H = 48, STACK_ROWS = 9;

// ---- buildings, three frames each (Lv1..Lv3) --------------------------------------------------

function drawHouse(ctx: Ctx, ox: number, level: number): void {
  const p = PALETTES.house;
  const roofH = level >= 3 ? 26 : 36; // a second storey pushes the roof up
  const wallTop = roofH - 2;
  wall(ctx, ox + 4, wallTop, 56, BIG_H - wallTop, p);
  archDoor(ctx, ox + 36, 62, 10, 18, p);
  windowAt(ctx, ox + 9, 46, 9, 8, p); windowAt(ctx, ox + 22, 46, 9, 8, p);
  if (level >= 2) {
    windowAt(ctx, ox + 49, 46, 9, 8, p);
    flowerBox(ctx, ox + 9, 55, 9); flowerBox(ctx, ox + 22, 55, 9); flowerBox(ctx, ox + 49, 55, 9);
    px(ctx, ox + 34, 78, INK, 14, 2); px(ctx, ox + 35, 78, p.frame, 12, 1); // porch step
  }
  if (level >= 3) {
    for (const x of [9, 22, 35, 48]) windowAt(ctx, ox + x, 30, 9, 8, p, x === 35);
    lantern(ctx, ox + 48, 64);
  }
  gableRoof(ctx, ox, 0, BIG_W, roofH, p);
  if (level >= 2) chimney(ctx, ox + 46, level >= 3 ? 6 : 10);
  plaque(ctx, ox + 35, 55, level, p);
}

function drawBarracks(ctx: Ctx, ox: number, level: number): void {
  const p = PALETTES.barracks;
  // the keep: a stone block from under the parapet to the ground
  wall(ctx, ox + 4, 18, 56, BIG_H - 18, p);
  // parapet with crenellations along the roof row, corner towers a little taller
  px(ctx, ox + 4, 16, INK, 56, 4); px(ctx, ox + 5, 17, p.wallLight, 54, 1); px(ctx, ox + 5, 18, p.wallDark, 54, 1);
  merlons(ctx, ox + 14, 10, 36, p);
  for (const tx of [2, 52]) {
    px(ctx, ox + tx, 12, INK, 10, 20); px(ctx, ox + tx + 1, 13, p.wall, 8, 18);
    for (let r = 17; r < 30; r += 4) px(ctx, ox + tx + 1, r, p.wallDark, 8, 1);
    px(ctx, ox + tx + 1, 13, p.wallLight, 8, 1);
    merlons(ctx, ox + tx, 6, 10, p);
  }
  // door with a stone arch, arrow slits either side
  px(ctx, ox + 23, 57, STONE_DARK, 18, 3); px(ctx, ox + 25, 56, STONE_DARK, 14, 1); px(ctx, ox + 24, 58, INK, 16, 1);
  doubleDoor(ctx, ox + 25, 60, 14, 20, p);
  slit(ctx, ox + 13, 40); slit(ctx, ox + 49, 40); slit(ctx, ox + 31, 30);
  banner(ctx, ox + 44, 44, BLUE, '#274a9c');
  if (level >= 2) {
    shield(ctx, ox + 16, 62); shield(ctx, ox + 41, 62);
    stakes(ctx, ox + 4, 76, 56, ox + 22, ox + 42);
  }
  if (level >= 3) {
    // the right corner grows into a tall round tower with a slate cap and a flag
    px(ctx, ox + 50, 4, INK, 14, 30); px(ctx, ox + 51, 5, p.wall, 12, 28);
    px(ctx, ox + 51, 5, p.wallLight, 2, 28); px(ctx, ox + 61, 5, p.wallDark, 2, 28);
    for (let r = 9; r < 32; r += 4) px(ctx, ox + 53, r, p.wallDark, 8, 1);
    slit(ctx, ox + 56, 14);
    for (let r = 0; r < 6; r++) { const hw = 1 + r; px(ctx, ox + 57 - hw, r, INK, hw * 2 + 1, 1); if (r > 0) px(ctx, ox + 58 - hw, r, r % 2 ? p.roofDark : p.roof, hw * 2 - 1, 1); }
    px(ctx, ox + 49, 6, INK, 16, 1);
    px(ctx, ox + 57, 0, INK, 1, 1); px(ctx, ox + 58, 0, RED, 5, 3); px(ctx, ox + 62, 1, INK, 1, 1);
    torch(ctx, ox + 21, 56); torch(ctx, ox + 43, 56);
    banner(ctx, ox + 12, 44, RED, RED_DARK);
  }
  plaque(ctx, ox + 26, 49, level, p);
}

function drawGranary(ctx: Ctx, ox: number, level: number): void {
  const p = PALETTES.granary;
  if (level >= 3) silo(ctx, ox + 23, 6, 8, 20);
  wall(ctx, ox + 3, 20, 26, CABIN_H - 20, p);
  doubleDoor(ctx, ox + 11, 34, 10, 14, p, false);
  px(ctx, ox + 12, 36, p.frame, 1, 10); px(ctx, ox + 19, 36, p.frame, 1, 10); // barn door braces
  if (level >= 2) {
    // loft door open with hay, a pulley beam poking out of the peak
    px(ctx, ox + 12, 23, INK, 8, 8); px(ctx, ox + 13, 24, HAY, 6, 6); px(ctx, ox + 13, 27, HAY_DARK, 6, 1); px(ctx, ox + 15, 25, HAY_DARK, 1, 3);
    px(ctx, ox + 15, 19, INK, 2, 4); px(ctx, ox + 14, 18, INK, 4, 1);
    windowAt(ctx, ox + 23, 37, 5, 5, p);
  } else {
    // closed loft door with an X brace
    px(ctx, ox + 12, 23, p.frame, 8, 8); px(ctx, ox + 13, 24, p.wallDark, 6, 6);
    for (let i = 0; i < 6; i++) { px(ctx, ox + 13 + i, 24 + i, p.frame); px(ctx, ox + 18 - i, 24 + i, p.frame); }
  }
  gableRoof(ctx, ox, 0, CABIN_W, 22, p);
  plaque(ctx, ox + 4, 22, level, p);
}

function drawCabin(ctx: Ctx, ox: number, level: number): void {
  const p = PALETTES.woodyard;
  wall(ctx, ox + 3, 24, 26, CABIN_H - 24, p);
  windowAt(ctx, ox + 7, 30, 8, 8, p);
  archDoor(ctx, ox + 18, 33, 9, 15, p);
  if (level >= 3) { windowAt(ctx, ox + 7, 40, 8, 6, p); lantern(ctx, ox + 28, 35); }
  gableRoof(ctx, ox, 0, CABIN_W, 26, p);
  if (level >= 2) chimney(ctx, ox + 23, 4);
  plaque(ctx, ox + 17, 27, level, p);
}

function stackTexture(scene: Phaser.Scene, key: string, unit: (ctx: Ctx, x: number, y: number) => void): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, STACK_W * (STACK_ROWS + 1), STACK_H)!;
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  const base = STACK_H - 1;
  for (let rows = 0; rows <= STACK_ROWS; rows++) {
    const ox = rows * STACK_W;
    if (rows > 0) px(ctx, ox, base - 1, SHADOW, STACK_W, 2);
    for (let r = 0; r < rows; r++) {
      const y = base - 6 - r * 5;
      if (r % 2 === 0) for (let k = 0; k < 3; k++) unit(ctx, ox + k * 5, y);
      else for (let k = 0; k < 2; k++) unit(ctx, ox + 3 + k * 5, y);
    }
  }
  tex.refresh();
  for (let i = 0; i <= STACK_ROWS; i++) tex.add(i, 0, i * STACK_W, 0, STACK_W, STACK_H);
}

function buildingTexture(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: Ctx, ox: number, level: number) => void, litOnly = false): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w * 3, h)!;
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  LIT_ONLY = litOnly;
  for (let level = 1; level <= 3; level++) draw(ctx, (level - 1) * w, level);
  LIT_ONLY = false;
  tex.refresh();
  for (let i = 0; i < 3; i++) tex.add(i, 0, i * w, 0, w, h);
}

/**
 * Where each building gives off light at night (window centres, lanterns, torches), in texture
 * pixels from the sprite's top-left, per level (index = level). `warm` = firelight (torches).
 */
export const LIGHTS: Record<'house' | 'barracks' | 'granary' | 'woodyard', readonly (readonly { x: number; y: number; r: number; warm?: boolean }[])[]> = {
  house: [
    [],
    [{ x: 13, y: 50, r: 16 }, { x: 26, y: 50, r: 16 }],
    [{ x: 13, y: 50, r: 16 }, { x: 26, y: 50, r: 16 }, { x: 53, y: 50, r: 16 }],
    [{ x: 13, y: 50, r: 16 }, { x: 26, y: 50, r: 16 }, { x: 53, y: 50, r: 16 }, { x: 13, y: 34, r: 14 }, { x: 26, y: 34, r: 14 }, { x: 39, y: 34, r: 16 }, { x: 52, y: 34, r: 14 }, { x: 49, y: 66, r: 20, warm: true }],
  ],
  barracks: [
    [],
    [{ x: 14, y: 43, r: 8 }, { x: 50, y: 43, r: 8 }],
    [{ x: 14, y: 43, r: 8 }, { x: 50, y: 43, r: 8 }],
    [{ x: 14, y: 43, r: 8 }, { x: 50, y: 43, r: 8 }, { x: 21, y: 57, r: 22, warm: true }, { x: 43, y: 57, r: 22, warm: true }, { x: 57, y: 17, r: 8 }],
  ],
  granary: [[], [], [{ x: 25, y: 39, r: 10 }], [{ x: 25, y: 39, r: 10 }]],
  woodyard: [
    [],
    [{ x: 11, y: 34, r: 14 }],
    [{ x: 11, y: 34, r: 14 }],
    [{ x: 11, y: 34, r: 14 }, { x: 11, y: 43, r: 12 }, { x: 29, y: 37, r: 20, warm: true }],
  ],
};
/** Chimney tops (smoke rises from here), per level. */
export const CHIMNEYS: Record<'house' | 'barracks' | 'granary' | 'woodyard', readonly (readonly { x: number; y: number }[])[]> = {
  house: [[], [], [{ x: 48, y: 9 }], [{ x: 48, y: 5 }]],
  barracks: [[], [], [], []],
  granary: [[], [], [], []],
  woodyard: [[], [], [{ x: 25, y: 3 }], [{ x: 25, y: 3 }]],
};

/** A lone blue banner on a pole (10x18): flown from a house sworn to the barracks. */
export function ensureBannerTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists('banner')) return;
  const tex = scene.textures.createCanvas('banner', 10, 18)!;
  const ctx = tex.getContext();
  banner(ctx, 1, 1, BLUE, '#274a9c');
  tex.refresh();
}

/** Soft radial light, 64x64, white centre fading to transparent — erased from the night to make pools of light. */
export function ensureGlowTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists('glow')) return;
  const tex = scene.textures.createCanvas('glow', 64, 64)!;
  const ctx = tex.getContext();
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 64, 64);
  tex.refresh();
}

/** Texture key for a building kind; frame = level - 1. */
export const BUILDING_TEXTURE = { house: 'bld-house', barracks: 'bld-barracks', granary: 'bld-granary', woodyard: 'cabin' } as const;
/** The same buildings' windows, lanterns and torches alone — laid over the body at night. */
export const LIT_TEXTURE = { house: 'bld-house-lit', barracks: 'bld-barracks-lit', granary: 'bld-granary-lit', woodyard: 'cabin-lit' } as const;

/** Create every building and stock texture (safe to call more than once). */
export function ensureBuildingArt(scene: Phaser.Scene): void {
  buildingTexture(scene, 'bld-house', BIG_W, BIG_H, drawHouse);
  buildingTexture(scene, 'bld-barracks', BIG_W, BIG_H, drawBarracks);
  buildingTexture(scene, 'bld-granary', CABIN_W, CABIN_H, drawGranary);
  buildingTexture(scene, 'cabin', CABIN_W, CABIN_H, drawCabin);
  buildingTexture(scene, 'bld-house-lit', BIG_W, BIG_H, drawHouse, true);
  buildingTexture(scene, 'bld-barracks-lit', BIG_W, BIG_H, drawBarracks, true);
  buildingTexture(scene, 'bld-granary-lit', CABIN_W, CABIN_H, drawGranary, true);
  buildingTexture(scene, 'cabin-lit', CABIN_W, CABIN_H, drawCabin, true);
  stackTexture(scene, 'logstack', logEnd);
  stackTexture(scene, 'cratestack', crateFace);
  ensureGlowTexture(scene);
  ensureBannerTexture(scene);
}

/** PNG data URL of one frame of a generated texture, for the DOM help screen. */
export function frameDataUrl(scene: Phaser.Scene, key: string, frame: number): string {
  const tex = scene.textures.get(key);
  const f = tex.get(frame);
  const src = tex.getSourceImage() as HTMLCanvasElement;
  const c = document.createElement('canvas');
  c.width = f.width; c.height = f.height;
  c.getContext('2d')!.drawImage(src, f.cutX, f.cutY, f.width, f.height, 0, 0, f.width, f.height);
  return c.toDataURL();
}

// ---- flora: trees, saplings and crops, one 16x16 tilesheet ------------------------------------

const LEAF_DARK = '#2f6b2e', LEAF = '#4f9a3c', LEAF_LIGHT = '#7cc65a', LEAF_HI = '#a8e07a';
const PINE_DARK = '#1f5a3a', PINE = '#2f7d4e', PINE_LIGHT = '#57a56a';
const TRUNK = '#6b4226', TRUNK_DARK = '#3b2314', TRUNK_LIGHT = '#8f5c34';
const SOIL = '#7a4d2b', SOIL_DARK = '#5a3619', SOIL_LIGHT = '#9a6a3e';
const TOMATO = '#d9382f', TOMATO_HI = '#f06a5a', FRUIT_GREEN = '#8bc34a', FLOWER = '#ffe27a', STAKE = '#a67b4a';

/** Frame indices into the `flora` tileset (a single row of 16x16 tiles). */
export const FLORA = {
  young: [0, 1, 2] as const,
  oakTop: 3, oakTrunk: 4,
  pineTop: 5, pineTrunk: 6,
  youngChopped: 7, oakChopped: 8, bare: 9,
  stump: 10, sprout: 11, sapling: 12, saplingBig: 13,
  crop: [14, 15, 16, 17, 18] as const,
  crop2: [19, 20, 21, 22, 23] as const,
  tilled: 24,
  count: 25,
} as const;

/** Filled ellipse, pixel by pixel. */
function blob(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, c: string): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) px(ctx, x, y, c);
    }
}
/** A leafy crown: dark outline, mid fill, light upper-left, a few highlight dots. */
function crown(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, seed: number): void {
  blob(ctx, cx, cy, rx, ry, LEAF_DARK);
  blob(ctx, cx, cy, rx - 1, ry - 1, LEAF);
  blob(ctx, cx - rx * 0.25, cy - ry * 0.3, rx * 0.55, ry * 0.5, LEAF_LIGHT);
  for (let i = 0; i < 3 + (seed % 3); i++) {
    const a = seed * 1.7 + i * 2.1, r = 0.6 + (i % 2) * 0.25;
    px(ctx, Math.round(cx + Math.cos(a) * rx * r), Math.round(cy + Math.sin(a) * ry * r), i % 2 ? LEAF_HI : LEAF_DARK);
  }
}
function trunk(ctx: Ctx, x: number, y0: number, y1: number, w: number, flare = false): void {
  px(ctx, x, y0, TRUNK_DARK, w, y1 - y0 + 1);
  px(ctx, x + 1, y0, TRUNK, Math.max(1, w - 2), y1 - y0 + 1);
  px(ctx, x + 1, y0, TRUNK_LIGHT, 1, y1 - y0);
  if (flare) { px(ctx, x - 1, y1 - 1, TRUNK_DARK, w + 2, 2); px(ctx, x, y1 - 1, TRUNK, w, 1); }
}

function drawYoung(ctx: Ctx, ox: number, v: number): void {
  trunk(ctx, ox + 7, 10, 15, 2);
  crown(ctx, ox + 8, 6.5, 5 + (v === 1 ? 1 : 0), 5 - (v === 2 ? 1 : 0), v);
}
/** Old oak drawn 16x32 at (ox, 0): crown across both tiles, trunk in the lower one. */
function drawOak(ctx: Ctx, ox: number): void {
  trunk(ctx, ox + 6, 18, 31, 4, true);
  crown(ctx, ox + 8, 12, 7.5, 9, 5);
  crown(ctx, ox + 4.5, 16, 4, 3.5, 2); crown(ctx, ox + 11.5, 15, 4, 3.5, 3);
  crown(ctx, ox + 8, 19, 4.5, 3, 4);
}
/** Old pine drawn 16x32: layered boughs over a straight trunk. */
function drawPine(ctx: Ctx, ox: number): void {
  trunk(ctx, ox + 7, 18, 31, 2, true);
  const tiers: [number, number, number][] = [[24, 7, 5], [18, 6, 5], [12, 5, 5], [7, 3.5, 4], [3, 2, 3]]; // [baseY, halfWidth, height]
  for (const [by, hw, h] of tiers) {
    for (let r = 0; r < h; r++) {
      const half = Math.round(hw * (r / (h - 1)));
      px(ctx, ox + 8 - half - 1, by - h + 1 + r, PINE_DARK, half * 2 + 3, 1);
      if (half > 0) px(ctx, ox + 8 - half, by - h + 1 + r, PINE, half * 2 + 1, 1);
      if (half > 1) px(ctx, ox + 8 - half, by - h + 1 + r, PINE_LIGHT, Math.max(1, half - 1), 1);
    }
  }
}
function drawStump(ctx: Ctx, ox: number): void {
  px(ctx, ox + 5, 9, TRUNK_DARK, 6, 6); px(ctx, ox + 6, 10, TRUNK, 4, 4); px(ctx, ox + 5, 8, TRUNK_DARK, 6, 2); px(ctx, ox + 6, 8, FACE, 4, 2); px(ctx, ox + 7, 8, RING, 2, 1);
  px(ctx, ox + 4, 14, TRUNK_DARK, 8, 1);
}
function drawSprout(ctx: Ctx, ox: number, big: boolean): void {
  px(ctx, ox + 7, big ? 6 : 9, LEAF_DARK, 2, big ? 9 : 6);
  px(ctx, ox + 8, big ? 7 : 10, LEAF, 1, big ? 7 : 4);
  blob(ctx, ox + 5.5, big ? 8 : 10, 2.5, 1.5, LEAF_DARK); blob(ctx, ox + 5.5, big ? 8 : 10, 1.5, 1, LEAF_LIGHT);
  blob(ctx, ox + 10.5, big ? 6.5 : 9, 2.5, 1.5, LEAF_DARK); blob(ctx, ox + 10.5, big ? 6.5 : 9, 1.5, 1, LEAF_LIGHT);
  if (big) { blob(ctx, ox + 8, 5, 2.5, 2, LEAF_DARK); blob(ctx, ox + 8, 5, 1.5, 1, LEAF); }
}
function drawTilled(ctx: Ctx, ox: number): void {
  px(ctx, ox, 0, SOIL, 16, 16);
  for (let y = 2; y < 16; y += 4) { px(ctx, ox, y, SOIL_DARK, 16, 1); px(ctx, ox, y + 1, SOIL_LIGHT, 16, 1); }
  for (let i = 0; i < 6; i++) px(ctx, ox + ((i * 5 + 3) % 16), (i * 7 + 1) % 16, SOIL_DARK);
}
/** Tomato plant, five phases: mound, sprout, leafy, flowering on a stake, ripe. */
function drawCrop(ctx: Ctx, ox: number, phase: number, mirror: boolean): void {
  const m = (x: number) => (mirror ? ox + 15 - x : ox + x);
  if (phase === 0) { px(ctx, m(6), 11, SOIL_DARK, 4, 3); px(ctx, m(7), 10, SOIL_LIGHT, 2, 1); px(ctx, m(8), 9, LEAF_LIGHT, 1, 1); return; }
  if (phase === 1) { px(ctx, m(8), 9, LEAF_DARK, 1, 5); px(ctx, m(6), 9, LEAF, 2, 1); px(ctx, m(9), 8, LEAF, 2, 1); px(ctx, m(6), 8, LEAF_LIGHT, 1, 1); px(ctx, m(10), 7, LEAF_LIGHT, 1, 1); return; }
  // stake and stem
  if (phase >= 3) { px(ctx, m(8), 2, STAKE, 1, 12); px(ctx, m(8), 2, TRUNK_DARK, 1, 1); }
  px(ctx, m(7), 6, LEAF_DARK, 1, 8);
  blob(ctx, m(5) + 0.5, 9, 2.5, 1.5, LEAF_DARK); blob(ctx, m(5) + 0.5, 9, 1.5, 1, LEAF);
  blob(ctx, m(10) + 0.5, 7, 2.5, 1.5, LEAF_DARK); blob(ctx, m(10) + 0.5, 7, 1.5, 1, LEAF);
  blob(ctx, m(5) + 0.5, 12, 2.5, 1.5, LEAF_DARK); blob(ctx, m(5) + 0.5, 12, 1.5, 1, LEAF_LIGHT);
  if (phase === 2) return;
  if (phase === 3) { px(ctx, m(4), 5, FLOWER); px(ctx, m(11), 10, FLOWER); px(ctx, m(9), 5, FRUIT_GREEN, 2, 2); px(ctx, m(5), 7, FRUIT_GREEN, 2, 2); return; }
  // ripe: fat red tomatoes with a highlight
  for (const [x, y] of [[4, 6], [10, 4], [5, 11], [11, 9]] as const) { px(ctx, m(x), y, TOMATO_HI, 3, 3); px(ctx, m(x) + 1, y + 1, TOMATO, 2, 2); px(ctx, m(x) + 1, y - 1, LEAF_DARK, 1, 1); }
}

/** Build the `flora` tileset (must exist before the tilemap is created). */
export function ensureFlora(scene: Phaser.Scene): void {
  if (scene.textures.exists('flora')) return;
  const tex = scene.textures.createCanvas('flora', FLORA.count * 16, 16)!;
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  const at = (f: number) => f * 16;
  for (let v = 0; v < 3; v++) drawYoung(ctx, at(FLORA.young[v]), v);
  // the tall trees are drawn on a 16x32 scratch canvas and split into a top and a trunk frame
  const tall = document.createElement('canvas'); tall.width = 32; tall.height = 32;
  const tc = tall.getContext('2d')!;
  drawOak(tc, 0); drawPine(tc, 16);
  ctx.drawImage(tall, 0, 0, 16, 16, at(FLORA.oakTop), 0, 16, 16); ctx.drawImage(tall, 0, 16, 16, 16, at(FLORA.oakTrunk), 0, 16, 16);
  ctx.drawImage(tall, 16, 0, 16, 16, at(FLORA.pineTop), 0, 16, 16); ctx.drawImage(tall, 16, 16, 16, 16, at(FLORA.pineTrunk), 0, 16, 16);
  // chopped: the young crown with a notch, the oak trunk with a notch; then the bare trunk
  drawYoung(ctx, at(FLORA.youngChopped), 0); px(ctx, at(FLORA.youngChopped) + 6, 12, FACE, 3, 2); px(ctx, at(FLORA.youngChopped) + 3, 4, LEAF_HI); px(ctx, at(FLORA.youngChopped) + 13, 9, LEAF_HI);
  ctx.drawImage(tall, 0, 16, 16, 16, at(FLORA.oakChopped), 0, 16, 16); px(ctx, at(FLORA.oakChopped) + 5, 10, FACE, 3, 2); px(ctx, at(FLORA.oakChopped) + 8, 11, FACE, 2, 1);
  trunk(ctx, at(FLORA.bare) + 6, 4, 15, 4, true); px(ctx, at(FLORA.bare) + 4, 6, TRUNK_DARK, 3, 1); px(ctx, at(FLORA.bare) + 9, 8, TRUNK_DARK, 3, 1); px(ctx, at(FLORA.bare) + 6, 3, FACE, 4, 1);
  drawStump(ctx, at(FLORA.stump));
  drawSprout(ctx, at(FLORA.sprout), false);
  drawSprout(ctx, at(FLORA.sapling), true);
  drawYoung(ctx, at(FLORA.saplingBig), 2); // a sheltered sapling is already a small tree
  for (let i = 0; i < 5; i++) { drawCrop(ctx, at(FLORA.crop[i]), i, false); drawCrop(ctx, at(FLORA.crop2[i]), i, true); }
  drawTilled(ctx, at(FLORA.tilled));
  tex.refresh();
}
