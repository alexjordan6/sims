import Phaser from 'phaser';

/** Small text overlay in the top-left: fps, agent count, tick rate, speed, pause. */
export class Hud {
  private text: Phaser.GameObjects.Text;
  private extra: Record<string, string | number> = {};

  constructor(scene: Phaser.Scene) {
    this.text = scene.add
      .text(8, 8, '', {
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        fontSize: '12px',
        color: '#e8e8e8',
        backgroundColor: 'rgba(0,0,0,0.45)',
        padding: { x: 6, y: 4 },
      })
      .setScrollFactor(0)
      .setDepth(1000);
  }

  /** Extra lines you want shown, e.g. hud.set('prey', prey.length). */
  set(key: string, value: string | number): void {
    this.extra[key] = value;
  }

  render(lines: Record<string, string | number>): void {
    const all = { ...lines, ...this.extra };
    this.text.setText(
      Object.entries(all)
        .map(([k, v]) => `${k}: ${typeof v === 'number' ? Number.isInteger(v) ? v : v.toFixed(2) : v}`)
        .join('\n'),
    );
  }
}
