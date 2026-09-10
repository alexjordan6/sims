import type { SimScene } from './SimScene';

/**
 * The only contract a sim needs to satisfy. Keep agents as plain objects/classes:
 * no Phaser game objects inside them, so thousands can tick cheaply.
 */
export interface Agent {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Advance this agent by dt seconds. `world` is the scene: use world.agents, world.rng, world.grid, world.params. */
  update(dt: number, world: SimScene): void;
  /** Optional: color for the default circle renderer (0xRRGGBB). */
  color?: number;
  /** Optional: radius for the default circle renderer. */
  radius?: number;
  /** Set to true to have the scene remove this agent after the tick. */
  dead?: boolean;
}
