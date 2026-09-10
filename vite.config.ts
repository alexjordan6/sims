import { defineConfig, type Plugin } from 'vite';
import { readdirSync, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';

// Every games/<name>/index.html becomes its own page in the build.
const gameNames = readdirSync('games', { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(resolve('games', d.name, 'index.html')))
  .map((d) => d.name)
  .sort();
const gameInputs = Object.fromEntries(gameNames.map((n) => [`games/${n}`, resolve('games', n, 'index.html')]));

// `npm run new` while the dev server is running: restart so the new game shows in the gallery.
const restartOnNewGame: Plugin = {
  name: 'restart-on-new-game',
  configureServer(server) {
    const gamesDir = resolve('games') + sep;
    server.watcher.on('addDir', (p) => {
      if (p.startsWith(gamesDir)) server.restart();
    });
  },
};

export default defineConfig(({ mode }) => ({
  // GitHub Pages serves the repo at /<repo>/; dev stays at /.
  base: mode === 'production' ? '/sims/' : '/',
  // The gallery page reads this list; nothing to register by hand.
  define: { __GAMES__: JSON.stringify(gameNames) },
  resolve: { alias: { '@shared': resolve('src/shared') } },
  plugins: [restartOnNewGame],
  build: {
    chunkSizeWarningLimit: 1500, // phaser alone is ~1.2 MB
    rollupOptions: {
      input: { main: resolve('index.html'), ...gameInputs },
    },
  },
  server: { open: false },
}));
