import * as THREE from 'three';

/** A short ribbon sampled from the rendered blade itself, never a detached circle effect. */
export class WeaponTrail {
  private positions = new Float32Array(18 * 12);
  private colours = new Float32Array(18 * 12);
  private geometry = new THREE.BufferGeometry();
  readonly mesh: THREE.Mesh;
  private samples: { base: THREE.Vector3; tip: THREE.Vector3; age: number }[] = [];
  /** how long a sample hangs about: longer than the window it was taken in, so the arc reads as one stroke */
  private static readonly LIFE = 0.2;
  constructor() {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colours, 3).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.Mesh(this.geometry, new THREE.MeshBasicMaterial({ color: 0xd2e5ff, vertexColors: true, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }
  clear(): void { this.samples = []; this.mesh.visible = false; }
  update(weapon: THREE.Object3D | undefined, active: boolean, dt: number): void {
    this.samples.forEach(s => s.age += dt);
    this.samples = this.samples.filter(s => s.age < WeaponTrail.LIFE);
    if (weapon && active) {
      weapon.updateWorldMatrix(true, false);
      const tip = weapon.getObjectByName('weapon-tip');
      this.samples.push({ base: weapon.localToWorld(new THREE.Vector3(0,0.14,0)), tip: tip ? tip.getWorldPosition(new THREE.Vector3()) : weapon.localToWorld(new THREE.Vector3(0,0.52,0)), age: 0 });
      if (this.samples.length > 13) this.samples.shift();
    }
    let offset = 0;
    const put = (v: THREE.Vector3, fade: number) => {
      v.toArray(this.positions, offset);
      this.colours.fill(fade, offset, offset+3); offset += 3;
    };
    for (let i=1;i<this.samples.length;i++) {
      const a=this.samples[i-1], b=this.samples[i], fa=1-a.age/WeaponTrail.LIFE, fb=1-b.age/WeaponTrail.LIFE;
      put(a.base,fa);put(a.tip,fa);put(b.tip,fb);put(a.base,fa);put(b.tip,fb);put(b.base,fb);
    }
    this.geometry.setDrawRange(0,offset/3);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.mesh.visible = offset > 0;
  }
}
