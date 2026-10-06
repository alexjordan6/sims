import type { FoodKind } from '../config';
import type { EnemyKind } from '../agents';

// Which model draws what. One line to swap a model; scales bring each pack's units to ours (one tile is
// one unit, a grown person about 1.2 tall). Anything not listed, or not yet loaded, is drawn with the
// code-built placeholder, so the game is never missing a piece.

export interface Pick { key: string; scale: number }

/** flora per tile kind: a few variants each, chosen per tile so a forest is not one tree stamped out */
export const FLORA_MODEL = {
  tree: [{ key: 'nature/tree_oak_dark', scale: 1.9 }, { key: 'nature/tree_default_dark', scale: 1.8 }, { key: 'nature/tree_detailed_dark', scale: 1.8 }, { key: 'nature/tree_simple_dark', scale: 1.8 }],
  oldTree: [{ key: 'nature/tree_fat_darkh', scale: 2.2 }, { key: 'nature/tree_tall_dark', scale: 2.1 }, { key: 'grave/pine-crooked', scale: 1.25 }, { key: 'grave/pine-fall-crooked', scale: 1.25 }],
  sapling: [{ key: 'nature/tree_pineSmallA', scale: 1.1 }],
  stump: [{ key: 'nature/stump_round', scale: 1.3 }, { key: 'nature/stump_old', scale: 1.3 }],
  bush: [{ key: 'nature/plant_bushDetailed', scale: 1.5 }],
  hazel: [{ key: 'nature/plant_bushLarge', scale: 1.2 }],
  garlic: [{ key: 'nature/plant_flatShort', scale: 1.4 }],
  burdock: [{ key: 'nature/plant_flatTall', scale: 1.3 }],
  mushroom: [{ key: 'nature/mushroom_tanGroup', scale: 1.6 }],
  mushroomRipe: [{ key: 'nature/mushroom_redGroup', scale: 1.9 }],
  tuft: [{ key: 'nature/grass_large', scale: 1.5 }, { key: 'nature/grass_leafsLarge', scale: 1.5 }],
} satisfies Record<string, Pick[]>;

export function pickModel(kind: keyof typeof FLORA_MODEL, r: number): Pick | undefined {
  const list: Pick[] = FLORA_MODEL[kind];
  return list[Math.floor(r * list.length) % list.length];
}

/** a crop's model by what it is and how far along: growing leaves, then the ripe plant */
export function cropModel(food: FoodKind, grown: number, ripe: boolean): (Pick & { tint: number }) | undefined {
  switch (food) {
    case 'wheat': return { key: grown < 0.5 ? 'nature/crops_wheatStageA' : 'nature/crops_wheatStageB', scale: 1.9, tint: ripe ? 0xffffff : 0xb8c890 };
    case 'carrot': return ripe ? { key: 'nature/crop_carrot', scale: 1.8, tint: 0xffffff } : { key: 'nature/crops_leafsStageA', scale: 1.8, tint: 0xffffff };
    case 'tomato': return { key: ripe ? 'nature/crops_cornStageD' : grown < 0.5 ? 'nature/crops_cornStageA' : 'nature/crops_cornStageB', scale: 1.4, tint: ripe ? 0xffb8a0 : 0xffffff };
    default: return undefined;
  }
}

/** every prop model the world uses (centred single props), for the loader */
export function propKeys(): string[] {
  const keys = new Set<string>();
  for (const list of Object.values(FLORA_MODEL)) for (const p of list as Pick[]) keys.add(p.key);
  for (const k of ['wheatStageA', 'wheatStageB', 'leafsStageA', 'cornStageA', 'cornStageB', 'cornStageD']) keys.add(`nature/crops_${k}`);
  keys.add('nature/crop_carrot');
  return [...keys];
}

// ---- people and monsters --------------------------------------------------------------------

/** the villagers' faces: a person's id picks one */
export const FOLK = ['folk/character-male-a', 'folk/character-male-b', 'folk/character-male-c', 'folk/character-male-d', 'folk/character-male-e', 'folk/character-male-f',
  'folk/character-female-a', 'folk/character-female-b', 'folk/character-female-c', 'folk/character-female-d', 'folk/character-female-e', 'folk/character-female-f'];
/** the head of the village */
export const HEAD = 'folk/character-male-e';

/** what walks out of the trees. (rats and boars keep their code-built bodies: nothing in the packs is four-legged) */
export const FOE_MODEL: Partial<Record<EnemyKind, { key: string; tint?: number }>> = {
  raider: { key: 'grave/character-zombie' },
  warlord: { key: 'grave/character-vampire' },
  snatcher: { key: 'grave/character-skeleton', tint: 0xc8c8d0 },
  brute: { key: 'grave/character-zombie', tint: 0xb08070 },
  shaman: { key: 'grave/character-ghost', tint: 0xb090d0 },
  wrecker: { key: 'grave/character-skeleton', tint: 0xd0a070 },
  troll: { key: 'grave/character-zombie', tint: 0x80a070 },
  skulk: { key: 'grave/character-ghost', tint: 0x404048 },
  ogre: { key: 'grave/character-zombie', tint: 0x90a880 },
};

/** every character model, for the loader */
export function characterKeys(): string[] {
  return [...new Set([...FOLK, HEAD, ...Object.values(FOE_MODEL).map((f) => f!.key), 'grave/character-keeper'])];
}
