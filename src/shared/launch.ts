import Phaser from 'phaser';

export interface LaunchOptions {
  width?: number;
  height?: number;
  background?: string;
  parent?: string;
}

declare global {
  interface Window {
    /** The running game, for poking at from the devtools console: game.scene.scenes[0].agents */
    game: Phaser.Game;
  }
}

/** Boot a Phaser game with one scene, scaled to fit the window. */
export function launch(scene: typeof Phaser.Scene, opts: LaunchOptions = {}): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: opts.parent ?? 'game',
    width: opts.width ?? 1280,
    height: opts.height ?? 720,
    backgroundColor: opts.background ?? '#101014',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [scene],
  });
  window.game = game;
  return game;
}
