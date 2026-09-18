import { params } from '@shared/index';

export const TILE = 16;
export const COLS = 240;
export const ROWS = 160;
export const ZOOM = 2; // 16 px tiles shown at 32 px

/** One run: survive escalating raids until the warlord arrives, then beat him. (`bossDay` is a slider: p.bossDay.) */
export const RUN = { raidEvery: 3, warnDays: 3 } as const;

/**
 * Every tuning knob, one live object: reading `p.x` sees the slider. The backtick panel groups them in folders.
 * Anything a playtest might want to bend lives here rather than in a constant.
 */
function live<T extends object[]>(...groups: T): UnionToIntersection<T[number]> {
  const out: Record<string, unknown> = {};
  for (const g of groups) for (const k of Object.keys(g)) Object.defineProperty(out, k, { enumerable: true, get: () => (g as Record<string, unknown>)[k], set: (v) => { (g as Record<string, unknown>)[k] = v; } });
  return out as UnionToIntersection<T[number]>;
}
type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void ? I : never;

export const p = live(
  params({
    dayLength: [120, 10, 300, 1],    // real seconds per day
    bossDay: [21, 5, 40, 1],         // the run's length: the Warlord comes on this day
    raidEvery: [RUN.raidEvery, 1, 20, 1],
    firstRaidDay: [3, 1, 10, 1],     // raids come on this day and every raidEvery after
    raidSizeMul: [1.75, 0.5, 4, 0.05], // every count in a raid's mix is scaled by this
    waveHpGrowth: [0.08, 0, 0.3, 0.01], // raider HP multiplier grows this much per wave
  }, 'pacing'),
  params({
    treeYield: [8, 1, 30, 1],        // wood a woodcutter gets from a young tree
    oldYield: [12, 1, 40, 1],        // ...and from old growth
    playerTreeYield: [2, 0, 12, 1],  // what the head's own axe brings in
    cutterWork: [2.5, 0.5, 8, 0.1],  // seconds per chop
    farmerWork: [1.2, 0.3, 5, 0.1],  // seconds per field action
    haulMul: [1, 0.25, 3, 0.25],     // villagers' armfuls (16 wood / 12 food) scale by this
    cropYield: [6, 1, 20, 1],        // food per harvested crop (boons add to it)
    cropDays: [2, 1, 10, 1],         // days from seed to harvest
    foodPerDay: [1, 0, 3],           // per villager
    startWood: [25, 0, 200, 1],
    startFood: [40, 0, 200, 1],
  }, 'economy'),
  params({
    hearthMul: [1, 0, 3, 0.25],      // scales every building's nightly wood
    hearthNights: [3, 1, 7, 1],      // nights a woodpile holds
    hearthStart: [1, 0, 3, 1],       // nights a new building comes with
  }, 'hearths'),
  params({
    birthChance: [0.5, 0, 1, 0.05],  // base: per couple per dawn, if fed, warm and housed
    feverDays: [5, 1, 15, 1],        // Baby Fever: days of food in store that count as a surplus
    feverBonus: [0.4, 0, 0.9, 0.05], // Baby Fever: birth chance added while the surplus holds
    adultAge: [8, 1, 40, 1],         // days
    oldAge: [70, 20, 200, 1],        // days
    cadetDays: [3, 1, 8, 1],         // drill days to come of age a soldier
    bedBonus: [0, -2, 6, 1],         // beds added to every house
    coldKidCare: [-1, -3, 0, 1],     // care a child loses after a cold night
    fleeRange: [120, 20, 300, 5],    // px: children run from raiders this close
  }, 'growth'),
  params({
    playerHp: [60, 10, 200, 5],
    playerDmg: [12, 1, 40, 1],       // per sword swing at ×1 weapon
    soldierHp: [60, 5, 100, 1],
    soldierDmg: [10, 1, 30, 1],
    weaponTier0Mul: [0.5, 0.1, 1, 0.05], // the club / hunting bow everyone starts with
    forgeCostMul: [1, 0, 3, 0.25],   // wood and scrap for armor and weapons
    wallHp: [400, 50, 1500, 10],
    gateHp: [240, 50, 1000, 10],
    wallRepair: [80, 10, 400, 10],   // HP one wood mends on a wall or gate
    buildingHpMul: [1, 0.25, 4, 0.25],
    towerRange: [150, 40, 320, 8],   // px; barracks arrow range at Lv1
    towerDmg: [5, 1, 30, 1],         // per arrow at Lv1; +TOWER.dmgPerLevel each barracks level
    towerCd: [1.4, 0.2, 5, 0.1],     // seconds between tower shots
    towerStart: [10, 0, 60, 1],      // arrows a fresh barracks comes with
    towerCap: [20, 5, 100, 1],       // arrows a Lv1 chest holds
  }, 'defenders'),
  params({
    raiderHp: [30, 5, 100, 1],
    raiderDmg: [5, 1, 30, 1],
    wreckerDmg: [15, 1, 60, 1],      // building damage per wrecker swing
    wreckerWallDmg: [6, 1, 30, 1],   // what it does to a wall instead
    bruteWallMul: [3, 1, 6, 0.5],    // a brute's wall damage as a multiple of its blow
  }, 'enemies'),
  params({
    fog: true,
    hearths: true,                   // off: nothing burns and nothing is ever cold
    towerFires: true,
    godMode: false,                  // the head cannot die
    freeBuild: false,                // building, upgrading, forging and fortifying cost nothing
  }, 'debug'),
);

// ---- barracks tower -------------------------------------------------------------------------
/** Every barracks fires arrows at raiders in range from its own chest of arrows; the chest is refilled with wood. */
export const TOWER = {
  /** the chest's size and starting stock are sliders: p.towerCap, p.towerStart */
  /** one restock: this much wood for this many arrows */
  restockWood: 2, restockArrows: 10,
  /** per barracks level above 1 */
  capPerLevel: 10, rangePerLevel: 16, dmgPerLevel: 1.5,
} as const;

export const COST = { house: 20, barracks: 30, tavern: 50 } as const;
export const DEFENSE_COST = { wall: 4, gate: 12, stairs: 10 } as const;
export const WALL_HEIGHT = 64;

// ---- trees, storage, upgrades --------------------------------------------------------------
/** days for a stump/sapling to become a tree */
export const SAPLING_DAYS = 4;
/** daily chance each tree seeds an adjacent grass tile */
/** a tree's daily chance to seed a neighbouring grass tile: base + per tree around it (8-neighbourhood, capped at 4) */
export const SEED_BASE = 0.01;
export const SEED_PER_NEIGHBOUR = 0.025;
/** a sapling with at least two tree neighbours grows this fast instead of SAPLING_DAYS */
export const SHELTERED_SAPLING_DAYS = 3;
/** days after which a tree is old growth: taller, and worth p.oldYield */
export const OLD_GROWTH_DAYS = 6;
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
  barracks: ['', 'sponsors 1 house · fires arrows at raiders', 'sponsors 2 houses · soldiers +15 HP · iron forge · tower +1.5 dmg', 'sponsors 3 houses · soldiers +30 HP · +20% dmg · regen · steel forge · tower +3 dmg'],
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
/** a child starts apprenticing this many days before coming of age, and needs p.cadetDays at it to come of age skilled */
export const CADET_AGE_BEFORE = 3;
/** care stars: +6% HP and work speed per star for life */
export const STAR_BONUS = 0.06;
/** a child on hearty rations eats this much a day (and is "well fed") */
export const HEARTY_RATION = 2;
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
/** barracks level needed to forge each tier (armor and weapons alike) */
export const ARMOR_BARRACKS_LEVEL = [0, 1, 2, 3] as const;

// ---- weapons --------------------------------------------------------------------------------
/** Everyone starts with a crude weapon (tier 0) and forges better ones at the barracks chest; tier 2 is the old baseline. */
export type WeaponSlot = 'melee' | 'bow';
export interface WeaponTier { name: string; wood: number; scrap: number; mul: number }
export const WEAPONS: Record<WeaponSlot, { name: string; tiers: readonly WeaponTier[] }> = {
  melee: { name: 'Blade', tiers: [
    { name: 'Wooden club', wood: 0, scrap: 0, mul: 0.5 },
    { name: 'Bronze sword', wood: 8, scrap: 0, mul: 0.75 },
    { name: 'Iron sword', wood: 10, scrap: 3, mul: 1 },
    { name: 'Steel sword', wood: 14, scrap: 8, mul: 1.3 },
  ] },
  bow: { name: 'Bow', tiers: [
    { name: 'Hunting bow', wood: 0, scrap: 0, mul: 0.5 },
    { name: 'Yew bow', wood: 8, scrap: 0, mul: 0.75 },
    { name: 'Composite bow', wood: 10, scrap: 3, mul: 1 },
    { name: 'War bow', wood: 14, scrap: 8, mul: 1.3 },
  ] },
};
export const WEAPON_SLOTS: readonly WeaponSlot[] = ['melee', 'bow'];


// ---- hearths --------------------------------------------------------------------------------
/** Wood a building's hearth burns each night, by level (index = level); 0 means it has no hearth. Woodcutters keep the piles stocked. */
export const HEARTH_WOOD: Record<'house' | 'barracks' | 'granary' | 'woodyard' | 'tavern' | 'lair', readonly [number, number, number, number]> = {
  house: [0, 2, 2, 3],
  barracks: [0, 3, 3, 4],
  tavern: [0, 3, 3, 4],
  granary: [0, 0, 0, 0],
  woodyard: [0, 0, 0, 0],
  lair: [0, 0, 0, 0],
};
/** scrap iron looted from slain raiders */
export const SCRAP_DROP = { raider: 2, brute: 4, warlord: 10, snatcher: 1, shaman: 2, rat: 0, ogre: 30, wrecker: 3 } as const;

// ---- building damage ------------------------------------------------------------------------
/** Hit points per building level (index = level). Every kind must appear here, so new buildings are destructible by default; 0 means it can't be hurt (the Ogre's lair). */
export const BUILDING_HP: Record<'house' | 'barracks' | 'granary' | 'woodyard' | 'tavern' | 'lair', readonly [number, number, number, number]> = {
  house: [0, 240, 360, 480],
  tavern: [0, 300, 420, 540],
  granary: [0, 300, 420, 540],
  woodyard: [0, 300, 420, 540],
  barracks: [0, 400, 560, 720],
  lair: [0, 0, 0, 0],
};
/** hammer on a damaged building: HP per wood; rebuilding a ruin costs this share of the build cost (buildings without a shop price use `rebuildDefault`) */
export const REPAIR = { perWood: 60, rebuildFraction: 0.5, rebuildDefault: 15 } as const;

// ---- the Wrecker ----------------------------------------------------------------------------
/** A raider that ignores people and tears down buildings, houses first. Walled off, it batters walls slowly. */
export const WRECKER = {
  hp: 45, dmg: 5, wallDmg: 6, speed: 42,
  /** seconds per swing at a building, and how close to its footprint it stands */
  swing: 1.0, reach: 14,
  /** seconds without anything reachable before it gives up and leaves */
  patience: 15,
} as const;
/** cloth dyes for soldiers' tabards, and plume colours */
export const DYES = ['#3f6fd1', '#c23b3b', '#2f7d4e', '#e0b04a', '#8c4ab0', '#e8e0d0', '#2a2a2e', '#d8722c'] as const;
export const DYE_NAMES = ['blue', 'red', 'green', 'gold', 'purple', 'white', 'black', 'orange'] as const;
export const PLUMES = ['none', '#c23b3b', '#e8e0d0', '#3f6fd1', '#e0b04a'] as const;
