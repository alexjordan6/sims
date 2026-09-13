import Phaser from 'phaser';

export interface LaunchOptions {
  width?: number;
  height?: number;
  background?: string;
  parent?: string;
  /** Nearest-neighbour texture filtering + rounded positions, for pixel art. */
  pixelArt?: boolean;
  /** Integer upscale of the base resolution (e.g. 2 => 16 px tiles show as 32 px). Ignored with scale 'resize'. */
  zoom?: number;
  /**
   * 'fit' (default): the fixed base resolution is letterboxed into the parent.
   * 'resize': the canvas fills the parent and the scene drives its own camera zoom/follow —
   * use this for worlds larger than a phone screen.
   */
  scale?: 'fit' | 'resize';
}

declare global {
  interface Window {
    /** The running game, for poking at from the devtools console: game.scene.scenes[0].agents */
    game: Phaser.Game;
  }
}

/** Boot a Phaser game with one scene, scaled to fit the window. */
export function launch(scene: typeof Phaser.Scene, opts: LaunchOptions = {}): Phaser.Game {
  const resize = opts.scale === 'resize';
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: opts.parent ?? 'game',
    width: opts.width ?? 1280,
    height: opts.height ?? 720,
    backgroundColor: opts.background ?? '#101014',
    pixelArt: opts.pixelArt ?? false,
    roundPixels: opts.pixelArt ?? false,
    scale: resize
      ? { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.NO_CENTER }
      : { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, zoom: opts.zoom ?? 1 },
    scene: [scene],
  });
  window.game = game;
  return game;
}
