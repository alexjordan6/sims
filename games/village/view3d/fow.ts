import * as THREE from 'three';
import { COLS, ROWS } from '../config';

// The fog of war, as a patch every lit surface carries: each one is multiplied by how well its tile is
// seen. Unexplored landscape stays visible at a subdued brightness; hostile visibility is separate.
//
// This file used to be the PS1 "pixel horror" pass as well — vertices snapped to a coarse screen grid so
// every edge crawled, then a full-screen dither to a short palette with grain and a vignette over it.
// That is all gone; the world is drawn straight. Flat shading stays, on purpose: hard facets are the
// look we want, not the filter we didn't.

const fowData = new Uint8Array(COLS * ROWS);
export const FOW = new THREE.DataTexture(fowData, COLS, ROWS, THREE.RedFormat, THREE.UnsignedByteType);
FOW.magFilter = THREE.LinearFilter; FOW.minFilter = THREE.LinearFilter;
FOW.needsUpdate = true;
const fowUniforms = { fowTex: { value: FOW }, fowSize: { value: new THREE.Vector2(COLS, ROWS) }, fowOn: { value: 1 } };
/** Switch the fog of war off for a frame (a room indoors has no fog; its floor is not the map). */
export function setFowOn(on: boolean): void { fowUniforms.fowOn.value = on ? 1 : 0; }

/** Refresh the landscape tint: subdued beyond sight, full light where seen now. */
export function updateFow(explored: Uint8Array | null, vis: Float32Array | null): void {
  if (!explored || !vis) { fowData.fill(255); FOW.needsUpdate = true; return; }
  for (let i = 0; i < fowData.length; i++) fowData[i] = explored[i] ? 190 + Math.round(65 * vis[i]) : 175;
  FOW.needsUpdate = true;
}

function fowCompile(sh: THREE.WebGLProgramParametersWithUniforms): void {
  Object.assign(sh.uniforms, fowUniforms);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vFowXZ;')
    .replace('#include <project_vertex>', '#include <project_vertex>\n{ vec4 fw = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n fw = instanceMatrix * fw;\n#endif\n fw = modelMatrix * fw; vFowXZ = fw.xz; }');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform sampler2D fowTex; uniform vec2 fowSize; uniform float fowOn; varying vec2 vFowXZ;')
    .replace('#include <fog_fragment>', 'gl_FragColor.rgb *= mix(1.0, texture2D(fowTex, vFowXZ / fowSize).r, fowOn);\n#include <fog_fragment>');
}

/** A flat-shaded, fog-of-war-aware lit material: what every solid thing in the world is made of. */
export function lambert(params: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ flatShading: true, ...params });
  fogify(m);
  return m;
}
/** Give an existing material (a loaded model's, or an actor's own clone of one) the fog of war. */
export function fogify(m: THREE.Material): void {
  m.onBeforeCompile = fowCompile;
  m.needsUpdate = true;
}

/**
 * A pack's palette atlas samples hard: every texel is one flat colour cell, and smoothing one into its
 * neighbour would bleed unrelated colours across a model's faces.
 */
export function palette(tex: THREE.Texture | null): THREE.Texture | null {
  if (tex) { tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true; }
  return tex;
}
