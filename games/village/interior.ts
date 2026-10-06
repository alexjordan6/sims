import type { VillageScene } from './main';
import { BUILDINGS, World, doorstep, hearthCost, type Building } from './world';
import { p, hasInterior, type InteriorKind } from './config';

export type Furnishing = { x: number; y: number; w: number; h: number; kind: 'bed' | 'table' | 'hearth' | 'rack' | 'bar' | 'shelf' | 'chest' | 'crib'; label: string };

/** The colours one kind of room is built from; draw() reads nothing else, so a new interior is a new row here. */
export interface Room {
  bg: string; frame: string; base: string;
  plankA: string; plankB: string; plankLine: string;
  upper: string; upperLine: string; post: string; sill: string;
  banner: string; bannerTrim: string; bannerStud: string;
  /** toadstool caps are spotted; everyone else's hanging is plain */
  spots?: boolean;
  blanket: string; mat: string; matTrim: string; glow: string;
}
const COTTAGE: Room = {
  bg: '#1b151b', frame: '#281c20', base: '#624331',
  plankA: '#85603e', plankB: '#926b46', plankLine: '#795334',
  upper: '#50302b', upperLine: '#765044', post: '#ae7849', sill: '#d6a668',
  banner: '#934646', bannerTrim: '#d4a568', bannerStud: '#e3b577',
  blanket: '#a75556', mat: '#16121a', matTrim: '#e7b970', glow: '#ffc36a24',
};
export const ROOM: Record<InteriorKind, Room> = {
  house: COTTAGE,
  tavern: COTTAGE,
  barracks: { ...COTTAGE, banner: '#375575', blanket: '#456989' },
  // under the cap: packed earth, pale plaster, red timber, and a spotted toadstool hanging
  gnomehouse: {
    bg: '#17131a', frame: '#2a1f22', base: '#4a4234',
    plankA: '#7d6a4a', plankB: '#8b7854', plankLine: '#6a5942',
    upper: '#c4b49a', upperLine: '#a9977c', post: '#8c3b32', sill: '#e2cfae',
    banner: '#b8463c', bannerTrim: '#f2e7d5', bannerStud: '#f2e7d5', spots: true,
    blanket: '#4f7a4a', mat: '#1a1410', matTrim: '#f2c87a', glow: '#ffb85a2e',
  },
};

/** Walkable rooms use their own coordinates; the outdoor simulation keeps running. */
export class Interior {
  building: Building | null = null;
  x = 160;
  y = 193;
  /** what stands in the room, in room pixels (the 3D view builds it from this: see view3d/room.ts) */
  furniture: Furnishing[] = [];
  private destination: { x: number; y: number } | null = null;
  time = 0;
  private mealAt = -99;
  /** walking this frame (for the gait) */
  moving = false;
  constructor(private s: VillageScene) {}
  get active(): boolean { return !!this.building; }

  enter(b: Building): void {
    if (!hasInterior(b.kind)) return;
    if (b.ruined) { this.s.event('build', `Only ashes and rubble in the ${BUILDINGS[b.kind].name.toLowerCase()} — rebuild it with the hammer first.`, true); return; }
    this.building = b; this.x = 160; this.y = 191; this.destination = null;
    this.s.player.hidden = true; this.s.player.swing = null; this.s.player.vx = this.s.player.vy = 0;
    this.s.selectedBuilding = b; this.s.selected = null;
    this.furniture = [
      { x: 139, y: 34, w: 42, h: 23, kind: 'hearth', label: b.kind === 'tavern' ? 'Share a hot meal · 2 food' : 'Warm yourself by the hearth' }, // label is refreshed live by hint()
      { x: 26, y: 36, w: 35, h: 18, kind: 'shelf', label: 'Books, keepsakes and family stories' },
    ];
    if (b.kind === 'house') {
      for (let i = 0; i < Math.min(6, this.s.beds(b)); i++) this.furniture.push({ x: 32 + i % 3 * 29, y: 73 + Math.floor(i / 3) * 47, w: 22, h: 34, kind: 'bed', label: 'A soft bed · rest by the hearth' });
      this.furniture.push({ x: 211, y: 101, w: 58, h: 26, kind: 'table', label: 'The family table' });
      // the nursery: a row of cribs along the right wall (label is refreshed live by hint())
      for (let i = 0; i < Math.min(8, this.s.cribs(b)); i++) this.furniture.push({ x: 202 + i % 4 * 23, y: 138 + Math.floor(i / 4) * 30, w: 19, h: 22, kind: 'crib', label: 'Nursery' });
    } else if (b.kind === 'barracks') {
      for (let i = 0; i < 3 + b.level; i++) this.furniture.push({ x: 30 + i % 3 * 28, y: 76 + Math.floor(i / 3) * 46, w: 21, h: 32, kind: 'bed', label: 'Soldiers’ bunks' });
      this.furniture.push({ x: 220, y: 42, w: 59, h: 29, kind: 'rack', label: 'Fletch 10 arrows · 2 wood' }, { x: 208, y: 112, w: 62, h: 27, kind: 'table', label: 'Command table · inspect soldiers to equip bows and set posts' });
      this.furniture.push({ x: 226, y: 162, w: 36, h: 24, kind: 'chest', label: 'Armor chest' }); // label is filled in live by hint()
    } else if (b.kind === 'gnomehouse') {
      for (let i = 0; i < Math.min(6, this.s.beds(b)); i++) this.furniture.push({ x: 30 + i % 3 * 26, y: 84 + Math.floor(i / 3) * 44, w: 18, h: 26, kind: 'bed', label: 'A little bed under the cap' });
      this.furniture.push({ x: 124, y: 141, w: 46, h: 22, kind: 'table', label: 'The family table' });
      // gnome cottages breed like any house, so their nursery needs cribs to show the infants in
      for (let i = 0; i < Math.min(4, this.s.cribs(b)); i++) this.furniture.push({ x: 214 + i % 2 * 23, y: 134 + Math.floor(i / 2) * 30, w: 19, h: 22, kind: 'crib', label: 'Nursery' });
    } else {
      this.furniture.push({ x: 212, y: 52, w: 67, h: 24, kind: 'bar', label: 'Hot stew · 2 food' });
      for (const [x, y] of [[42, 92], [216, 105], [55, 146], [208, 153]]) this.furniture.push({ x, y, w: 43, h: 22, kind: 'table', label: 'Gather around the table' });
    }
    this.s.event('info', `Inside ${BUILDINGS[b.kind].name}. Move with WASD, the joystick, or tap the floor.`, true);
  }
  leave(): void {
    if (!this.building) return;
    const b = this.building; this.building = null;
    const d = doorstep(b), p = this.s.player;
    if (p) { Object.assign(p, World.center(d.tx, d.ty)); p.hidden = false; p.vx = p.vy = 0; p.touch.x = p.touch.y = 0; p.clearGoal(); }
    this.destination = null;
  }
  /** A tap on the room's floor at room pixels (x, y): walk there, or act when it is the head itself (or the right button). */
  tap(x: number, y: number, right: boolean): void {
    if (Math.hypot(x - this.x, y - this.y) < 20 || right) { this.act(); return; }
    this.destination = { x, y };
  }
  private free(x: number, y: number): boolean {
    if (x < 23 || x > 297 || y < 58 || y > 205) return false;
    return !this.furniture.some(f => x > f.x - 4 && x < f.x + f.w + 4 && y > f.y - 2 && y < f.y + f.h + 4);
  }
  update(dt: number): void {
    this.time += dt;
    const p = this.s.player, k = p.keys;
    let dx = Number(k.D.isDown) - Number(k.A.isDown) + p.touch.x;
    let dy = Number(k.S.isDown) - Number(k.W.isDown) + p.touch.y;
    if (dx || dy) this.destination = null;
    else if (this.destination) {
      dx = this.destination.x - this.x; dy = this.destination.y - this.y;
      if (Math.hypot(dx, dy) < 3) { this.destination = null; dx = dy = 0; }
    }
    this.moving = !!(dx || dy);
    const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    const nx = this.x + dx * 55 * dt, ny = this.y + dy * 55 * dt;
    if (this.free(nx, this.y)) this.x = nx;
    if (this.free(this.x, ny)) this.y = ny;
    if (dx) p.dir = dx < 0 ? -1 : 1;
    if (this.y > 201 && Math.abs(this.x - 160) < 14) this.leave();
  }
  private nearby(): Furnishing | undefined {
    return [...this.furniture].sort((a, b) => this.distance(a) - this.distance(b)).find(f => this.distance(f) < 26);
  }
  private distance(f: Furnishing): number {
    return Math.hypot(Math.max(f.x - this.x, 0, this.x - f.x - f.w), Math.max(f.y - this.y, 0, this.y - f.y - f.h));
  }
  hint(): string {
    if (this.y > 175 && Math.abs(this.x - 160) < 30) return 'E: exit to the village';
    const f = this.nearby();
    if (f?.kind === 'crib' && this.building) { const b = this.building, why = this.s.birthProblem(b); f.label = `Nursery · ${this.s.infantsOf(b).length} of ${this.s.cribs(b)} cribs${why ? ` · no births: ${why}` : ` · next birth roll in ${Math.ceil(this.s.birthIn(b))}s (${Math.round(100 * this.s.birthChance(b))}%)`} · infants walk out into the yard after ${p.infantDays} days`; }
    if (f?.kind === 'chest' && this.building) f.label = `Armor chest · tower arrows ${this.building.ammo ?? 0} / ${this.s.towerCap(this.building)} · restock 10 for 2 wood · forge armor`;
    if (f?.kind === 'hearth' && this.building) {
      const b = this.building, pile = `${b.firewood} / ${p.hearthNights} nights of wood · burns ${hearthCost(b)} a night`;
      f.label = b.warm ? `${b.kind === 'tavern' ? 'Share a hot meal · 2 food' : 'Warm yourself by the hearth'} · ${pile}` : `Cold hearth · ${pile} · woodcutters bring firewood`;
    }
    return f ? `E: ${f.label}` : 'Walk around · approach the hearth, beds or equipment · door below to leave';
  }
  act(): void {
    if (!this.building) return;
    if (this.y > 175 && Math.abs(this.x - 160) < 30) { this.leave(); return; }
    const f = this.nearby(); if (!f) return;
    if (f.kind === 'rack') { this.s.craftArrows(); return; }
    if (f.kind === 'chest') { this.s.openArmory(this.s.player, this.building); return; }
    if (f.kind === 'hearth' || f.kind === 'bar' || f.kind === 'bed') {
      if (!this.building.warm) { this.s.event('info', 'The hearth is cold — there is no fire to rest by until the pile is stocked and dawn lights it.', true); return; }
      if (this.time - this.mealAt < 8) { this.s.event('info', 'Enjoy the warmth a little longer before resting again.'); return; }
      const cost = this.building.kind === 'tavern' ? 2 : 1;
      if (this.s.food < cost) { this.s.event('food', 'Bring some food for a warm meal.'); return; }
      this.s.food -= cost; this.mealAt = this.time;
      const hp = this.building.kind === 'tavern' ? 5 + this.building.level * 15 : 12;
      this.s.player.hp = Math.min(this.s.player.maxHp, this.s.player.hp + hp);
      this.s.player.hunger = Math.min(p.hungerMax, this.s.player.hunger + cost); // a meal is a meal
      this.s.event('food', `A warm meal and a quiet moment · restored ${hp} HP.`, true); return;
    }
    this.s.selectBuilding(this.building);
    this.s.event('info', f.label);
  }

}
