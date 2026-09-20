import type { Rng } from '@shared/index';
import { ITEM, p, type FoodKind, type LoadKind } from './config';

export type ItemKind = LoadKind | 'scrap';

/**
 * Something lying in the world at a pixel position: a handful of food thrown from the basket, the
 * armful a villager died carrying, the scrap iron a raider dropped. Items fly (z is height above the
 * ground), bounce, roll to a stop and deflect off anything that blocks walking, so nothing ends up
 * inside a wall. They belong to the world, not the agent list: nothing but physics moves them.
 */
export interface Item {
  id: number;
  kind: ItemKind;
  food?: FoodKind;
  n: number;
  x: number; y: number;
  /** height above the ground, and velocity in all three axes (px/s) */
  z: number;
  vx: number; vy: number; vz: number;
  /** on the ground and still: what children eat and the head picks up */
  rest: boolean;
  /** seconds since it came to be */
  age: number;
}

/** Does a point block an item flying at height z? Walls, buildings and closed gates always do; a tree only below its crown; open ground never. */
export type Blocked = (x: number, y: number, z: number) => boolean;

/**
 * Throw an item from `from` so that it comes to rest around `to`, bounces and all — with a little
 * scatter, as any throw has. The bounces and the roll carry it past its first landing, so the throw
 * is rehearsed on open ground and the pace scaled until the rest point falls on the aim.
 */
export function launch(it: Item, from: { x: number; y: number }, to: { x: number; y: number }, rng: Rng, height = 12): void {
  const dx = to.x - from.x, dy = to.y - from.y, dist = Math.hypot(dx, dy);
  const T = ITEM.flightBase + dist * ITEM.flightPerPx;
  const s = () => 1 + rng.range(-ITEM.scatter, ITEM.scatter);
  // reach the ground (z = 0) from `height` after T seconds: z0 + vz·T − g·T²/2 = 0
  const vz = (ITEM.gravity * T * T / 2 - height) / T;
  let vx = dx / T, vy = dy / T;
  for (let pass = 0; pass < 3 && dist > 1; pass++) {
    const trial: Item = { ...it, x: from.x, y: from.y, z: height, vx, vy, vz, rest: false, age: 0 };
    for (let i = 0; i < 600 && !trial.rest; i++) tickItem(trial, 1 / 60, () => false);
    const went = Math.hypot(trial.x - from.x, trial.y - from.y);
    if (went < 1) break;
    vx *= dist / went; vy *= dist / went;
  }
  it.x = from.x; it.y = from.y; it.z = height;
  it.vx = vx * s(); it.vy = vy * s(); it.vz = vz * s();
  it.rest = false;
}

/** Let a dropped item hop a little in a random direction. */
export function hop(it: Item, rng: Rng): void {
  const a = rng.range(0, Math.PI * 2), v = rng.range(0.3, 1) * ITEM.dropHop * 0.5;
  it.z = 2; it.vx = Math.cos(a) * v; it.vy = Math.sin(a) * v; it.vz = ITEM.dropHop; it.rest = false;
}

/** One physics step: fly, bounce, roll, deflect; settle when slow on the ground. */
export function tickItem(it: Item, dt: number, blocked: Blocked): void {
  it.age += dt;
  if (it.rest) return;
  // in the air
  it.vz -= ITEM.gravity * dt;
  it.z += it.vz * dt;
  if (it.z <= 0) {
    it.z = 0;
    if (it.vz < -20) { it.vz = -it.vz * p.itemBounce; it.vx *= ITEM.bounceKeep; it.vy *= ITEM.bounceKeep; }
    else { it.vz = 0; const k = Math.exp(-p.itemFriction * dt); it.vx *= k; it.vy *= k; } // rolling
  }
  // move one axis at a time and bounce off anything that blocks walking
  const nx = it.x + it.vx * dt, ny = it.y + it.vy * dt;
  if (blocked(nx, it.y, it.z)) it.vx = -it.vx * ITEM.wallKeep; else it.x = nx;
  if (blocked(it.x, ny, it.z)) it.vy = -it.vy * ITEM.wallKeep; else it.y = ny;
  if (it.z === 0 && Math.hypot(it.vx, it.vy) < ITEM.restSpeed) { it.vx = it.vy = 0; it.rest = true; }
}
