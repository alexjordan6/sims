import * as THREE from 'three';
import { COLS, ROWS, POT_INGREDIENTS } from '../config';
import { WILD_FOOD, type Tile, type TileKind } from '../world';
import type { VillageScene } from '../main';
import { GEO, COL, GROUND_MAT, PROP_MAT } from './models';
import { MODELS } from './assets';
import { FLORA_MODEL, pickModel } from './registry';

// The ground and everything rooted in it, cut into chunks of CH x CH tiles. A chunk is rebuilt only
// when one of its tiles changes (world.dirty) or is first explored, so a still world costs nothing.
// Flora is instanced per shape per chunk: twelve thousand trees are a few hundred draw calls at most,
// and the camera's frustum skips whole chunks.

export const CH = 32;
const CX = Math.ceil(COLS / CH), CY = Math.ceil(ROWS / CH);

/** a code-built shape (see GEO), or 'm:pack/name' for a loaded model */
type Shape = string;
/** what a shape draws with: the model if it has landed, else the placeholder */
function geometryOf(shape: Shape): THREE.BufferGeometry | undefined {
  return shape.startsWith('m:') ? MODELS.props.get(shape.slice(2)) : GEO[shape as keyof typeof GEO];
}
const NO_SHADOW = new Set<Shape>(['tuft', 'berry', 'm:nature/grass_large']);

/** a little rise and fall in the ground, the same at every shared corner, so the low-poly facets read */
export function groundHeight(x: number, z: number): number {
  const h = Math.sin(x * 0.37 + z * 0.11) * 0.06 + Math.sin(z * 0.29 - x * 0.17) * 0.05 + Math.sin(x * 1.7 + z * 2.3) * 0.015;
  return h;
}

/** a deterministic 0..1 from a tile, for size and turn variation */
function hash(tx: number, ty: number, k = 0): number {
  let h = (tx * 374761393 + ty * 668265263 + k * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const c3 = new THREE.Color();

interface Chunk { ground: THREE.Mesh; props: Map<Shape, THREE.InstancedMesh>; group: THREE.Group }

export class Terrain {
  readonly group = new THREE.Group();
  private chunks: Chunk[] = [];
  private dirty = new Set<number>();
  /** all of the ground meshes, for the pointer's raycast */
  readonly grounds: THREE.Mesh[] = [];

  constructor(private scene: VillageScene) {
    for (let cy = 0; cy < CY; cy++) for (let cx = 0; cx < CX; cx++) {
      const g = new THREE.Group();
      const ground = new THREE.Mesh(new THREE.BufferGeometry(), GROUND_MAT);
      ground.userData.ground = true;
      ground.receiveShadow = true;
      g.add(ground);
      this.group.add(g);
      this.grounds.push(ground);
      this.chunks.push({ ground, props: new Map(), group: g });
    }
  }

  /** The props of the chunks round a point (the one it is in and its neighbours), for the pointer's raycast. */
  propsAround(x: number, z: number): THREE.Object3D[] {
    const cx = Math.floor(x / CH), cz = Math.floor(z / CH), out: THREE.Object3D[] = [];
    for (let j = cz - 1; j <= cz + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) {
      if (i < 0 || j < 0 || i >= CX || j >= CY) continue;
      for (const im of this.chunks[j * CX + i].props.values()) if (im.count) out.push(im);
    }
    return out;
  }

  /** Every chunk, from scratch (a new run). */
  rebuildAll(): void { for (let i = 0; i < this.chunks.length; i++) this.dirty.add(i); }

  markTile(i: number): void {
    const tx = i % COLS, ty = (i / COLS) | 0;
    this.dirty.add(((ty / CH) | 0) * CX + ((tx / CH) | 0));
  }

  /** Rebuild whatever changed since last frame. Returns true if anything did (the minimap repaints then). */
  sync(): boolean {
    const s = this.scene, w = s.world, fog = s.fog;
    for (const i of w.dirty) this.markTile(i);
    const changed = w.dirty.size > 0;
    w.dirty.clear();
    if (fog) { for (const i of fog.fresh) this.markTile(i); fog.fresh.length = 0; }
    if (!this.dirty.size) return changed;
    // a few chunks a frame at most, nearest the camera first is not worth the bookkeeping: there are only 40
    for (const c of this.dirty) this.build(c);
    this.dirty.clear();
    return true;
  }

  private seen(i: number): boolean {
    const fog = this.scene.fog;
    return !fog || !fog.enabled || fog.explored[i] === 1;
  }

  private groundColour(t: Tile, tx: number, ty: number): number {
    switch (t.kind as TileKind) {
      case 'thicket': return COL.thicketGround;
      case 'wall': case 'gate': case 'stairs': return COL.dirt;
      default:
        if (t.building) return COL.building;
        if (t.trail) return COL.trail;
        if (t.tall) return COL.tall;
        return hash(tx, ty) < 0.5 ? COL.grass : COL.grass2;
    }
  }

  private build(ci: number): void {
    const s = this.scene, w = s.world, ch = this.chunks[ci];
    const cx = ci % CX, cy = (ci / CX) | 0;
    const x0 = cx * CH, y0 = cy * CH, x1 = Math.min(COLS, x0 + CH), y1 = Math.min(ROWS, y0 + CH);
    // ---- ground: two flat-shaded triangles a tile, coloured by what the tile is ----
    const n = (x1 - x0) * (y1 - y0);
    const pos = new Float32Array(n * 18), col = new Float32Array(n * 18);
    let o = 0;
    const put = (x: number, z: number, r: number, g: number, b: number) => {
      pos[o] = x; pos[o + 1] = groundHeight(x, z); pos[o + 2] = z;
      col[o] = r; col[o + 1] = g; col[o + 2] = b; o += 3;
    };
    for (let ty = y0; ty < y1; ty++) for (let tx = x0; tx < x1; tx++) {
      const i = ty * COLS + tx, t = w.tiles[i];
      c3.setHex(this.seen(i) ? this.groundColour(t, tx, ty) : COL.unseen);
      const { r, g, b } = c3;
      // alternate the diagonal so the facets do not all lean one way
      if ((tx + ty) & 1) {
        put(tx, ty, r, g, b); put(tx, ty + 1, r, g, b); put(tx + 1, ty, r, g, b);
        put(tx + 1, ty, r, g, b); put(tx, ty + 1, r, g, b); put(tx + 1, ty + 1, r, g, b);
      } else {
        put(tx, ty, r, g, b); put(tx, ty + 1, r, g, b); put(tx + 1, ty + 1, r, g, b);
        put(tx, ty, r, g, b); put(tx + 1, ty + 1, r, g, b); put(tx + 1, ty, r, g, b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    ch.ground.geometry.dispose();
    ch.ground.geometry = geo;
    // ---- flora: count, then fill one instanced mesh per shape ----
    const list = new Map<Shape, { m: THREE.Matrix4; c: number }[]>();
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const add = (shape: Shape, x: number, z: number, scale: number, colour: number, turn = 0, lift = 0, tilt = 0) => {
      e.set(tilt, turn, 0); q.setFromEuler(e);
      v.set(x, groundHeight(x, z) + lift, z); sc.set(scale, scale, scale);
      let l = list.get(shape); if (!l) list.set(shape, (l = []));
      l.push({ m: m4.clone().compose(v, q, sc), c: colour });
    };
    for (let ty = y0; ty < y1; ty++) for (let tx = x0; tx < x1; tx++) {
      const i = ty * COLS + tx;
      if (!this.seen(i)) continue;
      const t = w.tiles[i], cx2 = tx + 0.5, cz = ty + 0.5;
      const r = hash(tx, ty, 1), turn = hash(tx, ty, 2) * Math.PI * 2;
      const jx = cx2 + (hash(tx, ty, 3) - 0.5) * 0.3, jz = cz + (hash(tx, ty, 4) - 0.5) * 0.3;
      // a model if it has landed (white: its own colours), else the placeholder in its flat colour
      const prop = (kind: keyof typeof FLORA_MODEL, x: number, z: number, size: number, fallback: Shape, colour: number, tint = 0xffffff, tilt = 0, variant = r) => {
        const m = pickModel(kind, variant);
        if (m && MODELS.props.has(m.key)) add('m:' + m.key, x, z, size * m.scale, tint, turn, 0, tilt);
        else add(fallback, x, z, size, colour, turn, 0, tilt);
        return !!(m && MODELS.props.has(m.key));
      };
      switch (t.kind) {
        case 'tree': {
          const old = s.isOldGrowth(t), size = (old ? 1.15 : 0.8 + Math.min(1, t.stage / Math.max(1, s.oldGrowthDays)) * 0.25) * (0.9 + r * 0.2);
          const chopped = t.work > 0 ? 0.12 * t.work : 0; // a tree being felled leans
          if (!prop(old ? 'oldTree' : 'tree', jx, jz, size, 'trunk', COL.trunk, 0xffffff, chopped)) add(old ? 'oldCrown' : 'crown', jx, jz, size, old ? COL.crownOld : COL.crown, turn, 0, chopped);
          break;
        }
        case 'sapling':
          if (t.stage < 2) prop('stump', cx2, cz, 1, 'stump', COL.stump);
          else prop('sapling', jx, jz, 0.7 + r * 0.4, 'sapling', COL.sapling);
          break;
        case 'thicket': add('thicket', jx, jz, 0.95 + r * 0.25, COL.thicket, turn); break;
        case 'bush': case 'hazel': case 'garlic': case 'burdock': case 'mushroom': {
          const ripe = s.wildRipe(t);
          const wild = WILD_FOOD[t.kind], ingredient = !!wild && POT_INGREDIENTS.has(wild);
          if (t.kind === 'mushroom') {
            if (prop(ripe ? 'mushroomRipe' : 'mushroom', jx, jz, 1, 'cap', ripe ? COL.cap : COL.mushroom)) break;
            for (let k = 0; k < 2; k++) add('cap', jx + (hash(tx, ty, 5 + k) - 0.5) * 0.5, jz + (hash(tx, ty, 8 + k) - 0.5) * 0.5, (ripe ? 1 : 0.6) * (0.8 + hash(tx, ty, 11 + k) * 0.5), ripe ? COL.cap : COL.mushroom, turn);
            break;
          }
          const body = t.kind === 'garlic' ? COL.garlic : t.kind === 'burdock' ? COL.burdock : t.kind === 'hazel' ? COL.hazel : COL.bush;
          // picked bare, a plant is a shade duller
          prop(t.kind as 'bush' | 'hazel' | 'garlic' | 'burdock', jx, jz, t.kind === 'garlic' ? 0.8 : 0.9 + r * 0.25, 'blob', body, ripe ? 0xffffff : 0x9a9a8a);
          if (ripe) {
            const fruit = t.kind === 'bush' ? COL.berry : t.kind === 'hazel' ? COL.nut : t.kind === 'burdock' ? 0xa05a8a : 0xe8e0c8;
            for (let k = 0; k < (ingredient ? 6 : 4); k++) {
              const a = (k / 6) * Math.PI * 2 + turn;
              add('berry', jx + Math.cos(a) * 0.26, jz + Math.sin(a) * 0.26, 1, fruit, 0, 0.3 + hash(tx, ty, 20 + k) * 0.25);
            }
          }
          break;
        }
        default:
          if (t.tall && !t.building && !t.defense) prop('tuft', jx, jz, 0.9 + r * 0.4, 'tuft', COL.tuft, 0xc8d0b0);
      }
    }
    // shapes this chunk no longer has are emptied
    for (const [shape, im] of ch.props) if (!list.has(shape)) im.count = 0;
    for (const [shape, items] of list) {
      const geo = geometryOf(shape);
      if (!geo) continue;
      let im = ch.props.get(shape);
      // a mesh too small for the chunk, or still drawing a placeholder its model has since replaced, is remade
      if (im && (im.instanceMatrix.count < items.length || im.geometry !== geo)) { ch.group.remove(im); im.dispose(); im = undefined; ch.props.delete(shape); }
      if (!im) {
        // a little headroom so a chunk that grows by a tree or two does not reallocate
        im = new THREE.InstancedMesh(geo, PROP_MAT, Math.ceil(items.length * 1.25) + 8);
        im.castShadow = !NO_SHADOW.has(shape);
        im.receiveShadow = true;
        ch.props.set(shape, im);
        ch.group.add(im);
      }
      im.count = items.length;
      for (let k = 0; k < items.length; k++) { im.setMatrixAt(k, items[k].m); im.setColorAt(k, c3.setHex(items[k].c)); }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
    }
  }
}
