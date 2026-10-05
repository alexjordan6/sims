import * as THREE from 'three';
import { COLS, ROWS } from '../config';

// The pixel-horror look, PS1 style:
//  - vertices snap to a coarse screen grid, so edges crawl and wobble as the camera moves
//  - textures map without perspective correction (affine), and sample without smoothing
//  - the frame is drawn small and blown up with hard pixels, then dithered down to a short palette,
//    darkened at the corners and given a little grain
// Plus the fog of war, which lives in the same material patch: every lit surface is multiplied by how
// well its tile is seen, so the unexplored is black and the remembered is dim.

// ---- global shader patches (before anything compiles) ----------------------------------------------

/** the virtual screen the vertices snap to, in half-NDC units (≈ a 400 x 224 screen) */
const GRID = 'vec2(200.0, 112.0)';
THREE.ShaderChunk.project_vertex += `
#ifdef PSX_SNAP
  { vec4 psx = gl_Position; psx.xyz /= psx.w; psx.xy = floor(psx.xy * ${GRID} + 0.5) / ${GRID}; psx.xyz *= psx.w; gl_Position = psx; }
#endif
`;
// affine texture mapping: the uv varyings skip perspective correction
for (const k of ['uv_pars_vertex', 'uv_pars_fragment'] as const) {
  THREE.ShaderChunk[k] = THREE.ShaderChunk[k].replace(/varying vec2 (v\w*Uv);/g, 'noperspective varying vec2 $1;');
}

// ---- the fog of war, as a texture every material reads ---------------------------------------------

const fowData = new Uint8Array(COLS * ROWS);
export const FOW = new THREE.DataTexture(fowData, COLS, ROWS, THREE.RedFormat, THREE.UnsignedByteType);
FOW.magFilter = THREE.LinearFilter; FOW.minFilter = THREE.LinearFilter;
FOW.needsUpdate = true;
const fowUniforms = { fowTex: { value: FOW }, fowSize: { value: new THREE.Vector2(COLS, ROWS) } };

/** Refresh the fog texture: black where never seen, dim where remembered, full light where seen now. */
export function updateFow(explored: Uint8Array | null, vis: Float32Array | null): void {
  if (!explored || !vis) { fowData.fill(255); FOW.needsUpdate = true; return; }
  for (let i = 0; i < fowData.length; i++) fowData[i] = explored[i] ? 95 + Math.round(160 * vis[i]) : 0;
  FOW.needsUpdate = true;
}

function psxCompile(sh: THREE.WebGLProgramParametersWithUniforms): void {
  Object.assign(sh.uniforms, fowUniforms);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vFowXZ;')
    .replace('#include <project_vertex>', '#include <project_vertex>\n{ vec4 fw = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n fw = instanceMatrix * fw;\n#endif\n fw = modelMatrix * fw; vFowXZ = fw.xz; }');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform sampler2D fowTex; uniform vec2 fowSize; varying vec2 vFowXZ;')
    .replace('#include <fog_fragment>', 'gl_FragColor.rgb *= texture2D(fowTex, vFowXZ / fowSize).r;\n#include <fog_fragment>');
}

/** A flat-shaded, wobbling, fog-of-war-aware lit material: what every solid thing in the world is made of. */
export function lambert(params: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ flatShading: true, ...params });
  psxify(m);
  return m;
}
/** Give an existing material (a loaded model's) the wobble and the fog of war. */
export function psxify(m: THREE.Material): void {
  m.defines = { ...(m.defines ?? {}), PSX_SNAP: '' };
  m.onBeforeCompile = psxCompile;
  const tex = (m as THREE.MeshLambertMaterial).map;
  if (tex) { tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true; }
  m.needsUpdate = true;
}

// ---- the post pass: low resolution, dither, palette, vignette, grain ----------------------------

const POST_VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const POST_FRAG = `
uniform sampler2D tex; uniform vec2 res; uniform float levels; uniform float time; uniform float grain;
varying vec2 vUv;
float bayer(vec2 p) {
  int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0)), i = x + y * 4;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[i]) + 0.5) / 16.0;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 px = floor(vUv * res);
  vec3 c = texture2D(tex, (px + 0.5) / res).rgb;
  c = pow(max(c, 0.0), vec3(1.0 / 2.2));
  // a little colour drained out, the shadows pushed toward a cold green-black
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 0.78) * vec3(0.96, 1.0, 0.94);
  // vignette, grain
  vec2 q = vUv - 0.5;
  c *= mix(0.45, 1.0, smoothstep(0.82, 0.25, length(q * vec2(1.25, 1.0))));
  c += (hash(px + fract(time) * 97.0) - 0.5) * grain;
  // ordered dither down to a short palette
  c += (bayer(px) - 0.5) / levels;
  c = floor(c * levels + 0.5) / levels;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export class Ps1Pass {
  readonly target: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: THREE.ShaderMaterial;
  private t = 0;

  constructor() {
    this.target = new THREE.WebGLRenderTarget(320, 180, { type: THREE.HalfFloatType, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, depthBuffer: true });
    this.mat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT, fragmentShader: POST_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tex: { value: this.target.texture }, res: { value: new THREE.Vector2(320, 180) }, levels: { value: 20 }, time: { value: 0 }, grain: { value: 0.035 } },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** Match the screen's shape at `height` pixels tall. */
  size(w: number, h: number, height: number): void {
    const H = Math.max(90, Math.round(height)), W = Math.max(120, Math.round((H * w) / h));
    if (this.target.width === W && this.target.height === H) return;
    this.target.setSize(W, H);
    (this.mat.uniforms.res.value as THREE.Vector2).set(W, H);
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, dt: number, levels: number): void {
    this.t += dt;
    this.mat.uniforms.time.value = this.t;
    this.mat.uniforms.levels.value = levels;
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.cam);
  }
}
