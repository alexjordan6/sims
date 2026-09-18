import Phaser from 'phaser';
import { ARMOR, DYES, PLUMES, type ArmorSlot } from './config';

// Modular pixel people: every villager, the head and every raider is drawn from layers (body,
// hair, outfit, then armor pieces) into a cached 16x20 texture, so what someone wears shows.

export type Body = 'adult' | 'kid' | 'orc' | 'imp' | 'rat' | 'shaman' | 'boss' | 'brute';
export type Outfit = 'farmer' | 'woodcutter' | 'soldier' | 'kid' | 'head' | 'none';
export type Held = 'none' | 'hoe' | 'axe' | 'sword' | 'bow';
export type HelmetStyle = 0 | 1 | 2;

export interface Armor { helmet: number; chest: number; legs: number; shield: number }
export const NO_ARMOR: Armor = { helmet: 0, chest: 0, legs: 0, shield: 0 };

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
  if (l.body === 'rat') { drawRat(ctx, ox, oy, walk); return; }

  const big = l.body === 'boss' || l.body === 'brute';
  const mskin = l.body === 'orc' ? '#6f9a4a' : l.body === 'imp' ? '#c84a3a' : l.body === 'shaman' ? '#8c7ab0' : l.body === 'brute' ? '#7a8a4a' : l.body === 'boss' ? '#5f7f3a' : skin;
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
  else if (held === 'bow') { P(14, 5, '#8f5c34', 1, 9); P(13, 5, '#8f5c34', 1, 1); P(13, 13, '#8f5c34', 1, 1); }
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

function drawRat(ctx: Ctx, ox: number, oy: number, walk: boolean): void {
  const P = (x: number, y: number, c: string, w = 1, h = 1) => px(ctx, ox + x, oy + y, c, w, h);
  P(3, 12, INK, 10, 6); P(4, 13, '#8a7a6a', 8, 4); P(4, 13, '#a89888', 8, 1);
  P(11, 11, INK, 4, 4); P(12, 12, '#8a7a6a', 2, 2); P(13, 12, '#2a1a16', 1, 1); P(14, 10, '#c88a8a', 1, 2);
  P(0, 15, '#c88a8a', 3, 1); if (walk) { P(5, 18, INK, 2, 2); P(9, 18, INK, 2, 2); } else { P(4, 18, INK, 2, 2); P(10, 18, INK, 2, 2); }
}

/** Ensure the texture for a look exists (two frames: idle 0, walk 1) and return its key. */
export function ensureCharacter(scene: Phaser.Scene, l: Look): string {
  const key = charKey(l);
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, 32, 20)!;
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  drawCharacter(ctx, 0, 0, l, false);
  drawCharacter(ctx, 16, 0, l, true);
  tex.refresh();
  tex.add(0, 0, 0, 0, 16, 20);
  tex.add(1, 0, 16, 0, 16, 20);
  return key;
}

/** PNG data URL of a look at 1x, for the DOM (cards, roster, the armory). */
export function charImg(l: Look): string {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 20;
  drawCharacter(c.getContext('2d')!, 0, 0, l, false);
  return c.toDataURL();
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
