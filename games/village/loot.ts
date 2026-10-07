import type { Rng } from '@shared/index';
import { ARMOR_SLOTS, COLS, ROWS, STACK, WEAPON_SLOTS, p, type ArmorSlot, type FoodKind, type WeaponSlot } from './config';
import type { Gear, Slot } from './pack';

/**
 * Loot: what a chest, a ruin or a fallen enemy gives. Everything turns on one number, the danger (0-1):
 * how far out it lies and how late in the run it is. Low danger rolls leather and bronze, middling iron,
 * high steel. Only what is in the box scales — never the enemies guarding it.
 */

/** the best tier anything rolls (tier 4, the loot-only kinds, comes from `found` sources only) */
export const LOOT_TOP_TIER = 3;

/** How dangerous a spot is: half its distance from the village (as a share of the map's half-diagonal), half the run's progress. */
export function danger(tiles: number, day: number, bonus = 0): number {
  const far = Math.min(1, tiles / (Math.hypot(COLS, ROWS) / 2));
  const late = Math.min(1, Math.max(0, day / Math.max(1, p.bossDay)));
  return Math.max(0, Math.min(1, 0.5 * far + 0.5 * late + bonus));
}

/** The tier a piece of gear rolls at `danger`: 1 at the bottom, 3 at the top, a little either way. */
export function lootTier(rng: Rng, d: number): number {
  const roll = 0.6 + d * 2.8 + p.lootTierBias + rng.range(-0.6, 0.6);
  return Math.max(1, Math.min(LOOT_TOP_TIER, Math.floor(roll)));
}

export type GearSlot = WeaponSlot | ArmorSlot;
/** weapons and armor: gear that has a slot and a tier (not an implement) */
export type Piece = Exclude<Gear, { kind: 'tool' }>;
/** A piece of gear for `slot` at `tier`. */
export function piece(slot: GearSlot, tier: number): Piece {
  return (WEAPON_SLOTS as readonly string[]).includes(slot) ? { kind: 'weapon', slot: slot as WeaponSlot, tier } : { kind: 'armor', slot: slot as ArmorSlot, tier };
}
const GEAR_SLOTS: readonly GearSlot[] = [...WEAPON_SLOTS, ...ARMOR_SLOTS];

/** what a cache of supplies holds: hard tack and whatever was being carried */
const SUPPLY_FOOD: readonly FoodKind[] = ['meat', 'meat', 'wheat', 'hazelnut', 'honey', 'carrot'];

/**
 * Roll `size` things at `danger`: each a piece of gear (share `gear`) or a stack of supplies — food, wood
 * or scrap, more of it the more dangerous the spot. lootMul scales how many things there are.
 */
export function rollLoot(rng: Rng, d: number, size: number, gear = 0.5): Slot[] {
  const n = Math.max(1, Math.round(size * p.lootMul));
  const out: Slot[] = [];
  const more = 0.6 + d;
  for (let i = 0; i < n; i++) {
    if (rng.chance(gear)) { out.push(piece(rng.pick(GEAR_SLOTS), lootTier(rng, d))); continue; }
    const r = rng.next();
    if (r < 0.45) out.push({ kind: 'food', food: rng.pick(SUPPLY_FOOD), n: Math.min(STACK.food, Math.max(2, Math.round(rng.range(4, 9) * more))) });
    else if (r < 0.75) out.push({ kind: 'wood', n: Math.min(STACK.wood, Math.max(3, Math.round(rng.range(6, 12) * more))) });
    else out.push({ kind: 'scrap', n: Math.min(STACK.scrap, Math.max(1, Math.round(rng.range(2, 5) * more))) });
  }
  return out;
}

/** What each enemy kind fights with, and so may leave behind: the slots it can drop. */
export const DROP_SLOTS: Partial<Record<string, readonly GearSlot[]>> = {
  raider: ['melee', 'shield'],
  brute: ['chest', 'legs'],
  shaman: ['helmet'],
  wrecker: ['melee'],
};

/**
 * What a slain enemy leaves besides its scrap: the gear it fought with, now and then (dropChance), at the
 * day's danger. The Warlord always leaves a steel piece.
 */
export function enemyDrop(rng: Rng, kind: string, boss: boolean, day: number): Piece | null {
  if (boss) return piece(rng.pick(GEAR_SLOTS), LOOT_TOP_TIER);
  const slots = DROP_SLOTS[kind];
  if (!slots || !rng.chance(p.dropChance)) return null;
  return piece(rng.pick(slots), lootTier(rng, danger(0, day)));
}
