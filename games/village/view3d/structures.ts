import * as THREE from 'three';
import { BUILDINGS, type Building, type BuildingKind, type Defense } from '../world';
import type { VillageScene } from '../main';
import { Mover } from '../agents';
import { mat, WALL_UNITS, U } from './models';
import { lambert } from './ps1';
import { groundHeight } from './terrain';

// Buildings and fortifications. Each is a small group of flat-shaded boxes and cones, rebuilt only
// when what it looks like changes (level, ruin, gate open/shut). Pack models replace these later
// through the same entry point (makeBuilding), so the scene code never cares which it gets.

const box = new THREE.BoxGeometry(1, 1, 1);
const roof4 = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4); // a square pyramid of unit footprint
const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
const ico = new THREE.IcosahedronGeometry(0.5, 1);

function part(g: THREE.BufferGeometry, colour: number, sx: number, sy: number, sz: number, x: number, y: number, z: number, m?: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(g, m ?? mat(colour));
  mesh.scale.set(sx, sy, sz); mesh.position.set(x, y + sy / 2, z);
  return mesh;
}

/** what a building wears, by kind: walls, roof, and how tall it stands at level 1 */
const STYLE: Record<BuildingKind, { wall: number; roof: number; h: number }> = {
  house: { wall: 0x6e5c48, roof: 0x4a2a24, h: 1.3 },
  barracks: { wall: 0x5e5e62, roof: 0x3a3a44, h: 1.8 },
  granary: { wall: 0x7a6248, roof: 0x5a3a26, h: 1.6 },
  woodyard: { wall: 0x5a4632, roof: 0x3e3226, h: 1.1 },
  tavern: { wall: 0x705a40, roof: 0x3e2420, h: 1.6 },
  lair: { wall: 0x2a2626, roof: 0x1a1818, h: 1.8 },
  gnomehouse: { wall: 0xcfc2a8, roof: 0x9a2a22, h: 0.9 },
  cookpot: { wall: 0x2a2a2e, roof: 0x8a4a1a, h: 0.9 },
};

const CHARRED = 0x2a2420;

interface Built { group: THREE.Group; key: string; windows: THREE.MeshLambertMaterial; light?: THREE.Mesh }

/**
 * Build a building at the origin of its footprint: x right, z south, one unit a tile. The front
 * (with the door) faces south (+z), the way the 2D art faced the camera.
 */
function makeBuilding(b: Building): Built {
  const f = BUILDINGS[b.kind], st = STYLE[b.kind], w = f.w, d = f.h;
  const g = new THREE.Group();
  const ruined = b.ruined;
  const wallC = ruined ? CHARRED : st.wall, roofC = ruined ? 0x1e1a18 : st.roof;
  const windows = lambert({ color: 0x1a1410, emissive: 0x000000 });
  const lvl = Math.min(3, b.level);
  const h = st.h + 0.3 * (lvl - 1);
  const cx = w / 2, cz = d / 2;
  const doorX = f.door + 0.5;
  switch (b.kind) {
    case 'cookpot': {
      // the great pot: a squat black cauldron on stones, the stew a dull glow at its lip
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; g.add(part(ico, 0x4a4844, 0.45, 0.3, 0.45, cx + Math.cos(a) * 1.1, 0, cz + Math.sin(a) * 1.1)); }
      g.add(part(cyl, wallC, 1.9, 0.95, 1.9, cx, 0.15, cz));
      const stew = new THREE.Mesh(new THREE.CircleGeometry(0.85, 12).rotateX(-Math.PI / 2), lambert({ color: 0x5a3a1a, emissive: ruined ? 0x000000 : 0x6a2a08 }));
      stew.position.set(cx, 1.08, cz); g.add(stew);
      return { group: g, key: '', windows, light: stew };
    }
    case 'gnomehouse': {
      // a toadstool: pale stem, spotted red cap
      g.add(part(cyl, wallC, 1.1, h, 1.1, cx, 0, cz));
      g.add(part(new THREE.SphereGeometry(0.5, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), roofC, 2.1, 1.3, 2.1, cx, h - 0.05, cz));
      if (!ruined) for (let k = 0; k < 5; k++) { const a = k * 1.3; g.add(part(box, 0xf0e8d8, 0.16, 0.08, 0.16, cx + Math.cos(a) * 0.65, h + 0.35, cz + Math.sin(a) * 0.65)); }
      g.add(part(box, 0x2a1a14, 0.35, 0.55, 0.06, doorX, 0, cz + 0.55));
      g.add(part(box, 0x1a1410, 0.22, 0.22, 0.06, cx + 0.35, 0.45, cz + 0.55, windows));
      return { group: g, key: '', windows };
    }
    case 'lair': {
      // the Ogre's lair: a black mound of rock with a mouth
      g.add(part(ico, wallC, w * 0.95, h * 1.2, d * 0.95, cx, 0, cz));
      g.add(part(ico, 0x343030, w * 0.5, h * 0.9, d * 0.5, cx + 1, 0.2, cz - 0.8));
      g.add(part(box, 0x050404, 1.2, 1.1, 0.4, doorX, 0, d - 0.35));
      return { group: g, key: '', windows };
    }
    case 'woodyard': {
      // an open shed on posts over a log pile
      for (const [px, pz] of [[0.2, 0.2], [w - 0.2, 0.2], [0.2, d - 0.2], [w - 0.2, d - 0.2]]) g.add(part(box, 0x3e2e20, 0.14, h, 0.14, px, 0, pz));
      g.add(part(box, roofC, w + 0.2, 0.12, d + 0.2, cx, h, cz));
      for (let k = 0; k < 3 + lvl; k++) g.add(part(cyl, 0x6a4a2e, 0.28, w - 0.8, 0.28, cx, 0.14 + (k % 3) * 0.26, 0.5 + Math.floor(k / 3) * 0.3).rotateZ(Math.PI / 2));
      return { group: g, key: '', windows };
    }
  }
  // the house-like ones: walls, a pitched roof, a door to the south, windows that light at night
  g.add(part(box, wallC, w - 0.3, h, d - 0.3, cx, 0, cz));
  const roofH = b.kind === 'barracks' ? 0.5 : b.kind === 'granary' ? 1.4 : 1.1;
  if (ruined) {
    const r = part(roof4, roofC, (w - 0.1) * 0.9, roofH * 0.6, (d - 0.1) * 0.9, cx + 0.3, h - 0.5, cz);
    r.rotation.z = 0.35; g.add(r);
  } else g.add(part(roof4, roofC, w + 0.1, roofH, d + 0.1, cx, h, cz));
  if (b.kind === 'barracks' && !ruined) for (let k = 0; k < 4; k++) g.add(part(box, wallC, 0.3, 0.3, 0.3, k < 2 ? 0.3 : w - 0.3, h + 0.5, k % 2 ? 0.3 : d - 0.3)); // a tower top at each corner
  if (lvl >= 3 && !ruined && b.kind !== 'barracks') g.add(part(box, 0x4a4040, 0.35, 0.9, 0.35, w - 0.8, h, 0.8)); // a chimney
  g.add(part(box, 0x24180f, 0.6, 0.95, 0.06, doorX, 0, d - 0.12));
  for (const wx of [0.7, w - 0.7]) if (Math.abs(wx - doorX) > 0.6) g.add(part(box, 0x1a1410, 0.38, 0.32, 0.06, wx, h * 0.5, d - 0.12, windows));
  if (b.kind === 'tavern' && !ruined) g.add(part(box, 0x8a5a2a, 0.5, 0.35, 0.05, doorX + 0.7, 1.0, d - 0.05)); // the sign
  return { group: g, key: '', windows };
}

function defenseKey(d: Defense, open: boolean): string { return `${d.kind}|${open}`; }

function makeDefense(d: Defense, open: boolean): THREE.Group {
  const g = new THREE.Group();
  const H = WALL_UNITS;
  if (d.kind === 'wall') {
    g.add(part(box, 0x56565a, 1, H, 1, 0.5, 0, 0.5));
    for (const [x, z] of [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) g.add(part(box, 0x4a4a4e, 0.26, 0.22, 0.26, x, H, z));
  } else if (d.kind === 'gate') {
    g.add(part(box, 0x4a4a4e, 0.18, H, 1, 0.09, 0, 0.5));
    g.add(part(box, 0x4a4a4e, 0.18, H, 1, 0.91, 0, 0.5));
    g.add(part(box, 0x4a4a4e, 1, 0.3, 1, 0.5, H - 0.3, 0.5));
    if (!open) g.add(part(box, 0x5a3e24, 0.64, H - 0.35, 0.2, 0.5, 0, 0.5));
  } else {
    // stairs: four steps up to the wall walk
    for (let k = 0; k < 4; k++) g.add(part(box, 0x5e5a54, 1, (H * (k + 1)) / 4, 0.25, 0.5, 0, 0.125 + k * 0.25));
  }
  g.traverse((o) => { o.userData.defense = d; });
  return g;
}

export class Structures {
  readonly group = new THREE.Group();
  private built = new Map<Building, Built>();
  private forts = new Map<number, { group: THREE.Group; key: string }>();
  /** the meshes a pointer can land on: wall tops, gates, stairs */
  readonly pickable: THREE.Object3D[] = [];
  /** every building's group, for the pointer */
  get buildingGroups(): THREE.Object3D[] { return [...this.built.values()].map((e) => e.group); }

  constructor(private scene: VillageScene) {}

  clear(): void {
    for (const b of this.built.values()) this.group.remove(b.group);
    for (const f of this.forts.values()) this.group.remove(f.group);
    this.built.clear(); this.forts.clear(); this.pickable.length = 0;
  }

  sync(night: number, t: number): void {
    const s = this.scene, w = s.world;
    const live = new Set<Building>();
    for (const b of w.buildings) {
      live.add(b);
      const key = `${b.kind}|${Math.min(3, b.level)}|${!!b.ruined}`;
      let e = this.built.get(b);
      if (e && e.key !== key) { this.group.remove(e.group); e = undefined; }
      if (!e) {
        e = makeBuilding(b); e.key = key;
        e.group.position.set(b.tx, groundHeight(b.tx + BUILDINGS[b.kind].w / 2, b.ty + BUILDINGS[b.kind].h / 2), b.ty);
        e.group.traverse((o) => { o.userData.building = b; o.castShadow = true; o.receiveShadow = true; });
        this.group.add(e.group); this.built.set(b, e);
      }
      // the windows come on as night falls, in a warm house only; the pot's stew glows while it cooks
      const lit = !b.ruined && b.warm ? night : 0;
      e.windows.emissive.setRGB(0.9 * lit, 0.55 * lit, 0.2 * lit);
      if (e.light) ((e.light as THREE.Mesh).material as THREE.MeshLambertMaterial).emissiveIntensity = 0.6 + 0.4 * Math.sin(t * 3);
    }
    for (const [b, e] of this.built) if (!live.has(b)) { this.group.remove(e.group); this.built.delete(b); }
    // fortifications
    const seen = new Set<number>();
    let pickDirty = false;
    for (const [id, d] of w.defenses) {
      seen.add(id);
      const friendly = d.kind === 'gate' && s.agents.some((a) => a instanceof Mover && !a.hostile && !a.elevated && !a.hidden && Math.hypot(a.x * U - (d.tx + 0.5), a.y * U - (d.ty + 0.5)) < 1.2);
      const open = d.kind === 'gate' && (d.open || friendly);
      const key = defenseKey(d, open);
      let f = this.forts.get(id);
      if (f && f.key !== key) { this.group.remove(f.group); f = undefined; pickDirty = true; }
      if (!f) {
        f = { group: makeDefense(d, open), key };
        f.group.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
        f.group.position.set(d.tx, groundHeight(d.tx + 0.5, d.ty + 0.5), d.ty);
        this.group.add(f.group); this.forts.set(id, f); pickDirty = true;
      }
      // the posting order paints every wall it could send a guard to
      const tint = s.posting ? 0x6ab8d0 : d.hp < d.maxHp * 0.5 ? 0x3a3434 : null;
      f.group.traverse((o) => { if (o instanceof THREE.Mesh) (o as THREE.Mesh & { _base?: THREE.Material })._base ??= o.material as THREE.Material; });
      f.group.traverse((o) => { if (o instanceof THREE.Mesh) o.material = tint === null ? (o as THREE.Mesh & { _base: THREE.Material })._base : mat(tint); });
    }
    for (const [id, f] of this.forts) if (!seen.has(id)) { this.group.remove(f.group); this.forts.delete(id); pickDirty = true; }
    if (pickDirty) {
      this.pickable.length = 0;
      for (const f of this.forts.values()) this.pickable.push(f.group);
    }
  }

  /** where a building pops when it levels up (for the celebration) */
  centre(b: Building): THREE.Vector3 {
    const f = BUILDINGS[b.kind];
    return new THREE.Vector3(b.tx + f.w / 2, STYLE[b.kind].h + 0.6, b.ty + f.h / 2);
  }
}
