import './main';
import type { VillageScene } from './main';
import { World, doorstep, type BuildingKind } from './world';
import { Rng } from '../../src/shared/rng';
import { Villager, Arrow, Raider } from './agents';
import { Brute, Rat, Ogre, waveComposition } from './enemies';
import { COLS, ROWS, WALL_HEIGHT } from './config';

const scene = () => (window as unknown as { game: { scene: { scenes: VillageScene[] } } }).game.scene.scenes[0];
const output = document.getElementById('test-results')!, summary = document.getElementById('test-summary')!;
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); output.textContent += `PASS ${message}\n`; };
function fresh(): VillageScene {
  const s = scene(); s.reset(42); s.screen = 'playing'; s.paused = true; s.wood = 150; s.food = 150; s.fx.length = 0;
  (s as unknown as { ui: { showScreen(v: null): void } }).ui.showScreen(null);
  document.querySelector('.ctrl-panel')?.classList.remove('open');
  return s;
}
function clearing(s: VillageScene) {
  for (let y = 90; y <= 110; y++) for (let x = 115; x <= 140; x++) s.world.set(x, y, 'grass');
}
function fort(s: VillageScene) {
  clearing(s);
  for (let x = 119; x <= 131; x++) { s.world.placeDefense('wall', x, 95); s.world.placeDefense(x === 125 ? 'gate' : 'wall', x, 105); }
  for (let y = 96; y < 105; y++) { s.world.placeDefense('wall', 119, y); s.world.placeDefense('wall', 131, y); }
  s.world.placeDefense('stairs', 120, 96); s.world.placeDefense('wall', 120, 95);
  Object.assign(s.player, World.center(124, 100));
  s.fitCamera();
}
function step(s: VillageScene, seconds: number) {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) { s.grid.rebuild(s.agents); for (const a of [...s.agents]) if (!a.dead) a.update(1 / 60, s); s.removeDead(); }
}
document.getElementById('run-checks')!.addEventListener('click', () => {
  output.textContent = ''; summary.textContent = 'Running';
  try {
    assert(COLS * ROWS > 80 * 44 * 10, 'world is over ten times the old area');
    let dense = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const w = new World(); w.generate(new Rng(seed)); if (w.denseForests) dense++;
      assert(w.bfs({ tx: COLS / 2, ty: ROWS / 2 }, { tx: COLS / 2, ty: 0 }).length > 0, `seed ${seed}: north trail reachable`);
      assert(w.treeCount === w.count(t => t.kind === 'tree'), `seed ${seed}: tree accounting`);
      const lairDist = w.lair ? Math.hypot(w.lair.tx + 2 - COLS / 2, w.lair.ty + 2 - ROWS / 2) : 0;
      assert(w.lair && lairDist >= 40 && lairDist <= 90 && w.bfs({ tx: w.lair.tx + 2, ty: w.lair.ty + 4 }, { tx: COLS / 2, ty: ROWS / 2 }).length > 0, `seed ${seed}: the Ogre's lair is placed far out and reachable (${lairDist.toFixed(0)} tiles)`);
    }
    assert(dense > 7 && dense < 20, `dense forests vary by seed (${dense}/20)`);
    const a = new World(), b = new World(); a.generate(new Rng(88)); b.generate(new Rng(88));
    assert(a.tiles.every((t, i) => t.kind === b.tiles[i].kind && t.v === b.tiles[i].v), 'same seed produces identical world');
    const w = new World(16, 16);
    for (let x = 3; x <= 10; x++) { w.placeDefense('wall', x, 3); w.placeDefense(x === 6 ? 'gate' : 'wall', x, 10); }
    for (let y = 4; y < 10; y++) { w.placeDefense('wall', 3, y); w.placeDefense('wall', 10, y); }
    assert(w.bfs({ tx: 6, ty: 12 }, { tx: 6, ty: 6 }).length > 0, 'friendly path crosses a guarded gate');
    assert(w.bfs({ tx: 6, ty: 12 }, { tx: 6, ty: 6 }, true).length === 0, 'closed perimeter blocks enemies');
    const gate = w.get(6, 10)!.defense!; gate.open = true;
    assert(w.bfs({ tx: 6, ty: 12 }, { tx: 6, ty: 6 }, true).length > 0, 'open gate lets enemies through'); gate.open = false;
    assert(w.bfs({ tx: 3, ty: 3 }, { tx: 10, ty: 10 }, false, true).length > 0, 'battlements connect around corners and over gates');
    assert(w.isBlocked(5, 5, false, true), 'elevated actors cannot walk off walls');
    assert(!w.lineClear(World.center(6, 12), World.center(6, 6)), 'ground arrows blocked by closed gate');
    assert(w.lineClear(World.center(6, 12), World.center(6, 6), true), 'wall archers fire over the perimeter');
    w.damageDefense(gate, 999); assert(!w.get(6, 10)!.defense && w.bfs({ tx: 6, ty: 12 }, { tx: 6, ty: 6 }, true).length > 0, 'destroying a gate opens a real breach');
    assert([1, 2, 3, 4, 5, 6].every(n => !waveComposition(n).rat || waveComposition(n).rat >= 10), 'every rat wave has at least ten');
    let s = fresh(); clearing(s);
    const brute = new Brute(2000, 1600);
    assert(brute.maxHp === 180 && brute.dmg === 24 && brute.speed === 56 && brute.pushScale === 0.15, 'brute health, damage, speed and resistance doubled');
    s.agents = [s.player]; Object.assign(s.player, { x: 2020, y: 1600 }); s.spawn(brute);
    brute.startAttack(s, s.player, 24, 30, 0.2, 0.4); const hp = s.player.hp; s.player.x = 2100;
    brute.attackTick(0.21, s);
    assert(s.fx.some(e => e.kind === 'melee') && s.player.hp === hp, 'dodged brute attack still animates its axe without damage');
    s = fresh(); clearing(s); s.agents = [s.player]; Object.assign(s.player, World.center(121, 100));
    const victim = s.spawn(new Raider(s.player.x + 60, s.player.y)); victim.speed = 0;
    const arrow = s.spawn(new Arrow(s.player.x, s.player.y, 1, 0, 14, s.player)); s.grid.rebuild(s.agents);
    for (let i = 0; i < 30 && !arrow.dead; i++) arrow.update(1 / 60, s);
    assert(victim.hp === victim.maxHp - 14 && arrow.dead, 'arrow collision damages the body exactly once');
    const shield = s.world.placeDefense('wall', 123, 100)!;
    const blocked = s.spawn(new Arrow(s.player.x, s.player.y, 1, 0, 14, s.player)); const before = victim.hp;
    for (let i = 0; i < 30 && !blocked.dead; i++) blocked.update(1 / 60, s);
    assert(blocked.dead && victim.hp === before, 'ground arrows stop at stone walls');
    s.world.damageDefense(shield, 999);
    s = fresh(); clearing(s); s.agents = [s.player]; Object.assign(s.player, World.center(135, 100));
    for (const q of s.world.find(t => t.kind === 'crop')) s.world.set(q.tx, q.ty, 'tilled');
    s.world.set(120, 100, 'crop'); const rat = s.spawn(new Rat(1928, 1608, { harmlessRats: true })); s.grid.rebuild(s.agents);
    for (let i = 0; i < 100; i++) rat.update(1 / 60, s);
    assert(s.world.get(120, 100)!.kind === 'crop', 'Foragers gives time to respond to crop damage');
    for (let i = 0; i < 100; i++) rat.update(1 / 60, s);
    assert(s.world.get(120, 100)!.kind === 'tilled' && !rat.dead, 'Foragers still allows rats to eat crops');
    s = fresh(); fort(s); s.agents = [s.player];
    const guard = s.spawn(new Villager(...Object.values(World.center(122, 100)) as [number, number], s.world.houses[0], 'soldier', 20, 'Wall tester', s.mods));
    assert(s.assignPost(guard, { tx: 124, ty: 95 }), 'wall post accepts a route through connected stairs');
    step(s, 8);
    assert(guard.elevated && guard.tile.tx === 124 && guard.tile.ty === 95 && guard.weapon === 'bow', 'soldier climbs stairs and reaches the assigned wall post');
    const breach = s.world.get(124, 95)!.defense!; s.world.damageDefense(breach, 999); s.rescueFallenGuards();
    assert(!guard.elevated && !s.world.isBlocked(guard.tile.tx, guard.tile.ty), 'wall collapse places its guard safely on ground');
    for (const kind of ['house', 'barracks', 'tavern'] as BuildingKind[]) {
      const building = s.world.buildings.find(b => b.kind === kind) ?? s.world.place(kind, 135, 95);
      const door = doorstep(building); Object.assign(s.player, World.center(door.tx, door.ty));
      s.interior.enter(building); assert(s.interior.active && s.player.hidden, `${kind}: enter interior and leave outdoor targeting`);
      s.interior.x = 160; s.interior.y = 192; s.interior.act();
      assert(!s.interior.active && !s.player.hidden && s.player.tile.tx === door.tx && s.player.tile.ty === door.ty, `${kind}: exit at the correct door`);
      s.world.set(building.tx, building.ty, 'grass'); assert(s.world.get(building.tx, building.ty)!.building === building, `${kind}: building remains indestructible`);
    }
    // the Ogre: asleep and hidden by day, out at night, home at dawn with a quarter of his health back; never counts as a raid
    s = fresh(); s.agents = [s.player, s.ogre!]; const ogre = s.ogre!;
    assert(ogre instanceof Ogre && ogre.hidden && ogre.state === 'sleeping' && ogre.lairBound && ogre.huge, 'the Ogre starts asleep and hidden in his lair');
    Object.assign(s.player, World.center(COLS / 2, ROWS / 2)); s.dayTime = 0.86; step(s, 2);
    assert(!ogre.hidden && ogre.state === 'roaming', 'the Ogre comes out at night');
    ogre.hp = 300; s.dayTime = 0.3; step(s, 20);
    assert(ogre.hidden && ogre.state === 'sleeping' && ogre.hp === 450, 'the Ogre goes home at dawn and heals a quarter');
    assert(!s.agents.some(a => a instanceof Raider && !a.lairBound), 'the Ogre does not count toward an active raid');
    Object.assign(s.player, { x: ogre.x, y: ogre.y + 40 }); s.dayTime = 0.86; step(s, 3);
    assert(ogre.state === 'hunting' && s.player.hp <= s.player.maxHp - 25, 'the Ogre hunts a player near his lair at night and hits for 25');
    const n = output.textContent!.split('\n').filter(Boolean).length;
    summary.textContent = `${n} checks passed`; s.paused = true;
  } catch (e) { summary.textContent = 'FAILED'; output.textContent += String(e); console.error(e); }
});
document.querySelectorAll<HTMLButtonElement>('[data-preview]').forEach(btn => btn.addEventListener('click', () => {
  const s = fresh(), kind = btn.dataset.preview!;
  if (kind === 'fort' || kind === 'combat') {
    fort(s); s.world.place('tavern', 125, 98); s.world.place('house', 120, 98);
    s.player.tool = 'bow';
    const guard = s.spawn(new Villager(2008, 1528, s.world.houses[0], 'soldier', 20, 'Archer', s.mods)); guard.elevated = true; guard.weapon = 'bow'; guard.post = guard.tile;
    if (kind === 'combat') { const brute = s.spawn(new Brute(2008, 1720)); s.spawn(new Raider(1960, 1730)); brute.speed = 30; s.paused = false; }
  } else if (kind === 'forest') {
    const t = s.world.nearest(s.player.x, s.player.y, (t) => t.biome === 'deepwood' && t.kind === 'grass');
    if (t) Object.assign(s.player, World.center(t.tx, t.ty)); s.fitCamera();
  } else {
    const b = s.world.buildings.find(b => b.kind === kind) ?? s.world.place('tavern', 135, 95); b.level = 3;
    s.interior.enter(b); s.interior.x = 162; s.interior.y = 140;
  }
  s.dayTime = 0.82; s.draw();
  summary.textContent = `${kind} preview · wall height ${WALL_HEIGHT}px`;
}));
