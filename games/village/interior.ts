import type { VillageScene } from './main';
import { BUILDINGS, World, doorstep, hearthCost, type Building } from './world';
import { p } from './config';
import { ensureCharacter, frameSize } from './characters';
import { lookFor } from './render';
import type { Mover } from './agents';

type Furnishing = { x: number; y: number; w: number; h: number; kind: 'bed' | 'table' | 'hearth' | 'rack' | 'bar' | 'shelf' | 'chest' | 'crib'; label: string };

/** Walkable rooms use their own coordinates; the outdoor simulation keeps running. */
export class Interior {
  building: Building | null = null;
  x = 160;
  y = 193;
  private canvas?: HTMLCanvasElement;
  private ctx?: CanvasRenderingContext2D;
  private furniture: Furnishing[] = [];
  private destination: { x: number; y: number } | null = null;
  private time = 0;
  private mealAt = -99;
  /** walking this frame (for the gait) */
  private moving = false;
  constructor(private s: VillageScene) {}
  get active(): boolean { return !!this.building; }

  enter(b: Building): void {
    if (!['house', 'barracks', 'tavern'].includes(b.kind)) return;
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
    } else {
      this.furniture.push({ x: 212, y: 52, w: 67, h: 24, kind: 'bar', label: 'Hot stew · 2 food' });
      for (const [x, y] of [[42, 92], [216, 105], [55, 146], [208, 153]]) this.furniture.push({ x, y, w: 43, h: 22, kind: 'table', label: 'Gather around the table' });
    }
    if (!this.canvas) {
      this.canvas = document.createElement('canvas'); this.canvas.width = 320; this.canvas.height = 224;
      this.canvas.className = 'interior-view'; this.canvas.setAttribute('aria-label', 'Walkable building interior. WASD or joystick to move; tap a destination; use C or the action button.');
      this.ctx = this.canvas.getContext('2d')!;
      document.getElementById('game')!.append(this.canvas);
      this.canvas.addEventListener('pointerdown', e => {
        e.stopPropagation(); e.preventDefault();
        const r = this.canvas!.getBoundingClientRect(), scale = Math.min(r.width / 320, r.height / 224);
        const x = (e.clientX - r.left - (r.width - 320 * scale) / 2) / scale;
        const y = (e.clientY - r.top - (r.height - 224 * scale) / 2) / scale;
        if (x > 270 && y < 25) { this.leave(); return; }
        if (Math.hypot(x - this.x, y - this.y) < 20 || e.button === 2) { this.act(); return; }
        this.destination = { x, y };
      });
      this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    }
    this.canvas.hidden = false;
    this.s.event('info', `Inside ${BUILDINGS[b.kind].name}. Move with WASD, the joystick, or tap the floor.`, true);
  }
  leave(): void {
    if (!this.building) return;
    const b = this.building; this.building = null;
    if (this.canvas) this.canvas.hidden = true;
    const d = doorstep(b), p = this.s.player;
    if (p) { Object.assign(p, World.center(d.tx, d.ty)); p.hidden = false; p.vx = p.vy = 0; p.touch.x = p.touch.y = 0; p.clearGoal(); }
    this.destination = null;
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
    if (f?.kind === 'crib' && this.building) { const b = this.building, why = this.s.birthProblem(b); f.label = `Nursery · ${this.s.infantsOf(b).length} of ${this.s.cribs(b)} cribs${why ? ` · no births: ${why}` : ` · next birth roll in ${Math.ceil(this.s.birthIn(b))}s (${Math.round(100 * this.s.birthChance(b))}%)`} · infants walk out to a pen after ${p.infantDays} days`; }
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
      this.s.event('food', `A warm meal and a quiet moment · restored ${hp} HP.`, true); return;
    }
    this.s.selectBuilding(this.building);
    this.s.event('info', f.label);
  }

  draw(): void {
    if (!this.building || !this.ctx) return;
    const c = this.ctx, b = this.building;
    c.imageSmoothingEnabled = false;
    const rect = (x: number, y: number, w: number, h: number, color: string) => { c.fillStyle = color; c.fillRect(Math.round(x), Math.round(y), w, h); };
    rect(0, 0, 320, 224, '#1b151b');
    rect(15, 26, 290, 188, '#281c20'); rect(20, 30, 280, 178, '#624331');
    for (let y = 57; y < 208; y += 8) for (let x = 21; x < 299; x += 28) {
      rect(x, y, 27, 7, ((x + y) % 3) ? '#85603e' : '#926b46'); rect(x + 4, y + 5, 10, 1, '#795334');
    }
    rect(20, 30, 280, 28, '#50302b');
    for (let y = 31; y < 55; y += 6) rect(21, y, 278, 1, '#765044');
    for (const x of [21, 124, 195, 294]) rect(x, 30, 4, 29, '#ae7849');
    for (const x of [88, 199]) { rect(x, 34, 18, 17, '#d6a668'); rect(x + 2, 36, 14, 13, this.s.dayTime > 0.75 || this.s.dayTime < 0.25 ? '#263654' : '#83aeb1'); rect(x + 8, 35, 2, 15, '#51372d'); rect(x + 2, 42, 14, 2, '#51372d'); }
    rect(132, 92, 58, 82, b.kind === 'barracks' ? '#375575' : '#934646');
    c.strokeStyle = '#d4a568'; c.strokeRect(135.5, 95.5, 51, 75);
    for (let y = 100; y < 170; y += 9) { rect(132, y, 3, 3, '#e3b577'); rect(187, y, 3, 3, '#e3b577'); }
    rect(146, 202, 28, 12, '#16121a'); rect(146, 201, 28, 2, '#e7b970');
    for (const f of this.furniture) {
      const { x, y, w, h, kind } = f;
      rect(x + 2, y + h - 3, w + 2, 6, '#433026');
      if (kind === 'bed') {
        rect(x, y, w, h, '#402a22'); rect(x + 2, y + 2, w - 4, h - 5, '#b98152');
        rect(x + 3, y + 4, w - 6, 7, '#eee0bd'); rect(x + 2, y + 12, w - 4, h - 16, b.kind === 'barracks' ? '#456989' : '#a75556');
        rect(x + 4, y + 14, 2, h - 19, '#d2a16e');
      } else if (kind === 'hearth') {
        rect(x, y, w, h, '#969083'); rect(x + 4, y + 4, w - 8, h - 4, '#211a1c');
        if (b.warm) for (let i = 0; i < 5; i++) { const flame = 5 + Math.sin(this.time * 8 + i * 2) * 3; rect(x + 7 + i * 6, y + h - flame, 5, flame, i % 2 ? '#ffc85f' : '#e8803b'); }
        else for (let i = 0; i < 3; i++) rect(x + 9 + i * 9, y + h - 3, 4, 2, i % 2 ? '#4a2a22' : '#6b3a2a'); // cold: a few dead embers
        // the woodpile beside it shows how many nights are left
        for (let i = 0; i < b.firewood; i++) { rect(x + w + 4, y + h - 4 - i * 4, 9, 3, '#8f5c34'); rect(x + w + 4, y + h - 4 - i * 4, 2, 3, '#d3ab6d'); }
        rect(x - 3, y, w + 6, 3, '#b2a38d');
      } else if (kind === 'rack') {
        rect(x, y, w, h, '#3e2c23'); rect(x + 2, y + 3, w - 4, 3, '#b17c49');
        for (let i = 0; i < 6; i++) { rect(x + 6 + i * 8, y + 7, 2, 20, '#d3ab6d'); rect(x + 5 + i * 8, y + 7, 4, 3, '#d2d8d8'); }
      } else if (kind === 'chest') {
        // an iron-banded chest; arrow fletchings stick out of the lid while the tower has any
        rect(x, y + 6, w, h - 6, '#3e2c23'); rect(x + 2, y + 8, w - 4, h - 10, '#7a5236');
        rect(x, y + 2, w, 6, '#4b3328'); rect(x + 1, y + 3, w - 2, 3, '#8a5d3d');
        for (const u of [4, w - 8]) { rect(x + u, y + 2, 4, h - 2, '#6d7378'); rect(x + u + 1, y + 2, 2, h - 2, '#9aa1a6'); }
        rect(x + w / 2 - 3, y + 6, 6, 6, '#d9b25a'); rect(x + w / 2 - 1, y + 8, 2, 3, '#3e2c23');
        const stock = Math.min(4, Math.ceil((b.ammo ?? 0) / (this.s.towerCap(b) / 4)));
        for (let i = 0; i < stock; i++) { rect(x + 8 + i * 5, y - 6, 1, 9, '#d3ab6d'); rect(x + 7 + i * 5, y - 7, 3, 3, i % 2 ? '#d2d8d8' : '#c9564a'); }
      } else if (kind === 'crib') {
        rect(x, y + 4, w, h - 4, '#5a3a28'); rect(x + 2, y + 6, w - 4, h - 8, '#c9a26b'); rect(x + 2, y + 6, w - 4, 4, '#eee0bd');
        for (let i = 0; i < w; i += 3) rect(x + i, y, 1, h, '#8a5c34');
        rect(x, y, w, 1, '#a87848'); rect(x, y + h - 1, w, 1, '#3e2c23');
      } else if (kind === 'shelf') {
        rect(x, y, w, h, '#b78453');
        for (let i = 0; i < 7; i++) rect(x + 3 + i * 4, y + 3, 3, 11, ['#818f69', '#b45f53', '#e0b57a'][i % 3]);
      } else {
        rect(x, y, w, h, '#422c21'); rect(x + 2, y + 2, w - 4, h - 4, '#b0824c'); rect(x + 2, y + 3, w - 4, 2, '#d4a569');
        for (const u of [8, w - 11]) { rect(x + u, y + 7, 6, 5, '#e9d8b0'); rect(x + u + 1, y + 8, 4, 2, '#9c5834'); }
        rect(x + w / 2, y + 6, 3, 7, '#f6d992'); rect(x + w / 2 + 1, y + 3, 1, 3, '#ffbd53');
      }
    }
    // people are drawn with their real looks (outfit, armor, dye), the same textures the world uses
    const person = (x: number, y: number, m: Mover, walk = false, scale = 1) => {
      const look = lookFor(m); if (!look) return;
      const key = ensureCharacter(this.s, look), { w, h } = frameSize(look.body);
      const tex = this.s.textures.getFrame(key, walk ? 1 : 0); if (!tex) return;
      c.drawImage(tex.source.image as CanvasImageSource, tex.cutX, tex.cutY, tex.width, tex.height, Math.round(x - w * scale / 2), Math.round(y - h * scale * 0.75), w * scale, h * scale);
    };
    const residents = this.s.villagers().filter(v => v.hidden && v.indoors === b && v.role !== 'infant');
    residents.forEach((v, i) => person(46 + i % 3 * 28, 86 + Math.floor(i / 3) * 46, v));
    // infants in their cribs (a crowded nursery shows the overflow as a count)
    const cribs = this.furniture.filter(f => f.kind === 'crib'), infants = this.s.infantsOf(b);
    infants.slice(0, cribs.length).forEach((v, i) => { const f = cribs[i]; person(f.x + f.w / 2, f.y + f.h - 3 + Math.sin(this.time * 2 + i) * 0.5, v, false, 0.7); });
    if (infants.length > cribs.length) { c.font = '8px monospace'; c.fillStyle = '#f0d4a2'; c.fillText(`+${infants.length - cribs.length}`, 282, 200); }
    const keeper = this.s.villagers().find(v => v.role !== 'kid');
    if (b.kind === 'tavern' && keeper) person(247, 47, keeper);
    const p = this.s.player;
    person(this.x, this.y, p, this.moving && Math.floor(this.time / 0.18) % 2 === 1);
    // Warm radial firelight, contained inside the room; the outside night keeps advancing.
    if (b.warm) { const glow = c.createRadialGradient(160, 60, 5, 160, 90, 145); glow.addColorStop(0, '#ffc36a24'); glow.addColorStop(1, '#00000000'); c.fillStyle = glow; c.fillRect(20, 30, 280, 177); }
    else { c.fillStyle = '#1a2a4018'; c.fillRect(20, 30, 280, 177); }
    c.font = '10px monospace'; c.fillStyle = '#f0d4a2'; c.fillText(`${BUILDINGS[b.kind].name} · Lv${b.level}`, 19, 17);
    c.fillStyle = '#cba984'; c.fillText('EXIT ×', 270, 17);
    if (this.s.raidActive) { c.fillStyle = '#ff7860'; c.fillText('RAID OUTSIDE', 119, 220); }
  }
}
