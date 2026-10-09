
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

/** every prop model the world uses (centred single props), for the loader */
export function propKeys(): string[] {
  const keys = new Set<string>();
  for (const list of Object.values(FLORA_MODEL)) for (const p of list as Pick[]) keys.add(p.key);
  return [...keys];
}

// ---- people and monsters --------------------------------------------------------------------

/**
 * The one rig every person and monster is animated on. Bodies are built as boxes over it (see
 * figure.ts), so a pack character is only ever a skeleton to us: `root`, `torso`, `head`, two arms,
 * two legs and 32 clips, which every folk and grave character carries alike. One is all we need.
 * (The grave pack's ghost is the exception that proves it: no legs and no head bone, so it could
 * never have carried a figure.)
 */
export const RIG = 'folk/character-male-a';

/** every character model, for the loader */
export function characterKeys(): string[] { return [RIG]; }
