# Where these came from

Vendored from [`phaserjs/phaser`](https://github.com/phaserjs/phaser/tree/master/skills) at commit
`02d8931b626d9764c133cbb3fbf99966c03c757c` (Phaser **4.2.1**), fetched 2026-09-25.

**This project is on Phaser 3.90 and stays there** — v3 was chosen deliberately. Phaser publishes
no v3 branch of these skills, so every `SKILL.md` here carries a one-line banner under its
frontmatter saying so. That banner is the only local edit; everything else is upstream verbatim.

The v3/v4 split, in short: the *rendering* layer was rewritten (pipelines became render nodes, FX and
masks became filters, tint/camera-matrix/texture-coordinate changes, `DynamicTexture`), while the
everyday gameplay API — scenes, tweens, input, timers, tilemaps, groups, arcade physics, the data
manager and the event system — is broadly unchanged. `v3-to-v4-migration/SKILL.md` is the delta, and
is the one to read whenever a renderer detail matters.

## Re-syncing

Re-run the fetch against a newer commit and re-apply the banners; diff before committing, since
upstream tracks v4 and will drift further from this project over time.
