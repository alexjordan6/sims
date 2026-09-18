import { LEGACY_TEST_MODE, p } from './config';

// Meta-progression: renown banked across runs, spent on a tree of boons.
// Eight branches; each is root -> fork (A|B) -> capstone. A whole path occupies one loadout slot.
// Persisted in localStorage; everything here is plain data so the scene/UI can stay dumb about it.

export interface Mods {
  startFood: number;
  startWood: number;
  extraAdults: number;
  startSoldiers: number;
  cropYield: number;
  cropDaysDelta: number;
  farmerSpeedMul: number;
  fieldWide: boolean;
  foodPerDayMul: number;
  birthBonus: number;
  /** Baby Fever: births get p.feverBonus while food in store covers p.feverDays of rations */
  babyFever: boolean;
  twinChance: number;
  houseCap: number;
  adultAgeDelta: number;
  hpMul: number;
  soldierHpBonus: number;
  soldierDmgMul: number;
  soldierRegen: number;
  /** fewer drill days for cadets (War Drums) */
  cadetDaysDelta: number;
  /** extra houses each barracks can sponsor (Blooded) */
  sponsorBonus: number;
  raiderSpeedMul: number;
  raiderHpMul: number;
  playerDmgMul: number;
  playerHpBonus: number;
  playerRegen: number;
  // ---- Timber
  /** extra wood from every felled tree */
  treeYieldBonus: number;
  /** grove seeding chance multiplier */
  seedMul: number;
  /** sheltered saplings grow this many days faster */
  shelteredDaysDelta: number;
  /** trees become old growth this many days sooner */
  oldGrowthDaysDelta: number;
  /** extra wood from old growth on top of treeYieldBonus */
  oldYieldBonus: number;
  startWoodyardLevel: number;
  cutterSpeedMul: number;
  /** woodcutters chop past the tree reserve */
  ignoreReserve: boolean;
  // ---- Masonry
  hammerHits: number;
  upgradeCostMul: number;
  buildCostMul: number;
  startGranaryLevel: number;
  capMul: number;
  bedBonus: number;
  // ---- Bounty
  killWood: number;
  killFood: number;
  ratsHarmless: boolean;
  /** HP the player heals per raider slain */
  killHeal: number;
  /** how long a snatcher must hold on to a child before it has them */
  snatchDelayMul: number;
  noSnatch: boolean;
  // ---- Fortune
  raidEveryDelta: number;
  warnDaysDelta: number;
  /** raiders removed from every wave */
  waveShrink: number;
  bossEscortMul: number;
  /** villagers heal to full each dawn */
  dawnHeal: boolean;
  villagerHpMul: number;
  starveDaysDelta: number;
  /** children come of age fully drilled */
  fullDrill: boolean;
}
export const DEFAULT_MODS: Mods = {
  startFood: 40, startWood: 25, extraAdults: 0, startSoldiers: 0,
  cropYield: 6, cropDaysDelta: 0, farmerSpeedMul: 1, fieldWide: false, foodPerDayMul: 1,
  birthBonus: 0, babyFever: false, twinChance: 0, houseCap: 4, adultAgeDelta: 0,
  hpMul: 1, soldierHpBonus: 0, soldierDmgMul: 1, soldierRegen: 0, cadetDaysDelta: 0, sponsorBonus: 0,
  raiderSpeedMul: 1, raiderHpMul: 1, playerDmgMul: 1, playerHpBonus: 0, playerRegen: 0,
  treeYieldBonus: 0, seedMul: 1, shelteredDaysDelta: 0, oldGrowthDaysDelta: 0, oldYieldBonus: 0, startWoodyardLevel: 1, cutterSpeedMul: 1, ignoreReserve: false,
  hammerHits: 3, upgradeCostMul: 1, buildCostMul: 1, startGranaryLevel: 1, capMul: 1, bedBonus: 0,
  killWood: 0, killFood: 0, ratsHarmless: false, killHeal: 0, snatchDelayMul: 1, noSnatch: false,
  raidEveryDelta: 0, warnDaysDelta: 0, waveShrink: 0, bossEscortMul: 1, dawnHeal: false, villagerHpMul: 1, starveDaysDelta: 0, fullDrill: false,
};

export type Branch = 'harvest' | 'hearth' | 'war' | 'hold' | 'timber' | 'masonry' | 'bounty' | 'fortune';
export const BRANCHES: { id: Branch; name: string; blurb: string }[] = [
  { id: 'harvest', name: 'Harvest', blurb: 'food and farming' },
  { id: 'hearth', name: 'Hearth', blurb: 'families and children' },
  { id: 'war', name: 'War', blurb: 'soldiers and combat' },
  { id: 'hold', name: 'Stronghold', blurb: 'defence and you' },
  { id: 'timber', name: 'Timber', blurb: 'trees and wood' },
  { id: 'masonry', name: 'Masonry', blurb: 'buildings and stores' },
  { id: 'bounty', name: 'Bounty', blurb: 'spoils of war' },
  { id: 'fortune', name: 'Fortune', blurb: 'the calendar and luck' },
];

export interface Node {
  id: string;
  branch: Branch;
  /** 1 root, 2 fork, 3 capstone */
  tier: 1 | 2 | 3;
  /** fork side, for layout: capstones sit under their fork */
  side?: 'a' | 'b';
  requires?: string;
  name: string;
  cost: number;
  blurb: string;
  icon: { key: string; frame: number };
  apply(m: Mods): void;
}

export const NODES: Node[] = [
  // ---- Harvest
  { id: 'harvest1', branch: 'harvest', tier: 1, name: 'Green Thumb', cost: 50, blurb: 'Crops yield +2 food', icon: { key: 'farm', frame: 81 }, apply: (m) => (m.cropYield += 2) },
  { id: 'harvest2a', branch: 'harvest', tier: 2, side: 'a', requires: 'harvest1', name: 'Iron Harvest', cost: 100, blurb: 'Yield +3 more, farmers work 30% faster', icon: { key: 'farm', frame: 68 }, apply: (m) => { m.cropYield += 3; m.farmerSpeedMul *= 1.3; } },
  { id: 'harvest3a', branch: 'harvest', tier: 3, side: 'a', requires: 'harvest2a', name: 'Bumper Crops', cost: 200, blurb: 'Crops ripen a day sooner', icon: { key: 'farm', frame: 43 }, apply: (m) => (m.cropDaysDelta -= 1) },
  { id: 'harvest2b', branch: 'harvest', tier: 2, side: 'b', requires: 'harvest1', name: 'Deep Larder', cost: 100, blurb: '+50 starting food and a wider starting field', icon: { key: 'farm', frame: 44 }, apply: (m) => { m.startFood += 50; m.fieldWide = true; } },
  { id: 'harvest3b', branch: 'harvest', tier: 3, side: 'b', requires: 'harvest2b', name: 'Granary', cost: 200, blurb: 'Villagers eat half as much', icon: { key: 'farm', frame: 96 }, apply: (m) => (m.foodPerDayMul *= 0.5) },
  // ---- Hearth
  { id: 'hearth1', branch: 'hearth', tier: 1, name: 'Baby Fever', cost: 50, blurb: 'While the granary holds 5+ days of food, births are far more likely — the bigger the village, the more it takes to keep the surplus', icon: { key: 'town', frame: 85 }, apply: (m) => (m.babyFever = true) },
  { id: 'hearth2a', branch: 'hearth', tier: 2, side: 'a', requires: 'hearth1', name: 'Big Families', cost: 100, blurb: 'Houses hold 6 instead of 4', icon: { key: 'town', frame: 53 }, apply: (m) => (m.houseCap = 6) },
  { id: 'hearth3a', branch: 'hearth', tier: 3, side: 'a', requires: 'hearth2a', name: 'Twins', cost: 200, blurb: 'A quarter of births are twins', icon: { key: 'dungeon', frame: 88 }, apply: (m) => (m.twinChance += 0.25) },
  { id: 'hearth2b', branch: 'hearth', tier: 2, side: 'b', requires: 'hearth1', name: 'Second Couple', cost: 100, blurb: 'Start with a second family and house', icon: { key: 'dungeon', frame: 99 }, apply: (m) => (m.extraAdults += 2) },
  { id: 'hearth3b', branch: 'hearth', tier: 3, side: 'b', requires: 'hearth2b', name: 'Quick to Grow', cost: 200, blurb: 'Children come of age 2 days sooner', icon: { key: 'dungeon', frame: 85 }, apply: (m) => (m.adultAgeDelta -= 2) },
  // ---- War
  { id: 'war1', branch: 'war', tier: 1, name: 'Drill Yard', cost: 50, blurb: 'Soldiers +15 HP', icon: { key: 'dungeon', frame: 102 }, apply: (m) => (m.soldierHpBonus += 15) },
  { id: 'war2a', branch: 'war', tier: 2, side: 'a', requires: 'war1', name: 'War Drums', cost: 100, blurb: 'Cadets need 2 days of drill instead of 3', icon: { key: 'town', frame: 95 }, apply: (m) => (m.cadetDaysDelta -= 1) },
  { id: 'war3a', branch: 'war', tier: 3, side: 'a', requires: 'war2a', name: 'Blooded', cost: 250, blurb: 'Soldiers deal +50%; every barracks sponsors one more house', icon: { key: 'dungeon', frame: 105 }, apply: (m) => { m.soldierDmgMul *= 1.5; m.sponsorBonus += 1; } },
  { id: 'war2b', branch: 'war', tier: 2, side: 'b', requires: 'war1', name: 'Veteran', cost: 150, blurb: 'Start with a trained soldier', icon: { key: 'dungeon', frame: 96 }, apply: (m) => (m.startSoldiers += 1) },
  { id: 'war3b', branch: 'war', tier: 3, side: 'b', requires: 'war2b', name: 'Old Guard', cost: 250, blurb: 'Start with two; soldiers regen 2 HP/s out of combat', icon: { key: 'dungeon', frame: 97 }, apply: (m) => { m.startSoldiers += 1; m.soldierRegen += 2; } },
  // ---- Stronghold
  { id: 'hold1', branch: 'hold', tier: 1, name: 'Watchtower', cost: 50, blurb: 'Raiders move 15% slower', icon: { key: 'town', frame: 83 }, apply: (m) => (m.raiderSpeedMul *= 0.85) },
  { id: 'hold2a', branch: 'hold', tier: 2, side: 'a', requires: 'hold1', name: 'Palisade', cost: 100, blurb: 'Raiders move 30% slower in all', icon: { key: 'town', frame: 81 }, apply: (m) => (m.raiderSpeedMul *= 0.82) },
  { id: 'hold3a', branch: 'hold', tier: 3, side: 'a', requires: 'hold2a', name: 'Stone Walls', cost: 200, blurb: 'Raiders arrive battered: -25% HP', icon: { key: 'town', frame: 77 }, apply: (m) => (m.raiderHpMul *= 0.75) },
  { id: 'hold2b', branch: 'hold', tier: 2, side: 'b', requires: 'hold1', name: 'Champion', cost: 100, blurb: 'Your attacks deal 1.5x, +20 HP', icon: { key: 'dungeon', frame: 104 }, apply: (m) => { m.playerDmgMul *= 1.5; m.playerHpBonus += 20; } },
  { id: 'hold3b', branch: 'hold', tier: 3, side: 'b', requires: 'hold2b', name: "Warlord's Bane", cost: 250, blurb: '2x damage in all, +40 HP, regen 5 HP/s out of combat', icon: { key: 'dungeon', frame: 106 }, apply: (m) => { m.playerDmgMul *= 4 / 3; m.playerHpBonus += 40; m.playerRegen += 5; } },
  // ---- Timber
  { id: 'timber1', branch: 'timber', tier: 1, name: 'Sharp Axes', cost: 50, blurb: 'Every tree yields +4 wood', icon: { key: 'town', frame: 129 }, apply: (m) => (m.treeYieldBonus += 4) },
  { id: 'timber2a', branch: 'timber', tier: 2, side: 'a', requires: 'timber1', name: 'Forester', cost: 100, blurb: 'Groves seed twice as fast; sheltered saplings grow in 2 days', icon: { key: 'town', frame: 28 }, apply: (m) => { m.seedMul *= 2; m.shelteredDaysDelta -= 1; } },
  { id: 'timber3a', branch: 'timber', tier: 3, side: 'a', requires: 'timber2a', name: 'Old Growth', cost: 200, blurb: 'Trees mature in 4 days; old growth pays 20 wood', icon: { key: 'town', frame: 16 }, apply: (m) => { m.oldGrowthDaysDelta -= 2; m.oldYieldBonus += 4; } },
  { id: 'timber2b', branch: 'timber', tier: 2, side: 'b', requires: 'timber1', name: 'Lumber Camp', cost: 100, blurb: 'The woodyard starts at Lv2; +40 starting wood', icon: { key: 'town', frame: 92 }, apply: (m) => { m.startWoodyardLevel = Math.max(m.startWoodyardLevel, 2); m.startWood += 40; } },
  { id: 'timber3b', branch: 'timber', tier: 3, side: 'b', requires: 'timber2b', name: 'Sawmill', cost: 200, blurb: 'Woodcutters chop 40% faster and never stop at the reserve', icon: { key: 'town', frame: 115 }, apply: (m) => { m.cutterSpeedMul *= 1.4; m.ignoreReserve = true; } },
  // ---- Masonry
  { id: 'masonry1', branch: 'masonry', tier: 1, name: 'Steady Hands', cost: 50, blurb: 'Hammer upgrades take 2 hits instead of 3', icon: { key: 'town', frame: 128 }, apply: (m) => (m.hammerHits = 2) },
  { id: 'masonry2a', branch: 'masonry', tier: 2, side: 'a', requires: 'masonry1', name: 'Cheap Timber', cost: 100, blurb: 'Upgrades cost 30% less wood', icon: { key: 'town', frame: 57 }, apply: (m) => (m.upgradeCostMul *= 0.7) },
  { id: 'masonry3a', branch: 'masonry', tier: 3, side: 'a', requires: 'masonry2a', name: 'Master Builder', cost: 200, blurb: 'Houses and barracks cost half to build; the granary starts at Lv2', icon: { key: 'town', frame: 53 }, apply: (m) => { m.buildCostMul *= 0.5; m.startGranaryLevel = Math.max(m.startGranaryLevel, 2); } },
  { id: 'masonry2b', branch: 'masonry', tier: 2, side: 'b', requires: 'masonry1', name: 'Deep Cellars', cost: 100, blurb: 'The granary and woodyard hold 50% more at every level', icon: { key: 'farm', frame: 75 }, apply: (m) => (m.capMul *= 1.5) },
  { id: 'masonry3b', branch: 'masonry', tier: 3, side: 'b', requires: 'masonry2b', name: 'Great Hall', cost: 200, blurb: 'Houses get +2 beds at every level', icon: { key: 'town', frame: 85 }, apply: (m) => (m.bedBonus += 2) },
  // ---- Bounty
  { id: 'bounty1', branch: 'bounty', tier: 1, name: 'Plunder', cost: 50, blurb: 'Every raider slain drops 3 wood', icon: { key: 'dungeon', frame: 89 }, apply: (m) => (m.killWood += 3) },
  { id: 'bounty2a', branch: 'bounty', tier: 2, side: 'a', requires: 'bounty1', name: 'Foragers', cost: 100, blurb: 'Rats take twice as long to eat crops; kills also drop 2 food', icon: { key: 'farm', frame: 44 }, apply: (m) => { m.ratsHarmless = true; m.killFood += 2; } },
  { id: 'bounty3a', branch: 'bounty', tier: 3, side: 'a', requires: 'bounty2a', name: 'Trophies', cost: 200, blurb: 'Each kill heals you 5 HP; soldiers +20% HP', icon: { key: 'dungeon', frame: 116 }, apply: (m) => { m.killHeal += 5; m.soldierHpBonus += 12; } },
  { id: 'bounty2b', branch: 'bounty', tier: 2, side: 'b', requires: 'bounty1', name: 'Quick Hands', cost: 100, blurb: 'Snatchers take twice as long to grab a child', icon: { key: 'dungeon', frame: 110 }, apply: (m) => (m.snatchDelayMul *= 2) },
  { id: 'bounty3b', branch: 'bounty', tier: 3, side: 'b', requires: 'bounty2b', name: 'Guardians', cost: 250, blurb: 'Children can\'t be snatched at all', icon: { key: 'dungeon', frame: 102 }, apply: (m) => (m.noSnatch = true) },
  // ---- Fortune
  { id: 'fortune1', branch: 'fortune', tier: 1, name: 'Long Peace', cost: 50, blurb: 'Raids come every 4 days instead of 3', icon: { key: 'town', frame: 83 }, apply: (m) => (m.raidEveryDelta += 1) },
  { id: 'fortune2a', branch: 'fortune', tier: 2, side: 'a', requires: 'fortune1', name: 'Scouts', cost: 100, blurb: 'Raids are announced 2 days out and arrive one raider short', icon: { key: 'town', frame: 95 }, apply: (m) => { m.warnDaysDelta += 1; m.waveShrink += 1; } },
  { id: 'fortune3a', branch: 'fortune', tier: 3, side: 'a', requires: 'fortune2a', name: 'Hearsay', cost: 200, blurb: 'The Warlord arrives with half his escort', icon: { key: 'dungeon', frame: 109 }, apply: (m) => (m.bossEscortMul *= 0.5) },
  { id: 'fortune2b', branch: 'fortune', tier: 2, side: 'b', requires: 'fortune1', name: 'Second Wind', cost: 100, blurb: 'Villagers heal fully every dawn and have +25% HP', icon: { key: 'dungeon', frame: 115 }, apply: (m) => { m.dawnHeal = true; m.villagerHpMul *= 1.25; } },
  { id: 'fortune3b', branch: 'fortune', tier: 3, side: 'b', requires: 'fortune2b', name: 'Iron Constitution', cost: 250, blurb: 'Nobody starves for 2 extra days; children come of age fully drilled', icon: { key: 'dungeon', frame: 87 }, apply: (m) => { m.starveDaysDelta += 2; m.fullDrill = true; } },
];

const NODE_BY_ID = new Map(NODES.map((n) => [n.id, n]));
export const nodeById = (id: string): Node | undefined => NODE_BY_ID.get(id);
export const nodesOf = (branch: Branch): Node[] => NODES.filter((n) => n.branch === branch);

/** Root -> ... -> node, following `requires`. */
export function pathOf(id: string): Node[] {
  const out: Node[] = [];
  for (let n = nodeById(id); n; n = n.requires ? nodeById(n.requires) : undefined) out.unshift(n);
  return out;
}

/** Old flat-boon ids from the first release, mapped onto the tree. */
const LEGACY_IDS: Record<string, string> = {
  larder: 'harvest2b', harvest: 'harvest1', timber: 'hold1', couple: 'hearth2b', families: 'hearth2a',
  drums: 'war2a', veteran: 'war2b', hardy: 'war1', champion: 'hold2b', palisade: 'hold2a',
};

export interface MetaState {
  renown: number;
  runs: number;
  wins: number;
  bestDay: number;
  unlocked: string[];
  loadout: string[];
}

export interface RunResult {
  won: boolean;
  day: number;
  raidersKilled: number;
  /** children who came of age this run, and the care stars they were raised with (summed) */
  childrenRaised: number;
  stars: number;
  /** bosses found and slain out in the world (the Ogre) */
  bossesSlain: number;
}

export interface RenownBreakdown { days: number; kills: number; children: number; bosses: number; victory: number; total: number }

const KEY = 'village.meta';

export class Meta {
  state: MetaState = { renown: 0, runs: 0, wins: 0, bestDay: 0, unlocked: [], loadout: [] };

  constructor() {
    this.load();
  }

  load(): void {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.state = { ...this.state, ...JSON.parse(raw) };
    } catch { /* private mode etc. — play without persistence */ }
    this.migrate();
  }

  /** Map old ids onto tree nodes (granting their prerequisites) and drop anything unknown. */
  private migrate(): void {
    const fix = (ids: string[]): string[] => {
      const out: string[] = [];
      for (const raw of ids) {
        const id = LEGACY_IDS[raw] ?? raw;
        if (!nodeById(id)) continue;
        for (const n of pathOf(id)) if (!out.includes(n.id)) out.push(n.id);
      }
      return out;
    };
    const unlocked = fix(this.state.unlocked);
    // loadout: keep the deepest owned node per branch
    const loadout: string[] = [];
    for (const raw of this.state.loadout) {
      const id = LEGACY_IDS[raw] ?? raw;
      const n = nodeById(id);
      if (!n || !unlocked.includes(id) || loadout.some((x) => nodeById(x)!.branch === n.branch)) continue;
      loadout.push(id);
    }
    this.state.unlocked = unlocked;
    this.state.loadout = loadout;
  }

  save(): void {
    try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch { /* ignore */ }
  }

  /** How many paths can be equipped: 2, or 3 once you've won (every branch in test mode). */
  get slots(): number {
    if (LEGACY_TEST_MODE) return BRANCHES.length;
    return this.state.wins > 0 ? 3 : 2;
  }

  isUnlocked(id: string): boolean {
    return LEGACY_TEST_MODE || this.state.unlocked.includes(id);
  }
  isEquipped(id: string): boolean {
    return this.state.loadout.includes(id);
  }
  /** Is this node on an equipped path (itself or an ancestor of the equipped node)? */
  isOnEquippedPath(id: string): boolean {
    return this.state.loadout.some((eq) => pathOf(eq).some((n) => n.id === id));
  }
  equippedIn(branch: Branch): Node | undefined {
    return this.state.loadout.map((id) => nodeById(id)!).find((n) => n.branch === branch);
  }
  isBuyable(id: string): boolean {
    if (LEGACY_TEST_MODE) return false; // nothing to buy, it's all yours
    const n = nodeById(id);
    if (!n || this.isUnlocked(id)) return false;
    if (n.requires && !this.isUnlocked(n.requires)) return false;
    return this.state.renown >= n.cost;
  }

  /** Buy a node. Returns false if unaffordable, already owned, or its prerequisite is missing. */
  unlock(id: string): boolean {
    if (!this.isBuyable(id)) return false;
    this.state.renown -= nodeById(id)!.cost;
    this.state.unlocked.push(id);
    this.save();
    return true;
  }

  /**
   * Equip the path ending at `id` (one per branch), unequip it if already equipped,
   * or swap it for the branch's current path. Returns false when no slot is free.
   */
  toggleLoadout(id: string): boolean {
    const n = nodeById(id);
    if (!n || !this.isUnlocked(id)) return false;
    const i = this.state.loadout.indexOf(id);
    if (i >= 0) { this.state.loadout.splice(i, 1); this.save(); return true; }
    const sameBranch = this.state.loadout.findIndex((x) => nodeById(x)!.branch === n.branch);
    if (sameBranch >= 0) this.state.loadout[sameBranch] = id;
    else if (this.state.loadout.length >= this.slots) return false;
    else this.state.loadout.push(id);
    this.save();
    return true;
  }

  /** Run modifiers for the current loadout: every equipped node plus its ancestors. */
  mods(): Mods {
    // the economy sliders set the baseline the boons build on
    const m: Mods = { ...DEFAULT_MODS, cropYield: p.cropYield, startFood: p.startFood, startWood: p.startWood };
    for (const id of this.state.loadout) for (const n of pathOf(id)) n.apply(m);
    return m;
  }

  static renownFor(r: RunResult): RenownBreakdown {
    const days = r.day * 10, kills = r.raidersKilled * 5, children = r.childrenRaised * 20 + r.stars * 8, bosses = r.bossesSlain * 300, victory = r.won ? 500 : 0;
    return { days, kills, children, bosses, victory, total: days + kills + children + bosses + victory };
  }

  /** Bank a finished run. */
  bankRun(r: RunResult): RenownBreakdown {
    const b = Meta.renownFor(r);
    this.state.renown += b.total;
    this.state.runs++;
    if (r.won) this.state.wins++;
    this.state.bestDay = Math.max(this.state.bestDay, r.day);
    this.save();
    return b;
  }
}

