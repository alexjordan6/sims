/** Workers need sustained clearance before returning to work, not one safe frame. */
export const WORKER_DANGER = 90;
export const WORKER_CLEAR = 140;
export const WORKER_CALM_SECONDS = 3;

export class WorkerSafety {
  fleeing = false;
  private calm = 0;
  update(dt: number, danger: boolean, nearby: boolean): boolean {
    if (danger) { this.fleeing = true; this.calm = 0; }
    if (!this.fleeing) return false;
    if (nearby) this.calm = 0;
    else this.calm += Math.max(0, dt);
    if (this.calm >= WORKER_CALM_SECONDS) { this.fleeing = false; this.calm = 0; }
    return this.fleeing;
  }
}
