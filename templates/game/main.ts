import { SimScene, launch, params, type Agent } from '@shared/index';

// Sliders show up in the top-right panel; read p.* inside update/tick to get live values.
const p = params({
  count: [200, 1, 2000, 1],
  speed: [60, 0, 400],
  jitter: [2, 0, 10],
});

class Walker implements Agent {
  id = 0;
  color = 0x7fd3ff;
  radius = 3;
  constructor(public x: number, public y: number, public vx: number, public vy: number) {}

  update(dt: number, world: SimScene): void {
    // random walk: nudge velocity, clamp to p.speed, wrap at edges
    this.vx += world.rng.range(-p.jitter, p.jitter);
    this.vy += world.rng.range(-p.jitter, p.jitter);
    const len = Math.hypot(this.vx, this.vy) || 1;
    if (len > p.speed) { this.vx *= p.speed / len; this.vy *= p.speed / len; }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    world.wrap(this);
  }
}

class __CLASS__Scene extends SimScene {
  setup(): void {
    for (let i = 0; i < p.count; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      this.spawn(new Walker(this.rng.range(0, this.W), this.rng.range(0, this.H), Math.cos(a) * p.speed, Math.sin(a) * p.speed));
    }
  }

  // Optional: override tick(dt) for global rules (spawning, collisions, stats),
  // draw() for custom rendering, hudLines() for extra HUD readouts.
}

launch(__CLASS__Scene);
