import { params } from '@shared/index';

export const TILE = 16;
export const COLS = 80;
export const ROWS = 44;
export const ZOOM = 2; // 16 px tiles shown at 32 px

/** One run: survive escalating raids until the warlord arrives, then beat him. */
export const RUN = { days: 21, raidEvery: 3, bossDay: 21, warnDays: 3 } as const;

export const p = params({
  dayLength: [120, 10, 300, 1],    // real seconds per day
  raidEvery: [RUN.raidEvery, 1, 20, 1],
  birthChance: [0.5, 0, 1],        // per couple per day, if fed and housed
  adultAge: [8, 1, 40, 1],         // days
  oldAge: [70, 20, 200, 1],        // days
  cropDays: [2, 1, 10, 1],         // days from seed to harvest
  foodPerDay: [1, 0, 3],           // per villager
  raiderHp: [30, 5, 100, 1],
  raiderDmg: [5, 1, 30, 1],
  soldierHp: [60, 5, 100, 1],
  soldierDmg: [10, 1, 30, 1],
});

export const COST = { house: 20, barracks: 30 } as const;
export const TREE_YIELD = 8;

// ---- trees, storage, upgrades --------------------------------------------------------------
/** days for a stump/sapling to become a tree */
export const SAPLING_DAYS = 4;
/** daily chance each tree seeds an adjacent grass tile */
/** a tree's daily chance to seed a neighbouring grass tile: base + per tree around it (8-neighbourhood, capped at 4) */
export const SEED_BASE = 0.01;
export const SEED_PER_NEIGHBOUR = 0.025;
/** a sapling with at least two tree neighbours grows this fast instead of SAPLING_DAYS */
export const SHELTERED_SAPLING_DAYS = 3;
/** days after which a tree is old growth: taller, and worth OLD_YIELD */
export const OLD_GROWTH_DAYS = 6;
export const OLD_YIELD = 12;
/** woodcutters leave at least this many trees standing */
export const TREE_RESERVE = 8;
/** food / wood the granary / woodyard can hold, by level (index = level) */
export const CAPS = [0, 150, 300, 600] as const;

/** Playtest switch: every Legacy node unlocked and a slot per branch. Flip to false to restore progression (saved progress is untouched either way). */
export const LEGACY_TEST_MODE = true;
/** wood to upgrade a building to level 2 / 3 (index = current level) */
export const UPGRADE_COST: Record<'house' | 'barracks' | 'granary' | 'woodyard', readonly number[]> = {
  house: [0, 30, 60], barracks: [0, 40, 80], granary: [0, 30, 60], woodyard: [0, 30, 60],
};
/** what each level of a building gives, in a few words (index = level); shown in tooltips, hints and help */
export const LEVEL_PERKS: Record<'house' | 'barracks' | 'granary' | 'woodyard', readonly [string, string, string, string]> = {
  house: ['', '4 beds', '6 beds', '8 beds · births +15%'],
  barracks: ['', 'sponsors 1 house', 'sponsors 2 houses · soldiers +15 HP', 'sponsors 3 houses · soldiers +30 HP · +20% dmg · regen'],
  granary: ['', 'holds 150 food', 'holds 300 food', 'holds 600 food'],
  woodyard: ['', 'holds 150 wood', 'holds 300 wood', 'holds 600 wood'],
};
/** what changes on the building itself at each level, for the help screen */
export const LEVEL_LOOKS: Record<'house' | 'barracks' | 'granary' | 'woodyard', readonly [string, string, string, string]> = {
  house: ['', 'cottage', 'chimney, flower boxes, porch', 'second storey'],
  barracks: ['', 'stone keep', 'shields and stakes', 'tower and torches'],
  granary: ['', 'barn', 'open hay loft', 'silo'],
  woodyard: ['', 'cabin', 'chimney', 'lantern and loft window'],
};
// ---- children ------------------------------------------------------------------------------
/** a child starts apprenticing this many days before coming of age, and needs CADET_DAYS at it to come of age skilled */
export const CADET_AGE_BEFORE = 3;
export const CADET_DAYS = 3;
/** care stars: +6% HP and work speed per star for life */
export const STAR_BONUS = 0.06;
/** a child on hearty rations eats this much a day (and is "well fed") */
export const HEARTY_RATION = 2;
/** children run for the nearest door when a raider is this close */
export const FLEE_RANGE = 120;
/** children are asleep indoors between these times of day */
export const BEDTIME = { start: 0.8, end: 0.28 } as const;
export type Calling = 'farmer' | 'woodcutter' | 'soldier';
export const CALLING_NAME: Record<Calling, string> = { farmer: 'farmers', woodcutter: 'woodcutters', soldier: 'soldiers' };
/** gifted traits: a five-star child gets one for life */
export type Trait = 'hardy' | 'quick' | 'brave' | 'greenthumb' | 'tireless';
export const TRAITS: Record<Trait, { name: string; blurb: string }> = {
  hardy: { name: 'Hardy', blurb: '+25% HP' },
  quick: { name: 'Quick', blurb: 'moves 20% faster' },
  brave: { name: 'Brave', blurb: 'soldiers deal +20%' },
  greenthumb: { name: 'Green Thumb', blurb: 'a quarter of harvests yield double' },
  tireless: { name: 'Tireless', blurb: 'works 25% faster' },
};
/** beds per house level (index = level); overridden upward by the Big Families boon */
export const HOUSE_BEDS = [0, 4, 6, 8] as const;
