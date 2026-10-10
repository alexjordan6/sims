import * as THREE from 'three';
import { poseFigure } from './motion';
import { Mover, Villager, Raider } from '../agents';
import { lookFor } from '../look';
import type { VillageScene } from '../main';
import { bake } from './assets';
import { heldMesh, grip, rankOf, kitOf, weaponTier, modelFor, scaleOf, standHeight, PERSON, type Kick } from './actors';
import { buildFigure, FIGURES, wearing, NO_KIT, type Spec, type Kit } from './figure';
import { lambert } from './fow';
import { U } from './models';
import { groundHeight } from './terrain';

// Distant characters share baked poses from the live joint solver. Nearby characters use
// continuous articulation; instancing keeps the distant army inexpensive.

/** the poses baked for every look: [clip, fraction of the clip] */
const POSES = [
  ...Array.from({ length: 2 }, (_, i) => ({ clip: 'idle', at: i / 2 })),
  ...Array.from({ length: 8 }, (_, i) => ({ clip: 'walk', at: i / 8 })),
  ...Array.from({ length: 4 }, (_, i) => ({ clip: 'attack', at: i / 3 })),
  { clip: 'die', at: 1 },
];
const IDLE = [0, 1], WALK = Array.from({length:8}, (_,i)=>i+2), STRIKE = [10,11,12,13], FALLEN = 14;
const CAPACITY0 = 64;
/**
 * How many distinct looks the crowd will bake. Each one is fifteen baked poses kept for the session, so
 * geometry is the scarce thing here while per-instance colour is free. A village's soldiers share
 * their kit, so the real count sits far below this; the cap is only there so that a village forever
 * re-arming one piece at a time cannot pile up looks without end. Past it, gear stops being baked.
 */
const LOOK_CAP = 72;

interface Look { poses: THREE.InstancedMesh[]; /** the mover drawn by each instance of each pose, for picking */ who: Mover[][]; /** instances set this frame, per pose */ n: Int32Array }
interface Fallen { look: Look; x: number; y: number; z: number; yaw: number; scale: number; colour: THREE.Color; t: number }

/**
 * Is this mover drawn by the crowd (once its look has baked)? Bosses, the head and people stay full actors.
 * Every body uses the shared articulated figure, so what a look costs is its figure, its tool,
 * its hat and its rank — not which of a dozen faces it was given.
 */
export function crowdModel(m: Mover): { figure: string; held: string; weapon: number; kit: Kit; hat: boolean; rank: number; tint: number } | null {
  if (m instanceof Villager) {
    const held = lookFor(m)?.held ?? 'none';
    return { figure: 'gnome', held, weapon: weaponTier(m, held), kit: kitOf(m), hat: true, rank: rankOf(m), tint: 0xffffff };
  }
  if (m instanceof Raider && !m.boss && !m.huge && m.kind !== 'ogre' && m.kind !== 'troll') {
    if (!modelFor(m)) return null; // rats and boars keep their code-built bodies
    return { figure: m.kind, held: lookFor(m)?.held ?? 'none', weapon: 0, kit: NO_KIT, hat: false, rank: 1, tint: 0xffffff };
  }
  return null;
}

/** A look's identity: everything about a body that is geometry rather than colour. */
function lookId(cm: NonNullable<ReturnType<typeof crowdModel>>): string {
  const k = cm.kit;
  return `${cm.figure}|${cm.held}${cm.weapon ? cm.weapon : ''}|${cm.hat}${cm.rank > 1 ? `|${cm.rank}` : ''}${wearing(k) ? `|${k.helmet}${k.chest}${k.legs}${k.shield}` : ''}`;
}

/**
 * The ids the crowd drew this frame, as frame stamps: emptied each frame by moving the frame on, so
 * nothing is freed and rebuilt sixty or a hundred and twenty times a second. Each id also keeps the body
 * it was, so one that died since can be laid down where it fell.
 */
export class FrameSet {
  private at = new Map<number, { frame: number; m: Mover }>();
  frame = 0;
  has(id: number): boolean { return this.at.get(id)?.frame === this.frame; }
  add(m: Mover): void { const e = this.at.get(m.id); if (e) { e.frame = this.frame; e.m = m; } else this.at.set(m.id, { frame: this.frame, m }); }
  next(): void { this.frame++; }
  /** Each body drawn last frame and not this one; and forget anything older. */
  gone(fn: (m: Mover) => void): void {
    this.at.forEach((e, id) => { if (e.frame === this.frame - 1) fn(e.m); else if (e.frame < this.frame - 1) this.at.delete(id); });
  }
}

export class Crowd {
  readonly group = new THREE.Group();
  private looks = new Map<string, Look | null>();
  private yaw = new Map<number, number>();
  private fallen: Fallen[] = [];
  private t = 0;
  private strides = new Map<number, number>();
  private col = new THREE.Color();
  /** the movers drawn last frame (the actor path skips them) */
  readonly drawn = new FrameSet();

  constructor(private scene: VillageScene, private kicks: Map<number, Kick>) {}

  clear(): void { this.fallen = []; this.yaw.clear(); this.strides.clear(); this.drawn.next(); this.drawn.next(); this.picks.clear(); }

  /** Bake a look's poses (once). Null when the rig has not loaded (the actor path draws it meanwhile). */
  private look(cm: NonNullable<ReturnType<typeof crowdModel>>): Look | null {
    let { kit } = cm;
    let id = lookId(cm);
    if (this.looks.has(id)) return this.looks.get(id)!;
    if (this.looks.size >= LOOK_CAP) { kit = NO_KIT; id = lookId({ ...cm, kit }); if (this.looks.has(id)) return this.looks.get(id)!; }
    const spec: Spec | undefined = FIGURES[cm.figure];
    if (!spec) return null;
    const rig = new THREE.Group();
    const k = PERSON / (buildFigure(rig, spec, { cap: cm.hat ? cm.rank : 0, kit }));
    rig.scale.setScalar(k);
    const hand = rig.getObjectByName('hand-right');
    const tool = heldMesh(cm.held, cm.weapon);
    rig.userData.held = cm.held;
    if (tool && hand) { tool.scale.setScalar(1 / k); grip(tool, k, spec); hand.add(tool); }
    const mat = lambert({ vertexColors: true, flatShading: false });
    const poses = POSES.map(({ clip, at }) => {
      poseFigure(rig, { phase: at * Math.PI * 2, pace: clip === 'walk' ? 0.85 : 0, time: at * 3,
        strike: clip === 'attack' ? { dir: cm.held === 'pike' ? 'down' : 'right', progress: at, recovery: Math.max(0, (at - 0.8) * 5) } : undefined,
        bow: clip === 'attack' && cm.held === 'bow' ? 1 - at : undefined,
        death: clip === 'die' ? 1 : undefined });
      rig.updateMatrixWorld(true);
      const g = bake(rig);
      const mesh = new THREE.InstancedMesh(g, mat, CAPACITY0);
      mesh.count = 0; mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.frustumCulled = false; // instances are spread over the map; the whole set is cheap enough to draw
      this.group.add(mesh);
      return mesh;
    });
    const look: Look = { poses, who: poses.map(() => []), n: new Int32Array(poses.length) };
    this.looks.set(id, look);
    return look;
  }

  /** The pose a body is in now: struck mid-blow, walking, or at rest, on a slow flipbook clock. */
  private poseOf(m: Mover, k: Kick | undefined, dt: number): number {
    const phase = (this.strides.get(m.id) ?? m.id) + Math.hypot(m.vx,m.vy) * U * dt * 9;
    this.strides.set(m.id,phase);
    if (k && k.attack > 0) return STRIKE[Math.min(3, Math.floor((0.4 - Math.min(0.4, k.attack)) / 0.4 * 4))];
    const moving = Math.abs(m.vx) + Math.abs(m.vy) > 1;
    if (moving) return WALK[Math.floor(phase / (Math.PI * 2) * WALK.length) % WALK.length];
    return IDLE[Math.floor(this.t * 1.5 + m.id * 0.37) % IDLE.length];
  }

  /**
   * Draw everyone the crowd handles this frame. Returns nothing; `drawn` lists who it took, so the
   * actor path leaves them alone. Bodies that died since last frame lie fallen and sink away.
   */
  /** what the camera can see: bodies further than this from its focus are not posed or drawn */
  private cullX = 0;
  private cullZ = 0;
  private cullR2 = Infinity;
  /** the camera's view, when the view has one: a body outside it (with a little margin for its shadow) is not drawn */
  private frustum: THREE.Frustum | null = null;
  private sphere = new THREE.Sphere(new THREE.Vector3(), 1.6);
  cull(x: number, z: number, r: number, frustum: THREE.Frustum | null = null): void { this.cullX = x; this.cullZ = z; this.cullR2 = r * r; this.frustum = frustum; }
  /** the white a hit flashes toward (kept, not made anew for every body struck) */
  private static readonly FLASH = new THREE.Color(2.4, 2.4, 2.4);

  sync(dt: number): void {
    this.t += dt;

    const s = this.scene, fog = s.fog;
    if (this.picks.size > s.agents.length * 2 + 64) { const live = new Set(s.agents.map((a) => (a as Mover).id)); for (const id of this.picks.keys()) if (!live.has(id)) this.picks.delete(id); } // the long-dead
    this.drawn.next();
    // how many instances each pose has this frame, kept on the look (no map made afresh each frame)
    for (const l of this.looks.values()) if (l) { l.who.forEach((w) => (w.length = 0)); l.n.fill(0); }
    const put = (look: Look, pose: number, m: Mover | null, x: number, y: number, z: number, yaw: number, scale: number, colour: THREE.Color, squash = 0) => {
      const n = look.n[pose];
      if (n >= look.poses[pose].instanceMatrix.count) this.grow(look, pose);
      const target = look.poses[pose];
      // a turn about the vertical and a (squashed) scale, written straight into the instance buffer
      const c = Math.cos(yaw), sn = Math.sin(yaw), sx = scale * (1 + squash * 0.5), sy = scale * (1 - squash), e = target.instanceMatrix.array as Float32Array, o = n * 16;
      e[o] = c * sx; e[o + 1] = 0; e[o + 2] = -sn * sx; e[o + 3] = 0;
      e[o + 4] = 0; e[o + 5] = sy; e[o + 6] = 0; e[o + 7] = 0;
      e[o + 8] = sn * sx; e[o + 9] = 0; e[o + 10] = c * sx; e[o + 11] = 0;
      e[o + 12] = x; e[o + 13] = y; e[o + 14] = z; e[o + 15] = 1;
      target.setColorAt(n, colour);
      if (m) look.who[pose][n] = m;
      look.n[pose] = n + 1;
    };
    // Full articulation around the player; instancing keeps the distant army inexpensive.
    const close = s.agents.filter(a => !a.dead && !(a as Mover).hidden && modelFor(a as Mover) &&
      Math.hypot(a.x - s.player.x, a.y - s.player.y) * U < 9)
      .sort((a,b) => Math.hypot(a.x-s.player.x,a.y-s.player.y)-Math.hypot(b.x-s.player.x,b.y-s.player.y)).slice(0, 25);
    const detailed = new Set(close.map(a=>a.id));
    for (const ag of s.agents) {
      const m = ag as Mover;
      if (detailed.has(m.id)) continue;
      if (m.dead) continue;
      const pick = this.pickFor(m), cm = pick.cm, look = pick.look;
      if (!cm || !look) continue;
      this.drawn.add(m);
      if (m.hidden || (m instanceof Raider && m.lurking) || (m.hostile && fog && fog.visibleAt(m.x, m.y) <= 0.35)) continue;
      if ((m.x * U - this.cullX) ** 2 + (m.y * U - this.cullZ) ** 2 > this.cullR2) continue; // out of the camera's reach
      const gx = m.x * U, gz = m.y * U, y = groundHeight(gx, gz) + standHeight(m);
      if (this.frustum && !this.frustum.intersectsSphere(this.sphere.set(this.sphere.center.set(gx, y + 0.5, gz), 1.6))) continue; // off the screen
      const k = this.kicks.get(m.id);
      const x = m.x * U + (k?.recoilX ?? 0), z = m.y * U + (k?.recoilZ ?? 0);
      // facing: turn toward the way it walks, smoothly
      let yaw = this.yaw.get(m.id) ?? 0;
      const moving = Math.abs(m.vx) + Math.abs(m.vy) > 1;
      if (moving) { let d = Math.atan2(m.vx, m.vy) - yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; yaw += d * (1 - Math.exp(-dt * 10)); }
      else if (m.dir) { const want = m.dir < 0 ? -Math.PI / 2 : Math.PI / 2; if (Math.abs(want - yaw) > 2.5) yaw = want; }
      this.yaw.set(m.id, yaw);
      const flash = m.hurtT < 0.15 && !m.blocked ? 1 : k && k.flash > 0 ? Math.min(1, k.flash * 6) : 0;
      this.col.setHex(cm.tint);
      if (flash) this.col.lerp(Crowd.FLASH, flash * 0.8);
      put(look, this.poseOf(m, k, dt), m, x, y, z, yaw, scaleOf(m), this.col, k?.squash ?? 0);
    }
    // the dead: whoever the crowd drew last frame and is now gone lies down where it fell, and sinks
    this.drawn.gone((m) => {
      const pk = this.picks.get(m.id), cm = pk?.cm ?? null, look = pk?.look ?? null;
      if (look && cm && m.dead) this.fallen.push({ look, x: m.x * U, y: groundHeight(m.x * U, m.y * U), z: m.y * U, yaw: this.yaw.get(m.id) ?? 0, scale: scaleOf(m), colour: new THREE.Color(cm.tint), t: 0 });
      this.yaw.delete(m.id); this.strides.delete(m.id); this.picks.delete(m.id);
    });
    let kept = 0;
    for (const f of this.fallen) {
      f.t += dt;
      if (f.t >= 0.9) continue;
      put(f.look, FALLEN, null, f.x, f.y - Math.max(0, f.t - 0.3) * 0.8, f.z, f.yaw, f.scale, this.fade.copy(f.colour).multiplyScalar(1 - f.t * 0.6));
      this.fallen[kept++] = f;
    }
    this.fallen.length = kept;
    for (const l of this.looks.values()) if (l) for (let pi = 0; pi < l.poses.length; pi++) {
      const mesh = l.poses[pi], n = l.n[pi], was = mesh.count;
      mesh.count = n;
      mesh.visible = n > 0;
      if (!n && !was) continue; // empty then and now: nothing to send
      mesh.boundingSphere = null; // the pointer's raycast recomputes it lazily from where everyone stands now
      // send only the instances in use, not the whole (doubled-on-demand) buffer
      mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, n * 16); mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) { mesh.instanceColor.clearUpdateRanges(); mesh.instanceColor.addUpdateRange(0, n * 3); mesh.instanceColor.needsUpdate = true; }
    }
  }
  private fade = new THREE.Color();
  /**
   * Each body's look, kept until what decides it changes (gnome or not, role, weapon, kind): working it out
   * afresh for two thousand bodies every frame was a third of the crowd's time.
   */
  private picks = new Map<number, { m: Mover; id: string; cm: ReturnType<typeof crowdModel>; look: Look | null }>();
  private pickFor(m: Mover): { cm: ReturnType<typeof crowdModel>; look: Look | null } {
    // what the body is wearing and wielding belongs in this key too: without it a soldier that
    // re-arms at the chest would go on being drawn in the kit it walked over in
    const o = m as Mover & { role?: unknown; weapon?: unknown; kind?: unknown; tier?: unknown };
    const a = m.armor;
    const id = `${o.role}|${o.weapon}|${o.kind}|${o.tier}|${m.weapons.melee},${m.weapons.bow}|${a.helmet}${a.chest}${a.legs}${a.shield}`;
    let pk = this.picks.get(m.id);
    if (!pk || pk.m !== m || pk.id !== id || (pk.cm && !pk.look)) {
      const cm = crowdModel(m);
      pk = { m, id, cm, look: cm ? this.look(cm) : null };
      this.picks.set(m.id, pk);
    }
    return pk;
  }

  /** Double a pose's capacity (keeping what is already set). */
  private grow(look: Look, pose: number): void {
    const old = look.poses[pose], cap = old.instanceMatrix.count * 2;
    const mesh = new THREE.InstancedMesh(old.geometry, old.material, cap);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    mesh.instanceMatrix.array.set(old.instanceMatrix.array);
    if (old.instanceColor) { mesh.setColorAt(0, new THREE.Color()); mesh.instanceColor!.array.set(old.instanceColor.array); }
    this.group.remove(old); old.dispose();
    this.group.add(mesh);
    look.poses[pose] = mesh;
  }

  /** Every pose mesh, for the pointer's raycast. */
  get meshes(): THREE.InstancedMesh[] { const out: THREE.InstancedMesh[] = []; for (const l of this.looks.values()) if (l) out.push(...l.poses); return out; }
  /** The mover an instance of a pose mesh drew this frame. */
  moverAt(mesh: THREE.Object3D, instance: number): Mover | null {
    for (const l of this.looks.values()) if (l) { const i = l.poses.indexOf(mesh as THREE.InstancedMesh); if (i >= 0) return l.who[i][instance] ?? null; }
    return null;
  }
}
