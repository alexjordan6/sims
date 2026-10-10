import * as THREE from 'three';

// Bars and banners by the hundred. A health bar used to be two sprites, each with a material of its own,
// so each was two draw calls — and a battle of hundreds has hundreds of hurt bodies. Here every bar is an
// instance of one camera-facing quad (two calls for all of them: the backs, then the fills), and every
// banner an instance of one pole and one pennant.

const quad = new THREE.PlaneGeometry(1, 1);

/** One batch of instances that grows as it fills, sending only what it used each frame. */
class Batch {
  mesh: THREE.InstancedMesh;
  n = 0;
  constructor(private parent: THREE.Object3D, private geo: THREE.BufferGeometry, private mat: THREE.Material, private renderOrder: number, cap = 128) {
    this.mesh = this.make(cap);
  }
  private make(cap: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(this.geo, this.mat, cap);
    m.frustumCulled = false; m.renderOrder = this.renderOrder; m.count = 0;
    m.setColorAt(0, new THREE.Color());
    this.parent.add(m);
    return m;
  }
  /** Room for one more: doubles the buffers when full, keeping what is already set. */
  next(): number {
    if (this.n >= this.mesh.instanceMatrix.count) {
      const old = this.mesh, grown = this.make(old.instanceMatrix.count * 2);
      grown.instanceMatrix.array.set(old.instanceMatrix.array);
      grown.instanceColor!.array.set(old.instanceColor!.array);
      this.parent.remove(old); old.dispose();
      this.mesh = grown;
    }
    return this.n++;
  }
  end(): void {
    const m = this.mesh, was = m.count;
    m.count = this.n;
    m.visible = this.n > 0;
    if (this.n || was) {
      m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, this.n * 16); m.instanceMatrix.needsUpdate = true;
      m.instanceColor!.clearUpdateRanges(); m.instanceColor!.addUpdateRange(0, this.n * 3); m.instanceColor!.needsUpdate = true;
    }
    this.n = 0;
  }
}

/**
 * Flat bars that always face the camera: a dark back and a coloured fill growing from its left end.
 * Call begin(camera) each frame, bar(...) for each one, then end().
 */
export class Bars {
  readonly group = new THREE.Group();
  private back: Batch;
  private fill: Batch;
  private q = new THREE.Quaternion();
  private right = new THREE.Vector3(1, 0, 0);
  private m4 = new THREE.Matrix4();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private c = new THREE.Color();

  constructor(renderOrder = 10) {
    this.back = new Batch(this.group, quad, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.7, depthTest: false, depthWrite: false }), renderOrder);
    this.fill = new Batch(this.group, quad, new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false }), renderOrder + 1);
  }

  begin(camera: THREE.Camera): void {
    this.q.copy(camera.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.q);
  }

  /** A bar `w` wide centred on (x, y, z), `frac` of it filled in `colour`, on a back of `back`. */
  bar(x: number, y: number, z: number, w: number, frac: number, colour: number, back = 0x000000, h = 0.12): void {
    this.put(this.back, x, y, z, w + 0.06, h + 0.05, back);
    if (frac <= 0) return;
    const fw = Math.max(0.02, w * Math.min(1, frac)), off = -w / 2 + fw / 2;
    this.put(this.fill, x + this.right.x * off, y + this.right.y * off, z + this.right.z * off, fw, h, colour);
  }

  private put(b: Batch, x: number, y: number, z: number, w: number, h: number, colour: number): void {
    const i = b.next();
    this.m4.compose(this.p.set(x, y, z), this.q, this.s.set(w, h, 1));
    b.mesh.setMatrixAt(i, this.m4);
    b.mesh.setColorAt(i, this.c.setHex(colour));
  }

  end(): void { this.back.end(); this.fill.end(); }
}

/**
 * Banners: a dark pole and a coloured pennant, both instanced. begin(), flag(...) each, end().
 */
export class Flags {
  readonly group = new THREE.Group();
  private poles: Batch;
  private pennants: Batch;
  private m4 = new THREE.Matrix4();
  private c = new THREE.Color();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private p = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private eye = new THREE.Vector3();

  constructor(pole: THREE.BufferGeometry, pennant: THREE.BufferGeometry) {
    this.poles = new Batch(this.group, pole, new THREE.MeshBasicMaterial({ color: 0xffffff }), 0);
    this.pennants = new Batch(this.group, pennant, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }), 0);
  }

  /** Where the camera stands, so each banner can turn its pennant toward it. */
  begin(camera: THREE.Camera): void { this.eye.setFromMatrixPosition(camera.matrixWorld); }

  /**
   * A banner `size` times the pole's height standing at (x, y, z).
   *
   * The pennant is a flat triangle, so from the old fixed camera it always happened to be face-on. Let
   * the camera swing and it turns edge-on and disappears. It turns about its pole to face the camera —
   * about that axis only, since a banner that tips over with the camera is no banner at all.
   */
  flag(x: number, y: number, z: number, colour: number, size: number): void {
    this.q.setFromAxisAngle(this.up, Math.atan2(this.eye.x - x, this.eye.z - z));
    this.m4.compose(this.p.set(x, y, z), this.q, this.sc.setScalar(size));
    const i = this.poles.next(); this.poles.mesh.setMatrixAt(i, this.m4); this.poles.mesh.setColorAt(i, this.c.setHex(0x2a1a16));
    const j = this.pennants.next(); this.pennants.mesh.setMatrixAt(j, this.m4); this.pennants.mesh.setColorAt(j, this.c.setHex(colour));
  }

  end(): void { this.poles.end(); this.pennants.end(); }
}
