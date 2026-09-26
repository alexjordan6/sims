import { STACK, FOODS, WEAPONS, ARMOR, type BulkKind, type FoodKind, type WeaponSlot, type ArmorSlot } from './config';

export const IMPLEMENTS = ['axe', 'hoe', 'hammer', 'basket', 'wand'] as const;
export type Implement = typeof IMPLEMENTS[number];
export type Bulk = { kind: 'wood'; n: number } | { kind: 'food'; food: FoodKind; n: number } | { kind: 'scrap'; n: number };
export type Gear = { kind: 'weapon'; slot: WeaponSlot; tier: number } | { kind: 'armor'; slot: ArmorSlot; tier: number } | { kind: 'tool'; tool: Implement };
export type Slot = Bulk | Gear;
export type EquipmentSlot = WeaponSlot | ArmorSlot;
export const EQUIPMENT: readonly EquipmentSlot[] = ['melee', 'bow', 'helmet', 'chest', 'legs', 'shield'];
export const TOOL_NAME: Record<Implement, string> = { axe: 'Axe', hoe: 'Hoe', hammer: 'Hammer', basket: 'Basket', wand: 'Wand' };
export function isImplement(tool: string): tool is Implement { return (IMPLEMENTS as readonly string[]).includes(tool); }
export function isBulk(s: Slot): s is Bulk { return s.kind === 'wood' || s.kind === 'food' || s.kind === 'scrap'; }
function unhandled(s: never): never { throw new Error(`Unknown pack item: ${JSON.stringify(s)}`); }
export function slotName(s: Slot): string {
  switch (s.kind) {
    case 'wood': return 'Wood';
    case 'food': return FOODS[s.food].name;
    case 'scrap': return 'Scrap iron';
    case 'weapon': return WEAPONS[s.slot].tiers[s.tier].name;
    case 'armor': return ARMOR[s.slot].tiers[s.tier].name;
    case 'tool': return TOOL_NAME[s.tool];
    default: return unhandled(s);
  }
}
export function slotKey(s: Slot | null): string {
  if (!s) return '-';
  switch (s.kind) {
    case 'wood': case 'scrap': return `${s.kind}:${s.n}`;
    case 'food': return `food:${s.food}:${s.n}`;
    case 'tool': return `tool:${s.tool}`;
    case 'weapon': case 'armor': return `${s.kind}:${s.slot}:${s.tier}`;
    default: return unhandled(s);
  }
}
function matches(s: Slot | null, kind: BulkKind, food?: FoodKind): s is Bulk {
  return !!s && isBulk(s) && s.kind === kind && (s.kind !== 'food' || s.food === (food ?? 'wheat'));
}

/** Pure inventory data. Every transfer reports the amount actually accepted/removed. */
export class Pack {
  readonly slots: (Slot | null)[];
  /** `min` is the floor on slots: the head's pack never drops below five, a gnome's pouch is allowed to be tiny. */
  constructor(size = 12, min = 5) { this.slots = Array.from({ length: Math.max(min, Math.floor(size)) }, () => null); }
  at(i: number): Slot | null { return this.slots[i] ?? null; }
  get emptySlots(): number { return this.slots.filter(s => !s).length; }
  get full(): boolean { return this.emptySlots === 0; }
  clear(): void { this.slots.fill(null); }
  findSlot(pred: (s: Slot) => boolean): number { return this.slots.findIndex(s => !!s && pred(s)); }
  hasTool(tool: string): boolean { return this.findSlot(s => s.kind === 'tool' && s.tool === tool) >= 0; }
  bulk(): Bulk[] { return this.slots.filter((s): s is Bulk => !!s && isBulk(s)); }
  room(kind: BulkKind, food?: FoodKind): number {
    return this.slots.reduce((n, s) => n + (!s ? STACK[kind] : matches(s, kind, food) ? STACK[kind] - s.n : 0), 0);
  }
  countOf(kind: BulkKind, food?: FoodKind): number { return this.slots.reduce((n, s) => n + (matches(s, kind, food) ? s.n : 0), 0); }
  add(kind: BulkKind, n: number, food?: FoodKind): number {
    if (!Number.isFinite(n) || n <= 0) return 0;
    let left = n;
    for (const s of this.slots) if (matches(s, kind, food)) {
      const take = Math.min(left, STACK[kind] - s.n); s.n += take; left -= take;
    }
    for (let i = 0; i < this.slots.length && left > 1e-9; i++) if (!this.slots[i]) {
      const take = Math.min(left, STACK[kind]);
      this.slots[i] = kind === 'food' ? { kind, food: food ?? 'wheat', n: take } : { kind, n: take };
      left -= take;
    }
    return n - left;
  }
  put(g: Gear): number { const i = this.slots.indexOf(null); if (i >= 0) this.slots[i] = { ...g }; return i; }
  take(kind: BulkKind, n: number, food?: FoodKind): number {
    if (!Number.isFinite(n) || n <= 0) return 0;
    let left = n;
    const indices = this.slots.map((_, i) => i).filter(i => matches(this.slots[i], kind, food))
      .sort((a, b) => (this.slots[a] as Bulk).n - (this.slots[b] as Bulk).n || a - b);
    for (const i of indices) {
      const s = this.slots[i] as Bulk, take = Math.min(left, s.n);
      s.n -= take; left -= take; if (s.n < 1e-9) this.slots[i] = null;
      if (left < 1e-9) break;
    }
    return n - left;
  }
  removeAt(i: number): Slot | null { const s = this.at(i); if (i >= 0 && i < this.slots.length) this.slots[i] = null; return s; }
  move(i: number, j: number): boolean {
    if (i === j || i < 0 || j < 0 || i >= this.slots.length || j >= this.slots.length || !this.at(i)) return false;
    const from = this.at(i)!, to = this.at(j);
    if (isBulk(from) && matches(to, from.kind, from.kind === 'food' ? from.food : undefined)) {
      const n = Math.min(from.n, STACK[from.kind] - to.n); to.n += n; from.n -= n;
      if (from.n < 1e-9) this.slots[i] = null;
    } else { this.slots[j] = from; this.slots[i] = to; }
    return true;
  }
}
