import * as THREE from 'three';
import { Raider, type Mover } from '../agents';
import { BUILDINGS, type BuildingKind } from '../world';
import { TILE, p } from '../config';
import type { VillageScene } from '../main';
import { U, WALL_UNITS } from './models';
import { groundHeight } from './terrain';
import { standHeight } from './actors';

// Marks laid on the world: the cursor, what is selected, the squad, held spots, build previews,
// range rings, loot rings. Immediate mode: every frame asks for what it wants and pools hand out
// meshes, so nothing has to remember what was drawn last frame.

const squareLine = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(1, 0, 1), new THREE.Vector3(0, 0, 1)]);
const circleLine = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 40 }, (_, i) => new THREE.Vector3(Math.cos((i / 40) * Math.PI * 2), 0, Math.sin((i / 40) * Math.PI * 2))));
const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0.5);
const disc = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2);
const arrowHead = new THREE.ConeGeometry(0.16, 0.32, 4).rotateX(Math.PI);
const pole = new THREE.CylinderGeometry(0.02, 0.02, 0.8, 4).translate(0, 0.4, 0);
const pennant = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.8, 0), new THREE.Vector3(0.4, 0.68, 0), new THREE.Vector3(0, 0.56, 0)]);
const ghostBox = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
const segLine = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1)]);

class Pool<T extends THREE.Object3D> {
  private items: T[] = [];
  private used = 0;
  constructor(private parent: THREE.Group, private make: () => T) {}
  take(): T {
    let o = this.items[this.used];
    if (!o) { o = this.make(); this.items.push(o); this.parent.add(o); }
    this.used++;
    o.visible = true;
    return o;
  }
  end(): void { for (let i = this.used; i < this.items.length; i++) this.items[i].visible = false; this.used = 0; }
}

const lineMat = () => new THREE.LineBasicMaterial({ transparent: true, depthTest: false });
const fillMat = () => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide });

export class Overlay {
  readonly group = new THREE.Group();
  private rects: Pool<THREE.LineLoop>;
  private fills: Pool<THREE.Mesh>;
  private circles: Pool<THREE.LineLoop>;
  private discs: Pool<THREE.Mesh>;
  private markers: Pool<THREE.Mesh>;
  private poles: Pool<THREE.Group>;
  private segs: Pool<THREE.Line>;
  private ghost: THREE.Mesh;
  private bars: Pool<THREE.Sprite>;
  private t = 0;

  constructor(private scene: VillageScene) {
    const g = this.group;
    g.renderOrder = 5;
    const order = <T extends THREE.Object3D>(o: T) => { o.renderOrder = 5; return o; };
    this.rects = new Pool(g, () => order(new THREE.LineLoop(squareLine, lineMat())));
    this.fills = new Pool(g, () => order(new THREE.Mesh(plane, fillMat())));
    this.circles = new Pool(g, () => order(new THREE.LineLoop(circleLine, lineMat())));
    this.discs = new Pool(g, () => order(new THREE.Mesh(disc, fillMat())));
    this.markers = new Pool(g, () => order(new THREE.Mesh(arrowHead, new THREE.MeshBasicMaterial({ color: 0xffe066, depthTest: false }))));
    this.poles = new Pool(g, () => { const gr = new THREE.Group(); gr.add(new THREE.Mesh(pole, new THREE.MeshBasicMaterial({ color: 0x2a1a16 })), new THREE.Mesh(pennant, new THREE.MeshBasicMaterial({ color: 0x78d8f0, side: THREE.DoubleSide }))); return gr; });
    this.segs = new Pool(g, () => order(new THREE.Line(segLine, lineMat())));
    this.bars = new Pool(g, () => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true })); sp.center.set(0, 0.5); sp.renderOrder = 11; return sp; });
    this.ghost = new THREE.Mesh(ghostBox, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false }));
    g.add(this.ghost);
  }

  private rect(x: number, z: number, w: number, d: number, colour: number, alpha: number, y?: number): void {
    const r = this.rects.take();
    r.position.set(x, (y ?? groundHeight(x + w / 2, z + d / 2)) + 0.04, z); r.scale.set(w, 1, d);
    const m = r.material as THREE.LineBasicMaterial; m.color.setHex(colour); m.opacity = alpha;
  }
  private fill(x: number, z: number, w: number, d: number, colour: number, alpha: number, y?: number): void {
    const f = this.fills.take();
    f.position.set(x, (y ?? groundHeight(x + w / 2, z + d / 2)) + 0.03, z); f.scale.set(w, 1, d);
    const m = f.material as THREE.MeshBasicMaterial; m.color.setHex(colour); m.opacity = alpha;
  }
  private ring(x: number, z: number, r: number, colour: number, alpha: number, fillAlpha = 0, y?: number): void {
    const yy = (y ?? groundHeight(x, z)) + 0.05;
    const c = this.circles.take();
    c.position.set(x, yy, z); c.scale.set(r, 1, r);
    const m = c.material as THREE.LineBasicMaterial; m.color.setHex(colour); m.opacity = alpha;
    if (fillAlpha > 0) {
      const d = this.discs.take();
      d.position.set(x, yy - 0.01, z); d.scale.set(r, 1, r);
      const dm = d.material as THREE.MeshBasicMaterial; dm.color.setHex(colour); dm.opacity = fillAlpha;
    }
  }
  private marker(x: number, y: number, z: number): void {
    const m = this.markers.take();
    m.position.set(x, y + 0.15 * Math.sin(this.t * 5.5), z);
  }
  private seg(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, colour: number, alpha: number): void {
    const l = this.segs.take();
    l.position.set(x0, y0, z0);
    l.lookAt(x1, y1, z1);
    l.scale.set(1, 1, Math.hypot(x1 - x0, y1 - y0, z1 - z0));
    const m = l.material as THREE.LineBasicMaterial; m.color.setHex(colour); m.opacity = alpha;
  }
  private moverRing(m: Mover, colour: number, pulse: number): void {
    const x = m.x * U, z = m.y * U;
    this.ring(x, z, 0.45 + 0.08 * pulse, colour, 0.9, 0.15 + 0.1 * pulse, groundHeight(x, z) + standHeight(m));
  }

  sync(dt: number): void {
    this.t += dt;
    const s = this.scene, pl = s.player;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 4.5);
    const playing = s.screen === 'playing' && !s.interior.active;
    if (playing) this.draw(pulse);
    if (s.screen !== 'title' && !s.interior.active) this.drawBars();
    this.rects.end(); this.bars.end(); this.fills.end(); this.circles.end(); this.discs.end(); this.markers.end(); this.poles.end(); this.segs.end();
    void pl;
  }

  private draw(pulse: number): void {
    const s = this.scene, pl = s.player, fog = s.fog;
    // loot at the head's feet: a breathing ring, bright when walking over it would take it
    for (const it of s.world.items) {
      if (!it.rest || pl.hidden || (it.x - pl.x) ** 2 + (it.y - pl.y) ** 2 > 40 * 40) continue;
      if (fog && fog.visibleAt(it.x, it.y) <= 0.3) continue;
      const a = s.itemRoom(it) > 0 && !it.playerDropPending ? 1 : 0.3;
      this.ring(it.x * U, it.y * U, 0.4 + 0.08 * pulse, 0xffe066, 0.85 * a, (0.1 + 0.08 * pulse) * a);
    }
    const tool = pl.tool;
    // a wall, gate or stairs where the held tool would put it
    if (tool === 'wall' || tool === 'gate' || tool === 'stairs') {
      const q = s.defenseTarget(), ok = !s.defenseProblem(tool, q);
      this.rect(q.tx, q.ty, 1, 1, ok ? 0xffd578 : 0xff4040, 1);
      this.ghost.visible = true;
      this.ghost.position.set(q.tx, groundHeight(q.tx + 0.5, q.ty + 0.5), q.ty);
      this.ghost.scale.set(1, tool === 'stairs' ? WALL_UNITS * 0.6 : WALL_UNITS, tool === 'gate' ? 0.4 : 1);
      if (tool === 'gate') this.ghost.position.z += 0.3;
      (this.ghost.material as THREE.MeshBasicMaterial).color.setHex(ok ? 0xffe066 : 0xff6060);
    } else this.ghost.visible = false;
    if (s.posting) for (const d of s.world.defenses.values()) this.fill(d.tx + 0.1, d.ty + 0.1, 0.8, 0.8, 0x78d8f0, 0.5, groundHeight(d.tx, d.ty) + WALL_UNITS + 0.25);
    // the shaman wand: the marquee, the squad, held spots, the hunted
    const wand = tool === 'wand';
    if (wand) {
      const CYAN = 0x78d8f0;
      if (s.drag) {
        const d = s.drag, x0 = Math.min(d.x0, d.x1) * U, z0 = Math.min(d.y0, d.y1) * U, w = Math.abs(d.x1 - d.x0) * U, h = Math.abs(d.y1 - d.y0) * U;
        this.fill(x0, z0, w, h, CYAN, 0.12); this.rect(x0, z0, w, h, CYAN, 0.9);
      }
      for (const v of s.squad) if (!v.dead && !v.hidden) this.moverRing(v, CYAN, pulse);
      const hunted = new Set<Mover>();
      for (const v of s.fighters()) {
        const o = v.order;
        if (!o) continue;
        if (o.kind === 'hold') {
          this.rect(o.tx + 0.2, o.ty + 0.2, 0.6, 0.6, CYAN, 0.35);
          const pg = this.poles.take(); pg.position.set(o.tx + 0.5, groundHeight(o.tx + 0.5, o.ty + 0.5), o.ty + 0.5);
        } else if (o.kind === 'attack' && !o.target.dead && !o.target.hidden) hunted.add(o.target);
      }
      for (const m of hunted) this.moverRing(m, 0xff4040, pulse);
    }
    // the target tile; in build mode the footprint
    const f = s.target;
    if (!wand && s.world.inBounds(f.tx, f.ty)) {
      if (pl.build !== 'none') {
        const kind = pl.build as BuildingKind, { w, h } = BUILDINGS[kind];
        const a = s.buildAnchor(kind), ok = !s.buildProblem(a, kind), c = ok ? 0xffe066 : 0xff4040;
        this.fill(a.tx, a.ty, w, h, c, 0.18); this.rect(a.tx, a.ty, w, h, c, 0.9);
        this.fill(a.tx + BUILDINGS[kind].door + 0.2, a.ty + h - 0.8, 0.6, 0.6, c, 0.5);
        if (kind === 'barracks') this.ring(a.tx + w / 2, a.ty + h / 2, p.towerRange / TILE, c, 0.6, 0.06);
        if (!s.cursorPlacing) this.seg(pl.x * U, groundHeight(pl.x * U, pl.y * U) + 0.06, pl.y * U, a.tx + w / 2, groundHeight(a.tx + w / 2, a.ty + h / 2) + 0.06, a.ty + h / 2, 0xffffff, 0.35);
      } else {
        const can = s.hint().startsWith('E:');
        if (tool === 'basket' && can) {
          const q = s.hoverTile ?? f, x0 = pl.x * U, z0 = pl.y * U;
          this.seg(x0, groundHeight(x0, z0) + 0.6, z0, q.tx + 0.5, groundHeight(q.tx + 0.5, q.ty + 0.5) + 0.05, q.ty + 0.5, 0xffe066, 0.5);
        }
        this.rect(f.tx + 0.05, f.ty + 0.05, 0.9, 0.9, can ? 0xffe066 : 0xffffff, can ? 0.95 : 0.55);
        const hv = s.hoverTile;
        if (hv && !s.cursorAiming && s.world.inBounds(hv.tx, hv.ty)) this.rect(hv.tx + 0.03, hv.ty + 0.03, 0.94, 0.94, 0xffffff, 0.2);
      }
    }
    // whatever the inspector shows, marked in the world
    const sel = s.selected;
    if (sel && !sel.dead && !sel.hidden && !(sel instanceof Raider && sel.lurking)) {
      this.moverRing(sel, 0xffe066, pulse);
      const x = sel.x * U, z = sel.y * U;
      this.marker(x, groundHeight(x, z) + standHeight(sel) + 1.9, z);
    }
    const st = s.selectedTile;
    if (st) { this.rect(st.tx, st.ty, 1, 1, 0xffe066, 0.5 + 0.4 * pulse); this.marker(st.tx + 0.5, groundHeight(st.tx + 0.5, st.ty + 0.5) + 1.2, st.ty + 0.5); }
    const si = s.selectedItem;
    if (si) { this.ring(si.x * U, si.y * U, 0.35 + 0.06 * pulse, 0xffe066, 0.9, 0.15); this.marker(si.x * U, groundHeight(si.x * U, si.y * U) + si.z * U + 1, si.y * U); }
    const sb = s.selectedBuilding;
    if (sb) {
      const bf = BUILDINGS[sb.kind];
      this.rect(sb.tx - 0.1, sb.ty - 0.1, bf.w + 0.2, bf.h + 0.2, 0xffe066, 0.5 + 0.4 * pulse);
      this.marker(sb.tx + bf.w / 2, groundHeight(sb.tx + bf.w / 2, sb.ty + bf.h / 2) + 3.6, sb.ty + bf.h / 2);
      if (sb.kind === 'barracks') { const c = s.towerCenter(sb); this.ring(c.x * U, c.y * U, s.towerRange(sb) / TILE, 0xffe066, 0.3, 0.03); }
    }
  }
  /** a flat bar floating at (x, y, z), filled to frac */
  private bar(x: number, y: number, z: number, w: number, frac: number, colour: number, back = 0x000000, h = 0.12): void {
    const bg = this.bars.take(); bg.center.set(0, 0.5);
    bg.position.set(x - w / 2 - 0.03, y, z); bg.scale.set(w + 0.06, h + 0.05, 1);
    const bm = bg.material as THREE.SpriteMaterial; bm.color.setHex(back); bm.opacity = 0.7; bm.rotation = 0;
    if (frac <= 0) return;
    const fg = this.bars.take(); fg.center.set(0, 0.5);
    fg.position.set(x - w / 2, y, z); fg.scale.set(Math.max(0.02, w * frac), h, 1);
    const fm = fg.material as THREE.SpriteMaterial; fm.color.setHex(colour); fm.opacity = 1; fm.rotation = 0;
  }

  /** Hurt buildings show what is left of them; a ruin a red cross; every barracks its arrow stock; hurt walls their hp. */
  private drawBars(): void {
    const s = this.scene, fog = s.fog;
    for (const b of s.world.buildings) {
      const f = BUILDINGS[b.kind], x = b.tx + f.w / 2, z = b.ty + f.h / 2;
      if (fog && fog.enabled && !fog.isExplored(Math.floor(x), Math.floor(z))) continue;
      const top = groundHeight(x, z) + (b.kind === 'barracks' ? 3.0 : b.kind === 'cookpot' ? 1.8 : 3.1);
      if (b.kind !== 'lair' && b.maxHp && b.ruined) {
        for (const r of [Math.PI / 4, -Math.PI / 4]) {
          const c = this.bars.take(); c.center.set(0.5, 0.5);
          c.position.set(x, top + 0.3, z); c.scale.set(0.8, 0.12, 1);
          const m = c.material as THREE.SpriteMaterial; m.color.setHex(0xff4040); m.opacity = 0.9; m.rotation = r;
        }
      } else if (b.kind !== 'lair' && b.maxHp && b.hp < b.maxHp) this.bar(x, top + 0.3, z, 1.5, b.hp / b.maxHp, b.hp / b.maxHp > 0.4 ? 0x5fdc5f : 0xff4040);
      if (b.kind === 'barracks' && !b.ruined) {
        const ammo = b.ammo ?? 0, cap = s.towerCap(b);
        this.bar(x, top + 0.1, z, 1.5, ammo / cap, ammo / cap > 0.25 ? 0xffd578 : 0xff5a3c, ammo > 0 ? 0x000000 : 0x5a1010);
      }
    }
    for (const d of s.world.defenses.values()) if (d.hp < d.maxHp) this.bar(d.tx + 0.5, groundHeight(d.tx + 0.5, d.ty + 0.5) + WALL_UNITS + 0.45, d.ty + 0.5, 0.9, d.hp / d.maxHp, 0xeab765, 0x1a1a25, 0.08);
  }
}
