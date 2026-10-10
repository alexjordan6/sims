import * as THREE from 'three';
import type { Spec } from './figure';

export interface MotionPose {
  phase: number;
  pace: number;
  time: number;
  side?: number;
  backwards?: boolean;
  wind?: { x: number; y: number };
  guard?: boolean;
  bow?: number;
  strike?: { dir: string; progress: number; recovery: number; preparation?: number };
  hurt?: number;
  death?: number;
}

/** One continuous pose solver for live actors and distant baked silhouettes. */
export function poseFigure(rig: THREE.Object3D, p: MotionPose): void {
  const s = rig.userData.spec as Spec;
  if (!s) return;
  let nodes = rig.userData.joints as Map<string, THREE.Object3D> | undefined;
  if (!nodes) {
    nodes = new Map(); rig.traverse(n => { if (n.name) nodes!.set(n.name, n); });
    rig.userData.joints = nodes;
  }
  const bone = (name: string) => nodes!.get(name)!;
  const root = bone('root'), torso = bone('torso'), head = bone('head');
  const pace = Math.min(1, p.pace), stride = Math.sin(p.phase);
  root.position.y = Math.sin(p.phase * 2) * 0.009 * pace;
  root.rotation.set(0, 0, 0);
  torso.rotation.set((s.hunch ?? 0) + pace * 0.07, stride * pace * 0.06, Math.sin(p.phase) * pace * 0.025);
  torso.scale.y = 1 + Math.sin(p.time * 2.5) * 0.008 * (1 - pace);
  head.rotation.set(Math.sin(p.time * 1.5) * 0.012, -torso.rotation.y * 0.5, -torso.rotation.z * 0.5);
  for (const [side, sign] of [['left', 1], ['right', -1]] as const) {
    const phase = p.phase + (sign < 0 ? Math.PI : 0);
    const step = Math.sin(phase) * pace;
    bone('leg-' + side).rotation.set(step * 0.56 * (p.backwards ? -1 : 1), 0, sign * 0.025 - (p.side ?? 0) * step * 0.2);
    bone('knee-' + side).rotation.set(Math.max(0, -Math.sin(phase)) * pace * 0.95 + 0.045, 0, 0);
    bone('arm-' + side).rotation.set(-step * 0.32 - 0.08, 0, sign * 0.1);
    bone('elbow-' + side).rotation.set(-0.16 - Math.max(0, step) * 0.22, 0, 0);
    bone('hand-' + side).rotation.set(0, 0, 0);
  }
  const arm = bone('arm-right'), elbow = bone('elbow-right'), off = bone('arm-left');
  // Carry long blades clear of the ground, with a relaxed bent elbow.
  if (rig.userData.held === 'sword') {
    arm.rotation.x -= 0.28;
    elbow.rotation.x -= 0.55;
  }
  if (p.wind || p.guard) {
    const x = p.wind?.x ?? 0, y = p.wind?.y ?? 0;
    arm.rotation.set(-0.85 + y * 0.8, x * 1.3, -0.2 - x * 0.25);
    elbow.rotation.x = -0.85;
    off.rotation.set(p.guard ? -1 : -0.35, 0.25, 0.35);
    bone('elbow-left').rotation.x = p.guard ? -1.1 : -0.4;
    torso.rotation.y = x * 0.4;
    torso.rotation.x += 0.08;
  }
  if (p.strike) {
    const start = p.strike.preparation !== undefined && p.strike.preparation < 1
      ? [arm, elbow, off, bone('elbow-left'), torso, head].map(n => n.rotation.clone()) : null;
    const u = THREE.MathUtils.smoothstep(p.strike.progress, 0, 1);
    const settle = 1 - THREE.MathUtils.smoothstep(p.strike.recovery, 0, 1);
    const sign = p.strike.dir === 'left' ? -1 : 1;
    if (p.strike.dir === 'up') {
      arm.rotation.set((-2.8 + u * 2.15) * settle, 0, -0.18);
      elbow.rotation.x = (-0.65 + u * 0.5) * settle;
      torso.rotation.x += Math.sin(u * Math.PI) * 0.24 * settle;
    } else if (p.strike.dir === 'down') {
      arm.rotation.set((-0.15 - u * 1.25) * settle, -0.05, -0.1);
      elbow.rotation.x = (-2 + u * 1.85) * settle;
      torso.rotation.x += Math.sin(u * Math.PI) * 0.15 * settle;
    } else {
      arm.rotation.set(-1.2 * settle, sign * (1.6 - u * 3.2) * settle, -0.2);
      elbow.rotation.x = (-0.65 + Math.sin(u * Math.PI) * 0.5) * settle;
      torso.rotation.y = sign * (0.5 - u * 1.0) * settle;
    }
    off.rotation.set(-0.7 * settle, 0.25, 0.4);
    bone('elbow-left').rotation.x = -0.65 * settle;
    head.rotation.y = -torso.rotation.y * 0.6;
    if (start) {
      const mix = THREE.MathUtils.smoothstep(p.strike.preparation!, 0, 1);
      [arm, elbow, off, bone('elbow-left'), torso, head].forEach((n, i) => {
        n.rotation.set(THREE.MathUtils.lerp(start[i].x,n.rotation.x,mix), THREE.MathUtils.lerp(start[i].y,n.rotation.y,mix), THREE.MathUtils.lerp(start[i].z,n.rotation.z,mix));
      });
    }
  }
  if (p.bow !== undefined && p.bow >= 0) {
    arm.rotation.set(-1.4, -0.4, -0.15); elbow.rotation.x = -0.12;
    off.rotation.set(-0.9, 0.8, 0.35); bone('elbow-left').rotation.x = -1.6 * Math.min(1, p.bow + 0.3);
  }
  if (p.hurt) { torso.rotation.x -= p.hurt * 0.3; head.rotation.x += p.hurt * 0.25; }
  if (p.death !== undefined) {
    const fall = THREE.MathUtils.smoothstep(p.death, 0, 0.8);
    root.rotation.z = fall * 1.5;
    root.position.y = -fall * s.legLen * 0.7;
    bone('knee-left').rotation.x += fall * 0.8;
    bone('elbow-right').rotation.x -= fall * 0.6;
  }
}
