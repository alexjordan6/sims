import * as THREE from 'three';
import { BUILDINGS, type Building, type Defense } from '../world';
import { MODELS } from './assets';
import { lambert } from './ps1';
import { WALL_UNITS } from './models';

// Buildings and fortifications assembled from the town and graveyard kits. A wall piece stands on the +x
// edge of its tile (x 0.4..0.5, one unit tall); turning it a quarter at a time puts it on any side. A
// 'roof' piece rises toward +x by 0.63 over a tile, so mirrored pairs make a gable. Our people are a
// little over a tile tall, so walls are stretched to WALL_H. Returns null while any piece is missing,
// and the code-built building stands in (structures.ts).

/** how tall one storey of kit wall stands */
const WALL_H = 1.5;
const RISE = 0.63;
/** the kit's roofs are a bright teal; under our sky they read as old, damp slate */
const ROOF = 0x9a8c84;

/** the kit pieces buildings and defences are made of (kept on their own pivots) */
export const KIT_PIECES = [
  'town/wall-wood', 'town/wall-wood-door', 'town/wall-wood-window-shutters', 'town/wall-wood-window-small', 'town/wall-wood-broken',
  'town/wall', 'town/wall-door', 'town/wall-window-stone', 'town/wall-broken',
  'town/roof', 'town/roof-gable', 'town/roof-flat', 'town/chimney', 'town/banner-red', 'town/wall-block', 'town/wall-arch', 'town/stairs-stone',
];
/** whole models stood on the ground and centred */
export const KIT_PROPS = ['nature/campfire_logs', 'grave/crypt-large', 'nature/log_stackLarge', 'grave/fire-basket', 'grave/lantern-candle', 'grave/gravestone-round', 'grave/gravestone-cross', 'grave/gravestone-broken'];

const mats = new Map<number, THREE.MeshLambertMaterial>();
/** vertex colours times a tint: white for as-is, dark for a ruin */
function kitMat(tint: number): THREE.MeshLambertMaterial {
  let m = mats.get(tint);
  if (!m) mats.set(tint, (m = lambert({ vertexColors: true, color: tint })));
  return m;
}

function piece(g: THREE.Group, key: string, tint: number, x: number, y: number, z: number, rotY = 0, sx = 1, sy = 1, sz = 1): THREE.Mesh | null {
  const geo = MODELS.props.get(key);
  if (!geo) return null;
  const m = new THREE.Mesh(geo, kitMat(tint));
  m.position.set(x, y, z); m.rotation.y = rotY; m.scale.set(sx, sy, sz);
  g.add(m);
  return m;
}

/** a wall-side's turn: a piece faces +x, so east 0, north +90°, west 180°, south -90° */
const SIDE = { east: 0, north: Math.PI / 2, west: Math.PI, south: -Math.PI / 2 } as const;

/** a flat triangle filling a gable end, from (x0, y) to (x1, y) peaking at (mid, y + h), at depth z */
function gableEnd(g: THREE.Group, x0: number, x1: number, y: number, h: number, z: number, colour: number): void {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x0, y, z), new THREE.Vector3(x1, y, z), new THREE.Vector3((x0 + x1) / 2, y + h, z)]);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, lambert({ color: colour, side: THREE.DoubleSide }));
  g.add(m);
}

export interface KitBuilt { group: THREE.Group; windows: THREE.MeshLambertMaterial; top: number }

/** Every piece this building needs, loaded? */
function have(keys: string[]): boolean { return keys.every((k) => MODELS.props.has(k)); }

export function kitBuilding(b: Building): KitBuilt | null {
  const f = BUILDINGS[b.kind], w = f.w, d = f.h, lvl = Math.min(3, b.level), ruined = !!b.ruined;
  const g = new THREE.Group();
  const windows = lambert({ color: 0x1a1410, emissive: 0x000000 });
  if (b.kind === 'lair') {
    if (!have(['grave/crypt-large'])) return null;
    piece(g, 'grave/crypt-large', ruined ? 0x606060 : 0x9a9090, w / 2, 0, d / 2, Math.PI, 2.3, 2.0, 1.6);
    for (const [x, z, k] of [[0.4, d - 0.2, 'grave/gravestone-round'], [w - 0.4, d - 0.3, 'grave/gravestone-cross'], [w + 0.2, 1, 'grave/gravestone-broken']] as const) piece(g, k, 0xb0a8a0, x, 0, z, 0.3, 1.6, 1.6, 1.6);
    return { group: g, windows, top: 2.4 };
  }
  if (b.kind === 'woodyard' || b.kind === 'cookpot' || b.kind === 'gnomehouse' || b.kind === 'warren') return null; // these keep their code-built shapes
  const stone = b.kind === 'barracks';
  const W = stone ? 'town/wall' : 'town/wall-wood', DOOR = stone ? 'town/wall-door' : 'town/wall-wood-door';
  const WIN = stone ? 'town/wall-window-stone' : 'town/wall-wood-window-shutters', BROKEN = stone ? 'town/wall-broken' : 'town/wall-wood-broken';
  if (!have([W, DOOR, WIN, BROKEN, 'town/roof', 'town/roof-gable', 'town/roof-flat', 'town/chimney'])) return null;
  const tint = ruined ? 0x4a4038 : 0xd8d0c8; // a touch dimmer than the kit's bright paint; a ruin, charred
  const storeys = ruined ? 1 : b.kind === 'house' ? (lvl >= 2 ? 2 : 1) : b.kind === 'granary' ? 2 : b.kind === 'tavern' ? 2 : 1;
  // the walls: every outer edge of the footprint, storey by storey
  for (let s = 0; s < storeys; s++) {
    const y = s * WALL_H;
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) {
      const cx = i + 0.5, cz = j + 0.5;
      const sides: (keyof typeof SIDE)[] = [];
      if (i === w - 1) sides.push('east');
      if (i === 0) sides.push('west');
      if (j === 0) sides.push('north');
      if (j === d - 1) sides.push('south');
      for (const side of sides) {
        let key = W;
        const front = side === 'south';
        if (ruined && (i + j + s) % 2 === 0) key = BROKEN;
        else if (front && s === 0 && i === f.door) key = DOOR;
        else if ((front || side === 'north') && (i + s) % 2 === 1) key = WIN;
        else if ((side === 'east' || side === 'west') && j % 2 === 1 && s > 0) key = WIN;
        piece(g, key, tint, cx, y, cz, SIDE[side], 1, WALL_H, 1);
        // a lit pane behind each front window, so the house glows from inside at night
        if (key === WIN && front) { const p = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.45), windows); p.position.set(cx, y + WALL_H * 0.55, cz + 0.36); g.add(p); }
      }
    }
  }
  const top = storeys * WALL_H;
  if (ruined) return { group: g, windows, top };
  if (stone) {
    // the barracks: a flat roof behind a crenellated parapet
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) piece(g, 'town/roof-flat', ROOF, i + 0.5, top, j + 0.5);
    const parapet = lambert({ color: 0x5e5e62 });
    for (let i = 0; i < w; i++) for (const z of [0.1, d - 0.1]) if (i % 2 === 0) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.2), parapet); c.position.set(i + 0.5, top + 0.3, z); g.add(c); }
    for (let j = 0; j < d; j++) for (const x of [0.1, w - 0.1]) if (j % 2 === 0) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.35, 0.5), parapet); c.position.set(x, top + 0.3, j + 0.5); g.add(c); }
    piece(g, 'town/banner-red', 0xffffff, f.door + 0.5, top - 1.3, d - 0.02, -Math.PI / 2, 1, 1.2, 1);
    return { group: g, windows, top: top + 0.4 };
  }
  // a gable roof, its ridge running north–south: slopes rise toward the middle column from both sides
  const half = Math.floor(w / 2), odd = w % 2 === 1;
  for (let j = 0; j < d; j++) {
    const z = j + 0.5;
    for (let i = 0; i < half; i++) {
      piece(g, 'town/roof', ROOF, i + 0.5, top + i * RISE, z, 0);                 // west side, rising east
      piece(g, 'town/roof', ROOF, w - i - 0.5, top + i * RISE, z, Math.PI);      // east side, rising west
    }
    if (odd) piece(g, 'town/roof-gable', ROOF, half + 0.5, top + half * RISE, z, Math.PI / 2);
  }
  const peak = half * RISE + (odd ? 0.57 : 0);
  for (const z of [0, d]) gableEnd(g, 0, w, top, peak, z, 0x5a4634);
  if (lvl >= 3 || b.kind === 'tavern') piece(g, 'town/chimney', 0xffffff, w - 1, top + RISE * 0.5, 0.8, 0, 1, 1.4, 1);
  if (b.kind === 'tavern') piece(g, 'town/banner-red', 0xffffff, f.door + 1.5, 0.6, d - 0.02, -Math.PI / 2);
  return { group: g, windows, top: top + peak };
}

/** A wall, gate or stairs from the kit, or null while its pieces are missing. */
export function kitDefense(d: Defense, open: boolean): THREE.Group | null {
  if (!have(['town/wall-block', 'town/wall-arch', 'town/stairs-stone'])) return null;
  const g = new THREE.Group();
  const stone = kitMat(0xb8b4ac);
  const add = (key: string, x: number, y: number, z: number, rot: number, sx: number, sy: number, sz: number) => {
    const m = new THREE.Mesh(MODELS.props.get(key)!, stone); m.position.set(x, y, z); m.rotation.y = rot; m.scale.set(sx, sy, sz); g.add(m);
  };
  if (d.kind === 'wall') {
    add('town/wall-block', 0.5, 0, 0.5, 0, 1, WALL_UNITS, 1);
    for (const [x, z] of [[0.25, 0.25], [0.75, 0.75]]) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, 0.3), lambert({ color: 0x6a6660 })); c.position.set(x, WALL_UNITS + 0.12, z); g.add(c); }
  } else if (d.kind === 'gate') {
    add('town/wall-arch', 0.5, 0, 0.5, 0, 1, WALL_UNITS, 1);
    add('town/wall-arch', 0.5, 0, 0.5, Math.PI, 1, WALL_UNITS, 1);
    if (!open) { const door = new THREE.Mesh(new THREE.BoxGeometry(0.7, WALL_UNITS * 0.75, 0.15), lambert({ color: 0x5a3e24 })); door.position.set(0.5, WALL_UNITS * 0.375, 0.5); g.add(door); }
  } else {
    add('town/stairs-stone', 0.5, 0, 0.5, -Math.PI / 2, 1, WALL_UNITS, 2);
  }
  return g;
}
