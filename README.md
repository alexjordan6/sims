# sims

Browser playground for multi-agent simulations. Phaser 3 + Vite + TypeScript, deployed to GitHub Pages on every push.

## Workflow

```bash
npm run new my-idea        # scaffold games/my-idea/ from the template
npm run dev                # http://localhost:5173/  (hot reload)
git add -A && git commit -m "my-idea" && git push   # live at https://<user>.github.io/sims/games/my-idea/
```

Each game is one folder: `games/<name>/main.ts`. Subclass `SimScene`, implement `setup()` to spawn agents, and give each agent an `update(dt, world)`. That's it.

## What the kernel gives you (`src/shared/`)

| thing | use |
|---|---|
| `SimScene` | fixed-timestep loop, `spawn()`, `wrap()`/`bounce()`, `neighbors(a, r)`, `reset()` |
| `params({...})` | live sliders in the top-right panel — read `p.x` each tick |
| `world.grid` | spatial grid; `forEachInRadius(x, y, r, fn)` for cheap neighbour queries |
| `world.rng` | seeded RNG; `?seed=123` in the URL reproduces a run |
| `hud` | fps / agent count / speed; add lines via `hudLines()` |

Override `tick(dt)` for global rules, `draw()` for custom rendering.

## Keys

`Space` pause · `1` `2` `3` speed 1×/4×/16× · `R` reset (same seed) · `N` reset (new seed)

## One-time setup

1. Create a GitHub repo named `sims`, push `main`.
2. Repo → Settings → Pages → Source: **GitHub Actions**.

If the repo is named something else, change `base` in `vite.config.ts`.
