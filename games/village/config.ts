import { params } from '@shared/index';

export const TILE = 16;
export const COLS = 240;
export const ROWS = 160;
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
  towerRange: [150, 40, 320, 8],   // px; barracks arrow range at Lv1
  towerDmg: [8, 1, 30, 1],
  towerCd: [1.4, 0.2, 5, 0.1],     // seconds between tower shots
});

// ---- barracks tower -------------------------------------------------------------------------
/** Every barracks fires arrows at raiders in range from its own chest of arrows; the chest is refilled with wood. */
export const TOWER = {
  /** arrows a Lv1 chest holds, and what a fresh barracks starts with */
  cap: 20, start: 10,
  /** one restock: this much wood for this many arrows */
  restockWood: 2, restockArrows: 10,
  /** per barracks level above 1 */
  capPerLevel: 10, rangePerLevel: 16,
} as const;

export const COST = { house: 20, barracks: 30, tavern: 50 } as const;
export const DEFENSE_COST = { wall: 4, gate: 12, stairs: 10 } as const;
export const WALL_HEIGHT = 64;
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
export const UPGRADE_COST: Record<'house' | 'barracks' | 'granary' | 'woodyard' | 'tavern' | 'lair', readonly number[]> = {
  lair: [0, 0, 0],
  tavern: [0, 40, 80],
  house: [0, 30, 60], barracks: [0, 40, 80], granary: [0, 30, 60], woodyard: [0, 30, 60],
};
/** what each level of a building gives, in a few words (index = level); shown in tooltips, hints and help */
export const LEVEL_PERKS: Record<'house' | 'barracks' | 'granary' | 'woodyard' | 'tavern' | 'lair', readonly [string, string, string, string]> = {
  lair: ['', 'the Ogre sleeps here by day', '', ''],
  tavern: ['', 'hearth meals restore 20 HP', 'hearth meals restore 35 HP', 'hearth meals restore 50 HP · family hall'],
  house: ['', '4 beds', '6 beds', '8 beds · births +15%'],
  barracks: ['', 'sponsors 1 house · fires arrows at raiders', 'sponsors 2 houses · soldiers +15 HP', 'sponsors 3 houses · soldiers +30 HP · +20% dmg · regen'],
  granary: ['', 'holds 150 food', 'holds 300 food', 'holds 600 food'],
  woodyard: ['', 'holds 150 wood', 'holds 300 wood', 'holds 600 wood'],
};
/** what changes on the building itself at each level, for the help screen */
export const LEVEL_LOOKS: Record<'house' | 'barracks' | 'granary' | 'woodyard' | 'tavern' | 'lair', readonly [string, string, string, string]> = {
  lair: ['', 'a cave mouth, bones, a fire', '', ''],
  tavern: ['', 'green roof, hanging mug sign', 'flower boxes and second chimney', 'guest loft and lanterns'],
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

// ---- hauling --------------------------------------------------------------------------------
/** How much wood or food one pair of arms carries before a trip to the woodyard / granary. */
export const HAUL = { villager: { wood: 16, food: 12 }, player: { wood: 24, food: 18 } } as const;
export type LoadKind = 'wood' | 'food';

// ---- the Ogre -------------------------------------------------------------------------------
/** The first boss: a giant who sleeps in his lair by day and prowls around it at night. */
export const OGRE = {
  hp: 600, dmg: 25, speed: 34, reach: 30, windup: 0.6, recover: 1.1,
  /** how far from the lair he wanders, and how close you must come for him to hunt you */
  roam: 22, hunt: 14,
  /** fraction of max HP healed each day he sleeps */
  regen: 0.25,
  scrap: 30, renown: 300,
  /** tiles from the lair within which the eerie wind blows (it strengthens as you close in) */
  windRadius: 30,
  /** sprite scale: he's drawn at 48x64 already, so this is on top of that (a person is 16x20) */
  scale: 1.25,
} as const;

// ---- armor ----------------------------------------------------------------------------------
export type ArmorSlot = 'helmet' | 'chest' | 'legs' | 'shield';
export interface ArmorTier { name: string; wood: number; scrap: number; hp: number; reduce: number; speed: number; block: number }
/** Four slots, three tiers (leather / iron / steel). Index 0 is "nothing". Iron needs barracks Lv2, steel Lv3. */
export const ARMOR: Record<ArmorSlot, { name: string; tiers: readonly ArmorTier[] }> = {
  helmet: { name: 'Helmet', tiers: [
    { name: '—', wood: 0, scrap: 0, hp: 0, reduce: 0, speed: 0, block: 0 },
    { name: 'Leather cap', wood: 8, scrap: 0, hp: 5, reduce: 0, speed: 0, block: 0 },
    { name: 'Iron helm', wood: 10, scrap: 3, hp: 10, reduce: 0, speed: 0, block: 0 },
    { name: 'Steel helm', wood: 14, scrap: 8, hp: 15, reduce: 0, speed: 0, block: 0 },
  ] },
  chest: { name: 'Chest', tiers: [
    { name: '—', wood: 0, scrap: 0, hp: 0, reduce: 0, speed: 0, block: 0 },
    { name: 'Leather jerkin', wood: 8, scrap: 0, hp: 0, reduce: 0.08, speed: 0, block: 0 },
    { name: 'Iron mail', wood: 10, scrap: 3, hp: 0, reduce: 0.16, speed: 0, block: 0 },
    { name: 'Steel plate', wood: 14, scrap: 8, hp: 0, reduce: 0.24, speed: 0, block: 0 },
  ] },
  legs: { name: 'Legs', tiers: [
    { name: '—', wood: 0, scrap: 0, hp: 0, reduce: 0, speed: 0, block: 0 },
    { name: 'Leather boots', wood: 8, scrap: 0, hp: 0, reduce: 0, speed: 0.04, block: 0 },
    { name: 'Iron greaves', wood: 10, scrap: 3, hp: 0, reduce: 0, speed: 0.08, block: 0 },
    { name: 'Steel greaves', wood: 14, scrap: 8, hp: 5, reduce: 0, speed: 0.12, block: 0 },
  ] },
  shield: { name: 'Shield', tiers: [
    { name: '—', wood: 0, scrap: 0, hp: 0, reduce: 0, speed: 0, block: 0 },
    { name: 'Wooden buckler', wood: 10, scrap: 0, hp: 0, reduce: 0, speed: 0, block: 0.15 },
    { name: 'Iron-rimmed shield', wood: 12, scrap: 3, hp: 0, reduce: 0, speed: 0, block: 0.25 },
    { name: 'Steel kite shield', wood: 16, scrap: 8, hp: 0, reduce: 0, speed: 0, block: 0.35 },
  ] },
};
export const ARMOR_SLOTS: readonly ArmorSlot[] = ['helmet', 'chest', 'legs', 'shield'];
/** barracks level needed to forge each tier */
export const ARMOR_BARRACKS_LEVEL = [0, 1, 2, 3] as const;
/** scrap iron looted from slain raiders */
export const SCRAP_DROP = { raider: 2, brute: 4, warlord: 10, snatcher: 1, shaman: 2, rat: 0, ogre: 30 } as const;
/** cloth dyes for soldiers' tabards, and plume colours */
export const DYES = ['#3f6fd1', '#c23b3b', '#2f7d4e', '#e0b04a', '#8c4ab0', '#e8e0d0', '#2a2a2e', '#d8722c'] as const;
export const DYE_NAMES = ['blue', 'red', 'green', 'gold', 'purple', 'white', 'black', 'orange'] as const;
export const PLUMES = ['none', '#c23b3b', '#e8e0d0', '#3f6fd1', '#e0b04a'] as const;
