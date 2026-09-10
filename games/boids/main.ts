import Phaser from 'phaser';
import { SimScene, launch, params, type Agent } from '@shared/index';

// Classic Reynolds flocking. Drag the sliders while it runs.
const p = params({
  count: [400, 10, 3000, 1],
  maxSpeed: [120, 10, 400],
  maxForce: [200, 0, 1000],
  perception: [50, 5, 150],
  separation: [1.5, 0, 5],
  alignment: [1.0, 0, 5],
  cohesion: [1.0, 0, 5],
});

class Boid implements Agent {
  id = 0;
  radius = 2.5;
  color = 0x7fd3ff;
  constructor(public x: number, public y: number, public vx: number, public vy: number) {}

  update(dt: number, world: SimScene): void {
    let sepX = 0, sepY = 0, aliX = 0, aliY = 0, cohX = 0, cohY = 0, n = 0;
    const r = p.perception;
    world.grid.forEachInRadius(this.x, this.y, r, (o, d2) => {
      if (o === this) return;
      n++;
      const d = Math.sqrt(d2) || 1e-3;
      // separation is inverse-distance weighted so close neighbours push hardest
      sepX += (this.x - o.x) / d / d;
      sepY += (this.y - o.y) / d / d;
      aliX += o.vx; aliY += o.vy;
      cohX += o.x;  cohY += o.y;
    });

    let ax = 0, ay = 0;
    if (n > 0) {
      aliX /= n; aliY /= n;
      cohX = cohX / n - this.x; cohY = cohY / n - this.y;
      ax = sepX * p.separation * 400 + (aliX - this.vx) * p.alignment + cohX * p.cohesion;
      ay = sepY * p.separation * 400 + (aliY - this.vy) * p.alignment + cohY * p.cohesion;
      const f = Math.hypot(ax, ay);
      if (f > p.maxForce) { ax *= p.maxForce / f; ay *= p.maxForce / f; }
    }

    this.vx += ax * dt;
    this.vy += ay * dt;
    const s = Math.hypot(this.vx, this.vy) || 1;
    if (s > p.maxSpeed) { this.vx *= p.maxSpeed / s; this.vy *= p.maxSpeed / s; }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    world.wrap(this);

    // tint by heading so flocks read as groups
    const hue = ((Math.atan2(this.vy, this.vx) / Math.PI + 1) * 180) | 0;
    this.color = Phaser.Display.Color.HSLToColor(hue / 360, 0.7, 0.65).color;
  }
}

class BoidsScene extends SimScene {
  neighborRadius = 150; // grid cell size = largest perception slider value
  setup(): void {
    for (let i = 0; i < p.count; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      this.spawn(new Boid(this.rng.range(0, this.W), this.rng.range(0, this.H), Math.cos(a) * p.maxSpeed, Math.sin(a) * p.maxSpeed));
    }
  }

  tick(dt: number): void {
    // keep population in sync with the slider without a reset
    while (this.agents.length < p.count) {
      const a = this.rng.range(0, Math.PI * 2);
      this.spawn(new Boid(this.rng.range(0, this.W), this.rng.range(0, this.H), Math.cos(a) * p.maxSpeed, Math.sin(a) * p.maxSpeed));
    }
    if (this.agents.length > p.count) this.agents.length = p.count;
    super.tick(dt);
  }

  // Draw boids as little triangles pointing along their velocity.
  draw(): void {
    const g = this.gfx;
    g.clear();
    for (const a of this.agents) {
      const s = Math.hypot(a.vx, a.vy) || 1;
      const ux = a.vx / s, uy = a.vy / s;
      const L = 7, Wd = 3;
      g.fillStyle(a.color ?? 0xffffff, 1);
      g.fillTriangle(
        a.x + ux * L, a.y + uy * L,
        a.x - ux * Wd - uy * Wd, a.y - uy * Wd + ux * Wd,
        a.x - ux * Wd + uy * Wd, a.y - uy * Wd - ux * Wd,
      );
    }
  }
}

launch(BoidsScene);
