import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { psxify } from './ps1';

// The model packs (Kenney, CC0: see assets/CREDITS.md). Everything loads in the background at start;
// until it lands, the world is drawn with the code-built placeholders, and anything that never loads
// stays a placeholder. Two kinds of model come out of here:
//  - props (trees, plants, crops, wall and roof pieces): every mesh in the file merged into one geometry,
//    the colours baked into the vertices (sampled from the pack's palette texture), so a whole forest is
//    one instanced draw and no texture is bound at all
//  - characters: the skinned / jointed scene kept whole, with its animation clips, cloned per person

const glbs = import.meta.glob('../assets/models/**/*.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const pngs = import.meta.glob('../assets/models/**/Textures/*.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

/** 'pack/name' → url, e.g. 'nature/tree_oak_dark' */
const URLS = new Map<string, string>();
for (const [path, url] of Object.entries(glbs)) {
  const m = /models\/([^/]+)\/([^/]+)\.glb$/.exec(path);
  if (m) URLS.set(`${m[1]}/${m[2]}`, url);
}
/** each pack's palette texture, so a GLB's relative "Textures/colormap.png" finds it after bundling */
function textureFor(pack: string): string | undefined {
  return Object.entries(pngs).find(([p]) => p.includes(`/models/${pack}/Textures/`))?.[1];
}

const loaders = new Map<string, GLTFLoader>();
function loaderFor(pack: string): GLTFLoader {
  let l = loaders.get(pack);
  if (!l) {
    const manager = new THREE.LoadingManager();
    const tex = textureFor(pack);
    manager.setURLModifier((url) => (tex && /colormap\.png$/i.test(url) ? tex : url));
    loaders.set(pack, (l = new GLTFLoader(manager)));
  }
  return l;
}

/** pixels of an image, for sampling a palette texture into vertex colours */
const pixelCache = new WeakMap<object, { data: Uint8ClampedArray; w: number; h: number }>();
function pixels(img: CanvasImageSource & { width: number; height: number }): { data: Uint8ClampedArray; w: number; h: number } {
  let p = pixelCache.get(img);
  if (!p) {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0);
    p = { data: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
    pixelCache.set(img, p);
  }
  return p;
}

const srgb = new THREE.Color();
/** Merge a loaded scene into one non-indexed geometry with baked vertex colours. */
/**
 * Merge a scene (or a posed character rig) into one geometry with baked vertex colours. A skinned mesh is
 * baked in whatever pose its skeleton holds right now, so stepping a mixer and baking again gives a frame.
 */
export function bake(scene: THREE.Object3D): THREE.BufferGeometry {
  scene.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.visible) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    let src = o.geometry as THREE.BufferGeometry;
    if (o instanceof THREE.SkinnedMesh) {
      // pose the vertices: run each through its bones, so the bake holds the frame the mixer is on
      o.skeleton.update();
      src = src.clone();
      const pos = src.getAttribute('position') as THREE.BufferAttribute, v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); o.applyBoneTransform(i, v); pos.setXYZ(i, v.x, v.y, v.z); }
    }
    // split an indexed geometry by its material groups; anything else is one piece in the first material
    const indexed = !!src.index;
    const groups = indexed && src.groups.length ? src.groups : [{ start: 0, count: Infinity, materialIndex: 0 }];
    for (const grp of groups) {
      const m = (mats[grp.materialIndex ?? 0] ?? mats[0]) as THREE.MeshStandardMaterial; // a box has six face groups but often one material
      let g = src.clone();
      g.clearGroups();
      if (indexed) {
        const all = src.index!.array;
        g.setIndex(new THREE.BufferAttribute(all.slice(grp.start, grp.count === Infinity ? all.length : grp.start + grp.count), 1));
        g = g.toNonIndexed();
      }
      g.applyMatrix4(o.matrixWorld);
      const n = g.getAttribute('position').count;
      const col = new Float32Array(n * 3);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
      const base = m.color ?? new THREE.Color(1, 1, 1);
      const img = m.map?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
      const px = img && uv ? pixels(img) : null;
      for (let i = 0; i < n; i++) {
        let r = base.r, gg = base.g, b = base.b;
        if (px && uv) {
          const u = ((uv.getX(i) % 1) + 1) % 1, v = ((uv.getY(i) % 1) + 1) % 1;
          // glTF uvs run top-down
          const x = Math.min(px.w - 1, Math.floor(u * px.w)), y = Math.min(px.h - 1, Math.floor(v * px.h));
          const k = (y * px.w + x) * 4;
          srgb.setRGB(px.data[k] / 255, px.data[k + 1] / 255, px.data[k + 2] / 255, THREE.SRGBColorSpace);
          r *= srgb.r; gg *= srgb.g; b *= srgb.b;
        }
        col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b;
      }
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', g.getAttribute('position'));
      out.setAttribute('color', new THREE.BufferAttribute(col, 3));
      parts.push(out);
    }
  });
  const merged = mergeGeometries(parts, false)!;
  merged.computeVertexNormals(); // flat: the geometry is non-indexed, so each face gets its own normal
  merged.computeBoundingBox();
  return merged;
}

export interface Character { scene: THREE.Object3D; clips: THREE.AnimationClip[]; height: number }

/** What has loaded so far. Props are keyed 'pack/name'. */
export const MODELS = {
  props: new Map<string, THREE.BufferGeometry>(),
  characters: new Map<string, Character>(),
  /** bumped as models land, so the view knows to rebuild what it drew with placeholders */
  revision: 0,
};

/** Prop geometries are stood on y = 0 and centred on x/z when asked (single props); kit pieces keep their pivot. */
function standUp(g: THREE.BufferGeometry, centre: boolean): THREE.BufferGeometry {
  const bb = g.boundingBox!;
  const cx = centre ? (bb.min.x + bb.max.x) / 2 : 0, cz = centre ? (bb.min.z + bb.max.z) / 2 : 0;
  g.translate(-cx, centre ? -bb.min.y : 0, -cz);
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

function load(key: string): Promise<GLTF | null> {
  const url = URLS.get(key);
  if (!url) { console.warn(`model ${key} is not in assets/models`); return Promise.resolve(null); }
  return loaderFor(key.split('/')[0]).loadAsync(url).catch((e) => { console.warn(`model ${key} failed to load`, e); return null; });
}

/** Load a list of props (centred or kept on their pivot) and characters. Safe to call more than once. */
export async function loadModels(props: { key: string; centre: boolean }[], characters: string[]): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const { key, centre } of props) {
    if (MODELS.props.has(key)) continue;
    jobs.push(load(key).then((gltf) => {
      if (!gltf) return;
      MODELS.props.set(key, standUp(bake(gltf.scene), centre));
      MODELS.revision++;
    }));
  }
  for (const key of characters) {
    if (MODELS.characters.has(key)) continue;
    jobs.push(load(key).then((gltf) => {
      if (!gltf) return;
      // lit like the world: flat lambert with the palette sampled hard, wobbling, under the fog of war
      gltf.scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const old = o.material as THREE.MeshStandardMaterial;
        const m = new THREE.MeshLambertMaterial({ map: old.map ?? null, color: old.color ?? 0xffffff, flatShading: true });
        psxify(m);
        o.material = m;
        o.castShadow = true;
      });
      const bb = new THREE.Box3().setFromObject(gltf.scene);
      MODELS.characters.set(key, { scene: gltf.scene, clips: gltf.animations, height: bb.max.y - Math.min(0, bb.min.y) });
      MODELS.revision++;
    }));
  }
  await Promise.all(jobs);
}

/** every model the game has, by its 'pack/name' key */
export function haveModel(key: string): boolean { return URLS.has(key); }
