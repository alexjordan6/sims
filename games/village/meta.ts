// Meta-progression: renown banked across runs, spent on a tree of boons.
// Four branches; each is root -> fork (A|B) -> capstone. A whole path occupies one loadout slot.
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
}

export const DEFAULT_MODS: Mods = {
  startFood: 40, startWood: 25, extraAdults: 0, startSoldiers: 0,
  cropYield: 6, cropDaysDelta: 0, farmerSpeedMul: 1, fieldWide: false, foodPerDayMul: 1,
  birthBonus: 0, twinChance: 0, houseCap: 4, adultAgeDelta: 0,
  hpMul: 1, soldierHpBonus: 0, soldierDmgMul: 1, soldierRegen: 0, cadetDaysDelta: 0, sponsorBonus: 0,
  raiderSpeedMul: 1, raiderHpMul: 1, playerDmgMul: 1, playerHpBonus: 0, playerRegen: 0,
};

export type Branch = 'harvest' | 'hearth' | 'war' | 'hold';
export const BRANCHES: { id: Branch; name: string; blurb: string }[] = [
  { id: 'harvest', name: 'Harvest', blurb: 'food and farming' },
  { id: 'hearth', name: 'Hearth', blurb: 'families and children' },
  { id: 'war', name: 'War', blurb: 'soldiers and combat' },
  { id: 'hold', name: 'Stronghold', blurb: 'defence and you' },
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
  { id: 'hearth1', branch: 'hearth', tier: 1, name: 'Warm Hearths', cost: 50, blurb: 'Births 15% more likely', icon: { key: 'town', frame: 85 }, apply: (m) => (m.birthBonus += 0.15) },
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
  soldiersRaised: number;
}

export interface RenownBreakdown { days: number; kills: number; soldiers: number; victory: number; total: number }

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

  /** How many paths can be equipped: 2, or 3 once you've won. */
  get slots(): number {
    return this.state.wins > 0 ? 3 : 2;
  }

  isUnlocked(id: string): boolean {
    return this.state.unlocked.includes(id);
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
    const m: Mods = { ...DEFAULT_MODS };
    for (const id of this.state.loadout) for (const n of pathOf(id)) n.apply(m);
    return m;
  }

  static renownFor(r: RunResult): RenownBreakdown {
    const days = r.day * 10, kills = r.raidersKilled * 5, soldiers = r.soldiersRaised * 25, victory = r.won ? 500 : 0;
    return { days, kills, soldiers, victory, total: days + kills + soldiers + victory };
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
