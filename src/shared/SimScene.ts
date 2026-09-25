import Phaser from 'phaser';
import type { Agent } from './Agent';
import { Rng, seedFromUrl } from './rng';
import { SpatialGrid } from './spatial';
import { Hud } from './hud';

/**
 * Base scene for a multi-agent sim. Subclass, implement setup() (spawn agents) and
 * optionally override tick()/draw(). Everything else — fixed-timestep loop, speed
 * control, reset, neighbour grid, HUD — comes for free.
 *
 * Keys: Space pause · 1/2/3 speed 1x/4x/16x · R reset (same seed) · N reset (new seed)
 */
export abstract class SimScene extends Phaser.Scene {
  agents: Agent[] = [];
  rng!: Rng;
  grid!: SpatialGrid<Agent>;
  hud!: Hud;
  gfx!: Phaser.GameObjects.Graphics;

  /** Simulation ticks per second (independent of render fps). */
  tickRate = 60;
  /** Cell size of the neighbour grid; set to your largest query radius before create(). */
  neighborRadius = 50;
  /** Max ticks run in one frame so a tab-switch doesn't spiral. */
  maxTicksPerFrame = 20;

  speed = 1;
  paused = false;
  seed = 0;
  tickCount = 0;
  /** Simulated seconds elapsed since reset. */
  simTime = 0;

  private acc = 0;
  private nextId = 0;

  get W(): number {
    return this.scale.width;
  }
  get H(): number {
    return this.scale.height;
  }

  // ---- override these -------------------------------------------------------

  /** Spawn initial agents here via this.spawn(...). Called on create and every reset. */
  abstract setup(): void;

  /** One fixed step. Default: update every agent, then drop the dead. */
  tick(dt: number): void {
    for (const a of this.agents) a.update(dt, this);
    this.removeDead();
  }

  /** Called once per rendered frame. Default: a circle per agent. Override for custom visuals. */
  draw(): void {
    const g = this.gfx;
    g.clear();
    for (const a of this.agents) {
      g.fillStyle(a.color ?? 0xffffff, 1);
      g.fillCircle(a.x, a.y, a.radius ?? 3);
    }
  }

  /** Lines to show in the HUD beyond the defaults. */
  hudLines(): Record<string, string | number> {
    return {};
  }

  // ---- helpers ------------------------------------------------------------

  spawn<T extends Agent>(agent: T): T {
    agent.id = this.nextId++;
    this.agents.push(agent);
    return agent;
  }

  removeDead(): void {
    let w = 0;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.dead) this.agents[w++] = a;
    }
    this.agents.length = w;
  }

  /** Toroidal world: leaving one edge re-enters the opposite one. */
  wrap(a: { x: number; y: number }): void {
    const W = this.W, H = this.H;
    if (a.x < 0) a.x += W; else if (a.x >= W) a.x -= W;
    if (a.y < 0) a.y += H; else if (a.y >= H) a.y -= H;
  }

  /** Reflect velocity off the edges. */
  bounce(a: { x: number; y: number; vx: number; vy: number }): void {
    const W = this.W, H = this.H;
    if (a.x < 0) { a.x = 0; a.vx = Math.abs(a.vx); } else if (a.x > W) { a.x = W; a.vx = -Math.abs(a.vx); }
    if (a.y < 0) { a.y = 0; a.vy = Math.abs(a.vy); } else if (a.y > H) { a.y = H; a.vy = -Math.abs(a.vy); }
  }

  /** Neighbours of `a` within r (uses the grid, so cheap). */
  neighbors(a: Agent, r: number): Agent[] {
    return this.grid.query(a.x, a.y, r, a);
  }

  reset(newSeed?: number): void {
    this.seed = newSeed ?? this.seed;
    this.rng = new Rng(this.seed);
    this.agents = [];
    this.nextId = 0;
    this.tickCount = 0;
    this.simTime = 0;
    this.acc = 0;
    this.grid = new SpatialGrid<Agent>(this.W, this.H, this.neighborRadius);
    this.setup();
    this.grid.rebuild(this.agents);
  }

  // ---- Phaser lifecycle -------------------------------------------------------

  create(): void {
    // Phaser 4 rounds a game object to whole pixels only when its transform is position-only
    // ('safeAuto'), so a SCALED pixel-art sprite lands between screen pixels where v3 snapped it.
    // Measured at zoom 2: a scaled sprite nudged 0.4px renders differently under the two modes.
    // 'fullAuto' is what v3 did for everything, so this restores the old look rather than picking
    // a new one. It still defers to the camera's roundPixels, which pixelArt: true turns on.
    this.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, (obj: Phaser.GameObjects.GameObject) => {
      if ('vertexRoundMode' in obj) (obj as { vertexRoundMode: string }).vertexRoundMode = 'fullAuto';
    });
    this.gfx = this.add.graphics();
    this.hud = new Hud(this);
    this.seed = seedFromUrl();

    const kb = this.input.keyboard!;
    kb.on('keydown-SPACE', () => (this.paused = !this.paused));
    kb.on('keydown-ONE', () => (this.speed = 1));
    kb.on('keydown-TWO', () => (this.speed = 4));
    kb.on('keydown-THREE', () => (this.speed = 16));
    kb.on('keydown-R', () => this.reset());
    kb.on('keydown-N', () => {
      const s = (Math.random() * 0xffffffff) >>> 0;
      const url = new URL(window.location.href);
      url.searchParams.set('seed', String(s));
      window.history.replaceState(null, '', url);
      this.reset(s);
    });

    this.scale.on('resize', () => {
      this.grid = new SpatialGrid<Agent>(this.W, this.H, this.neighborRadius);
    });

    this.reset();
  }

  update(_t: number, deltaMs: number): void {
    const dt = 1 / this.tickRate;
    if (!this.paused) {
      this.acc += Math.min(deltaMs / 1000, 0.25) * this.speed;
      let n = 0;
      while (this.acc >= dt && n < this.maxTicksPerFrame) {
        this.grid.rebuild(this.agents);
        this.tick(dt);
        this.tickCount++;
        this.simTime += dt;
        this.acc -= dt;
        n++;
      }
      if (n === this.maxTicksPerFrame) this.acc = 0;
    }
    this.draw();
    this.hud.render({
      fps: Math.round(this.game.loop.actualFps),
      agents: this.agents.length,
      speed: `${this.speed}x${this.paused ? ' (paused)' : ''}`,
      t: this.simTime,
      seed: this.seed,
      ...this.hudLines(),
    });
  }
}
