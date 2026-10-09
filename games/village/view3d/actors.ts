import * as THREE from 'three';
import { Bars } from './billboards';
import { Mover, Villager, Raider, Player, Arrow, type EnemyKind } from '../agents';
import { Bolt } from '../enemies';
import { Boar, Swarm } from '../wildlife';
import { Caravan } from '../caravan';
import { lookFor, ENEMY_SCALE } from '../look';
import { BOAR, FOODS, ITEM, p } from '../config';
import type { Item } from '../items';
import type { VillageScene } from '../main';
import { mat, U, WALL_UNITS } from './models';
import { lambert, fogify } from './fow';
import { buildFigure, specFor, WEAPON_METAL, NO_KIT, type Spec, type Kit } from './figure';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { MODELS } from './assets';
import { RIG } from './registry';
import { groundHeight } from './terrain';

// Everyone who moves, and everything lying on the ground. Placeholder people are a few boxes —
// legs, body, head, and what they hold — until the character packs land; the look comes from the
// same lookFor() the inspector portraits use, so a role, a weapon or a gnome hat shows the same here.

const box = new THREE.BoxGeometry(1, 1, 1);
const cone = new THREE.ConeGeometry(0.5, 1, 6);
const ico = new THREE.IcosahedronGeometry(0.5, 0);
const ring = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
/** a soldier's rank on its red cap: none for a Recruit, then a band of bronze, silver, gold, and gold with a white plume at Elite */
const RANK_BAND = [0, 0, 0xb0703a, 0xc8ccd4, 0xe3b341, 0xe3b341];
export function rankOf(m: Mover): number { return m instanceof Villager && m.role === 'soldier' && m.isAdult ? m.tier : 1; }
/** The band (and the plume) for a cap whose brim is at `brim` (world units above the head bone), in a rig scaled by `k`. */
export function rankPieces(tier: number, k: number, brim: number): THREE.Mesh[] {
  if (tier < 2) return [];
  const out = [piece(RANK_BAND[tier], 0.36 / k, 0.11 / k, 0.36 / k, 0, (brim + 0.05) / k, 0, ring)];
  if (tier >= 5) out.push(piece(0xf4f0e6, 0.07 / k, 0.42 / k, 0.2 / k, 0, (brim + 0.5) / k, -0.06 / k));
  return out;
}
/**
 * Put a tool in the hand: at the end of the sleeve, held upright out of the fist, the way a pike is
 * shouldered and a sword is carried. (The pack's own hands wanted it laid flat across the palm instead.)
 */
export function grip(held: THREE.Object3D, k: number, s?: Spec): void {
  // the idle pose splays the arm about 32 degrees out; the tool is stood back up out of the fist
  if (s) { held.position.set(0, -(s.armLen - s.armW * 0.9), s.armW * 0.6); held.rotation.set(-0.1, 0, -0.56); return; }
  held.position.set(-0.05 / k, -0.32 / k, 0.06 / k);
  held.rotation.x = Math.PI / 2;
}
const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);

export function piece(colour: number, sx: number, sy: number, sz: number, x: number, y: number, z: number, g: THREE.BufferGeometry = box): THREE.Mesh {
  const m = new THREE.Mesh(g, lambert({ color: colour }));
  m.scale.set(sx, sy, sz); m.position.set(x, y + sy / 2, z);
  return m;
}

/** what a raider of each kind wears, in the dark */
const FOE: Record<EnemyKind, { body: number; head: number; eyes: number }> = {
  raider: { body: 0x4a2622, head: 0x141010, eyes: 0xff3020 },
  warlord: { body: 0x3a1010, head: 0x0a0808, eyes: 0xffa020 },
  rat: { body: 0x4a4440, head: 0x3a3430, eyes: 0xff2020 },
  snatcher: { body: 0x3a3a40, head: 0x202024, eyes: 0xd0ff40 },
  brute: { body: 0x4a3024, head: 0x2a1a14, eyes: 0xff4020 },
  shaman: { body: 0x3a2048, head: 0x1a1020, eyes: 0xc060ff },
  ogre: { body: 0x4a5a3a, head: 0x3a4a2e, eyes: 0xffd040 },
  wrecker: { body: 0x6a3a14, head: 0x2a1a0a, eyes: 0xff6020 },
  boar: { body: 0x4a3426, head: 0x3a2a1e, eyes: 0x200a0a },
  troll: { body: 0x3a4a34, head: 0x2e3a28, eyes: 0xffe040 },
  skulk: { body: 0x141414, head: 0x0a0a0a, eyes: 0xe0e0e0 },
};

/**
 * What is in the hand, in world units, built from the butt of the grip upward. `tier` is the weapon's
 * forged tier and decides its metal, so a bronze sword and a steel one are not the same grey box.
 */
export function heldMesh(held: string, tier = 0): THREE.Object3D | null {
  const g = new THREE.Group();
  const m = WEAPON_METAL[Math.max(0, Math.min(WEAPON_METAL.length - 1, tier))];
  const wood = 0x6a4a2a, grip = 0x3a2a1c;
  switch (held) {
    case 'sword': // a grip, a crossguard, and a blade that widens a little off the hilt
      g.add(piece(grip, 0.05, 0.1, 0.05, 0, 0, 0), piece(m, 0.2, 0.04, 0.06, 0, 0.1, 0),
        piece(m, 0.09, 0.46, 0.035, 0, 0.14, 0), piece(m, 0.05, 0.08, 0.03, 0, 0.6, 0, cone));
      break;
    case 'club': g.add(piece(wood, 0.07, 0.38, 0.07, 0, 0, 0), piece(wood, 0.12, 0.16, 0.12, 0, 0.36, 0)); break;
    case 'axe': g.add(piece(wood, 0.05, 0.6, 0.05, 0, 0, 0), piece(m, 0.06, 0.2, 0.05, 0.07, 0.4, 0), piece(m, 0.1, 0.14, 0.04, 0.12, 0.43, 0)); break;
    case 'hoe': g.add(piece(wood, 0.05, 0.75, 0.05, 0, 0, 0), piece(m, 0.18, 0.05, 0.06, 0.06, 0.7, 0)); break;
    case 'pike': g.add(piece(wood, 0.05, 1.6, 0.05, 0, 0, 0), piece(m, 0.09, 0.26, 0.05, 0, 1.56, 0, cone)); break;
    case 'bow': { // two limbs out of the grip and a string drawn between their tips
      const limb = (dy: number, sign: number) => { const b = piece(wood, 0.045, 0.42, 0.055, 0, dy, 0); b.rotation.z = sign * 0.3; return b; };
      g.add(piece(wood, 0.05, 0.16, 0.06, 0, 0, 0), limb(0.14, 0.3), limb(-0.1, -0.3), piece(0xe8e2d0, 0.012, 0.86, 0.012, 0.1, -0.22, 0));
      break;
    }
    case 'wand': g.add(piece(0x3a2a4a, 0.04, 0.5, 0.04, 0, 0, 0), piece(0x78d8f0, 0.1, 0.1, 0.1, 0, 0.5, 0, ico)); break;
    default: return null;
  }
  return g;
}

/** The tier of what this body is swinging or drawing, for the metal it is made of. */
export function weaponTier(m: Mover, held: string): number {
  if (held === 'bow') return Math.max(0, m.weapons.bow);
  if (held === 'sword' || held === 'axe' || held === 'pike') return Math.max(0, m.weapons.melee);
  return 0;
}

/** What `m` is wearing, for the figure to dress it in. */
export function kitOf(m: Mover): Kit { const a = lookFor(m)?.armor; return a ? { helmet: a.helmet, chest: a.chest, legs: a.legs, shield: a.shield } : NO_KIT; }

interface Actor {
  group: THREE.Group;
  /** the part that scales and squashes (the group itself carries position and facing) */
  body: THREE.Group;
  mats: THREE.MeshLambertMaterial[];
  key: string;
  yaw: number;
  carry?: THREE.Mesh;
  /** death animation clock, once the agent is gone */
  dying?: number;
  /** a pack character's animation, when it has one */
  anim?: Anim;
}

interface Anim { mixer: THREE.AnimationMixer; actions: Map<string, THREE.AnimationAction>; current: string }

/** how tall a grown person stands, in units */
export const PERSON = 1.25;

/** The rig this mover is animated on, if it walks on two legs (rats, boars, bolts, arrows and swarms keep code bodies). */
export function modelFor(m: Mover): { key: string } | null {
  if (m instanceof Player || m instanceof Villager) return { key: RIG };
  if (m instanceof Raider && !(m instanceof Boar) && m.kind !== 'rat' && m.kind !== 'boar') return { key: RIG };
  return null;
}

/** Build a figure for a mover on its own copy of the rig: its own materials, a mixer, its tool in hand. */
function makeCharacter(m: Mover, md: { key: string }): { body: THREE.Group; anim: Anim } | null {
  const ch = MODELS.characters.get(md.key);
  if (!ch) return null;
  const body = new THREE.Group();
  const rig = SkeletonUtils.clone(ch.scene);
  const fig = specFor(m);
  // the cap and the circlet go on with the body: the figure knows the head it has to fit them to
  const wear = { cap: m instanceof Villager ? rankOf(m) : 0, circlet: m instanceof Player, kit: kitOf(m) };
  const built = fig ? buildFigure(rig, fig.spec, wear) : 0; // 0: a rig we can't dress, so the pack's own body stands
  const k = PERSON / (built || ch.height);
  rig.scale.setScalar(k);
  rig.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mt = (o.material as THREE.MeshLambertMaterial).clone(); // every actor flashes on its own
    if (m instanceof Villager && m.elder) mt.color.multiplyScalar(0.85);
    fogify(mt); // a clone keeps the shader hook but not its defines
    o.material = mt;
  });
  body.add(rig);
  const hand = rig.getObjectByName('arm-right');
  const look = lookFor(m), held = look ? heldMesh(look.held, weaponTier(m, look.held)) : null;
  if (held && hand) { held.scale.setScalar(1 / k); grip(held, k, fig?.spec); hand.add(held); }
  else if (held) { held.position.set(0.3, 0.42, 0.12); held.rotation.x = 0.5; body.add(held); }
  const mixer = new THREE.AnimationMixer(rig);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const clip of ch.clips) actions.set(clip.name, mixer.clipAction(clip));
  for (const one of ['die', 'attack-melee-right', 'interact-right', 'pick-up']) { const a = actions.get(one); if (a) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } }
  const idle = actions.get('idle'); idle?.play();
  mixer.update(Math.random() * 2); // not everyone breathes in step
  return { body, anim: { mixer, actions, current: 'idle' } };
}

/** Cross-fade an actor to an animation (one-shots restart). */
function play(an: Anim, name: string, fade = 0.15): void {
  const next = an.actions.get(name);
  if (!next) return;
  if (an.current === name && next.loop !== THREE.LoopOnce) return;
  const prev = an.actions.get(an.current);
  next.reset().setEffectiveWeight(1).play();
  if (prev && prev !== next) prev.crossFadeTo(next, fade, false);
  an.current = name;
}

/** Build the placeholder for one mover. Front faces +z. */
export function makeActor(m: Mover): { body: THREE.Group; key: string; anim?: Anim } {
  const key = actorKey(m);
  const md = modelFor(m), built = md ? makeCharacter(m, md) : null;
  if (built) return { body: built.body, key, anim: built.anim };
  const body = new THREE.Group();
  const look = lookFor(m);
  if (m instanceof Arrow) { body.add(piece(0x8a6a3a, 0.04, 0.04, 0.6, 0, 0, 0), piece(0xd0d0d0, 0.06, 0.06, 0.1, 0, -0.01, 0.3, cone)); return { body, key }; }
  if (m instanceof Bolt) { const b = piece(0xb46bff, 0.35, 0.35, 0.35, 0, 0.4, 0, ico); (b.material as THREE.MeshLambertMaterial).emissive.setHex(0x7a2ad0); body.add(b); return { body, key }; }
  if (m instanceof Caravan) {
    // two oxen yoked side by side in front (+z), the laden cart behind
    for (const x of [0.32, -0.32]) {
      body.add(piece(0x6a4a2e, 0.42, 0.42, 0.9, x, 0.28, 0.75), piece(0x5a3e26, 0.3, 0.3, 0.3, x, 0.42, 1.32));
      body.add(piece(0xe8e0c8, 0.5, 0.05, 0.05, x, 0.68, 1.32)); // horns
      for (const [lx, lz] of [[0.13, 0.4], [-0.13, 0.4], [0.13, 1.1], [-0.13, 1.1]]) body.add(piece(0x3a2a1a, 0.1, 0.3, 0.1, x + lx, 0, lz));
    }
    body.add(piece(0x4a3420, 0.08, 0.08, 0.9, 0, 0.42, 0.15)); // the pole
    body.add(piece(0x7a5a36, 1.0, 0.18, 1.3, 0, 0.42, -0.65)); // the cart bed
    body.add(piece(0xb89a6a, 0.4, 0.3, 0.4, -0.22, 0.6, -0.4), piece(0x8a6a44, 0.35, 0.35, 0.35, 0.2, 0.6, -0.85), piece(0xd8c8a0, 0.5, 0.25, 0.3, 0, 0.6, -1.05)); // sacks and crates
    for (const x of [0.55, -0.55]) body.add(piece(0x3a2a1a, 0.08, 0.6, 0.6, x, 0.12, -0.65, cyl).rotateZ(Math.PI / 2));
    return { body, key };
  }
  if (m instanceof Swarm) { for (let k = 0; k < 9; k++) body.add(piece(0x1a1408, 0.06, 0.06, 0.06, (Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 0.5, (Math.random() - 0.5) * 0.6)); return { body, key }; }
  if (m instanceof Raider && (m.kind === 'rat' || m.kind === 'boar' || m instanceof Boar)) {
    const c = FOE[m.kind];
    const big = m.kind === 'boar' ? 1 : 0.55;
    body.add(piece(c.body, 0.4 * big, 0.38 * big, 0.75 * big, 0, 0.12 * big, 0));
    body.add(piece(c.head, 0.3 * big, 0.28 * big, 0.25 * big, 0, 0.2 * big, 0.45 * big));
    body.add(piece(c.eyes, 0.05, 0.05, 0.02, 0.07 * big, 0.38 * big, 0.58 * big), piece(c.eyes, 0.05, 0.05, 0.02, -0.07 * big, 0.38 * big, 0.58 * big));
    for (const [x, z] of [[0.12, 0.25], [-0.12, 0.25], [0.12, -0.25], [-0.12, -0.25]]) body.add(piece(c.head, 0.08 * big, 0.14 * big, 0.08 * big, x * big, 0, z * big));
    if (m.kind === 'boar') body.add(piece(0xe8e0c8, 0.04, 0.12, 0.04, 0.1, 0.18, 0.6), piece(0xe8e0c8, 0.04, 0.12, 0.04, -0.1, 0.18, 0.6)); // tusks
    return { body, key };
  }
  // a person: legs, body, head, arms; the colours say who
  let torso = 0x5a5a5a, head = 0xb08a6a, legs = 0x2a241e, eyes: number | null = null;
  if (m instanceof Player) { torso = 0x2e4a6e; legs = 0x2a2a34; }
  else if (m instanceof Villager) { torso = 0x4a5a3a; if (m.elder) head = 0x9a8a7a; }
  else if (m instanceof Raider) { const c = FOE[m.kind]; torso = c.body; head = c.head; legs = 0x141010; eyes = c.eyes; }
  const thin = m instanceof Raider && m.kind === 'skulk';
  const w = thin ? 0.28 : 0.42;
  body.add(piece(legs, w * 0.85, 0.42, 0.22, 0, 0, 0));
  body.add(piece(torso, w, 0.46, 0.26, 0, 0.42, 0));
  body.add(piece(torso, 0.1, 0.42, 0.12, w / 2 + 0.06, 0.44, 0), piece(torso, 0.1, 0.42, 0.12, -w / 2 - 0.06, 0.44, 0));
  body.add(piece(head, 0.3, 0.3, 0.28, 0, 0.9, 0));
  if (eyes !== null) {
    for (const x of [0.07, -0.07]) { const e = piece(eyes, 0.06, 0.04, 0.02, x, 1.04, 0.14); (e.material as THREE.MeshLambertMaterial).emissive.setHex(eyes); body.add(e); }
    if (m instanceof Raider && m.kind !== 'ogre' && m.kind !== 'troll') body.add(piece(0x0e0a0a, 0.36, 0.22, 0.34, 0, 1.08, -0.02, cone)); // the hood
  } else body.add(piece(0x141010, 0.05, 0.04, 0.02, 0.07, 1.02, 0.14), piece(0x141010, 0.05, 0.04, 0.02, -0.07, 1.02, 0.14));
  if (m instanceof Villager) body.add(piece(0xa02a22, 0.34, 0.5, 0.34, 0, 1.18, 0, cone), ...rankPieces(rankOf(m), 1, 1.02)); // the red hat, and the rank on it
  if (m instanceof Player) body.add(piece(0xc8a040, 0.32, 0.06, 0.3, 0, 1.06, 0)); // the head's circlet
  const held = look ? heldMesh(look.held) : null;
  if (held) { held.position.set(w / 2 + 0.08, 0.42, 0.12); held.rotation.x = 0.5; held.userData.held = true; body.add(held); }
  return { body, key };
}

function actorKey(m: Mover): string {
  const look = lookFor(m), md = modelFor(m), a = m.armor;
  // the gear is part of the key: a body that re-arms is rebuilt wearing what it just picked up
  const gear = `${a.helmet}${a.chest}${a.legs}${a.shield}|${m.weapons.melee},${m.weapons.bow}`;
  return `${md && MODELS.characters.has(md.key) ? md.key : 'box'}|${m.constructor.name}|${look?.held ?? ''}|${look?.body ?? ''}|${gear}|${m instanceof Villager ? m.role + m.elder + rankOf(m) : ''}|${m instanceof Raider ? m.kind + m.boss : ''}`;
}

export function scaleOf(m: Mover): number {
  const swollen = m instanceof Villager ? m.moodNow?.bulk?.scale ?? 1 : 1;
  const base = m instanceof Villager ? (m.isChild ? 0.38 : 0.55)
    : m instanceof Boar ? (m.young ? BOAR.youngScale : 1)
    : m instanceof Raider ? ENEMY_SCALE[m.kind] * (m.boss ? 1.15 : 1)
    : 1;
  return base * swollen;
}

/** Height above the ground an agent stands at, in units. */
export function standHeight(m: Mover): number {
  if (m instanceof Arrow) return (m.elevated ? WALL_UNITS * Math.max(0, 1 - m.travelled / m.dropDistance) : 0) + 0.7;
  return m.elevated ? WALL_UNITS : 0;
}

/** the hit-flash and squash an fx can lay on an actor for a moment */
export interface Kick { flash: number; flashColour: number; squash: number; recoilX: number; recoilZ: number; spin: number; /** seconds of a strike animation to play */ attack: number }

export class Actors {
  readonly group = new THREE.Group();
  private actors = new Map<number, Actor>();
  private dying: Actor[] = [];
  private items = new Map<number, THREE.Mesh>();
  readonly kicks = new Map<number, Kick>();
  /** who the crowd renderer draws (view3d/crowd.ts): the actor path leaves them be */
  crowdDrawn: { has(id: number): boolean } = new Set<number>();
  /** body meshes a pointer can land on, rebuilt as agents come and go */
  readonly pickable: THREE.Object3D[] = [];
  private t = 0;

  constructor(private scene: VillageScene) { this.group.add(this.hpBars.group); }

  clear(): void {
    for (const a of this.actors.values()) this.group.remove(a.group);
    for (const a of this.dying) this.group.remove(a.group);
    for (const i of this.items.values()) this.group.remove(i);
    this.actors.clear(); this.dying = []; this.items.clear(); this.kicks.clear(); this.pickable.length = 0;
  }

  kick(id: number): Kick {
    let k = this.kicks.get(id);
    if (!k) this.kicks.set(id, (k = { flash: 0, flashColour: 0xffffff, squash: 0, recoilX: 0, recoilZ: 0, spin: 0, attack: 0 }));
    return k;
  }

  /** Where an agent's head is, for words and bursts. */
  headOf(m: Mover): THREE.Vector3 {
    const a = this.actors.get(m.id);
    const s = a ? a.body.scale.y : scaleOf(m);
    return new THREE.Vector3(m.x * U, groundHeight(m.x * U, m.y * U) + standHeight(m) + 1.15 * s, m.y * U);
  }

  /** what the camera can see: actors further than this from its focus are not drawn or animated (the big map holds hundreds of them) */
  private cullX = 0;
  private cullZ = 0;
  private cullR2 = Infinity;
  cull(x: number, z: number, r: number): void { this.cullX = x; this.cullZ = z; this.cullR2 = r * r; }

  sync(dt: number): void {
    if (this.scene.view) this.hpBars.begin(this.scene.view.camera);
    this.syncBodies(dt);
    this.hpBars.end();
  }
  private syncBodies(dt: number): void {
    this.t += dt;
    const s = this.scene, fog = s.fog;
    const seen = new Set<number>();
    let pickDirty = false;
    for (const ag of s.agents) {
      const m = ag as Mover;
      seen.add(m.id);
      if (this.crowdDrawn.has(m.id)) {
        // drawn by the crowd: drop any actor it had before its look baked, and only keep its hp bar
        // (on raiders, and on the one gnome you are looking at — a thousand bars would be noise)
        const old = this.actors.get(m.id);
        if (old) { this.group.remove(old.group); this.actors.delete(m.id); pickDirty = true; }
        const seenHere = !m.hidden && !(m.hostile && fog && fog.visibleAt(m.x, m.y) <= 0.35);
        this.bar(m, seenHere && m.hp < m.maxHp && (m.hostile || s.selected === m));
        continue;
      }
      // out of the camera's reach, hidden indoors, or a raider in the dark: nothing to draw, so nothing to pose
      if (!(m instanceof Player) && (m.hidden || (m.x * U - this.cullX) ** 2 + (m.y * U - this.cullZ) ** 2 > this.cullR2 || (m.hostile && fog && fog.visibleAt(m.x, m.y) <= 0.35))) {
        const idle = this.actors.get(m.id);
        if (idle) idle.group.visible = false;
        this.bar(m, false);
        continue;
      }
      let a = this.actors.get(m.id);
      const key = actorKey(m);
      if (a && a.key !== key) { this.group.remove(a.group); a = undefined; pickDirty = true; }
      if (!a) {
        const { body, anim } = makeActor(m);
        const group = new THREE.Group();
        group.add(body);
        const mats: THREE.MeshLambertMaterial[] = [];
        body.traverse((o) => { if (o instanceof THREE.Mesh) { o.userData.agent = m; o.castShadow = true; mats.push(o.material as THREE.MeshLambertMaterial); } });
        a = { group, body, mats, key, yaw: 0, anim };
        this.group.add(group); this.actors.set(m.id, a); pickDirty = true;
      }
      const x = m.x * U, z = m.y * U;
      const moving = Math.abs(m.vx) + Math.abs(m.vy) > 1;
      const k = this.kicks.get(m.id);
      const bob = !a.anim && moving && !(m instanceof Arrow) && !(m instanceof Bolt) ? Math.abs(Math.sin(this.t * 12 + m.id)) * 0.06 : 0;
      if (a.anim) {
        const sp = Math.hypot(m.vx, m.vy);
        if (k && k.attack > 0) { if (a.anim.current !== 'attack-melee-right') play(a.anim, 'attack-melee-right', 0.05); }
        else play(a.anim, sp > 70 ? 'sprint' : moving ? 'walk' : 'idle');
        a.anim.mixer.update(dt * (moving ? Math.max(0.6, Math.min(1.6, sp / 45)) : 1));
      }
      a.group.position.set(x + (k?.recoilX ?? 0), groundHeight(x, z) + standHeight(m) + bob, z + (k?.recoilZ ?? 0));
      // facing: arrows along their flight, the head along its aim or facing, everyone else the way they walk
      let fx = 0, fz = 0;
      if (m instanceof Arrow || m instanceof Bolt) { fx = (m as Arrow).ux; fz = (m as Arrow).uy; }
      else if (m instanceof Player) { const bow = m.tool === 'bow'; fx = bow ? m.aim.x : m.facing.x; fz = bow ? m.aim.y : m.facing.y; if (moving && !bow) { fx = m.vx; fz = m.vy; } }
      else if (moving) { fx = m.vx; fz = m.vy; }
      else { fx = m.dir; fz = 0.0001; }
      const want = Math.atan2(fx, fz);
      let dy = want - a.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      a.yaw += m instanceof Arrow || m instanceof Bolt ? dy : dy * Math.min(1, dt * 12);
      a.group.rotation.y = a.yaw;
      const sc = scaleOf(m), sq = k?.squash ?? 0;
      a.body.scale.set(sc * (1 + sq * 0.5), sc * (1 - sq), sc * (1 + sq * 0.5));
      a.body.rotation.z = k?.spin ?? 0;
      if (m instanceof Swarm) a.body.children.forEach((c, i) => { c.position.x = Math.sin(this.t * 9 + i * 1.7) * 0.3; c.position.z = Math.cos(this.t * 7 + i * 2.1) * 0.3; });
      const hostileUnseen = m.hostile && fog && fog.visibleAt(m.x, m.y) <= 0.35;
      a.group.visible = !m.hidden && !(m instanceof Raider && m.lurking) && !hostileUnseen;
      // the hit flash, a telegraph's glow, or nothing
      const flash = m.hurtT < 0.15 && !m.blocked ? 1 : k && k.flash > 0 ? Math.min(1, k.flash * 6) : 0;
      const fc = m.hurtT < 0.15 && !m.blocked ? 0xffffff : k?.flashColour ?? 0xffffff;
      for (const mt of a.mats) { if (mt.userData.eyes === undefined) mt.userData.eyes = mt.emissive.getHex(); mt.emissive.setHex(flash > 0 ? fc : mt.userData.eyes as number); mt.emissiveIntensity = flash > 0 ? flash * 0.8 : 1; }
      // what is on the back: a bundle of logs, a basket of food
      if (m.load && !a.carry) { a.carry = piece(m.load.kind === 'food' ? 0x8a6a3a : 0x6a4a2a, 0.36, 0.3, 0.22, 0, 0.55, -0.24); a.body.add(a.carry); }
      if (a.carry) a.carry.visible = !!m.load;
      // hp bar over anyone hurt (and seen)
      this.bar(m, a.group.visible && m.hp < m.maxHp && !(m instanceof Arrow) && !(m instanceof Bolt));
    }
    for (const [id, a] of this.actors) if (!seen.has(id)) {
      this.actors.delete(id); this.kicks.delete(id); pickDirty = true;
      if (a.key.startsWith('Arrow') || a.key.startsWith('Bolt')) { this.group.remove(a.group); continue; }
      a.dying = 0; this.dying.push(a);
    }
    // the dead tip over, sink and are gone
    this.dying = this.dying.filter((a) => {
      a.dying! += dt;
      const f = Math.min(1, a.dying! / (a.anim ? 1.2 : 0.6));
      if (a.anim) { if (a.anim.current !== 'die') play(a.anim, 'die', 0.05); a.anim.mixer.update(dt); }
      else a.body.rotation.x = -f * Math.PI / 2;
      a.group.position.y -= dt * 0.25 * f;
      for (const mt of a.mats) { mt.transparent = true; mt.opacity = 1 - f; }
      if (f >= 1) { this.group.remove(a.group); return false; }
      return true;
    });
    // kicks fade
    for (const k of this.kicks.values()) {
      k.flash = Math.max(0, k.flash - dt); k.attack = Math.max(0, k.attack - dt);
      k.squash *= Math.max(0, 1 - dt * 10); k.recoilX *= Math.max(0, 1 - dt * 10); k.recoilZ *= Math.max(0, 1 - dt * 10); k.spin *= Math.max(0, 1 - dt * 8);
    }
    if (pickDirty) { this.pickable.length = 0; for (const a of this.actors.values()) this.pickable.push(a.body); }
    this.syncItems();
  }

  /** every hp bar this frame: one batch of camera-facing quads (two draws for all of them) */
  private hpBars = new Bars(10);
  private bar(m: Mover, show: boolean): void {
    if (!show) return;
    const huge = m instanceof Raider && (m.huge || m.boss);
    const w = huge ? 1.6 : 0.7, frac = Math.max(0, m.hp / m.maxHp);
    const head = this.headOf(m);
    this.hpBars.bar(head.x, head.y + 0.3, head.z, w, frac, frac > 0.4 ? 0x5fdc5f : 0xff4040, 0x000000, 0.07);
  }

  private syncItems(): void {
    const s = this.scene, fog = s.fog, pl = s.player, seen = new Set<number>();
    for (const it of s.world.items) {
      seen.add(it.id);
      let mesh = this.items.get(it.id);
      if (!mesh) { mesh = itemMesh(it); mesh.userData.item = it; this.items.set(it.id, mesh); this.group.add(mesh); }
      // loot near the head bobs and glows: walk over it to take it
      const near = it.rest && pl && !pl.hidden && (it.x - pl.x) ** 2 + (it.y - pl.y) ** 2 <= ITEM.highlight * ITEM.highlight;
      const bob = near ? 0.08 + Math.sin(this.t * 3.4 + it.id) * 0.06 : 0;
      const x = it.x * U, z = it.y * U;
      mesh.position.set(x, groundHeight(x, z) + it.z * U + bob, z);
      mesh.rotation.y = it.rest ? it.id : it.age * 6;
      const m = mesh.material as THREE.MeshLambertMaterial;
      m.emissive.setHex(near && s.itemRoom(it) > 0 ? 0x6a5a10 : 0x000000);
      mesh.visible = !fog || fog.visibleAt(it.x, it.y) > 0.3;
      if (it.kind === 'food') { const n = Math.min(3, Math.max(1, Math.ceil(it.n / Math.max(1, p.tossSize)))); mesh.scale.setScalar(0.7 + n * 0.15); }
    }
    for (const [id, mesh] of this.items) if (!seen.has(id)) { this.group.remove(mesh); this.items.delete(id); }
  }
}

function itemMesh(it: Item): THREE.Mesh {
  if (it.kind === 'wood') { const m = piece(0x6a4a2a, 0.12, 0.12, 0.5, 0, 0, 0); m.geometry = box; return m; }
  if (it.kind === 'scrap') return piece(0x7a7e84, 0.2, 0.08, 0.16, 0, 0, 0);
  if (it.kind === 'gear') return piece(0xb09040, 0.22, 0.12, 0.22, 0, 0, 0);
  const colour = it.food ? parseInt(FOODS[it.food].colour.slice(1), 16) : 0xa08060;
  const m = new THREE.Mesh(ico, lambert({ color: colour }));
  m.scale.setScalar(0.3);
  return m;
}

export { mat };
