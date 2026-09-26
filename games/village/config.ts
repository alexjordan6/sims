import { params } from '@shared/index';
import D from './defaults.json';

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
    cameraZoom: [D.cameraZoom, 0.5, 4, 0.25, 'Camera closeness multiplier: 1 is the original view, 2 is twice as close. Applies immediately; Z cycles zoom presets.'],
  }, 'camera'),
  params({
    dayLength: [D.dayLength, 10, 300, 1, 'Real seconds per in-game day. Shorter days = faster raids, less time to gather.'],
    bossDay: [D.bossDay, 5, 40, 1, 'The run\'s length: the Warlord arrives on this day. Beat him to win.'],
    raidEvery: [D.raidEvery, 1, 20, 1, 'Days between raids after the first (Long Peace adds one).'],
    firstRaidDay: [D.firstRaidDay, 1, 10, 1, 'The first raid comes on this day; the wave count starts from it.'],
    raidSizeMul: [D.raidSizeMul, 0.5, 4, 0.05, 'Every count in a raid\'s mix is multiplied by this. Enemy stats are untouched.'],
    waveHpGrowth: [D.waveHpGrowth, 0, 0.3, 0.01, 'Raider HP multiplier grows this much per wave (0.08 = +8% each raid).'],
  }, 'pacing'),
  params({
    treeYield: [D.treeYield, 1, 30, 1, 'Wood a woodcutter gets from a young tree.'],
    oldYield: [D.oldYield, 1, 40, 1, 'Wood a woodcutter gets from old growth (trees older than 6 days).'],
    playerTreeYield: [D.playerTreeYield, 0, 12, 1, 'What the head\'s own axe brings in per tree. 0 = the axe only clears ground.'],
    cutterWork: [D.cutterWork, 0.5, 8, 0.1, 'Seconds a woodcutter spends per chop.'],
    farmerWork: [D.farmerWork, 0.3, 5, 0.1, 'Seconds a farmer spends per field action (till, plant, harvest).'],
    forageWork: [D.forageWork, 0.3, 8, 0.1, 'Seconds a gnome spends picking one unit from a wild plant.'],
    grassSlow: [D.grassSlow, 0.1, 1, 0.05, 'Speed multiplier for anyone wading through long grass — the head, villagers and raiders alike (1 = no slowdown). The sword mows it; it never grows back.'],
    haulMul: [D.haulMul, 0.25, 3, 0.25, 'Villagers\' armfuls (16 wood / 12 food) scale by this. Bigger arms = fewer trips.'],
    cropYield: [D.cropYield, 1, 20, 1, 'Food per harvested crop before boons. Applies at NEW VILLAGE.'],
    cropDays: [D.cropDays, 1, 10, 1, 'Days from seed to harvest.'],
    foodPerDay: [D.foodPerDay, 0, 3, 'Ration each grown villager eats at dawn (children eat only what lands in their pen).'],
    hungerMax: [D.hungerMax, 1, 30, 1, 'Food units the head\'s belly holds. It empties as the day passes; empty, you lose HP.'],
    hungerPerDay: [D.hungerPerDay, 0, 12, 0.5, 'Food units the head burns a day (a grown villager eats foodPerDay). 0 = the belly never empties.'],
    hungerMeal: [D.hungerMeal, 1, 10, 1, 'Food units one press of T eats. Meat and honey fill twice as much per unit, a cooked dish three or four times.'],
    packSlots: [D.packSlots, 5, 36, 1, 'Player pack slots; applies at NEW VILLAGE.'],
    pickupRange: [D.pickupRange, 1, 8, 0.25, 'Loose-item pickup attraction radius, in tiles.'],
    pickupPull: [D.pickupPull, 10, 240, 5, 'Resting items move toward the player this many pixels per second.'],
    startWood: [D.startWood, 0, 200, 1, 'Wood in the woodyard at NEW VILLAGE.'],
    startFood: [D.startFood, 0, 200, 1, 'Food in the granary at NEW VILLAGE.'],
  }, 'economy'),
  params({
    hearthMul: [D.hearthMul, 0, 3, 0.25, 'Scales every building\'s nightly wood (house 2, barracks/tavern 3 at ×1). 0 = warmth is free.'],
    hearthNights: [D.hearthNights, 1, 7, 1, 'Nights of firewood a woodpile can hold. Smaller piles mean more cutter trips.'],
    hearthStart: [D.hearthStart, 0, 3, 1, 'Nights of wood a newly built building comes with.'],
  }, 'hearths'),
  params({
    birthChance: [D.birthChance, 0, 1, 0.05, 'Base birth rate: chance per birth roll (every birthEvery seconds) for a couple in a warm house with a free crib and food to spare.'],
    feverDays: [D.feverDays, 1, 15, 1, 'Baby Fever: days of food in store (at today\'s rations) that count as a surplus.'],
    feverBonus: [D.feverBonus, 0, 0.9, 0.05, 'Baby Fever: birth chance added while the surplus holds.'],
    cadetDays: [D.cadetDays, 0.5, 8, 0.5, 'Days in the pen, fed, a child needs to come of age skilled (a drill-yard child needs them to be a soldier at all). Must fit inside childDays.'],
    bedBonus: [D.bedBonus, -2, 6, 1, 'Beds added to every house on top of its level (4 / 6 / 8). Beds no longer gate births — cribs do.'],
    coldKidCare: [D.coldKidCare, -3, 0, 1, 'Care points a child loses after a night in a cold house.'],
    fleeRange: [D.fleeRange, 20, 300, 5, 'Pixels: children run for the nearest door when a raider is this close.'],
  }, 'growth'),
  params({
    infantDays: [D.infantDays, 0.1, 10, 0.1, 'Days an infant spends in the nursery before walking out to a pen. A house births at most cribs / infantDays children a day.'],
    childDays: [D.childDays, 0.25, 20, 0.25, 'Days from leaving the nursery to coming of age (Quick to Grow takes 2 off). Give them at least cadetDays in the pen, or nobody comes of age skilled — or a soldier.'],
    adultDays: [D.adultDays, 1, 100, 1, 'Days of adulthood before a villager grows old.'],
    elderDays: [D.elderDays, 0.5, 30, 0.5, 'Days an elder lives on (slower, grey) before passing away.'],
    birthEvery: [D.birthEvery, 1, 120, 1, 'Real seconds between birth rolls in each house (needs a couple, a warm hearth, a free crib and food to spare; birthChance decides the roll).'],
    cribs: [D.cribs, 1, 12, 1, 'Cribs in a Lv1 house nursery (+1 per level). A full nursery stalls births there.'],
    kidFood: [D.kidFood, 0, 4, 0.25, 'Food a pen child eats per day (two half-meals) from the pile the head tosses in. Unfed: no training, then starvation. 0 = pens feed themselves.'],
    kidStarveDays: [D.kidStarveDays, 1, 10, 1, 'Hungry days a child survives. Children eat nothing but what lands in a pen.'],
    tossSize: [D.tossSize, 1, 12, 1, 'Food landing on the pen per throw from the basket.'],
    tossRange: [D.tossRange, 2, 12, 1, 'Tiles the head can lob a handful of food. It lands near the cursor, bounces and rolls; walls and trees stop it.'],
    itemBounce: [D.itemBounce, 0, 0.9, 0.05, 'How much of its fall a thrown item bounces back up. 0 = it sticks where it lands.'],
    itemFriction: [D.itemFriction, 1, 20, 0.5, 'How fast a rolling item slows on the ground (higher = shorter rolls).'],
    penPace: [D.penPace, 0.5, 2, 0.05, 'How fast children run about the pen, as a multiple of their walking speed.'],
    dietFull: [D.dietFull, 1, 30, 1, 'Units of one food a child must eat for its full stat bonus (about three days of a single crop).'],
    dietMul: [D.dietMul, 0, 3, 0.25, 'Scales every diet bonus (wheat +25% HP, carrots +15% speed, tomatoes +25% work, berries +25% damage at ×1).'],
    wildRegrowMul: [D.wildRegrowMul, 0.25, 4, 0.25, 'Scales how long picked bushes and mushrooms take to regrow (3 / 4 days at ×1).'],
    wildSprout: [D.wildSprout, 0, 0.1, 0.005, 'Daily chance each old-growth tree sprouts a berry bush or mushrooms on a grass tile beside it.'],
  }, 'lifecycle'),
  params({
    playerHp: [D.playerHp, 10, 200, 5, 'The head\'s base HP before armor and boons. Applies at NEW VILLAGE or the next armor change.'],
    starveHpPerDay: [D.starveHpPerDay, 0, 200, 5, 'HP the head loses over a full day on an empty belly (60 = a whole bar a day). A starving head does not mend overnight and does not regenerate. 0 = the belly empties but never hurts.'],
    playerDmg: [D.playerDmg, 1, 40, 1, 'The head\'s sword damage at a ×1 weapon (the starting club is ×weaponTier0Mul).'],
    rollDist: [D.rollDist, 8, 80, 1, 'Pixels the head covers in one dodge roll (two tiles is 32). The roll goes through bodies but not walls.'],
    rollTime: [D.rollTime, 0.1, 0.8, 0.02, 'Seconds the roll takes. Shorter = snappier, and a smaller window to be caught in.'],
    rollCd: [D.rollCd, 0, 4, 0.05, 'Seconds after a roll ends before another can start.'],
    soldierHp: [D.soldierHp, 5, 100, 1, 'Soldiers\' base HP before barracks level, stars and armor.'],
    soldierDmg: [D.soldierDmg, 1, 30, 1, 'Soldiers\' base damage at a ×1 weapon.'],
    gnomeHp: [D.gnomeHp, 5, 100, 1, 'Grown gnomes\' base HP before stars and diet. Applies to gnomes coming of age.'],
    gnomeSpeed: [D.gnomeSpeed, 10, 80, 1, 'Walking speed of a grown gnome (soldiers move at 45).'],
    weaponTier0Mul: [D.weaponTier0Mul, 0.1, 1, 0.05, 'Damage multiplier of the club and hunting bow everyone starts with. 1 = no weapon progression.'],
    forgeCostMul: [D.forgeCostMul, 0, 3, 0.25, 'Wood and scrap for forging armor and weapons scale by this.'],
    wallHp: [D.wallHp, 50, 1500, 10, 'HP of a new wall segment.'],
    gateHp: [D.gateHp, 50, 1000, 10, 'HP of a new gate.'],
    wallRepair: [D.wallRepair, 10, 400, 10, 'HP one wood mends on a wall or gate with the hammer.'],
    buildingHpMul: [D.buildingHpMul, 0.25, 4, 0.25, 'Scales every building\'s HP (house 240, barracks 400 at ×1). Applies to new buildings and upgrades.'],
    towerRange: [D.towerRange, 40, 320, 8, 'Pixels: how far a Lv1 barracks tower shoots (+16 per level).'],
    towerDmg: [D.towerDmg, 1, 30, 1, 'Damage per tower arrow at Lv1 (+1.5 per barracks level).'],
    towerCd: [D.towerCd, 0.2, 5, 0.1, 'Seconds between tower shots.'],
    towerStart: [D.towerStart, 0, 60, 1, 'Arrows a freshly built barracks comes with.'],
    towerCap: [D.towerCap, 5, 100, 1, 'Arrows a Lv1 chest holds (+10 per level).'],
  }, 'defenders'),
  params({
    raiderHp: [D.raiderHp, 5, 100, 1, 'Base HP of a plain raider before wave growth.'],
    raiderDmg: [D.raiderDmg, 1, 30, 1, 'Damage per blow from a plain raider.'],
    wreckerDmg: [D.wreckerDmg, 1, 60, 1, 'Building damage per wrecker swing (a Lv1 house is 240 HP).'],
    wreckerWallDmg: [D.wreckerWallDmg, 1, 30, 1, 'What a wrecker does to a wall segment per swing when walled off.'],
    bruteWallMul: [D.bruteWallMul, 1, 6, 0.5, 'A brute\'s wall damage as a multiple of its 24-damage blow.'],
    boarBreed: [D.boarBreed, 0, 1, 0.05, 'Daily chance a sounder of two or more boars gains a young one (up to 5 a sounder). Wipe a sounder out and it is gone.'],
    boarDmg: [D.boarDmg, 1, 30, 1, 'Damage per blow from a provoked boar. Boars never raid; they charge whoever strikes them.'],
    trolls: [D.trolls, 0, 400, 5, 'Trolls scattered over the map at NEW VILLAGE. Solitary, hostile on sight and never leashed — a chase can carry one into the village. The count is the difficulty dial, not their stats.'],
    trollDmg: [D.trollDmg, 1, 30, 1, 'Damage per blow from a troll.'],
    hives: [D.hives, 0, 200, 5, 'Beehives hanging in old-growth trees at NEW VILLAGE. Walk inside a perimeter and the swarm comes out; chop the tree for the honey.'],
    beeDmg: [D.beeDmg, 1, 15, 1, 'Damage a swarm does per sting. It stings often, so small numbers add up fast.'],
    skulks: [D.skulks, 0, 200, 5, 'Most skulks abroad at once. They creep out of long grass all run long and go for gnomes first — mow the grass to starve them out.'],
    skulkTiles: [D.skulkTiles, 5, 400, 5, 'Tiles of long grass that sustain one skulk. Fewer tiles standing means a lower ceiling, so mowing is the real answer.'],
    skulkEvery: [D.skulkEvery, 0.5, 60, 0.5, 'Seconds between one skulk creeping out, while the ceiling allows it.'],
    skulkDmg: [D.skulkDmg, 1, 20, 1, 'Damage per blow from a skulk.'],
    skulkClub: [D.skulkClub, 0, 1, 0.05, 'Chance a slain skulk leaves its club rather than a single scrap. Clubs break down for wood at a barracks chest.'],
  }, 'enemies'),
  params({
    fog: [D.fog, 'Fog of war. Off lifts it everywhere; on drops it back over the unexplored.'],
    hearths: [D.hearths, 'Off: hearths burn nothing and no building is ever cold.'],
    towerFires: [D.towerFires, 'Off: barracks towers hold their fire.'],
    godMode: [D.godMode, 'The head cannot die (revives at full HP).'],
    freeBuild: [D.freeBuild, 'Building, upgrading, fortifying, forging and hearth stocking cost nothing.'],
    collide: [D.collide, 'Bodies push each other apart. Off: everyone walks through everyone, as before.'],
    gnomeStart: [D.gnomeStart, 'NEW VILLAGE starts you as a gnome family: no house, barracks or field — a toadstool cottage in the clearing, its founders, and the craft already learned. Also ?start=gnome.'],
    hunger: [D.hunger, 'The head gets hungry and starves. Off: the belly stays full, nothing drains and T does nothing. Also ?nohunger.'],
    peaceful: [D.peaceful, 'No raid schedule and no Warlord; the day you would have faced him you win instead. Boars and the Ogre still roam, and the SPAWN RAID button still works. Also ?peaceful.'],
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

/** Every kind of building on the map (world.ts re-exports this; the per-kind tables below key on it so a new kind can't be forgotten). */
export type BuildingKind = 'house' | 'barracks' | 'granary' | 'woodyard' | 'tavern' | 'lair' | 'gnomehouse';
/** The shaman wand's orders, in tiles: how far a holding squad engages from its spot, how close followers keep to the head, and the ring a squad spreads over when sent somewhere. */
export const ORDER = { leash: 5, followGap: 2.5, spread: 1 } as const;
export const COST = { house: 20, barracks: 30, tavern: 50, gnomehouse: 25 } as const;
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
export const UPGRADE_COST: Record<BuildingKind, readonly number[]> = {
  lair: [0, 0, 0],
  gnomehouse: [0, 20, 40],
  tavern: [0, 40, 80],
  house: [0, 30, 60], barracks: [0, 40, 80], granary: [0, 30, 60], woodyard: [0, 30, 60],
};
/** what each level of a building gives, in a few words (index = level); shown in tooltips, hints and help */
export const LEVEL_PERKS: Record<BuildingKind, readonly [string, string, string, string]> = {
  lair: ['', 'the Ogre sleeps here by day', '', ''],
  gnomehouse: ['', '3 beds · a cooking pot by the hearth', '4 beds', '6 beds'],
  tavern: ['', 'hearth meals restore 20 HP', 'hearth meals restore 35 HP', 'hearth meals restore 50 HP · family hall'],
  house: ['', '4 beds', '6 beds', '8 beds · births +15%'],
  barracks: ['', 'fires arrows at raiders · drills the drill yard', 'soldiers +15 HP · iron forge · tower +1.5 dmg', 'soldiers +30 HP · +20% dmg · regen · steel forge · tower +3 dmg'],
  granary: ['', 'holds 150 food', 'holds 300 food', 'holds 600 food'],
  woodyard: ['', 'holds 150 wood', 'holds 300 wood', 'holds 600 wood'],
};
/** what changes on the building itself at each level, for the help screen */
export const LEVEL_LOOKS: Record<BuildingKind, readonly [string, string, string, string]> = {
  lair: ['', 'a cave mouth, bones, a fire', '', ''],
  gnomehouse: ['', 'a toadstool cottage', 'a lantern and a second cap', 'a chimney and a fairy ring'],
  tavern: ['', 'green roof, hanging mug sign', 'flower boxes and second chimney', 'guest loft and lanterns'],
  house: ['', 'cottage', 'chimney, flower boxes, porch', 'second storey'],
  barracks: ['', 'stone keep', 'shields and stakes', 'tower and torches'],
  granary: ['', 'barn', 'open hay loft', 'silo'],
  woodyard: ['', 'cabin', 'chimney', 'lantern and loft window'],
};
// ---- children ------------------------------------------------------------------------------
/** a pen child trains every fed day and needs p.cadetDays of it to come of age skilled */
/** care stars: +6% HP and work speed per star for life */
export const STAR_BONUS = 0.06;
/** children are asleep indoors between these times of day */
export const BEDTIME = { start: 0.8, end: 0.28 } as const;
export type Calling = 'farmer' | 'woodcutter' | 'soldier';
export const CALLING_NAME: Record<Calling, string> = { farmer: 'farmers', woodcutter: 'woodcutters', soldier: 'soldiers' };
export const CALLINGS: readonly Calling[] = ['farmer', 'woodcutter', 'soldier'];
/** painted training pens, one kind per calling: children live and train there until they come of age */
export const PEN_NAME: Record<Calling, string> = { farmer: 'training field', woodcutter: 'wood lot', soldier: 'drill yard' };
export const PEN_COLOUR: Record<Calling, number> = { farmer: 0x6fd36f, woodcutter: 0xd6a35c, soldier: 0x6f9bff };
/** elders work and walk at this share of their adult pace */
export const ELDER_MUL = 0.75;
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
/** beds in a gnome house by level; a gnome family breeds like a human one (cribs are p.cribs + level - 1) */
export const GNOME_BEDS = [0, 3, 4, 6] as const;
/** tiles from a gnome house's centre that count as its yard: food lying there feeds its children */
export const GNOME_YARD = 4;

// ---- food and diet --------------------------------------------------------------------------
/** What the gnomes' pot makes out of raw food: dishes are food like any other, only richer (see RECIPES and Food.power). */
export type DishKind = 'stew' | 'roast' | 'tart' | 'soup' | 'cake';
export const DISHES: readonly DishKind[] = ['stew', 'roast', 'tart', 'soup', 'cake'];
/** Every kind of food. Crops are sown on soil; wild food grows in the woods and is picked by hand; dishes are cooked. What a child eats decides the adult. */
export type FoodKind = 'wheat' | 'carrot' | 'tomato' | 'berry' | 'mushroom' | 'hazelnut' | 'garlic' | 'burdock' | 'meat' | 'honey' | DishKind;
export const RAW_KINDS: readonly FoodKind[] = ['wheat', 'carrot', 'tomato', 'berry', 'mushroom', 'hazelnut', 'garlic', 'burdock', 'meat', 'honey'];
export const FOOD_KINDS: readonly FoodKind[] = [...RAW_KINDS, ...DISHES];
export const CROP_KINDS: readonly FoodKind[] = ['wheat', 'carrot', 'tomato'];
export type DietStat = 'hp' | 'speed' | 'work' | 'dmg' | 'care';
export interface Food {
  name: string; one: string;
  /** plural of `one`, when it isn't just `one` + s ('berries', 'bowls of stew', and the mass nouns that never take one) */
  many?: string;
  source: 'crop' | 'wild' | 'hunt' | 'hive' | 'cooked';
  /** crops: days to ripen on top of p.cropDays; wild: days to regrow after picking (× p.wildRegrowMul) */
  days: number;
  /** crops: yield on top of the cropYield slider; wild: what one picking gives */
  yield: number;
  stat: DietStat;
  /** how much of the stat's DIET_CAP a full diet of this gives (1 unless set; meat gives double) */
  power?: number;
  blurb: string;
  /** pile / label colour */
  colour: string;
}
export const FOODS: Record<FoodKind, Food> = {
  wheat: { name: 'Wheat', one: 'wheat', many: 'wheat', source: 'crop', days: 0, yield: 0, stat: 'hp', blurb: 'hearty: +HP for life', colour: '#e0b04a' },
  carrot: { name: 'Carrots', one: 'carrot', source: 'crop', days: 0, yield: -1, stat: 'speed', blurb: 'quick on their feet', colour: '#e8772c' },
  tomato: { name: 'Tomatoes', one: 'tomato', many: 'tomatoes', source: 'crop', days: 1, yield: 1, stat: 'work', blurb: 'tireless workers', colour: '#c9564a' },
  berry: { name: 'Berries', one: 'berry', many: 'berries', source: 'wild', days: 3, yield: 3, stat: 'dmg', blurb: 'fierce: soldiers hit harder', colour: '#8c4ab0' },
  mushroom: { name: 'Mushrooms', one: 'mushroom', source: 'wild', days: 4, yield: 2, stat: 'care', blurb: 'a care point with every meal', colour: '#a8765a' },
  // what the gnomes forage: hazel at the wood's edge, garlic in the meadow, burdock along the trails
  hazelnut: { name: 'Hazelnuts', one: 'hazelnut', source: 'wild', days: 5, yield: 3, stat: 'hp', blurb: 'hearty: +HP for life', colour: '#8a5a2a' },
  garlic: { name: 'Wild garlic', one: 'garlic', many: 'garlic', source: 'wild', days: 3, yield: 2, stat: 'work', blurb: 'tireless workers', colour: '#e8e0d0' },
  burdock: { name: 'Burdock', one: 'burdock root', many: 'burdock roots', source: 'wild', days: 4, yield: 2, stat: 'speed', blurb: 'quick on their feet', colour: '#7a5230' },
  // hunted: a boar drops it where it falls (see BOAR.meat); gnomes carry it home
  meat: { name: 'Boar meat', one: 'meat', many: 'meat', source: 'hunt', days: 0, yield: 0, stat: 'dmg', power: 2, blurb: 'a hunter\'s diet: the fiercest fighters', colour: '#c9564a' },
  // robbed from a hive in the canopy, stings and all
  honey: { name: 'Honey', one: 'comb of honey', many: 'combs of honey', source: 'hive', days: 0, yield: 0, stat: 'hp', power: 2, blurb: 'rich: hearty for life', colour: '#e8a52c' },
  // cooked at a gnome cottage's pot: worth three raw meals to a growing child, and a warm buff to the head
  stew: { name: 'Mushroom stew', one: 'bowl of stew', many: 'bowls of stew', source: 'cooked', days: 0, yield: 0, stat: 'work', power: 3, blurb: 'cooked: tireless workers', colour: '#a8765a' },
  roast: { name: 'Boar roast', one: 'roast', source: 'cooked', days: 0, yield: 0, stat: 'dmg', power: 3, blurb: 'cooked: the fiercest fighters', colour: '#b8463c' },
  tart: { name: 'Berry tart', one: 'tart', source: 'cooked', days: 0, yield: 0, stat: 'hp', power: 3, blurb: 'cooked: hearty for life', colour: '#8c4ab0' },
  soup: { name: 'Garden soup', one: 'bowl of soup', many: 'bowls of soup', source: 'cooked', days: 0, yield: 0, stat: 'speed', power: 3, blurb: 'cooked: quick on their feet', colour: '#e8772c' },
  cake: { name: 'Honey cake', one: 'cake', source: 'cooked', days: 0, yield: 0, stat: 'hp', power: 4, blurb: 'cooked: the heartiest there is', colour: '#e8a52c' },
};
/** Cooked, rather than sown or foraged: dishes never appear on a tile and can't be planted or picked. */
/** `n` of a food, in words: 1 carrot, 3 carrots, 2 bowls of stew. */
export function foodCount(n: number, k: FoodKind): string {
  const f = FOODS[k];
  return `${n % 1 ? n.toFixed(1) : n} ${n === 1 ? f.one : f.many ?? `${f.one}s`}`;
}
export function isDish(k: FoodKind): boolean { return FOODS[k].source === 'cooked'; }
/** An empty tally of every food kind (the granary's bins, a child's diet): one place to add a kind. */
export function zeroFood(): Record<FoodKind, number> {
  return Object.fromEntries(FOOD_KINDS.map((k) => [k, 0])) as Record<FoodKind, number>;
}
/** the most a full diet of one kind adds to its stat (× p.dietMul) */
export const DIET_CAP: Record<Exclude<DietStat, 'care'>, number> = { hp: 0.25, speed: 0.15, work: 0.25, dmg: 0.25 };
export const DIET_STAT_NAME: Record<DietStat, string> = { hp: 'HP', speed: 'speed', work: 'work speed', dmg: 'damage', care: 'care' };

// ---- the cooking pot -------------------------------------------------------------------------
/**
 * One dish the gnomes' pot can make: what it costs from the granary, how many servings it yields, and
 * what one serving does for the head who eats it (children just get the diet, like any food).
 */
export interface Recipe {
  dish: DishKind;
  /** raw kinds spent per batch */
  needs: Partial<Record<FoodKind, number>>;
  /** servings a batch makes */
  makes: number;
  /** HP one serving restores */
  heal: number;
  /** one serving raises the dish's stat by this share, for this many seconds of sim time */
  buffAdd: number;
  buffSecs: number;
}
export const RECIPES: Record<DishKind, Recipe> = {
  stew: { dish: 'stew', needs: { mushroom: 2, burdock: 1 }, makes: 3, heal: 25, buffAdd: 0.35, buffSecs: 90 },
  roast: { dish: 'roast', needs: { meat: 2, garlic: 1 }, makes: 3, heal: 30, buffAdd: 0.35, buffSecs: 90 },
  tart: { dish: 'tart', needs: { berry: 3, wheat: 1 }, makes: 3, heal: 35, buffAdd: 0.25, buffSecs: 120 },
  soup: { dish: 'soup', needs: { carrot: 2, tomato: 1 }, makes: 3, heal: 20, buffAdd: 0.35, buffSecs: 90 },
  cake: { dish: 'cake', needs: { honey: 2, wheat: 1 }, makes: 3, heal: 45, buffAdd: 0.3, buffSecs: 150 },
};

/** How a run begins: the founding family in their house, or a gnome family in their cottage (p.gnomeStart / ?start=gnome). */
export type StartKind = 'village' | 'gnome';

// ---- walkable interiors ----------------------------------------------------------------------
/** Buildings you can push the door open and walk into. Every one needs a room palette (interior.ts ROOM). */
export type InteriorKind = Extract<BuildingKind, 'house' | 'barracks' | 'tavern' | 'gnomehouse'>;
export const INTERIOR_KINDS: readonly InteriorKind[] = ['house', 'barracks', 'tavern', 'gnomehouse'];
export function hasInterior(k: BuildingKind): k is InteriorKind { return (INTERIOR_KINDS as readonly BuildingKind[]).includes(k); }

// ---- bodies ---------------------------------------------------------------------------------
/** How hard a body is to push aside when two overlap: the lighter one gives way (see VillageScene.separate). */
export const MASS = { kid: 0.5, villager: 1, player: 2, raider: 1, brute: 2, ogre: 10, warlord: 3, rat: 0.3, snatcher: 0.8, boar: 1.5, troll: 1.2, skulk: 0.7 } as const;

// ---- items on the ground --------------------------------------------------------------------
/** Thrown food, dropped armfuls and raider loot are free items with a pixel position and a little physics (see items.ts). */
export const ITEM = {
  /** px/s² downward on the height axis */
  gravity: 320,
  /** horizontal speed kept on each bounce, and on each deflection off a wall or tree */
  bounceKeep: 0.7, wallKeep: 0.5,
  /** below this ground speed (px/s) an item on the ground comes to rest */
  restSpeed: 3,
  /** how close (px) the head must be to pick one up, and a child to eat from one */
  reach: 15, eatReach: 12,
  /** px from the head at which a resting item lights up: a ring under it, a little bob, and no night tint */
  highlight: 48,
  /** a throw's flight time in seconds: base + distance / speed; the scatter on its velocity */
  flightBase: 0.4, flightPerPx: 1 / 160, scatter: 0.06,
  /** the little hop a dropped armful or loot makes */
  dropHop: 60,
  /** a thrown item clears a tree once it flies higher than this (px); walls and buildings are never cleared */
  treeHeight: 16,
} as const;

// ---- hauling --------------------------------------------------------------------------------
/** How much wood or food one pair of arms carries before a trip to the woodyard / granary. */
export const HAUL = { villager: { wood: 16, food: 12 }, player: { wood: 24, food: 18 } } as const;
export type LoadKind = 'wood' | 'food';
export type BulkKind = LoadKind | 'scrap';
export type ItemKind = BulkKind | 'gear';
export const STACK: Record<BulkKind, number> = { wood: HAUL.player.wood, food: HAUL.player.food, scrap: 20 };

// ---- the Ogre -------------------------------------------------------------------------------
/**
 * The first boss: a giant who sleeps in his lair by day and prowls around it at night. Once he
 * has a target he never sleeps again (see Ogre.aggroed). Three attacks, each with its own cooldown.
 */
export const OGRE = {
  hp: 600, speed: 34,
  /** how far from the lair he wanders, and how close you must come for him to hunt you */
  roam: 22, hunt: 14,
  /** fraction of max HP healed each day he sleeps (only while he still sleeps) */
  regen: 0.25,
  scrap: 30, renown: 300,
  /** tiles from the lair within which the eerie wind blows (it strengthens as you close in) */
  windRadius: 30,
  /** sprite scale: he's drawn at 48x64 already, so this is on top of that (a person is 16x20) */
  scale: 1.25,
  /** wide swing: a half-circle in front of him, everyone in it */
  swing: { dmg: 25, reach: 40, halfAngleCos: 0, windup: 0.6, recover: 1.1, cooldown: 1.5, push: 22, freeze: 0.1 },
  /** ground slam: everyone around him (unblockable) and the ground itself; drawn by a crowd or while the swing cools */
  smash: { dmg: 35, radius: 56, windup: 0.9, recover: 1.4, cooldown: 7, push: 40, freeze: 0.25, buildingDmg: 60, defenseDmg: 90, minVictims: 2 },
  /** charge: a straight rush at where the target stands, through anyone in the way, into whatever stops him */
  charge: { dmg: 30, minTiles: 5, maxTiles: 12, overshootTiles: 1.5, speedMul: 3, sweep: 14, windup: 0.5, recover: 0.8, stun: 1.6, cooldown: 9, push: 55, freeze: 0.2, buildingDmg: 120, defenseDmg: 180 },
} as const;

// ---- the hidden gnome cottage ---------------------------------------------------------------
/**
 * One toadstool cottage stands out in the woods, fogged and unclaimed. Its glade — warm motes and a
 * soft chime inside `ringRadius` tiles — is the clue, the way the lair's cold wind is the Ogre's.
 * Walk into it and the family is yours, along with the craft (the GNOME HOUSE tool is locked until then).
 */
export const GNOME_HOME = {
  /** tiles: the glade's radius. The player sees 10, so the motes show before the cottage lifts out of the fog. */
  ringRadius: 14,
  /** tiles from the village centre it hides, and how far it keeps from the Ogre's lair */
  minDist: 30, maxDist: 58, clear: 12,
  /** mushrooms ringing the cottage: the fairy ring */
  ringTiles: 10,
} as const;

// ---- wild boars -----------------------------------------------------------------------------
/**
 * Boars live in sounders (family groups) out in the woods and never raid. Strike one and it — and every
 * mate within packRange — charges the attacker until it calms (calmAfter seconds, or the attacker gets
 * further than leash tiles from the sounder's home). A dead boar drops meat where it fell (see wildlife.ts).
 * Damage is a slider (p.boarDmg); breeding is p.boarBreed.
 */
export const BOAR = {
  hp: 45, speed: 40, angrySpeed: 66, radius: 3,
  /** the blow: reach in px, wind-up and recovery in seconds */
  reach: 12, windup: 0.25, recover: 0.5,
  /** tiles: how far from home a calm boar roams, how far a chase goes, how far a provoked boar's mates hear it */
  roam: 7, leash: 16, packRange: 6,
  /** seconds a provoked boar stays angry without landing a blow; share of max HP a calm boar heals each dawn */
  calmAfter: 10, regen: 0.15,
  /** hidden in long grass: px at which a body walking onto it startles it, and how often the grass stirs as it moves (seconds) */
  startle: 9, rustleEvery: [0.35, 0.7] as const,
  /** meat units a grown boar drops (a young one drops half) */
  meat: 4,
  /** days before a young boar is grown (drawn small until then) */
  youngDays: 2, youngScale: 0.65,
  /** map: sounders placed at generation, boars per sounder, most a sounder grows to, least tiles from the village centre */
  sounders: 14, sounderSize: [3, 6] as const, sounderCap: 8, minDist: 30,
  /** least tiles between two sounders' homes — the wilderness only holds so many families before they crowd */
  spacing: 14,
} as const;

// ---- trolls ---------------------------------------------------------------------------------
/**
 * Solitary monsters scattered over the map at generation — no families, no home, no leash. A troll
 * wanders the wilderness, and anything it lays eyes on it hunts until that quarry is dead or indoors,
 * however far the chase goes. How many there are is p.trolls; how hard they hit is p.trollDmg.
 */
/**
 * A small thing that lives in the long grass. It creeps out wherever the grass still stands, so the
 * population ceiling is a function of how much you have left standing, and it goes for gnomes first —
 * they forage far from the walls and cannot fight back.
 */
export const SKULK = {
  hp: 14, speed: 30, huntSpeed: 46, radius: 2.5,
  /** the blow: reach in px, wind-up and recovery in seconds */
  reach: 11, windup: 0.3, recover: 0.45,
  /** tiles it can see prey at, and seconds between looking for a nearer quarry */
  sight: 9, retarget: 1.2,
  /** tiles it drifts per wandering leg */
  roam: 7,
  /** a gnome this many tiles further off still beats a nearer villager */
  gnomeBias: 7,
  /** least tiles from the head one may creep out at, so nothing appears in your lap */
  spawnDist: 10,
  /** wood a broken-down club returns */
  clubWood: 2,
} as const;

/** Gear a single barracks chest can hold. */
export const STASH_SLOTS = 12;

export const TROLL = {
  hp: 30, speed: 33, huntSpeed: 44, radius: 3,
  /** the blow: reach in px, wind-up and recovery in seconds */
  reach: 13, windup: 0.35, recover: 0.6,
  /** tiles it can see prey at, and seconds between looking for a nearer quarry */
  sight: 13, retarget: 1.5,
  /** tiles it drifts per wandering leg */
  roam: 9,
  /** meat a slain troll leaves where it fell */
  meat: 3,
  /** share of max HP a troll that is not hunting heals each dawn */
  regen: 0.15,
  /** map: least tiles from the village centre one may start, and least between two of them */
  minDist: 24, spacing: 4,
} as const;

// ---- beehives -------------------------------------------------------------------------------
/**
 * A hive hangs in the canopy of an old tree. Come inside its perimeter and the swarm boils out and
 * chases you — it cannot be fought, only outrun or shut out behind a door. Boars and other wildlife
 * are left alone; people and raiders alike are not. Chop the tree and the honey is yours, stings and all.
 */
export const HIVE = {
  /** px from the tree at which a body wakes the swarm (a tile is 16) */
  perimeter: 38,
  /** the sting: px it must be within, and seconds between stings (the damage is p.beeDmg) */
  reach: 10, stingEvery: 0.45,
  /** how fast the swarm flies — above a walking pace, below a running one */
  speed: 68,
  /** seconds it keeps chasing before it loses interest, and how far from home it will go (tiles) */
  patience: 11, range: 22,
  /** seconds the hive stays shaken after a swarm goes home, before anything can wake it again */
  calmAfter: 6,
  /** honey a knocked-down hive leaves */
  honey: 3,
  /** map: least tiles from the village centre a hive may hang, and least between two of them */
  minDist: 16, spacing: 5,
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
export const HEARTH_WOOD: Record<BuildingKind, readonly [number, number, number, number]> = {
  house: [0, 2, 2, 3],
  barracks: [0, 3, 3, 4],
  tavern: [0, 3, 3, 4],
  granary: [0, 0, 0, 0],
  woodyard: [0, 0, 0, 0],
  lair: [0, 0, 0, 0],
  gnomehouse: [0, 1, 1, 2],
};
/** scrap iron looted from slain raiders */
export const SCRAP_DROP = { raider: 2, brute: 4, warlord: 10, snatcher: 1, shaman: 2, rat: 0, ogre: 30, wrecker: 3, boar: 0, troll: 0, skulk: 0 } as const;

// ---- building damage ------------------------------------------------------------------------
/** Hit points per building level (index = level). Every kind must appear here, so new buildings are destructible by default; 0 means it can't be hurt (the Ogre's lair). */
export const BUILDING_HP: Record<BuildingKind, readonly [number, number, number, number]> = {
  house: [0, 240, 360, 480],
  tavern: [0, 300, 420, 540],
  granary: [0, 300, 420, 540],
  woodyard: [0, 300, 420, 540],
  barracks: [0, 400, 560, 720],
  lair: [0, 0, 0, 0],
  gnomehouse: [0, 180, 260, 340],
};
/** hammer on a damaged building: HP per wood; rebuilding a ruin costs this share of the build cost (buildings without a shop price use `rebuildDefault`) */
export const REPAIR = { perWood: 60, rebuildFraction: 0.5, rebuildDefault: 15 } as const;
/** Taking things down: the share of wood spent (build + upgrades, or the wall's cost) you get back. A ruin refunds nothing. */
export const DISMANTLE = { refund: 0.5, hits: 3 } as const;

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
