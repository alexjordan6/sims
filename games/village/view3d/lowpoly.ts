import * as THREE from 'three';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const modifier = new SimplifyModifier();
export const triangles = (g: THREE.BufferGeometry): number => (g.index?.count ?? g.getAttribute('position').count) / 3;

/** Reduce each loaded prop once, before instancing. Colour seams remain split when vertices weld. */
export async function downsampleModel(source: THREE.BufferGeometry): Promise<THREE.BufferGeometry> {
  const before = triangles(source);
  if (before <= 48) return source;
  const input = source.clone();
  // Smooth normals would preserve the curvature we deliberately want to remove.
  input.deleteAttribute('normal');
  const welded = mergeVertices(input);
  const reduced = await modifier.modify(welded, Math.floor(welded.getAttribute('position').count * 0.5));
  const result = reduced.index ? reduced.toNonIndexed() : reduced;
  result.computeVertexNormals(); result.computeBoundingBox(); result.computeBoundingSphere();
  result.userData.sourceTriangles = before;
  result.userData.triangles = triangles(result);
  input.dispose(); welded.dispose();
  if (result !== reduced) reduced.dispose();
  source.dispose();
  return result;
}
