# Where these came from

Vendored from [`phaserjs/phaser`](https://github.com/phaserjs/phaser/tree/master/skills) at commit
`02d8931b626d9764c133cbb3fbf99966c03c757c` (Phaser **4.2.1**).

This project runs Phaser 4.2.1, the same version these document, so they are upstream verbatim —
no banners, no edits, except the one correction noted below.

`v3-to-v4-migration/SKILL.md` is kept for historical context: the repo ran Phaser 3.90 until
2026-09-25, so anything in the git history before that commit is v3 code.

## Local corrections

One upstream error, found while migrating and deliberately kept fixed here — do not let a re-sync
silently drop it:

- `v3-to-v4-migration/SKILL.md` claims `tintFill` / `setTintFill()` were **removed** in v4. They
  were not. `setTintFill()` still exists as a deprecated stub that takes **zero arguments**, returns
  `void`, and logs an error. That matters: a v3 call like `setTintFill(0xffffff)` is a *compile*
  error (TS2554), not a missing-method error, and it silently does nothing at runtime.

## Re-syncing

Re-fetch against a newer upstream commit and diff before committing. Check whether the correction
above has been fixed upstream; if not, re-apply it.
