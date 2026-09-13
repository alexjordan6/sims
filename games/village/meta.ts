// Meta-progression: renown banked across runs, boons bought with it and equipped as a loadout.
// Persisted in localStorage; everything here is plain data so the scene/UI can stay dumb about it.

export interface Mods {
  startFood: number;
  startWood: number;
  extraAdults: number;
  startSoldier: boolean;
  cropYield: number;
  hpMul: number;
  martialMul: number;
  raiderSpeedMul: number;
  houseCap: number;
  playerDmgMul: number;
  playerHpBonus: number;
}

export const DEFAULT_MODS: Mods = {
  startFood: 40, startWood: 25, extraAdults: 0, startSoldier: false, cropYield: 6,
  hpMul: 1, martialMul: 1, raiderSpeedMul: 1, houseCap: 4, playerDmgMul: 1, playerHpBonus: 0,
};

export interface Boon {
  id: string;
  name: string;
  cost: number;
  blurb: string;
  icon: { key: string; frame: number };
  apply(m: Mods): void;
}

export const BOONS: Boon[] = [
  { id: 'larder', name: 'Deep Larder', cost: 50, blurb: '+40 starting food', icon: { key: 'farm', frame: 44 }, apply: (m) => (m.startFood += 40) },
  { id: 'timber', name: 'Timber Reserve', cost: 50, blurb: '+40 starting wood', icon: { key: 'town', frame: 92 }, apply: (m) => (m.startWood += 40) },
  { id: 'couple', name: 'Second Couple', cost: 100, blurb: 'Start with two more adults and a second house', icon: { key: 'dungeon', frame: 99 }, apply: (m) => (m.extraAdults += 2) },
  { id: 'harvest', name: 'Iron Harvest', cost: 100, blurb: 'Crops yield +3 food', icon: { key: 'farm', frame: 68 }, apply: (m) => (m.cropYield += 3) },
  { id: 'champion', name: 'Champion', cost: 100, blurb: 'Your attacks deal 1.5x, +20 HP', icon: { key: 'dungeon', frame: 105 }, apply: (m) => { m.playerDmgMul *= 1.5; m.playerHpBonus += 20; } },
  { id: 'hardy', name: 'Hardy Folk', cost: 150, blurb: 'Villagers have +50% HP', icon: { key: 'dungeon', frame: 116 }, apply: (m) => (m.hpMul *= 1.5) },
  { id: 'drums', name: 'War Drums', cost: 150, blurb: 'Kids soak up martial influence twice as fast', icon: { key: 'dungeon', frame: 102 }, apply: (m) => (m.martialMul *= 2) },
  { id: 'palisade', name: 'Palisade', cost: 150, blurb: 'Raiders move 25% slower', icon: { key: 'town', frame: 81 }, apply: (m) => (m.raiderSpeedMul *= 0.75) },
  { id: 'families', name: 'Big Families', cost: 150, blurb: 'Houses hold 6 instead of 4', icon: { key: 'town', frame: 85 }, apply: (m) => (m.houseCap = 6) },
  { id: 'veteran', name: 'Veteran', cost: 200, blurb: 'Start with a trained soldier', icon: { key: 'dungeon', frame: 96 }, apply: (m) => (m.startSoldier = true) },
];

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
  }

  save(): void {
    try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch { /* ignore */ }
  }

  /** How many boons can be equipped: 2, or 3 once you've won. */
  get slots(): number {
    return this.state.wins > 0 ? 3 : 2;
  }

  isUnlocked(id: string): boolean {
    return this.state.unlocked.includes(id);
  }
  isEquipped(id: string): boolean {
    return this.state.loadout.includes(id);
  }

  /** Buy a boon. Returns false if unaffordable or already owned. */
  unlock(id: string): boolean {
    const b = BOONS.find((x) => x.id === id);
    if (!b || this.isUnlocked(id) || this.state.renown < b.cost) return false;
    this.state.renown -= b.cost;
    this.state.unlocked.push(id);
    this.save();
    return true;
  }

  /** Equip/unequip an unlocked boon. Returns false if no free slot. */
  toggleLoadout(id: string): boolean {
    if (!this.isUnlocked(id)) return false;
    const i = this.state.loadout.indexOf(id);
    if (i >= 0) this.state.loadout.splice(i, 1);
    else if (this.state.loadout.length >= this.slots) return false;
    else this.state.loadout.push(id);
    this.save();
    return true;
  }

  /** Run modifiers for the current loadout. */
  mods(): Mods {
    const m: Mods = { ...DEFAULT_MODS };
    for (const id of this.state.loadout) BOONS.find((b) => b.id === id)?.apply(m);
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
