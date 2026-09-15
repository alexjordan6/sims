import { params } from '@shared/index';

export const TILE = 16;
export const COLS = 40;
export const ROWS = 22;
export const ZOOM = 2; // 16 px tiles shown at 32 px

/** One run: survive escalating raids until the warlord arrives, then beat him. */
export const RUN = { days: 21, raidEvery: 3, bossDay: 21, warnDays: 3 } as const;

export const p = params({
  dayLength: [30, 2, 180, 1],      // real seconds per day
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
export const TREE_SEED_CHANCE = 0.04;
/** woodcutters leave at least this many trees standing */
export const TREE_RESERVE = 8;
/** food / wood the granary / woodyard can hold, by level (index = level) */
export const CAPS = [0, 150, 300, 600] as const;
/** wood to upgrade a building to level 2 / 3 (index = current level) */
export const UPGRADE_COST: Record<'house' | 'barracks' | 'granary' | 'woodyard', readonly number[]> = {
  house: [0, 30, 60], barracks: [0, 40, 80], granary: [0, 30, 60], woodyard: [0, 30, 60],
};
/** beds per house level (index = level); overridden upward by the Big Families boon */
export const HOUSE_BEDS = [0, 4, 6, 8] as const;
