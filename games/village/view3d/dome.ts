import * as THREE from 'three';

/**
 * The sky, as a dome round the camera rather than a flat clear colour.
 *
 * Looking down from a fixed high angle, the sky was only ever a few pixels in the corners, so one flat
 * colour did for it. A camera down at head height spends half the frame looking at the horizon — and a
 * horizon is where the sky meets the ground. With nothing drawn up there you get a hard band of colour
 * instead, and at the edge of the map a clear view under the world.
 *
 * The bottom of the dome is the fog's own colour, so land fades into sky with no seam; it deepens going
 * up, because a sky of one flat colour reads as a wall however far away it is.
 */
const VERT = `
varying float vUp;
void main() {
  vUp = normalize(position).y;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}`;
const FRAG = `
uniform vec3 horizon;
uniform vec3 zenith;
varying float vUp;
void main() {
  // the horizon colour holds over a wide band low down and only deepens well up: it is the fog colour
  // too, so anything fading out at distance has to meet a sky the same shade as itself
  gl_FragColor = vec4(mix(horizon, zenith, pow(clamp(vUp, 0.0, 1.0), 1.6)), 1.0);
}`;

export class Dome {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private horizon = new THREE.Color();
  private deep = new THREE.Color(0x2a4a86);

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { horizon: { value: new THREE.Color() }, zenith: { value: new THREE.Color() } },
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), this.mat);
    this.mesh.renderOrder = -1; // behind everything, and it writes no depth
    this.mesh.frustumCulled = false;
  }

  /** Keep it round the camera, inside the far plane, and coloured for the hour. */
  sync(camera: THREE.Camera, sky: number, far: number): void {
    this.mesh.position.copy(camera.position);
    // always inside the far plane: a dome bigger than the view's reach gets sliced by it, and the cut
    // shows as a hard edge across the sky
    this.mesh.scale.setScalar(far * 0.9);
    this.horizon.setHex(sky);
    (this.mat.uniforms.horizon.value as THREE.Color).copy(this.horizon);
    // the same hour, deeper and bluer overhead
    (this.mat.uniforms.zenith.value as THREE.Color).copy(this.horizon).multiplyScalar(0.72).lerp(this.deep, 0.35);
  }
}
