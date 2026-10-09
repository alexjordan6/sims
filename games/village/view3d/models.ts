import * as THREE from 'three';
import { TILE } from '../config';
import { lambert } from './fow';

// Shared low-poly geometry and materials. Everything is flat-shaded and coloured per vertex or per
// instance, so the whole world is a handful of materials. Pack models (glTF) replace these one kind
// at a time through the registry; anything without a model falls back to the shapes here.

/** sim pixels → world units: one tile is one unit */
export const U = 1 / TILE;
/** how tall a wall stands, in tiles */
export const WALL_UNITS = 2.2;

const flat = (colour = 0xffffff, extra: THREE.MeshLambertMaterialParameters = {}) => lambert({ color: colour, ...extra });

/** the material every instanced prop shares: vertex colours (a model's own, or white on a placeholder) times the instance colour */
export const PROP_MAT = flat(0xffffff, { vertexColors: true });
/** vertex-coloured, for the ground */
export const GROUND_MAT = lambert({ vertexColors: true });

const cache = new Map<number, THREE.MeshLambertMaterial>();
/** a shared flat material of one colour */
export function mat(colour: number): THREE.MeshLambertMaterial {
  let m = cache.get(colour);
  if (!m) cache.set(colour, (m = flat(colour)));
  return m;
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // a tiny merge: every part is non-indexed with position + normal, so concatenating the arrays is enough
  const ps: number[] = [], ns: number[] = [];
  for (const g of parts) {
    const ng = g.index ? g.toNonIndexed() : g;
    ps.push(...(ng.getAttribute('position').array as Float32Array));
    ns.push(...(ng.getAttribute('normal').array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(ps, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(ns, 3));
  return out;
}
const at = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);

/** One geometry per prop shape, built once. Each is about a tile across with its base at y = 0. */
export const GEO = {
  trunk: at(new THREE.CylinderGeometry(0.09, 0.13, 0.7, 5), 0, 0.35, 0),
  crown: at(new THREE.ConeGeometry(0.55, 1.5, 6), 0, 1.35, 0),
  oldCrown: merged([at(new THREE.IcosahedronGeometry(0.62, 0), 0, 1.25, 0), at(new THREE.IcosahedronGeometry(0.45, 0), 0.2, 1.75, -0.1)]),
  stump: at(new THREE.CylinderGeometry(0.16, 0.2, 0.22, 6), 0, 0.11, 0),
  sapling: at(new THREE.ConeGeometry(0.22, 0.6, 5), 0, 0.3, 0),
  blob: at(new THREE.IcosahedronGeometry(0.32, 0), 0, 0.26, 0),
  berry: at(new THREE.IcosahedronGeometry(0.07, 0), 0, 0, 0),
  cap: merged([at(new THREE.CylinderGeometry(0.05, 0.06, 0.18, 5), 0, 0.09, 0), at(new THREE.ConeGeometry(0.18, 0.14, 6), 0, 0.22, 0)]),
  thicket: merged([
    at(new THREE.IcosahedronGeometry(0.42, 0), 0, 0.32, 0),
    at(new THREE.ConeGeometry(0.06, 0.45, 3).rotateZ(0.9), 0.35, 0.45, 0),
    at(new THREE.ConeGeometry(0.06, 0.45, 3).rotateZ(-0.9), -0.35, 0.45, 0.1),
    at(new THREE.ConeGeometry(0.06, 0.45, 3).rotateX(0.9), 0, 0.45, 0.35),
    at(new THREE.ConeGeometry(0.06, 0.45, 3).rotateX(-0.9), 0.1, 0.4, -0.35),
    at(new THREE.ConeGeometry(0.05, 0.4, 3), 0.05, 0.75, 0),
  ]),
  tuft: merged([
    at(new THREE.ConeGeometry(0.05, 0.38, 3).rotateZ(0.25), -0.18, 0.19, 0.05),
    at(new THREE.ConeGeometry(0.05, 0.44, 3), 0.05, 0.22, -0.15),
    at(new THREE.ConeGeometry(0.05, 0.36, 3).rotateZ(-0.3), 0.2, 0.18, 0.15),
    at(new THREE.ConeGeometry(0.05, 0.4, 3).rotateX(0.3), -0.05, 0.2, 0.25),
  ]),
  box: new THREE.BoxGeometry(1, 1, 1),
  ring: new THREE.RingGeometry(0.42, 0.5, 20).rotateX(-Math.PI / 2),
  disc: new THREE.CircleGeometry(0.5, 20).rotateX(-Math.PI / 2),
} as const;
// placeholders are white per vertex, so the instance colour alone paints them under PROP_MAT
for (const g of Object.values(GEO)) if (!g.getAttribute('color')) g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).fill(1), 3));

/** colours the placeholder world is painted in: dark, damp, desaturated */
export const COL = {
  grass: 0x3e5232, grass2: 0x445a36, tall: 0x4f6638, trail: 0x6a5d44, dirt: 0x58483a,
  thicketGround: 0x2e3022, building: 0x5a4d3e, unseen: 0x000000,
  trunk: 0x4a3626, crown: 0x2f4a2a, crownOld: 0x2a3f24, sapling: 0x3f5a30, stump: 0x6a5238,
  thicket: 0x2a2a1a, tuft: 0x5a7040,
  bush: 0x35502c, berry: 0x9a2a30, hazel: 0x405a2e, nut: 0x8a6a3a, garlic: 0xbab49a, burdock: 0x6a3a5a, mushroom: 0xb0a088, cap: 0x8a2a24,
} as const;
