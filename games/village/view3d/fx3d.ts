import * as THREE from 'three';
import { Mover, Villager, Raider, Player } from '../agents';
import { Bolt } from '../enemies';
import { TILE, OGRE, GNOME_HOME, FOODS } from '../config';
import { buildingCenter, BUILDINGS, type Building } from '../world';
import { Sfx } from '../sfx';
import type { VillageScene, FxEvent } from '../main';
import { U } from './models';
import { groundHeight } from './terrain';
import type { Actors } from './actors';
import { skyAt } from './sky';

// What the sim's fx queue looks like in 3D: bursts of low-poly specks, swings and thrusts drawn as
// fading arcs and streaks, words floating up from where they happened, and every sound the 2D game
// made, in the same places. Also the two places that are felt before they are seen — the cold wind
// round the Ogre's lair and the gnomes' warm glade — which tell the journal when you first walk in.

const MAX = 900;
const speck = new THREE.BoxGeometry(0.07, 0.07, 0.07);

interface Speck { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number; grav: number }

/** Things that need the view: where to put words on screen, and how to jolt the camera. */
export interface FxHost {
  project(v: THREE.Vector3): { x: number; y: number; on: boolean };
  shake(amount: number): void;
  bump(zoom: number, ms: number): void;
}

interface Word { el: HTMLDivElement; pos: THREE.Vector3; t: number; ttl: number }
interface Streak { obj: THREE.Object3D; mat: THREE.Material & { opacity: number }; t: number; ttl: number; grow?: number }
/** a line that fades: its ends, its colour, and its clock (drawn together with every other, see Lines) */
interface Line { ax: number; ay: number; az: number; bx: number; by: number; bz: number; r: number; g: number; b: number; t: number; ttl: number }
/** the shapes swings and shocks are drawn with: made once and shared, never one per blow */
const ARC = new THREE.RingGeometry(0.55, 0.85, 14, 1, 0, 2.4).rotateX(-Math.PI / 2);
const SPIN = new THREE.RingGeometry(0.55, 0.85, 14, 1, 0, Math.PI * 2).rotateX(-Math.PI / 2);
const SHOCK = new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2);
/** at most this many arcs and shocks at once: in a battle of thousands the oldest give way */
const ARCS_MAX = 160;
/** room for this many fading lines (a pike's thrust, an arrow's flight) at once */
const LINES_MAX = 2048;

export class Fx3d {
  readonly sfx = new Sfx();
  readonly group = new THREE.Group();
  private specks: Speck[] = [];
  private mesh: THREE.InstancedMesh;
  private words: Word[] = [];
  private streaks: Streak[] = [];
  /** every fading line, drawn as one batch: one geometry and one draw, however many pikes are thrusting */
  private lines: Line[] = [];
  private lineMesh: THREE.LineSegments = (() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LINES_MAX * 6), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(LINES_MAX * 8), 4).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true }));
    m.frustumCulled = false; geo.setDrawRange(0, 0);
    return m;
  })();
  private layer: HTMLDivElement;
  private m4 = new THREE.Matrix4();
  private col = new THREE.Color();
  private lastBlow = new Map<number, { ux: number; uy: number; crit: boolean }>();
  private wasPaused = false;
  private windLevel = 0; private windWarned = false; private windAcc = 0;
  /** the bowls of meals in the air, one mesh each */
  private bowls = new Map<object, THREE.Mesh>();
  private gladeLevel = 0; private gladeWarned = false; private gladeAcc = 0; private gladeHome: Building | null = null;
  private wasRaid = false;
  /** seconds until the dark next makes a sound of its own */
  private eerieT = 8;

  constructor(private scene: VillageScene, private actors: Actors, private host: FxHost) {
    this.group.add(this.lineMesh);
    this.mesh = new THREE.InstancedMesh(speck, new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.layer = document.createElement('div');
    this.layer.className = 'fx-words';
    document.getElementById('game')!.append(this.layer);
  }

  clear(): void {
    this.specks = []; this.mesh.count = 0;
    for (const w of this.words) w.el.remove();
    this.words = [];
    for (const s of this.streaks) { this.group.remove(s.obj); s.mat.dispose(); }
    this.streaks = [];
    this.lines = [];
    this.windWarned = false; this.windLevel = 0; this.sfx.wind(0);
    this.gladeWarned = false; this.gladeLevel = 0; this.gladeHome = null; this.sfx.glade(0);
  }

  // ---- primitives ----------------------------------------------------------------

  /** n specks thrown out from p: speed in units/s, `up` biases them skyward, `grav` pulls them down. */
  burst(p: THREE.Vector3, n: number, colour: number | number[], speed = 2, up = 1.5, life = 0.5, grav = 6, size = 1): void {
    const cs = Array.isArray(colour) ? colour : [colour];
    for (let i = 0; i < n && this.specks.length < MAX; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.6);
      const s: Speck = { x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * v, vy: up * (0.5 + Math.random()), vz: Math.sin(a) * v, life: 0, max: life * (0.7 + Math.random() * 0.6), size: size * (0.7 + Math.random() * 0.6), grav };
      this.mesh.setColorAt(this.specks.length, this.col.setHex(cs[i % cs.length]));
      this.specks.push(s);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** A word that floats up from p and fades. */
  word(text: string, p: THREE.Vector3, colour: string, size = 14, ttl = 0.9): void {
    if (this.words.length >= 40) return; // a great melee would bury the screen in numbers: past forty, let them go
    const el = document.createElement('div');
    el.className = 'fx-word'; el.textContent = text; el.style.color = colour; el.style.fontSize = `${size}px`;
    this.layer.append(el);
    this.words.push({ el, pos: p.clone(), t: 0, ttl });
  }

  /** A streak from a to b that fades out over ttl (a pike's line, an arrow's flight). */
  streak(a: THREE.Vector3, b: THREE.Vector3, colour: number, ttl = 0.16): void {
    if (this.lines.length >= LINES_MAX) this.lines.shift(); // a flood of them: the oldest goes
    this.lines.push({ ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, r: ((colour >> 16) & 255) / 255, g: ((colour >> 8) & 255) / 255, b: (colour & 255) / 255, t: 0, ttl });
  }
  /** An arc or a shock ring: a shared shape with a material of its own (for its fade), at most ARCS_MAX at once. */
  private ring(geo: THREE.BufferGeometry, colour: number, opacity: number): { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial } {
    if (this.streaks.length >= ARCS_MAX) { const old = this.streaks.shift()!; this.group.remove(old.obj); old.mat.dispose(); }
    const mat = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    this.group.add(mesh);
    return { mesh, mat };
  }

  /** A swing's arc: a flat ribbon of the circle round `who`, facing (ux, uy), fading as it ends. */
  arc(who: Mover, ux: number, uy: number, ttl: number, spin = false, colour = 0xf0f0e0): void {
    const sweep = spin ? Math.PI * 2 : 2.4;
    const x = who.x * U, z = who.y * U;
    const { mesh, mat } = this.ring(spin ? SPIN : ARC, colour, 0.75);
    mesh.position.set(x, groundHeight(x, z) + (who.elevated ? 2.2 : 0) + 0.55, z);
    // RingGeometry starts at +x and runs anticlockwise seen from above; centre the sweep on the facing
    mesh.rotation.y = -Math.atan2(uy, ux) - (spin ? 0 : -sweep / 2) - sweep;
    this.streaks.push({ obj: mesh, mat, t: 0, ttl });
  }

  /** A ring of shock running out over the ground. */
  shock(x: number, z: number, r: number, ttl: number): void {
    const { mesh, mat } = this.ring(SHOCK, 0xd8c8a0, 0.9);
    mesh.position.set(x, groundHeight(x, z) + 0.05, z);
    mesh.scale.setScalar(r * 0.2);
    this.streaks.push({ obj: mesh, mat, t: 0, ttl, grow: r });
  }

  private at(x: number, y: number, h = 0.5): THREE.Vector3 { const X = x * U, Z = y * U; return new THREE.Vector3(X, groundHeight(X, Z) + h, Z); }
  private visible(x: number, y: number): boolean { const f = this.scene.fog; return !f || f.visibleAt(x, y) > 0.35; }

  // ---- the sim's events --------------------------------------------------------------

  handle(ev: FxEvent): void {
    const s = this.scene, sfx = this.sfx;
    switch (ev.kind) {
      case 'hit':
        if (ev.attacker instanceof Bolt) this.burst(this.actors.headOf(ev.target), 8, [0xb46bff, 0x7a3ad0], 2, 1.5);
        this.hit(ev);
        break;
      case 'melee': {
        const dx = ev.x - ev.who.x, dy = ev.y - ev.who.y, d = Math.hypot(dx, dy) || 1;
        this.arc(ev.who, dx / d, dy / d, ev.who instanceof Raider && ev.who.kind === 'brute' ? 0.24 : 0.15, false, 0xd8b0a0);
        this.actors.kick(ev.who.id).attack = 0.45;
        sfx.swing(0); break;
      }
      case 'arrow': sfx.swing(0); break;
      case 'thrust': {
        const a = this.at(ev.x1, ev.y1 + 4, 0.75), b = this.at(ev.x2, ev.y2 + 4, 0.75);
        this.streak(a, b, 0xf2e6c8, 0.16);
        this.burst(b, 2, 0xffffff, 0.5, 0.3, 0.15, 0);
        sfx.swing(0); break;
      }
      case 'swing':
        this.arc(ev.who, ev.dx, ev.dy, ev.stage === 2 ? 0.3 : 0.18, ev.stage === 2);
        this.actors.kick(ev.who.id).attack = 0.4;
        sfx.swing(ev.stage); break;
      case 'telegraph': {
        const k = this.actors.kick(ev.who.id); k.flash = Math.max(k.flash, ev.ms / 1000); k.flashColour = 0xffc040;
        this.word('!', this.actors.headOf(ev.who).add(new THREE.Vector3(0, 0.3, 0)), '#ffe066', 18, 0.9);
        if (ev.who instanceof Raider) sfx.grunt();
        break;
      }
      case 'miss': this.burst(this.at(ev.who.x + ev.who.dir * 10, ev.who.y, 0.1), 4, 0x8a7a60, 1, 0.8); sfx.whiff(); break;
      case 'cast': this.burst(this.actors.headOf(ev.who), 10, [0x78d8f0, 0xb46bff], 2, 2); this.actors.kick(ev.who.id).squash = -0.15; sfx.bolt(); break;
      case 'impact': this.burst(this.at(ev.x, ev.y), 6, [0x78d8f0, 0xb46bff], 1.5, 1.5); break;
      case 'tool': {
        const who = ev.who ?? s.player, p = new THREE.Vector3(ev.tx + 0.5, groundHeight(ev.tx + 0.5, ev.ty + 0.5) + 0.1, ev.ty + 0.5);
        if (ev.tool === 'seed') { this.burst(p, 7, [0xd8c070, 0x8a6a3a], 1, 1.2); this.actors.kick(who.id).squash = 0.12; sfx.dig(); break; }
        const dx = p.x - who.x * U, dz = p.z - who.y * U, d = Math.hypot(dx, dz) || 1;
        this.arc(who, dx / d, dz / d, 0.16, false, 0xc8c0a8);
        this.actors.kick(who.id).attack = 0.4;
        window.setTimeout(() => { this.burst(p, ev.tool === 'axe' ? 5 : 8, ev.tool === 'axe' ? [0x8a6a3a, 0xc8a070] : [0x6a5440, 0x4a3a2a], 1.5, 1.5); if (ev.tool === 'axe' || ev.tool === 'hammer') sfx.chop(); else sfx.dig(); }, 90);
        break;
      }
      case 'boss': this.burst(this.actors.headOf(ev.who), 24, [0xff3020, 0x600a0a], 3, 2.5, 0.8); this.host.shake(0.35); sfx.horn(); break;
      case 'slowmo': this.host.bump(0.08, 420); break;
      case 'death': this.death(ev.who); break;
      case 'deposit': { const p = this.at(ev.x, ev.y, 0.1); this.burst(p, 6, 0x8a7a60, 1, 1); this.word(ev.text, p.add(new THREE.Vector3(0, 0.9, 0)), ev.colour, 13, 0.9); sfx.dig(); break; }
      case 'cut': this.burst(this.at(ev.x, ev.y, 0.2), 6, [0x5a7040, 0x7a9050], 1.5, 1.2); break;
      case 'rustle': if (this.visible(ev.x, ev.y)) this.burst(this.at(ev.x, ev.y, 0.25), 3, [0x5a7040, 0x7a9050], 1, 1); break;
      case 'bees': if (this.visible(ev.x, ev.y)) { this.burst(this.at(ev.x + (Math.random() - 0.5) * 10, ev.y + (Math.random() - 0.5) * 10, 0.8), 2, 0x2a2010, 0.8, 0.4, 0.4, 0); sfx.buzz(); } break;
      case 'ruin': case 'demolish': {
        const b = ev.building, f = BUILDINGS[b.kind], ruin = ev.kind === 'ruin';
        sfx.thud(ruin ? 1 : 0.6);
        for (let i = 0; i < (ruin ? 12 : 8); i++) this.burst(new THREE.Vector3(b.tx + Math.random() * f.w, groundHeight(b.tx, b.ty) + 0.3, b.ty + Math.random() * f.h), 4, [0x8a7a60, 0x5a5048, 0x3a3430], 1.5, 2, 0.8);
        if (ruin) { this.word('RUINED', new THREE.Vector3(b.tx + f.w / 2, groundHeight(b.tx, b.ty) + 3.5, b.ty + f.h / 2), '#ff6a5a', 18, 1.6); this.host.shake(0.25); }
        break;
      }
      case 'snore': if (this.visible(ev.x, ev.y)) this.word('z', this.at(ev.x + 6, ev.y, 1.4), '#d8d0f0', 13, 1.6); break;
      case 'smash': {
        const big = ev.r >= 40;
        const k = this.actors.kick(ev.who.id); k.squash = 0.3;
        if (big) sfx.slam(); else sfx.thud(1);
        const n = big ? 18 : 10, X = ev.x * U, Z = ev.y * U, R = ev.r * U;
        for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; this.burst(new THREE.Vector3(X + Math.cos(a) * R * 0.8, groundHeight(X, Z) + 0.1, Z + Math.sin(a) * R * 0.8), 3, 0x8a7a60, 1, 1); }
        this.shock(X, Z, R, big ? 0.38 : 0.26);
        this.host.shake(big ? 0.4 : 0.2);
        break;
      }
      case 'charge':
        sfx.roar();
        for (let i = 0; i < 4; i++) this.burst(this.at(ev.who.x - ev.ux * (6 + i * 5), ev.who.y - ev.uy * (6 + i * 5), 0.1), 3, 0x8a7a60, 1, 1);
        break;
      case 'roll':
        sfx.roll();
        for (let i = 0; i < 3; i++) this.burst(this.at(ev.who.x - ev.ux * (4 + i * 5), ev.who.y - ev.uy * (4 + i * 5), 0.1), 3, 0x8a7a60, 1, 0.8);
        this.actors.kick(ev.who.id).spin = (ev.ux < 0 ? 1 : -1) * 0.6;
        break;
      case 'thud': {
        // the Ogre's footsteps: felt within 30 tiles, louder and heavier the closer he is
        const d = Math.hypot(ev.who.x - s.player.x, ev.who.y - s.player.y) / TILE;
        if (d > 30) break;
        const near = 1 - d / 30;
        sfx.thud(0.25 + 0.75 * near);
        this.burst(this.at(ev.who.x, ev.who.y, 0.05), 3, 0x8a7a60, 1, 0.8);
        if (near > 0.6) this.host.shake(0.08 * near);
        break;
      }
      case 'upgrade': {
        const b = ev.building, c = buildingCenter(b);
        const p = new THREE.Vector3(c.tx, groundHeight(c.tx, c.ty) + 1.5, c.ty);
        this.burst(p, 18, [0xffe066, 0xffffff], 3, 2.5, 0.7);
        this.host.bump(0.04, 260); sfx.poof();
        break;
      }
      case 'hearts': this.burst(this.actors.headOf(ev.who), 6, [0xff7aa0, 0xffb0c8], 0.6, 1.5, 1, -0.5); sfx.streak(3); break;
    }
  }

  private hit(ev: Extract<FxEvent, { kind: 'hit' }>): void {
    const { attacker, target, dmg, crit, killed } = ev, sfx = this.sfx;
    const head = this.actors.headOf(target).add(new THREE.Vector3(0, -0.4, 0));
    if (target.blocked) { this.burst(head, 6, [0xfff2b0, 0xffd060], 2.5, 1.5, 0.3); sfx.hit(false); return; }
    const dx = target.x - attacker.x, dy = target.y - attacker.y, d = Math.hypot(dx, dy) || 1;
    const ux = ev.ux ?? dx / d, uy = ev.uy ?? dy / d;
    const heavy = target instanceof Raider && target.heavy, toRaider = target instanceof Raider, byPlayer = attacker instanceof Player;
    const k = this.actors.kick(target.id);
    k.squash = heavy ? 0.15 : crit ? 0.5 : 0.35; k.recoilX = ux * (heavy ? 0.06 : 0.18); k.recoilZ = uy * (heavy ? 0.06 : 0.18);
    this.burst(head, toRaider ? (crit ? 16 : 8) : 6, toRaider ? [0xfff2b0, 0xff9a3c] : [0x8a0a0a, 0x5a0606], crit ? 3.5 : 2.2, 1.6, 0.45);
    this.word(String(dmg), head.clone().add(new THREE.Vector3(ux * 0.2, 0.7, uy * 0.2)), toRaider ? (crit ? '#ff9a3c' : '#ffe066') : '#ff5a5a', crit ? 20 : 14, 0.9);
    if (byPlayer) {
      this.lastBlow.set(target.id, { ux, uy, crit });
      sfx.hit(crit);
      if (crit) this.host.shake(0.12);
      if (killed && (ev.streak ?? 0) >= 2) window.setTimeout(() => sfx.streak(ev.streak!), 120);
    } else if (target instanceof Player) { sfx.hurt(); this.host.shake(0.15); }
    else if (attacker instanceof Villager) sfx.hit(false);
  }

  private death(who: Mover): void {
    if (who instanceof Bolt) return;
    const head = this.actors.headOf(who);
    if (who instanceof Raider) {
      if (who.boss) { this.burst(head, 24, [0x8a0a0a, 0x5a0606], 3, 2, 0.8); this.burst(head, 30, [0xffd040, 0xfff0a0], 3, 3, 1); this.scene.slowMo(); }
      else this.burst(head, who.kind === 'rat' || who.kind === 'snatcher' ? 4 : 8, [0x8a0a0a, 0x5a0606], 2, 1.5, 0.6);
      this.sfx.kill();
      this.lastBlow.delete(who.id);
      return;
    }
    if (who instanceof Villager || who instanceof Player) this.burst(head, 10, [0xd8d8f0, 0x9a9ab8], 0.4, 1.4, 1.2, -0.6); // the ghost goes up
  }

  // ---- the places felt before they are seen ---------------------------------------------------

  private wind(dt: number): void {
    const s = this.scene, lair = s.world.lair;
    if (!lair) { this.sfx.wind(0); return; }
    const c = buildingCenter(lair), lx = c.tx * TILE, ly = c.ty * TILE, R = OGRE.windRadius * TILE;
    const pd = s.interior.active ? Infinity : Math.hypot(s.player.x - lx, s.player.y - ly) / TILE;
    const target = Math.max(0, Math.min(1, 1 - pd / OGRE.windRadius));
    this.windLevel += (target - this.windLevel) * Math.min(1, dt * 2);
    this.sfx.wind(this.sfx.muted ? 0 : this.windLevel);
    if (target > 0.03 && !this.windWarned) { this.windWarned = true; s.event('info', 'A cold wind rises, circling something out in the woods.', true); }
    // pale wisps stream round the lair, thick at its mouth; only near the head, where they can be seen
    if (pd > OGRE.windRadius + 20) return;
    this.windAcc += dt * 40;
    while (this.windAcc >= 1) {
      this.windAcc -= 1;
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R;
      const x = lx + Math.cos(a) * r, y = ly + Math.sin(a) * r;
      if (Math.hypot(x - s.player.x, y - s.player.y) > 24 * TILE || !this.visible(x, y)) continue;
      const k = 1 - r / R;
      if (Math.random() > Math.pow(k, 1.5)) continue;
      const spd = (2 + 3 * k) * (0.6 + Math.random() * 0.4);
      const p: Speck = { x: x * U, y: groundHeight(x * U, y * U) + 0.3 + Math.random() * 1.2, z: y * U, vx: -Math.sin(a) * spd, vy: 0.1, vz: Math.cos(a) * spd, life: 0, max: 1.4 + Math.random(), size: 1.4, grav: 0 };
      if (this.specks.length < MAX) { this.mesh.setColorAt(this.specks.length, this.col.setHex(Math.random() < 0.3 ? 0x4a3a50 : 0xb0b8d8)); this.specks.push(p); }
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private glade(dt: number): void {
    const s = this.scene;
    const den = (this.gladeHome ??= s.world.wildGnomeHouse ?? null);
    if (!den) { this.sfx.glade(0); return; }
    const c = buildingCenter(den), gx = c.tx * TILE, gy = c.ty * TILE, R = GNOME_HOME.ringRadius * TILE;
    const pd = s.interior.active ? Infinity : Math.hypot(s.player.x - gx, s.player.y - gy) / TILE;
    const target = Math.max(0, Math.min(1, 1 - pd / GNOME_HOME.ringRadius));
    this.gladeLevel += (target - this.gladeLevel) * Math.min(1, dt * 2);
    this.sfx.glade(this.sfx.muted ? 0 : this.gladeLevel);
    if (target > 0.03 && !this.gladeWarned) { this.gladeWarned = true; s.event('info', 'Warm motes drift on the air — something small and friendly keeps house out here.', true); }
    if (pd > GNOME_HOME.ringRadius + 20) return;
    this.gladeAcc += dt * 12;
    while (this.gladeAcc >= 1) {
      this.gladeAcc -= 1;
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R;
      const x = gx + Math.cos(a) * r, y = gy + Math.sin(a) * r;
      if (!this.visible(x, y)) continue;
      const p: Speck = { x: x * U, y: groundHeight(x * U, y * U) + 0.2, z: y * U, vx: -Math.cos(a) * 0.3, vy: 0.4 + Math.random() * 0.4, vz: -Math.sin(a) * 0.3, life: 0, max: 2 + Math.random() * 1.4, size: 1, grav: 0 };
      if (this.specks.length < MAX) { this.mesh.setColorAt(this.specks.length, this.col.setHex(Math.random() < 0.5 ? 0xffe9a0 : 0xd9f0a0)); this.specks.push(p); }
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /**
   * The dark makes its own sounds: the drone thickens toward midnight, a sour swell when a raid comes on,
   * and now and then, at night, something breathes in the thorns near you, or old wood creaks by the lair.
   */
  private dread(dt: number): void {
    const s = this.scene, night = skyAt(s.dayTime).night;
    this.sfx.drone(s.screen === 'playing' ? 0.3 + 0.7 * night : 0);
    if (s.raidActive && !this.wasRaid) this.sfx.stinger();
    this.wasRaid = s.raidActive;
    this.eerieT -= dt;
    if (this.eerieT > 0 || night < 0.5 || s.interior.active) return;
    this.eerieT = 7 + Math.random() * 12;
    const pl = s.player, t = pl.tile;
    let thorns = false;
    for (let dy = -3; dy <= 3 && !thorns; dy++) for (let dx = -3; dx <= 3; dx++) if (s.world.get(t.tx + dx, t.ty + dy)?.kind === 'thicket') { thorns = true; break; }
    if (thorns) { this.sfx.whisper(); return; }
    const lair = s.world.lair;
    if (lair) { const c = buildingCenter(lair); if (Math.hypot(c.tx - t.tx, c.ty - t.ty) < OGRE.windRadius * 0.7) { this.sfx.creak(); return; } }
    if (Math.random() < 0.35) this.sfx.creak();
  }

  /** Draw each lobbed meal along its arc; a bowl whose meal has landed goes. */
  private flyBowls(): void {
    const s = this.scene, live = new Set<object>();
    for (const l of s.lobs) {
      live.add(l);
      let m = this.bowls.get(l);
      if (!m) {
        m = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.14, 0.16, 7), new THREE.MeshBasicMaterial({ color: parseInt(FOODS[l.dish].colour.slice(1), 16) }));
        this.group.add(m); this.bowls.set(l, m);
      }
      const f = Math.min(1, l.t / l.T), x0 = l.x0 * U, z0 = l.y0 * U, x1 = l.x1 * U, z1 = l.y1 * U;
      const peak = 1.2 + Math.hypot(x1 - x0, z1 - z0) * 0.12;
      const y = groundHeight(x0, z0) + 0.9 + (groundHeight(x1, z1) - groundHeight(x0, z0) - 0.85) * f + 4 * peak * f * (1 - f);
      m.position.set(x0 + (x1 - x0) * f, y, z0 + (z1 - z0) * f);
      m.rotation.z = f * 6;
    }
    for (const [l, m] of this.bowls) if (!live.has(l)) { this.group.remove(m); this.bowls.delete(l); }
  }

  // ---- per frame -----------------------------------------------------------------------

  update(dt: number): void {
    const s = this.scene;
    this.flyBowls();
    if (s.paused !== this.wasPaused) this.wasPaused = s.paused;
    if (this.wasPaused) { this.sfx.wind(0); this.sfx.glade(0); this.sfx.drone(0); }
    else { this.wind(dt); this.glade(dt); this.dread(dt); }
    const step = this.wasPaused ? 0 : dt;
    // specks: integrate, drop the spent ones (keeping colours in step with their slots)
    let w = 0;
    for (let i = 0; i < this.specks.length; i++) {
      const p = this.specks[i];
      p.life += step;
      if (p.life >= p.max) continue;
      p.vy -= p.grav * step;
      p.x += p.vx * step; p.y += p.vy * step; p.z += p.vz * step;
      const floor = groundHeight(p.x, p.z);
      if (p.y < floor) { p.y = floor; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      if (w !== i) { this.specks[w] = p; this.mesh.getColorAt(i, this.col); this.mesh.setColorAt(w, this.col); }
      const k = (1 - p.life / p.max) * p.size;
      this.m4.makeScale(k, k, k).setPosition(p.x, p.y, p.z);
      this.mesh.setMatrixAt(w, this.m4);
      w++;
    }
    this.specks.length = w;
    this.mesh.count = w;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    // streaks and arcs fade (shock rings grow as they go)
    // the lines: one buffer, rewritten with whoever is still fading
    {
      const pos = this.lineMesh.geometry.getAttribute('position') as THREE.BufferAttribute, col = this.lineMesh.geometry.getAttribute('color') as THREE.BufferAttribute;
      const P = pos.array as Float32Array, C = col.array as Float32Array;
      let n = 0;
      for (const ln of this.lines) {
        ln.t += dt;
        const f = ln.t / ln.ttl;
        if (f >= 1) continue;
        const o = n * 6, c = n * 8, a = 0.85 * (1 - f);
        P[o] = ln.ax; P[o + 1] = ln.ay; P[o + 2] = ln.az; P[o + 3] = ln.bx; P[o + 4] = ln.by; P[o + 5] = ln.bz;
        C[c] = ln.r; C[c + 1] = ln.g; C[c + 2] = ln.b; C[c + 3] = a; C[c + 4] = ln.r; C[c + 5] = ln.g; C[c + 6] = ln.b; C[c + 7] = a;
        this.lines[n++] = ln;
      }
      this.lines.length = n;
      this.lineMesh.geometry.setDrawRange(0, n * 2);
      this.lineMesh.visible = n > 0;
      if (n) { pos.clearUpdateRanges(); pos.addUpdateRange(0, n * 6); pos.needsUpdate = true; col.clearUpdateRanges(); col.addUpdateRange(0, n * 8); col.needsUpdate = true; }
    }
    this.streaks = this.streaks.filter((st) => {
      st.t += dt;
      const f = st.t / st.ttl;
      if (f >= 1) { this.group.remove(st.obj); st.mat.dispose(); return false; }
      st.mat.opacity = 0.85 * (1 - f);
      if (st.grow) st.obj.scale.setScalar(st.grow * (0.2 + 0.9 * f));
      return true;
    });
    // words rise and fade, pinned to the world
    this.words = this.words.filter((wd) => {
      wd.t += dt;
      const f = wd.t / wd.ttl;
      if (f >= 1) { wd.el.remove(); return false; }
      const p = this.host.project(wd.pos.clone().add(new THREE.Vector3(0, f * 0.8, 0)));
      wd.el.style.display = p.on ? '' : 'none';
      wd.el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -50%) scale(${f < 0.15 ? 0.6 + f * 2.6 : 1})`;
      wd.el.style.opacity = String(f > 0.6 ? 1 - (f - 0.6) / 0.4 : 1);
      return true;
    });
  }
}
