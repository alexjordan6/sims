import Phaser from 'phaser';
import { ARMOR, DYES, PLUMES, WEAPONS, p, type ArmorSlot, type WeaponSlot } from './config';

// Modular pixel people: every villager, the head and every raider is drawn from layers (body,
// hair, outfit, then armor pieces) into a cached 16x20 texture, so what someone wears shows.

export type Body = 'adult' | 'kid' | 'orc' | 'imp' | 'rat' | 'shaman' | 'boss' | 'brute' | 'ogre' | 'gnome' | 'gnomekid' | 'boar' | 'troll';
export type Outfit = 'farmer' | 'woodcutter' | 'soldier' | 'kid' | 'head' | 'none' | 'gnome';
export type Held = 'none' | 'hoe' | 'axe' | 'sword' | 'club' | 'bow' | 'wand';
export type HelmetStyle = 0 | 1 | 2;

export interface Armor { helmet: number; chest: number; legs: number; shield: number }
export const NO_ARMOR: Armor = { helmet: 0, chest: 0, legs: 0, shield: 0 };
/** forged weapon tier per slot (index into WEAPONS[slot].tiers); everyone starts crude */
export interface Weapons { melee: number; bow: number }
export const NO_WEAPONS: Weapons = { melee: 0, bow: 0 };
export function weaponMul(w: Weapons, slot: WeaponSlot): number { return w[slot] === 0 ? p.weaponTier0Mul : WEAPONS[slot].tiers[w[slot]]?.mul ?? 1; }

export interface Look {
  body: Body;
  skin: number;
  hair: number;
  hairStyle: number;
  outfit: Outfit;
  held: Held;
  armor: Armor;
  dye: number;
  helmetStyle: HelmetStyle;
  plume: number;
}

export const SKINS = ['#f1c9a5', '#e0b088', '#c68e5e', '#8d5a3b', '#5c3a25'];
export const HAIRS = ['#3b2314', '#6b4226', '#b8802f', '#e2c25c', '#2a2a2e', '#a8443a', '#c9c9c9'];
const INK = '#2a1a16';

/** Stable per-agent variation: skin, hair colour, hair style from the id. */
export function seedLook(id: number): Pick<Look, 'skin' | 'hair' | 'hairStyle'> {
  const h = (id * 2654435761) >>> 0;
  return { skin: h % SKINS.length, hair: (h >>> 8) % HAIRS.length, hairStyle: (h >>> 16) % 3 };
}

/** Texture key for a look — every distinct combination is its own cached texture. */
export function charKey(l: Look): string {
  return `ch:${l.body}:${l.skin}${l.hair}${l.hairStyle}:${l.outfit}:${l.held}:${l.armor.helmet}${l.armor.chest}${l.armor.legs}${l.armor.shield}:${l.dye}${l.helmetStyle}${l.plume}`;
}

type Ctx = CanvasRenderingContext2D;
const px = (ctx: Ctx, x: number, y: number, c: string, w = 1, h = 1) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };

const OUTFIT: Record<Outfit, { cloth: string; clothDark: string; hat?: 'straw' | 'cap' | 'hood' | 'band' }> = {
  farmer: { cloth: '#4f9a3c', clothDark: '#2f6b2e', hat: 'straw' },
  woodcutter: { cloth: '#c9a26b', clothDark: '#8f6a3a', hat: 'cap' },
  soldier: { cloth: '#3f6fd1', clothDark: '#274a9c' },
  kid: { cloth: '#e8b4c8', clothDark: '#b07a92' },
  gnome: { cloth: '#3f6fd1', clothDark: '#274a9c' },
  head: { cloth: '#2f7d4e', clothDark: '#1f5a3a', hat: 'hood' },
  none: { cloth: '#7a5a3a', clothDark: '#4e3a22' },
};
const TIER_METAL = ['', '#a56a36', '#8d8f95', '#c9d3de']; // leather, iron, steel
const TIER_DARK = ['', '#6b4226', '#5e6067', '#8b99a8'];
const TIER_LIGHT = ['', '#c48a4c', '#b0b3b9', '#f0f4f8'];

/**
 * Draw one 16x20 frame at (ox, oy). `walk` opens the legs for the second gait frame.
 * Layers back to front: back arm/shield, legs, boots, torso, front arm, head, hair, face, armor.
 */
export function drawCharacter(ctx: Ctx, ox: number, oy: number, l: Look, walk = false): void {
  const skin = SKINS[l.skin], hair = HAIRS[l.hair];
  const o = OUTFIT[l.outfit];
  const cloth = l.armor.chest ? TIER_METAL[l.armor.chest] : (l.outfit === 'soldier' ? DYES[l.dye] : o.cloth);
  const clothDark = l.armor.chest ? TIER_DARK[l.armor.chest] : (l.outfit === 'soldier' ? darker(DYES[l.dye]) : o.clothDark);
  const P = (x: number, y: number, c: string, w = 1, h = 1) => px(ctx, ox + x, oy + y, c, w, h);
  const monster = l.body !== 'adult' && l.body !== 'kid';

  if (l.body === 'kid') { drawKid(ctx, ox, oy, l, walk); return; }
  if (l.body === 'gnome' || l.body === 'gnomekid') { drawGnome(ctx, ox, oy, l, walk, l.body === 'gnomekid'); return; }
  if (l.body === 'rat') { drawRat(ctx, ox, oy, walk); return; }
  if (l.body === 'boar') { drawBoar(ctx, ox, oy, walk); return; }
  if (l.body === 'ogre') { drawOgre(ctx, ox, oy, walk); return; }

  const big = l.body === 'boss' || l.body === 'brute' || l.body === 'troll';
  const mskin = l.body === 'orc' ? '#6f9a4a' : l.body === 'imp' ? '#c84a3a' : l.body === 'shaman' ? '#8c7ab0' : l.body === 'brute' ? '#7a8a4a' : l.body === 'boss' ? '#5f7f3a' : l.body === 'troll' ? '#79857a' : skin;
  const legX = 5, legY = 13;
  // shield on the back arm
  if (l.armor.shield) {
    const t = l.armor.shield;
    P(1, 8, INK, 5, 8); P(2, 9, TIER_METAL[t], 3, 6); P(2, 9, TIER_LIGHT[t], 1, 6); P(3, 11, TIER_DARK[t], 1, 2);
  }
  // legs and boots
  const lx = walk ? legX - 1 : legX, rx = walk ? legX + 4 : legX + 3;
  const legC = l.armor.legs ? TIER_METAL[l.armor.legs] : clothDark;
  P(lx, legY, INK, 3, 6); P(rx, legY, INK, 3, 6);
  P(lx + 1, legY, legC, 1, 4); P(rx + 1, legY, legC, 1, 4);
  P(lx + 1, legY + 4, l.armor.legs ? TIER_DARK[l.armor.legs] : '#4e2a1f', 1, 2); P(rx + 1, legY + 4, l.armor.legs ? TIER_DARK[l.armor.legs] : '#4e2a1f', 1, 2);
  // torso
  P(4, 8, INK, big ? 9 : 8, 6);
  P(5, 9, cloth, big ? 7 : 6, 4);
  P(5, 9, clothDark, big ? 7 : 6, 1);
  if (l.armor.chest) { P(6, 10, TIER_LIGHT[l.armor.chest], 1, 2); P(9, 10, TIER_DARK[l.armor.chest], 1, 2); P(7, 12, TIER_DARK[l.armor.chest], 2, 1); }
  else if (l.outfit === 'soldier') { P(7, 10, '#ffd75a', 2, 2); }
  else if (l.outfit === 'head') { P(6, 9, '#a8e07a', 4, 1); }
  // arms
  P(3, 9, INK, 2, 4); P(11, 9, INK, 2, 4);
  P(3, 10, monster ? mskin : skin, 1, 2); P(12, 10, monster ? mskin : skin, 1, 2);
  // held tool/weapon in the front hand
  drawHeld(ctx, ox, oy, l.held);
  // head
  P(5, 2, INK, 6, 7); P(6, 3, mskin, 4, 5);
  P(6, 5, INK, 1, 1); P(9, 5, INK, 1, 1); // eyes
  if (l.body === 'orc' || l.body === 'brute' || l.body === 'boss') { P(6, 7, '#f4f4f4', 1, 1); P(9, 7, '#f4f4f4', 1, 1); } // tusks
  if (l.body === 'imp') { P(5, 1, INK, 1, 2); P(10, 1, INK, 1, 2); P(5, 2, '#f0d060', 1, 1); P(10, 2, '#f0d060', 1, 1); }
  if (l.body === 'troll') {
    P(6, 4, INK, 4, 1);                                        // a heavy brow over sunken eyes
    P(6, 5, '#e8d45a', 1, 1); P(9, 5, '#e8d45a', 1, 1);        // yellow eyes under it
    P(9, 7, '#f4f4f4', 1, 1);                                  // one tusk; the other is long gone
    P(4, 2, '#4a4a3e', 8, 2); P(4, 4, '#4a4a3e', 1, 3); P(11, 4, '#4a4a3e', 1, 3); // lank mane
    P(3, 12, '#79857a', 1, 2); P(12, 12, '#79857a', 1, 2);     // long arms, knuckles near the knee
  }
  if (l.body === 'shaman') { P(4, 1, '#3d2a30', 8, 2); P(4, 3, '#3d2a30', 1, 4); P(11, 3, '#3d2a30', 1, 4); P(5, 0, '#f0d060', 1, 1); P(10, 0, '#f0d060', 1, 1); }
  // hair, then a hat or a helmet on top
  if (!monster && !l.armor.helmet) drawHair(ctx, ox, oy, l.hairStyle, hair);
  if (l.armor.helmet) drawHelmet(ctx, ox, oy, l.armor.helmet, l.helmetStyle, PLUMES[l.plume]);
  else if (o.hat === 'straw') { P(4, 3, '#e0b954', 8, 1); P(5, 1, '#e0b954', 6, 2); P(5, 1, '#b8912f', 6, 1); }
  else if (o.hat === 'cap') { P(5, 1, '#8f5c34', 6, 2); P(4, 3, '#6b4226', 8, 1); }
  else if (o.hat === 'hood') { P(4, 1, '#2f7d4e', 8, 3); P(4, 4, '#2f7d4e', 1, 3); P(11, 4, '#2f7d4e', 1, 3); P(5, 0, '#1f5a3a', 6, 1); }
  if (l.body === 'boss') { P(5, 0, '#e0b04a', 6, 2); P(5, 0, '#ffd75a', 1, 1); P(8, 0, '#ffd75a', 1, 1); P(10, 0, '#ffd75a', 1, 1); }
}

function darker(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) * 0.65, g = ((n >> 8) & 255) * 0.65, b = (n & 255) * 0.65;
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

function drawHair(ctx: Ctx, ox: number, oy: number, style: number, colour: string): void {
  const P = (x: number, y: number, w = 1, h = 1) => px(ctx, ox + x, oy + y, colour, w, h);
  if (style === 0) { P(5, 2, 6, 2); P(5, 4, 1, 2); }                 // short, swept
  else if (style === 1) { P(5, 2, 6, 2); P(5, 4, 1, 4); P(10, 4, 1, 4); } // long, past the ears
  else { P(5, 1, 6, 2); P(6, 3, 4, 1); P(7, 0, 2, 1); }                 // tufty top
}

function drawHelmet(ctx: Ctx, ox: number, oy: number, tier: number, style: HelmetStyle, plume: string): void {
  const m = TIER_METAL[tier], d = TIER_DARK[tier], l = TIER_LIGHT[tier];
  const P = (x: number, y: number, c: string, w = 1, h = 1) => px(ctx, ox + x, oy + y, c, w, h);
  if (style === 0) { P(5, 1, INK, 6, 3); P(6, 2, m, 4, 2); P(6, 2, l, 1, 1); }                                   // cap
  else if (style === 1) { P(4, 2, INK, 8, 3); P(5, 3, m, 6, 2); P(5, 1, INK, 6, 2); P(6, 2, m, 4, 1); P(5, 3, l, 1, 2); } // kettle brim
  else { P(5, 1, INK, 6, 7); P(6, 2, m, 4, 5); P(6, 2, l, 1, 5); P(7, 5, d, 2, 1); P(7, 4, INK, 2, 1); }         // great helm with a slit
  if (plume !== 'none') { P(8, 0, plume, 1, 2); P(9, 0, plume, 2, 1); }
}

function drawHeld(ctx: Ctx, ox: number, oy: number, held: Held): void {
  const P = (x: number, y: number, c: string, w = 1, h = 1) => px(ctx, ox + x, oy + y, c, w, h);
  if (held === 'hoe') { P(13, 6, '#8f5c34', 1, 9); P(12, 6, '#8d8f95', 3, 1); }
  else if (held === 'axe') { P(13, 7, '#8f5c34', 1, 8); P(13, 5, '#8d8f95', 2, 3); P(13, 5, '#c9d3de', 1, 3); }
  else if (held === 'sword') { P(13, 5, '#c9d3de', 1, 7); P(12, 12, '#e0b04a', 3, 1); P(13, 13, '#6b4226', 1, 2); }
  else if (held === 'club') { P(13, 8, '#8f5c34', 1, 7); P(12, 5, '#6b4226', 3, 4); P(13, 5, '#a8733f', 1, 3); } // a knotted stick with a fat head
  else if (held === 'bow') { P(14, 5, '#8f5c34', 1, 9); P(13, 5, '#8f5c34', 1, 1); P(13, 13, '#8f5c34', 1, 1); }
  else if (held === 'wand') { P(13, 6, '#3b2314', 1, 9); P(12, 4, '#78d8f0', 3, 1); P(13, 3, '#d8f6ff', 1, 3); P(12, 5, '#78d8f0', 1, 1); P(14, 5, '#78d8f0', 1, 1); } // a knotted stick with a glowing knot
}


/**
 * Gnomes, in the same 16x20 frame as everyone else but half the height: a tall red cap, a big nose,
 * a white beard on the grown (a club at the hip when armed), a tunic and boots. Children are a cap
 * on legs. `walk` opens the legs like the other bodies.
 */
function drawGnome(ctx: Ctx, ox: number, oy: number, l: Look, walk: boolean, kid: boolean): void {
  const skin = SKINS[l.skin], o = OUTFIT[l.outfit];
  const P = (x: number, y: number, c: string, w = 1, h = 1) => px(ctx, ox + x, oy + y, c, w, h);
  const HAT = '#c23b3b', HAT_LIGHT = '#e06a5a', BEARD = '#f4efe2', BEARD_DARK = '#c9c1b0', BOOT = '#3b2314', NOSE = '#e0907a';
  // a cone hat: rows of (x0, width) top to bottom, the last row the brim; ink outline, then red, then a light edge
  const hat = (rows: [number, number][], y0: number) => {
    P(rows[0][0], y0 - 1, INK, rows[0][1]);
    rows.forEach(([x0, w], k) => P(x0 - 1, y0 + k, INK, w + 2));
    rows.forEach(([x0, w], k) => P(x0, y0 + k, HAT, w));
    rows.forEach(([x0], k) => { if (k < rows.length - 1) P(x0, y0 + k, HAT_LIGHT, 1); });
  };
  if (kid) {
    const lx = walk ? 5 : 6, rx = walk ? 9 : 8;
    P(lx, 18, INK, 2, 2); P(rx, 18, INK, 2, 2); P(lx, 18, BOOT, 1, 1); P(rx + 1, 18, BOOT, 1, 1);
    P(5, 15, INK, 6, 4); P(6, 16, o.cloth, 4, 2); P(6, 17, o.clothDark, 4, 1);
    P(5, 11, INK, 6, 5); P(6, 12, skin, 4, 3); P(6, 12, INK, 1, 1); P(9, 12, INK, 1, 1); P(7, 13, NOSE, 2, 1);
    hat([[7, 2], [7, 2], [6, 4], [6, 4], [5, 6], [4, 8]], 6);
    return;
  }
  // legs and boots
  const lx = walk ? 4 : 5, rx = walk ? 10 : 9;
  P(lx, 16, INK, 3, 4); P(rx, 16, INK, 3, 4); P(lx + 1, 17, o.clothDark, 1, 1); P(rx + 1, 17, o.clothDark, 1, 1); P(lx + 1, 18, BOOT, 1, 1); P(rx + 1, 18, BOOT, 1, 1);
  // tunic with a belt, arms at the sides
  P(4, 11, INK, 8, 6); P(5, 12, o.cloth, 6, 4); P(5, 14, INK, 6, 1); P(7, 14, '#e0b04a', 2, 1); P(5, 15, o.clothDark, 6, 1);
  P(3, 12, INK, 1, 4); P(12, 12, INK, 1, 4); P(3, 14, skin, 1, 1); P(12, 14, skin, 1, 1);
  // face: eyes either side of a big nose
  P(4, 6, INK, 8, 5); P(5, 7, skin, 6, 3); P(6, 7, INK, 1, 1); P(9, 7, INK, 1, 1); P(7, 8, NOSE, 2, 2);
  // the beard, narrowing to a point over the tunic
  P(4, 9, INK, 8, 3); P(5, 12, INK, 6, 1); P(6, 13, INK, 4, 1);
  P(5, 10, BEARD, 6, 2); P(6, 12, BEARD, 4, 1); P(5, 11, BEARD_DARK, 1, 1); P(9, 11, BEARD_DARK, 1, 1); P(7, 12, BEARD_DARK, 2, 1);
  hat([[7, 2], [7, 2], [6, 4], [6, 4], [5, 6], [5, 6], [4, 8], [3, 10]], 0);
  drawHeld(ctx, ox, oy, l.held);
}

function drawKid(ctx: Ctx, ox: number, oy: number, l: Look, walk: boolean): void {
  const skin = SKINS[l.skin], hair = HAIRS[l.hair], o = OUTFIT[l.outfit];
  const P = (x: number, y: number, c: string, w = 1, h = 1) => px(ctx, ox + x, oy + y, c, w, h);
  const lx = walk ? 5 : 6, rx = walk ? 9 : 8;
  P(lx, 15, INK, 2, 4); P(rx, 15, INK, 2, 4); P(lx, 15, o.clothDark, 1, 3); P(rx + 1, 15, o.clothDark, 1, 3);
  P(5, 11, INK, 6, 5); P(6, 12, o.cloth, 4, 3);
  P(4, 12, INK, 1, 3); P(11, 12, INK, 1, 3);
  P(5, 5, INK, 6, 7); P(6, 6, skin, 4, 5); P(6, 8, INK, 1, 1); P(9, 8, INK, 1, 1);
  px(ctx, ox + 5, oy + 5, hair, 6, 2); if (l.hairStyle === 1) { px(ctx, ox + 5, oy + 7, hair, 1, 3); px(ctx, ox + 10, oy + 7, hair, 1, 3); }
  if (l.hairStyle === 2) px(ctx, ox + 7, oy + 4, hair, 2, 1);
}

/** Frame size per body: people are 16x20; the Ogre is drawn big (48x64) so he keeps his detail at scale. */
export function frameSize(body: Body): { w: number; h: number } {
  return body === 'ogre' ? { w: 48, h: 64 } : { w: 16, h: 20 };
}

/**
 * The Ogre, 48x64: a mountain of a body — hunched shoulders, a hanging belly, a hide loincloth,
 * tusks, a knotted club over one shoulder. `walk` swings the legs and the free arm.
 */
function drawOgre(ctx: Ctx, ox: number, oy: number, walk: boolean): void {
  const SKIN = '#7a8a4a', SKIN_DARK = '#55632f', SKIN_LIGHT = '#98a865', HIDE = '#6b4226', HIDE_DARK = '#3b2314', HIDE_LIGHT = '#8a5a34', BONE = '#e8e0d0', BONE_DARK = '#b8ae9a', WOOD = '#5a3a1e', WOOD_LIGHT = '#7a5230', EYE = '#f0d060';
  const P = (x: number, y: number, c: string, w = 1, h = 1) => px(ctx, ox + x, oy + y, c, w, h);
  // a rounded blob of ink then fill: rows of (x0, width)
  const blob = (rows: [number, number][], y0: number, c: string) => rows.forEach(([x0, w], k) => P(x0, y0 + k, c, w, 1));
  const sw = walk ? 2 : 0;
  // --- club, behind the body: rises over the right shoulder
  P(36, 2, INK, 8, 22); P(37, 3, WOOD, 6, 20); P(37, 3, WOOD_LIGHT, 2, 20); P(40, 6, WOOD, 1, 14);
  P(34, 0, INK, 12, 6); P(35, 1, WOOD, 10, 4); P(35, 1, WOOD_LIGHT, 3, 4); // the knotted head
  P(37, 0, BONE, 1, 2); P(41, 0, BONE, 1, 2); P(44, 3, BONE, 2, 1); P(36, 5, BONE_DARK, 2, 1); // bone spikes
  // --- legs: tree trunks wrapped in hide; walk frame strides
  const lx = 10 - sw, rx = 26 + sw;
  P(lx, 42, INK, 12, 20); P(rx, 42, INK, 12, 20);
  P(lx + 1, 43, SKIN, 10, 12); P(rx + 1, 43, SKIN, 10, 12);
  P(lx + 1, 43, SKIN_DARK, 1, 12); P(rx + 10, 43, SKIN_DARK, 1, 12);
  P(lx + 1, 55, HIDE, 10, 5); P(rx + 1, 55, HIDE, 10, 5); P(lx + 1, 55, HIDE_LIGHT, 10, 1); P(rx + 1, 55, HIDE_LIGHT, 10, 1); // wraps
  P(lx + 1, 60, SKIN_DARK, 10, 1); P(rx + 1, 60, SKIN_DARK, 10, 1); P(lx, 59, INK, 12, 3); P(rx, 59, INK, 12, 3); P(lx + 1, 60, HIDE_DARK, 10, 1); P(rx + 1, 60, HIDE_DARK, 10, 1);
  P(lx - 1, 61, INK, 14, 2); P(rx - 1, 61, INK, 14, 2); P(lx, 61, HIDE_DARK, 12, 1); P(rx, 61, HIDE_DARK, 12, 1); // feet
  P(lx + 2, 62, BONE, 2, 1); P(lx + 6, 62, BONE, 2, 1); P(rx + 4, 62, BONE, 2, 1); P(rx + 8, 62, BONE, 2, 1); // toenails
  // --- torso: hunched shoulders, hanging belly
  blob([[8, 32], [6, 36], [4, 40], [3, 42], [2, 44], [2, 44], [2, 44], [2, 44], [3, 42], [3, 42], [4, 40], [4, 40], [5, 38], [6, 36], [6, 36], [7, 34], [7, 34], [8, 32], [8, 32], [9, 30], [10, 28], [10, 28], [11, 26], [12, 24]], 18, INK);
  blob([[9, 30], [7, 34], [5, 38], [4, 40], [3, 42], [3, 42], [3, 42], [3, 42], [4, 40], [4, 40], [5, 38], [5, 38], [6, 36], [7, 34], [7, 34], [8, 32], [8, 32], [9, 30], [9, 30], [10, 28], [11, 26], [11, 26], [12, 24], [13, 22]], 19, SKIN);
  P(9, 19, SKIN_LIGHT, 30, 1); P(7, 20, SKIN_LIGHT, 4, 1); P(37, 20, SKIN_LIGHT, 4, 1); // light on the shoulders
  P(20, 24, SKIN_DARK, 8, 1); P(22, 25, SKIN_DARK, 4, 1); // chest crease
  P(14, 33, SKIN_LIGHT, 20, 1); P(16, 34, SKIN_LIGHT, 16, 1); // belly highlight
  P(22, 36, SKIN_DARK, 4, 2); // navel
  P(12, 22, SKIN_DARK, 2, 2); P(34, 22, SKIN_DARK, 2, 2); P(18, 28, SKIN_DARK, 1, 1); P(30, 30, SKIN_DARK, 1, 1); // warts
  // hide loincloth and belt with a skull buckle
  P(10, 38, INK, 28, 8); P(11, 39, HIDE, 26, 6); P(11, 39, HIDE_LIGHT, 26, 1); P(13, 41, HIDE_DARK, 2, 4); P(20, 42, HIDE_DARK, 2, 3); P(30, 41, HIDE_DARK, 3, 4);
  P(20, 37, INK, 8, 6); P(21, 38, BONE, 6, 4); P(22, 39, INK, 1, 1); P(25, 39, INK, 1, 1); P(22, 41, BONE_DARK, 4, 1);
  // --- arms: the left hangs with a fist, the right holds the club
  const ay = walk ? 1 : 0;
  P(0, 22 + ay, INK, 9, 22); P(1, 23 + ay, SKIN, 7, 18); P(1, 23 + ay, SKIN_LIGHT, 2, 12); P(6, 25 + ay, SKIN_DARK, 2, 14);
  P(0, 40 + ay, INK, 10, 8); P(1, 41 + ay, SKIN, 8, 6); P(2, 42 + ay, SKIN_DARK, 1, 1); P(4, 42 + ay, SKIN_DARK, 1, 1); P(6, 42 + ay, SKIN_DARK, 1, 1); P(1, 45 + ay, SKIN_DARK, 8, 1); // fist and knuckles
  P(39, 22, INK, 9, 14); P(40, 23, SKIN, 7, 12); P(45, 23, SKIN_LIGHT, 2, 8); P(40, 25, SKIN_DARK, 2, 10);
  P(37, 18, INK, 10, 8); P(38, 19, SKIN, 8, 6); P(38, 20, SKIN_DARK, 1, 1); P(42, 20, SKIN_DARK, 1, 1); P(39, 23, SKIN_DARK, 6, 1); // the grip around the club
  P(40, 7, INK, 1, 2); // strap
  // --- head: sunk between the shoulders, heavy brow, tusks
  blob([[16, 14], [14, 18], [13, 20], [12, 22], [12, 22], [12, 22], [12, 22], [12, 22], [12, 22], [12, 22], [13, 20], [13, 20], [14, 18], [15, 16], [16, 14]], 4, INK);
  blob([[17, 12], [15, 16], [14, 18], [13, 20], [13, 20], [13, 20], [13, 20], [13, 20], [13, 20], [14, 18], [14, 18], [15, 16], [16, 14], [17, 12]], 5, SKIN);
  P(17, 5, SKIN_LIGHT, 12, 1); P(15, 6, SKIN_LIGHT, 3, 1); // crown light
  P(14, 9, SKIN_DARK, 20, 2); P(13, 10, INK, 22, 1); // the brow
  P(17, 11, INK, 4, 3); P(27, 11, INK, 4, 3); P(18, 12, EYE, 2, 1); P(28, 12, EYE, 2, 1); // deep-set eyes
  P(22, 13, SKIN_DARK, 4, 3); P(21, 15, INK, 6, 1); P(22, 16, SKIN_DARK, 1, 1); P(25, 16, SKIN_DARK, 1, 1); // nose
  P(15, 17, INK, 18, 2); P(16, 18, HIDE_DARK, 16, 1); // the mouth
  P(15, 16, INK, 3, 5); P(16, 15, BONE, 1, 5); P(30, 16, INK, 3, 5); P(31, 15, BONE, 1, 5); // tusks
  P(19, 19, BONE, 2, 1); P(27, 19, BONE, 2, 1); // teeth
  P(11, 9, INK, 3, 5); P(12, 10, SKIN, 1, 3); P(34, 9, INK, 3, 5); P(35, 10, SKIN, 1, 3); // ears
  P(19, 2, INK, 10, 3); P(20, 3, HIDE_DARK, 8, 1); P(21, 1, INK, 2, 2); P(26, 0, INK, 2, 3); P(23, 2, HIDE_DARK, 1, 1); // hair tuft
  P(12, 4, BONE, 1, 2); P(35, 3, BONE, 1, 2); // bone earrings
}

function drawRat(ctx: Ctx, ox: number, oy: number, walk: boolean): void {
  const P = (x: number, y: number, c: string, w = 1, h = 1) => px(ctx, ox + x, oy + y, c, w, h);
  P(3, 12, INK, 10, 6); P(4, 13, '#8a7a6a', 8, 4); P(4, 13, '#a89888', 8, 1);
  P(11, 11, INK, 4, 4); P(12, 12, '#8a7a6a', 2, 2); P(13, 12, '#2a1a16', 1, 1); P(14, 10, '#c88a8a', 1, 2);
  P(0, 15, '#c88a8a', 3, 1); if (walk) { P(5, 18, INK, 2, 2); P(9, 18, INK, 2, 2); } else { P(4, 18, INK, 2, 2); P(10, 18, INK, 2, 2); }
}

/** A wild boar, facing right: a low bristled barrel of a body, a wedge of a head with tusks, thin legs, a tail curl. */
function drawBoar(ctx: Ctx, ox: number, oy: number, walk: boolean): void {
  const P = (x: number, y: number, c: string, w = 1, h = 1) => px(ctx, ox + x, oy + y, c, w, h);
  const HIDE = '#5a3a22', HIDE_DARK = '#3b2314', BRISTLE = '#8a5a34', BELLY = '#7a5a3e', TUSK = '#e8e0d0', NOSE = '#c88a8a';
  // body: outline, fill, a paler belly, a bristled ridge along the back
  P(2, 8, INK, 11, 8); P(3, 9, HIDE, 9, 6); P(4, 13, BELLY, 7, 2);
  P(3, 8, BRISTLE, 9, 1); P(4, 7, INK, 2, 1); P(7, 7, INK, 2, 1); P(10, 7, INK, 1, 1); // the ridge
  // head: forward and low, ear, eye, snout with the nose and two tusks
  P(10, 9, INK, 5, 6); P(11, 10, HIDE_DARK, 3, 4); P(11, 8, INK, 2, 2); P(11, 9, HIDE, 1, 1); // ear
  P(12, 11, '#f0d060', 1, 1); // eye
  P(13, 12, INK, 3, 3); P(14, 13, HIDE_DARK, 2, 1); P(15, 13, NOSE, 1, 2); // snout
  P(13, 15, TUSK, 1, 2); P(15, 15, TUSK, 1, 1); // tusks
  // tail
  P(1, 9, INK, 1, 3); P(0, 8, INK, 1, 1);
  // legs: two pairs, the walk frame swings them apart
  if (walk) { P(3, 16, INK, 2, 3); P(7, 16, INK, 2, 3); P(5, 16, INK, 1, 2); P(10, 16, INK, 2, 3); }
  else { P(4, 16, INK, 2, 3); P(9, 16, INK, 2, 3); P(6, 16, HIDE_DARK, 1, 2); P(11, 16, HIDE_DARK, 1, 2); }
}

/** Ensure the texture for a look exists (two frames: idle 0, walk 1) and return its key. */
export function ensureCharacter(scene: Phaser.Scene, l: Look): string {
  const key = charKey(l);
  if (scene.textures.exists(key)) return key;
  const { w, h } = frameSize(l.body);
  const tex = scene.textures.createCanvas(key, w * 2, h)!;
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  drawCharacter(ctx, 0, 0, l, false);
  drawCharacter(ctx, w, 0, l, true);
  tex.refresh();
  tex.add(0, 0, 0, 0, w, h);
  tex.add(1, 0, w, 0, w, h);
  return key;
}

/** PNG data URL of a look at 1x, for the DOM (cards, roster, the armory). */
const imgCache = new Map<string, string>();
export function charImg(l: Look): string {
  const key = charKey(l);
  let url = imgCache.get(key);
  if (url) return url;
  const c = document.createElement('canvas');
  const { w, h } = frameSize(l.body); c.width = w; c.height = h;
  drawCharacter(c.getContext('2d')!, 0, 0, l, false);
  url = c.toDataURL();
  imgCache.set(key, url);
  return url;
}

/** Stats a set of armor gives: extra HP, damage taken multiplier, speed multiplier, block chance. */
export function armorStats(a: Armor): { hp: number; dmgMul: number; speedMul: number; block: number } {
  const t = (slot: ArmorSlot) => ARMOR[slot].tiers[a[slot]];
  return {
    hp: t('helmet').hp + t('chest').hp + t('legs').hp + t('shield').hp,
    dmgMul: 1 - t('chest').reduce,
    speedMul: 1 + t('legs').speed,
    block: t('shield').block,
  };
}
