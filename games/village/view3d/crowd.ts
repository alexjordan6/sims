import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { Mover, Villager, Raider } from '../agents';
import { lookFor } from '../look';
import type { VillageScene } from '../main';
import { MODELS, bake } from './assets';
import { heldMesh, piece, modelFor, scaleOf, standHeight, PERSON, type Kick } from './actors';
import { lambert } from './ps1';
import { U } from './models';
import { groundHeight } from './terrain';

// The crowd: gnomes and rank-and-file raiders by the hundred. Instead of a skinned rig per body (eight
// meshes and a mixer each), every look is baked once into a handful of still poses — idle, a walk cycle,
// a strike, fallen — and each pose is one InstancedMesh. A body is an instance of whichever pose its clock
// is on: a flipbook, which is how a PS1 crowd moved anyway. A thousand bodies are a few dozen draws.

/** the poses baked for every look: [clip, fraction of the clip] */
const POSES: { clip: string; at: number }[] = [
  { clip: 'idle', at: 0 }, { clip: 'idle', at: 0.5 },
  { clip: 'walk', at: 0 }, { clip: 'walk', at: 0.25 }, { clip: 'walk', at: 0.5 }, { clip: 'walk', at: 0.75 },
  { clip: 'attack-melee-right', at: 0.3 }, { clip: 'attack-melee-right', at: 0.6 },
  { clip: 'die', at: 1 },
];
const IDLE = [0, 1], WALK = [2, 3, 4, 5], STRIKE = [6, 7], FALLEN = 8;
/** gnomes wear one of a few folk faces under the hat */
const GNOME_LOOKS = ['folk/character-male-b', 'folk/character-female-c', 'folk/character-male-d'];
const CAPACITY0 = 64;

interface Look { poses: THREE.InstancedMesh[]; /** the mover drawn by each instance of each pose, for picking */ who: Mover[][] }
interface Fallen { look: Look; x: number; y: number; z: number; yaw: number; scale: number; colour: THREE.Color; t: number }

/** Is this mover drawn by the crowd (once its look has baked)? Bosses, the head and people stay full actors. */
export function crowdModel(m: Mover): { key: string; held: string; hat: boolean; tint: number } | null {
  if (m instanceof Villager && m.gnome) {
    const held = lookFor(m)?.held ?? 'none';
    return { key: GNOME_LOOKS[m.id % GNOME_LOOKS.length], held, hat: true, tint: 0xffffff };
  }
  if (m instanceof Raider && !m.boss && !m.huge && m.kind !== 'ogre' && m.kind !== 'troll') {
    const md = modelFor(m);
    if (!md) return null;
    return { key: md.key, held: lookFor(m)?.held ?? 'none', hat: false, tint: md.tint ?? 0xffffff };
  }
  return null;
}

export class Crowd {
  readonly group = new THREE.Group();
  private looks = new Map<string, Look | null>();
  private yaw = new Map<number, number>();
  private fallen: Fallen[] = [];
  private t = 0;
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private v = new THREE.Vector3(); private sc = new THREE.Vector3();
  private col = new THREE.Color();
  /** the movers drawn last frame (the actor path skips them) */
  readonly drawn = new Set<number>();

  constructor(private scene: VillageScene, private kicks: Map<number, Kick>) {}

  clear(): void { this.fallen = []; this.yaw.clear(); this.drawn.clear(); }

  /** Bake a look's poses (once). Null when its model has not loaded (the actor path draws it meanwhile). */
  private look(key: string, held: string, hat: boolean): Look | null {
    const id = `${key}|${held}|${hat}`;
    if (this.looks.has(id)) return this.looks.get(id)!;
    const ch = MODELS.characters.get(key);
    if (!ch) return null;
    const rig = SkeletonUtils.clone(ch.scene);
    const k = PERSON / ch.height;
    rig.scale.setScalar(k);
    const hand = rig.getObjectByName('arm-right'), head = rig.getObjectByName('head');
    const tool = heldMesh(held);
    if (tool && hand) { tool.scale.setScalar(1 / k); tool.position.set(-0.05 / k, -0.32 / k, 0.06 / k); tool.rotation.x = Math.PI / 2; hand.add(tool); }
    if (hat && head) head.add(piece(0xa02a22, 0.34 / k, 0.55 / k, 0.34 / k, 0, 0.2 / k, 0, new THREE.ConeGeometry(0.5, 1, 6)));
    const mixer = new THREE.AnimationMixer(rig), mat = lambert({ vertexColors: true });
    const poses = POSES.map(({ clip, at }) => {
      const c = ch.clips.find((x) => x.name === clip) ?? ch.clips.find((x) => x.name === 'idle') ?? ch.clips[0];
      mixer.stopAllAction();
      if (c) { const a = mixer.clipAction(c); a.reset().play(); mixer.setTime(Math.min(c.duration - 1e-3, c.duration * at)); }
      rig.updateMatrixWorld(true);
      const g = bake(rig);
      const mesh = new THREE.InstancedMesh(g, mat, CAPACITY0);
      mesh.count = 0; mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.frustumCulled = false; // instances are spread over the map; the whole set is cheap enough to draw
      this.group.add(mesh);
      return mesh;
    });
    const look: Look = { poses, who: poses.map(() => []) };
    this.looks.set(id, look);
    return look;
  }

  /** The pose a body is in now: struck mid-blow, walking, or at rest, on a slow flipbook clock. */
  private poseOf(m: Mover, k: Kick | undefined): number {
    if (k && k.attack > 0) return STRIKE[k.attack > 0.2 ? 0 : 1];
    const moving = Math.abs(m.vx) + Math.abs(m.vy) > 1;
    if (moving) return WALK[Math.floor(this.t * 8 * Math.min(1.6, Math.max(0.6, Math.hypot(m.vx, m.vy) / 40)) + m.id) % 4];
    return IDLE[Math.floor(this.t * 1.5 + m.id * 0.37) % 2];
  }

  /**
   * Draw everyone the crowd handles this frame. Returns nothing; `drawn` lists who it took, so the
   * actor path leaves them alone. Bodies that died since last frame lie fallen and sink away.
   */
  sync(dt: number): void {
    this.t += dt;
    const s = this.scene, fog = s.fog;
    const was = new Set(this.drawn);
    this.drawn.clear();
    for (const l of this.looks.values()) if (l) l.who.forEach((w) => (w.length = 0));
    const count = new Map<THREE.InstancedMesh, number>();
    const put = (look: Look, pose: number, m: Mover | null, x: number, y: number, z: number, yaw: number, scale: number, colour: THREE.Color, squash = 0) => {
      const mesh = look.poses[pose];
      let n = count.get(mesh) ?? 0;
      if (n >= mesh.instanceMatrix.count) this.grow(look, pose);
      const target = look.poses[pose];
      this.e.set(0, yaw, 0); this.q.setFromEuler(this.e);
      this.v.set(x, y, z); this.sc.set(scale * (1 + squash * 0.5), scale * (1 - squash), scale * (1 + squash * 0.5));
      this.m4.compose(this.v, this.q, this.sc);
      target.setMatrixAt(n, this.m4); target.setColorAt(n, colour);
      if (m) look.who[pose][n] = m;
      count.set(target, ++n);
    };
    for (const ag of s.agents) {
      const m = ag as Mover;
      const cm = crowdModel(m);
      if (!cm || m.dead) continue;
      const look = this.look(cm.key, cm.held, cm.hat);
      if (!look) continue;
      this.drawn.add(m.id);
      if (m.hidden || (m instanceof Raider && m.lurking) || (m.hostile && fog && fog.visibleAt(m.x, m.y) <= 0.35)) continue;
      const k = this.kicks.get(m.id);
      const x = m.x * U + (k?.recoilX ?? 0), z = m.y * U + (k?.recoilZ ?? 0);
      // facing: turn toward the way it walks, smoothly
      let yaw = this.yaw.get(m.id) ?? 0;
      const moving = Math.abs(m.vx) + Math.abs(m.vy) > 1;
      if (moving) { let d = Math.atan2(m.vx, m.vy) - yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; yaw += d * Math.min(1, dt * 10); }
      else if (m.dir) { const want = m.dir < 0 ? -Math.PI / 2 : Math.PI / 2; if (Math.abs(want - yaw) > 2.5) yaw = want; }
      this.yaw.set(m.id, yaw);
      const flash = m.hurtT < 0.15 && !m.blocked ? 1 : k && k.flash > 0 ? Math.min(1, k.flash * 6) : 0;
      this.col.setHex(cm.tint);
      if (flash) this.col.lerp(new THREE.Color(2.4, 2.4, 2.4), flash * 0.8);
      put(look, this.poseOf(m, k), m, x, groundHeight(x, z) + standHeight(m), z, yaw, scaleOf(m), this.col, k?.squash ?? 0);
    }
    // the dead: whoever the crowd drew last frame and is now gone lies down where it fell, and sinks
    for (const id of was) if (!this.drawn.has(id)) {
      const m = this.lastSeen.get(id);
      const cm = m ? crowdModel(m) : null;
      const look = cm ? this.look(cm.key, cm.held, cm.hat) : null;
      if (m && look && m.dead) this.fallen.push({ look, x: m.x * U, y: groundHeight(m.x * U, m.y * U), z: m.y * U, yaw: this.yaw.get(m.id) ?? 0, scale: scaleOf(m), colour: new THREE.Color(cm!.tint), t: 0 });
      this.yaw.delete(id);
    }
    this.lastSeen.clear();
    for (const ag of s.agents) { const m = ag as Mover; if (this.drawn.has(m.id)) this.lastSeen.set(m.id, m); }
    this.fallen = this.fallen.filter((f) => {
      f.t += dt;
      if (f.t >= 0.9) return false;
      put(f.look, FALLEN, null, f.x, f.y - Math.max(0, f.t - 0.3) * 0.8, f.z, f.yaw, f.scale, f.colour.clone().multiplyScalar(1 - f.t * 0.6));
      return true;
    });
    for (const l of this.looks.values()) if (l) for (const mesh of l.poses) {
      mesh.count = count.get(mesh) ?? 0;
      mesh.boundingSphere = null; // the pointer's raycast recomputes it lazily from where everyone stands now
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
  private lastSeen = new Map<number, Mover>();

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
