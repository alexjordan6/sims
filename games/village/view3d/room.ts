import * as THREE from 'three';
import type { VillageScene } from '../main';
import { BUILDINGS, type Building } from '../world';
import type { InteriorKind } from '../config';
import { ROOM, type Furnishing } from '../interior';
import type { Mover } from '../agents';
import { lambert } from './ps1';
import { makeActor } from './actors';

// A building's inside, as a little diorama: floor, back and side walls, the furniture the room logic
// lays out (interior.ts), the people in it, a hearth that burns while the house is warm. The room has
// its own scene and camera; the PS1 pass draws it in place of the world while the head is indoors.
// Room pixels map to units at 16 to one, centred on the room: x 20..300, y 30..208.

const S = 1 / 16;
const RX = (x: number) => (x - 160) * S;
const RZ = (y: number) => (y - 120) * S;
const box = new THREE.BoxGeometry(1, 1, 1);
const cone = new THREE.ConeGeometry(0.5, 1, 5);
const hex = (s: string) => parseInt(s.slice(1, 7), 16);

function block(parent: THREE.Object3D, colour: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, emissive = 0): THREE.Mesh {
  const m = new THREE.Mesh(box, lambert({ color: colour, emissive }));
  m.position.set(x, y + sy / 2, z); m.scale.set(sx, sy, sz);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
}

export class Room3d {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60);
  private built: Building | null = null;
  private builtKey = '';
  private room = new THREE.Group();
  private fire = new THREE.PointLight(0xff9040, 0, 14, 1.2);
  private flames: THREE.Mesh[] = [];
  private people = new Map<Mover, THREE.Group>();
  private label: HTMLDivElement;
  private ray = new THREE.Raycaster();
  private floor!: THREE.Mesh;

  constructor(private s: VillageScene) {
    this.scene.add(new THREE.HemisphereLight(0x8a8a9a, 0x3a2a1e, 1.7), this.fire, this.room);
    const window = new THREE.DirectionalLight(0x8090b0, 0.4); window.position.set(-3, 8, 6); this.scene.add(window);
    this.scene.background = new THREE.Color(0x0a0808);
    this.label = document.createElement('div');
    this.label.className = 'room-label';
    this.label.hidden = true;
    document.getElementById('game')!.append(this.label);
  }

  /** Room pixels under a client point (for tapping the floor), or null off the floor. */
  floorAt(cx: number, cy: number, canvas: HTMLCanvasElement): { x: number; y: number } | null {
    const r = canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), this.camera);
    const hit = this.ray.intersectObject(this.floor)[0];
    return hit ? { x: hit.point.x / S + 160, y: hit.point.z / S + 120 } : null;
  }

  private build(b: Building): void {
    this.scene.remove(this.room);
    this.room = new THREE.Group();
    this.scene.add(this.room);
    this.flames = []; this.people.clear();
    const r = ROOM[b.kind as InteriorKind], g = this.room;
    const W = 280 * S, D = 178 * S, H = 2.6;
    // the floor: planks in two tones
    this.floor = block(g, hex(r.plankA), 0, -0.1, RZ(119), W, 0.1, D);
    for (let k = 0; k < 11; k++) block(g, hex(k % 2 ? r.plankB : r.plankLine), 0, -0.002, RZ(58 + k * 14), W, 0.004, 0.05);
    // the walls: back and sides (the front is open, like a dollhouse)
    block(g, hex(r.upper), 0, 0, RZ(30) - 0.1, W + 0.4, H, 0.2);
    block(g, hex(r.frame), -W / 2 - 0.1, 0, RZ(119), 0.2, H, D);
    block(g, hex(r.frame), W / 2 + 0.1, 0, RZ(119), 0.2, H, D);
    for (const x of [21, 124, 195, 294]) block(g, hex(r.post), RX(x + 2), 0, RZ(30) + 0.05, 0.25, H, 0.15);
    // windows on the back wall: night blue or day light
    const night = this.s.dayTime > 0.75 || this.s.dayTime < 0.25;
    for (const x of [88, 199]) { block(g, hex(r.sill), RX(x + 9), 1.0, RZ(30) + 0.02, 1.2, 1.0, 0.08); block(g, night ? 0x263654 : 0x83aeb1, RX(x + 9), 1.08, RZ(30) + 0.07, 0.95, 0.82, 0.04, night ? 0x0a1020 : 0x2a3a3c); }
    // the rug in the middle (a toadstool cap's spots under a gnome's roof) and the mat at the door
    block(g, hex(r.banner), RX(161), 0, RZ(133), 58 * S, 0.03, 82 * S);
    block(g, hex(r.bannerTrim), RX(161), 0.005, RZ(133), 52 * S, 0.03, 76 * S).scale.y = 0.02;
    block(g, hex(r.banner), RX(161), 0.01, RZ(133), 48 * S, 0.03, 72 * S);
    if (r.spots) for (const [sx, sy] of [[145, 105], [168, 116], [149, 134], [172, 146], [155, 160]]) block(g, 0xffffff, RX(sx), 0.02, RZ(sy), 0.5, 0.03, 0.4);
    block(g, hex(r.mat), RX(160), 0, RZ(208), 28 * S, 0.03, 12 * S);
    for (const f of this.s.interior.furniture) this.furnish(f, b);
    // from the open front, high enough to see over the beds; aimed a little behind centre so the hearth clears the top bar
    this.camera.position.set(0, 14, 10.5);
    this.camera.lookAt(0, 0, -1.6);
  }

  private furnish(f: Furnishing, b: Building): void {
    const g = this.room, r = ROOM[b.kind as InteriorKind];
    const x = RX(f.x + f.w / 2), z = RZ(f.y + f.h / 2), w = f.w * S, d = f.h * S;
    switch (f.kind) {
      case 'bed':
        block(g, 0x402a22, x, 0, z, w, 0.32, d);
        block(g, 0xeee0bd, x, 0.32, z - d / 2 + 0.3, w - 0.1, 0.12, 0.4);
        block(g, hex(r.blanket), x, 0.32, z + 0.2, w - 0.08, 0.1, d - 0.7);
        break;
      case 'hearth': {
        block(g, 0x969083, x, 0, z - 0.3, w, 1.7, d * 0.7);
        block(g, 0x211a1c, x, 0, z - 0.05, w - 0.6, 1.0, d * 0.45);
        block(g, 0xb2a38d, x, 1.7, z - 0.3, w + 0.3, 0.15, d * 0.8);
        // logs stacked beside it: one per night of wood
        for (let i = 0; i < b.firewood; i++) block(g, 0x8f5c34, x + w / 2 + 0.35, i * 0.18, z, 0.45, 0.16, 0.2);
        if (b.warm) for (let i = 0; i < 5; i++) {
          const fl = new THREE.Mesh(cone, lambert({ color: i % 2 ? 0xffc85f : 0xe8803b, emissive: i % 2 ? 0xffa030 : 0xd05010 }));
          fl.position.set(x - 0.8 + i * 0.4, 0.3, z); fl.scale.set(0.3, 0.6, 0.3);
          g.add(fl); this.flames.push(fl);
        }
        this.fire.position.set(x, 1.0, z + 0.8);
        break;
      }
      case 'shelf':
        block(g, 0xb78453, x, 0, z - 0.2, w, 1.5, 0.4);
        for (let i = 0; i < 7; i++) block(g, [0x818f69, 0xb45f53, 0xe0b57a][i % 3], x - w / 2 + 0.2 + i * 0.27, 0.9, z, 0.18, 0.45, 0.25);
        break;
      case 'rack':
        block(g, 0x3e2c23, x, 0, z - 0.2, w, 1.4, 0.3);
        for (let i = 0; i < 6; i++) block(g, 0xd3ab6d, x - w / 2 + 0.45 + i * 0.5, 0.2, z, 0.05, 1.1, 0.05);
        break;
      case 'chest': {
        block(g, 0x7a5236, x, 0, z, w, 0.6, d);
        block(g, 0x6d7378, x - w / 2 + 0.3, 0, z, 0.12, 0.62, d + 0.02);
        block(g, 0x6d7378, x + w / 2 - 0.3, 0, z, 0.12, 0.62, d + 0.02);
        block(g, 0xd9b25a, x, 0.35, z + d / 2, 0.2, 0.2, 0.04);
        const stock = Math.min(4, Math.ceil((b.ammo ?? 0) / (this.s.towerCap(b) / 4)));
        for (let i = 0; i < stock; i++) block(g, 0xd3ab6d, x - 0.4 + i * 0.25, 0.6, z, 0.04, 0.5, 0.04);
        break;
      }
      case 'crib':
        block(g, 0x5a3a28, x, 0, z, w, 0.35, d);
        block(g, 0xc9a26b, x, 0.35, z, w - 0.12, 0.05, d - 0.12);
        for (let i = 0; i < 4; i++) block(g, 0x8a5c34, x - w / 2 + 0.1 + i * (w - 0.2) / 3, 0.35, z + d / 2 - 0.04, 0.04, 0.35, 0.04);
        break;
      case 'bar':
        block(g, 0x422c21, x, 0, z, w, 0.85, d);
        block(g, 0xb0824c, x, 0.85, z, w + 0.1, 0.08, d + 0.1);
        break;
      default: // a table, a candle on it
        block(g, 0x422c21, x - w / 2 + 0.2, 0, z, 0.12, 0.5, 0.12);
        block(g, 0x422c21, x + w / 2 - 0.2, 0, z, 0.12, 0.5, 0.12);
        block(g, 0xb0824c, x, 0.5, z, w, 0.08, d);
        block(g, 0xf6d992, x, 0.58, z, 0.08, 0.2, 0.08, 0xffbd53);
    }
  }

  private person(m: Mover, x: number, y: number, scale: number, key: string): void {
    let grp = this.people.get(m);
    if (!grp || grp.userData.key !== key) {
      if (grp) this.room.remove(grp);
      grp = new THREE.Group();
      const { body } = makeActor(m);
      body.traverse((o) => { o.castShadow = true; });
      grp.add(body); grp.userData.key = key;
      this.room.add(grp); this.people.set(m, grp);
    }
    grp.position.set(RX(x), 0, RZ(y));
    grp.scale.setScalar(scale);
    grp.userData.seen = true;
  }

  /** Per frame while indoors: rebuild on a new room, place everyone, flicker the fire, label the room. */
  sync(dt: number): void {
    const s = this.s, it = s.interior, b = it.building;
    if (!b) { this.label.hidden = true; this.built = null; return; }
    const key = `${b.kind}|${b.level}|${b.warm}|${b.firewood}|${b.ammo ?? 0}|${it.furniture.length}`;
    if (this.built !== b || this.builtKey !== key) { this.built = b; this.builtKey = key; this.build(b); }
    for (const g of this.people.values()) g.userData.seen = false;
    const residents = s.villagers().filter((v) => v.hidden && v.indoors === b && v.role !== 'infant');
    const small = b.kind === 'gnomehouse' ? 0.8 : 1;
    residents.forEach((v, i) => this.person(v, 46 + (i % 3) * 28, 86 + Math.floor(i / 3) * 46, small * (v.gnome ? 0.55 : v.isChild ? 0.68 : 1), 'r' + v.role + v.gnome));
    const cribs = it.furniture.filter((f) => f.kind === 'crib'), infants = s.infantsOf(b);
    infants.slice(0, cribs.length).forEach((v, i) => { const f = cribs[i]; this.person(v, f.x + f.w / 2, f.y + f.h / 2, 0.4, 'i'); });
    const keeper = s.villagers().find((v) => v.role !== 'kid');
    if (b.kind === 'tavern' && keeper) this.person(keeper, 247, 50, 1, 'k');
    this.person(s.player, it.x, it.y, 1, 'p');
    for (const [m, g] of this.people) if (!g.userData.seen) { this.room.remove(g); this.people.delete(m); }
    // the head turns to walk, and bobs
    const pg = this.people.get(s.player);
    if (pg) {
      const k = s.player.keys, mx = Number(k.D.isDown) - Number(k.A.isDown), my = Number(k.S.isDown) - Number(k.W.isDown);
      if (mx || my) pg.rotation.y = Math.atan2(mx, my);
      pg.position.y = it.moving ? Math.abs(Math.sin(it.time * 12)) * 0.06 : 0;
    }
    // the fire
    this.flames.forEach((f, i) => { f.scale.y = 0.45 + 0.25 * Math.abs(Math.sin(it.time * 8 + i * 2)); });
    this.fire.intensity = b.warm ? 6 + Math.sin(it.time * 13) * 0.8 : 0;
    // the room's name, and a warning while there is fighting outside
    const text = `${BUILDINGS[b.kind].name} · Lv${b.level}${s.raidActive ? ' — RAID OUTSIDE' : ''}`;
    if (this.label.textContent !== text) this.label.textContent = text;
    this.label.classList.toggle('raid', s.raidActive);
    this.label.hidden = false;
    void dt;
  }

  resize(w: number, h: number): void { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
}
