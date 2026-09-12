import { params } from '@shared/index';

export const TILE = 32;
export const COLS = 40;
export const ROWS = 22;

export const p = params({
  dayLength: [60, 2, 180, 1],      // real seconds per day
  raidEvery: [5, 1, 20, 1],        // days between raids
  birthChance: [0.35, 0, 1],       // per couple per day, if fed and housed
  adultAge: [12, 1, 40, 1],        // days
  oldAge: [70, 20, 200, 1],        // days
  cropDays: [3, 1, 10, 1],         // days from seed to harvest
  foodPerDay: [1, 0, 3],           // per villager
  raiderHp: [30, 5, 100, 1],
  raiderDmg: [5, 1, 30, 1],
  soldierHp: [40, 5, 100, 1],
  soldierDmg: [8, 1, 30, 1],
});

export const COST = { house: 20, barracks: 30 } as const;
export const HOUSE_CAP = 4;
export const CROP_YIELD = 6;
export const TREE_YIELD = 8;
