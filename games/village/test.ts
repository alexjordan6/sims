import './main';
import { runPackChecks } from './pack-test';
import { IMPLEMENTS } from './pack';
import { STACK } from './config';
const clearBulk = (s: VillageScene) => s.player.pack.slots.forEach((b,i)=>{if(b && ['wood','food','scrap'].includes(b.kind))s.player.pack.removeAt(i);});
import type { VillageScene } from './main';
import { World, WILD_FOOD, doorstep, buildingCenter, hearthCost, BUILDINGS, type BuildingKind, type Chest } from './world';
import { Rng } from '../../src/shared/rng';
import { Villager, Arrow, Raider, BELT, BUILDS } from './agents';
import { Brute, Rat, Ogre, Wrecker, Troll, Skulk, waveComposition } from './enemies';
import { Boar, Swarm } from './wildlife';
import { SLOT_GAP, Warband } from './regiment';
import { hostSize, hostCounts } from './host';
import { rollLoot, lootTier, danger, enemyDrop } from './loot';
const BATTLE_BIG_TEST = 20;
import { WARREN, SOLDIER_CAP_PER_LEVEL, PLAINS } from './config';
import { TILE, COLS, ROWS, WALL_HEIGHT, HAUL, TOWER, ORDER, p, BUILDING_HP, WRECKER, DISMANTLE, DEFENSE_COST, COST, FOODS, FOOD_KINDS, DIET_CAP, ITEM, BOAR, GNOME_HOME, GNOME_PACK, RECIPES, DISHES, CROP_KINDS, zeroFood, TROLL, HIVE, SKULK, STASH_SLOTS, WEAPONS, YARD, CALLINGS, TREE_RESERVE, MOODS, SERVE_RANGE, POT_INGREDIENTS, BODY } from './config';

const scene = () => (window as unknown as { game: { scene: { scenes: VillageScene[] } } }).game.scene.scenes[0];
const output = document.getElementById('test-results')!, summary = document.getElementById('test-summary')!;
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); output.textContent += `PASS ${message}\n`; };
/** `wild` keeps the boars, `trolls` keeps the trolls, `hives` keeps the beehives — both wander into timed checks otherwise, and a troll fights back. */
function fresh(wild = false, trolls = false, hives = false, skulks = false, thickets = false): VillageScene {
  const s = scene(); s.reset(42); s.screen = 'playing'; s.paused = true; s.wood = 150; s.food = 150; s.fx.length = 0;
  for (const tool of IMPLEMENTS) { if (!s.player.pack.hasTool(tool)) s.player.pack.put({ kind: 'tool', tool }); s.foundTools.add(tool); } // the checks work with the whole kit
  s.world.mowAll(); // mown: the checks below time walks; the long grass checks raise it where they need it (mowAll keeps world.tallCount honest)
  if (!wild) { for (const a of s.agents) if (a instanceof Boar) a.dead = true; s.sounders = []; } // no stray sounder wanders into a check
  if (!trolls) for (const a of s.agents) if (a instanceof Troll) a.dead = true; // nor a troll, which would fight back
  if (!hives) s.world.hives.clear(); // nor a hive over a check that walks somebody past it
  if (!skulks) for (const a of s.agents) if (a instanceof Skulk) a.dead = true; // nor a skulk that crept out during an earlier check
  if (!thickets) for (const q of s.world.find((t) => t.kind === 'thicket')) s.world.set(q.tx, q.ty, 'grass'); // nor thorns under a walk
  for (const c of s.camps) for (const m of c.members) m.dead = true; // nor a raider camp out in the wild
  s.camps = [];
  s.removeDead();
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
/** Let thrown things fly, bounce and settle. */
function settle(s: VillageScene, seconds = 6) { for (let i = 0; i < seconds * 60; i++) s.world.tickItems(1 / 60); }
/** Roll every house for births `rolls` times (p.birthEvery seconds apart) and return how many were born. */
function births(s: VillageScene, rolls: number): number {
  const n = s.villagers().length;
  for (let i = 0; i < rolls; i++) { s.simTime += p.birthEvery; s.tickBirths(); }
  return s.villagers().length - n;
}
/**
 * Roll for a birth until one takes, up to `rolls` times, and report how many were born. birthChance is
 * capped at 0.95 however high the slider goes, so a single roll is never a promise.
 */
function bornIn(s: VillageScene, rolls: number): number {
  for (let i = 0; i < rolls; i++) { const n = births(s, 1); if (n) return n; }
  return 0;
}
/** Like step(), but through the scene's own tick — for what the scene does per frame rather than what agents do. */
function ticks(s: VillageScene, seconds: number) {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) { s.grid.rebuild(s.agents); s.tick(1 / 60); }
}
function step(s: VillageScene, seconds: number) {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) { s.grid.rebuild(s.agents); for (const a of [...s.agents]) if (!a.dead) a.update(1 / 60, s); s.world.tickItems(1 / 60); s.removeDead(); }
}
document.getElementById('run-checks')!.addEventListener('click', () => {
  output.textContent = ''; summary.textContent = 'Running';
  const savedAdaptiveSpawns = p.adaptiveSpawns, savedGnomeStart = p.gnomeStart, savedForge = p.forgeMaxTier, savedDrop = p.dropChance;
  p.forgeMaxTier = 3; p.dropChance = 0; // the old forge checks forge every tier, and no stray gear drop lands in a counted pile
  p.gnomeStart = false; // the checks below are laid out on the village start (the game starts gnomes by default)
  try {
    p.adaptiveSpawns = false; // Legacy timed scenarios isolate their own enemies.
    assert(COLS * ROWS > 80 * 44 * 10, 'world is over ten times the old area');
    runPackChecks(scene(), assert);
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
    const gate = w.get(6, 10)!.defense!; w.setGateOpen(gate, true);
    assert(w.bfs({ tx: 6, ty: 12 }, { tx: 6, ty: 6 }, true).length > 0, 'open gate lets enemies through'); w.setGateOpen(gate, false);
    assert(w.bfs({ tx: 6, ty: 12 }, { tx: 6, ty: 6 }, true).length === 0 && w.bfs({ tx: 6, ty: 12 }, { tx: 7, ty: 6 }, true).length === 0, 'a failed search is remembered for the region until walkability changes');
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
    // barracks tower: fires from its own chest at raiders in range, falls silent when dry, restocks for wood
    s = fresh(); s.agents = [s.player]; Object.assign(s.player, { x: -500, y: -500 });
    const keep = s.world.barracks[0], kc = s.towerCenter(keep);
    for (let y = keep.ty - 8; y < keep.ty + 12; y++) for (let x = keep.tx - 8; x < keep.tx + 12; x++) if (s.world.get(x, y)?.kind === 'tree') s.world.set(x, y, 'grass');
    assert(keep.ammo === p.towerStart && s.towerCap(keep) === p.towerCap, 'a fresh barracks starts with a part-filled chest');
    const foe = s.spawn(new Raider(kc.x + 90, kc.y)); foe.speed = 0; foe.hp = foe.maxHp = 1000;
    const towerStep = (sec: number) => { for (let i = 0; i < Math.ceil(sec * 60); i++) { s.grid.rebuild(s.agents); for (const a of [...s.agents]) if (!a.dead) a.update(1 / 60, s); s.tickTowers(1 / 60); s.removeDead(); } };
    towerStep(4);
    const shots = p.towerStart - keep.ammo!;
    assert(shots >= 2 && foe.hp <= foe.maxHp - shots * s.towerDmg(keep) + s.towerDmg(keep), `the tower shot ${shots} arrows and they landed (raider at ${foe.hp} HP)`);
    keep.ammo = 0; const silent = foe.hp; towerStep(3);
    assert(foe.hp === silent, 'an empty chest fires nothing');
    s.wood = 1; assert(!s.restockTower(keep) && keep.ammo === 0, 'restocking needs wood');
    s.wood = 10; assert(s.restockTower(keep) && keep.ammo === TOWER.restockArrows && s.wood === 10 - TOWER.restockWood, 'restocking trades wood for tower arrows');
    keep.ammo = s.towerCap(keep) - 3; s.restockTower(keep);
    assert(keep.ammo === s.towerCap(keep) && !s.restockTower(keep), 'the chest fills to its cap and refuses more');
    foe.dead = true; s.removeDead();
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
      s.world.set(building.tx, building.ty, 'grass'); assert(s.world.get(building.tx, building.ty)!.building === building, `${kind}: building tiles never change`);
    }
    // buildings take damage; a ruin keeps its footprint and does nothing until the hammer rebuilds it
    s = fresh(); clearing(s);
    for (const kind of ['house', 'barracks', 'granary', 'woodyard', 'tavern', 'gnomehouse'] as BuildingKind[]) {
      const b = s.world.buildings.find(q => q.kind === kind) ?? s.world.place(kind, kind === 'gnomehouse' ? 130 : 135, 95);
      assert(b.hp === BUILDING_HP[kind][1] && b.maxHp === b.hp && b.hp > 0, `${kind}: starts at its Lv1 hit points`);
    }
    assert(s.world.lair && !s.damageBuilding(s.world.lair, 999) && !s.world.lair.ruined, 'the lair cannot be hurt');
    const home = s.world.houses[0], tenant = s.spawn(new Villager(0, 0, home, 'farmer', 20, 'Tenant', s.mods));
    tenant.hidden = true; tenant.indoors = home; Object.assign(tenant, World.center(home.tx + 1, home.ty + 1));
    assert(!s.damageBuilding(home, 100) && home.hp === BUILDING_HP.house[1] - 100 && !home.ruined, 'a blow takes hit points without wrecking');
    assert(s.damageBuilding(home, 999) && home.ruined && home.hp === 0, 'enough blows reduce a house to a ruin');
    assert(!tenant.hidden && !tenant.indoors && !s.world.isBlocked(tenant.tile.tx, tenant.tile.ty), 'a ruined roof puts whoever was inside back on the street');
    assert(s.beds(home) === 0 && s.nearestShelter(home.tx * 16, home.ty * 16) !== home, 'a ruined house has no beds and shelters nobody');
    s.interior.enter(home); assert(!s.interior.active, 'you cannot walk into a ruin');
    const keepB = s.world.barracks[0]; s.damageBuilding(keepB, 9999);
    assert(keepB.ruined && s.world.barracks.length === 0 && s.world.allBarracks.length === 1, 'a ruined barracks sponsors, fires and forges nothing');
    s.wood = 1; assert(!s.repairBuilding(home) && home.ruined, 'rebuilding needs the wood');
    s.wood = 20; assert(s.repairBuilding(home) && !home.ruined && home.hp === home.maxHp && s.wood === 20 - s.rebuildCost(home), 'the hammer raises a ruin for half its build cost');
    home.hp = home.maxHp - 100; s.wood = 5; assert(s.repairBuilding(home) && home.hp === home.maxHp - 40 && s.wood === 4, 'a wood mends 60 HP');
    s.repairBuilding(keepB);
    // the Wrecker: walks past people to the nearest reachable house; walled off, it batters the wall slowly
    assert(waveComposition(1).wrecker === 0 && waveComposition(4).wrecker === 2, 'wreckers join from the second wave');
    s = fresh(); clearing(s); s.agents = [s.player]; Object.assign(s.player, { x: -400, y: -400 });
    const target = s.world.place('house', 122, 100), bystander = s.spawn(new Villager(0, 0, target, 'farmer', 20, 'Bystander', s.mods));
    Object.assign(bystander, World.center(129, 100)); bystander.speed = 0; bystander.update = () => {};
    const wrecker = s.spawn(new Wrecker(World.center(132, 100).x, World.center(132, 100).y));
    assert(wrecker.maxHp === WRECKER.hp && wrecker.kind === 'wrecker', 'wrecker stats');
    step(s, 3); assert(wrecker.prey === target && wrecker.task.startsWith('wrecking') && target.hp < target.maxHp, `the wrecker heads for the house and starts pounding it (${target.hp}/${target.maxHp})`);
    assert(bystander.hp === bystander.maxHp, 'it walks straight past the villager in its way');
    step(s, 20); assert(target.ruined, 'a lone wrecker levels a Lv1 house in about 16 seconds');
    s = fresh(); fort(s); s.agents = [s.player]; Object.assign(s.player, { x: -400, y: -400 });
    for (const q of s.world.villageBuildings) s.damageBuilding(q, 99999); // nothing standing outside the fort to go for instead
    const inner = s.world.place('house', 121, 98);
    const outside = s.spawn(new Wrecker(World.center(125, 109).x, World.center(125, 109).y));
    step(s, 6);
    const chipped = [...s.world.defenses.values()].find(d => d.hp < d.maxHp);
    assert(inner.hp === inner.maxHp && !!chipped && outside.task === 'battering the wall', `walled in, the house is untouched while the wrecker chips at the wall (${chipped?.hp}/${chipped?.maxHp})`);
    assert(chipped!.maxHp - chipped!.hp <= p.wreckerWallDmg * 6, 'a wrecker is far slower at walls than a brute');
    // weapons: everyone starts crude and forges up at the chest; raids come in big bands
    s = fresh(); clearing(s); s.agents = [s.player]; Object.assign(s.player, World.center(121, 100)); s.player.facing = { x: 1, y: 0 }; s.player.tool = 'sword';
    const dummy = s.spawn(new Raider(s.player.x + 16, s.player.y)); dummy.speed = 0; dummy.hp = dummy.maxHp = 1000; dummy.update = () => {};
    const swingAt = () => { s.player.pressAttack(); step(s, 0.6); return dummy.maxHp - dummy.hp; };
    assert(s.player.weapons.melee === 0 && s.player.weapons.bow === 0, 'the head starts with a club and a hunting bow');
    const clubHit = swingAt(); assert(clubHit === 6, `a club hits for half (${clubHit})`);
    s.wood = 7; assert(!s.craftWeapon(s.player, 'melee') && s.player.weapons.melee === 0, 'forging needs the wood');
    s.wood = 8; assert(s.craftWeapon(s.player, 'melee') && s.player.weapons.melee === 1 && s.wood === 0, 'a bronze sword costs 8 wood');
    dummy.hp = dummy.maxHp; const bronzeHit = swingAt(); assert(bronzeHit === 9, `bronze hits for three quarters (${bronzeHit})`);
    s.wood = 100; s.scrap = 100; assert(s.weaponProblem(s.player, 'melee') === 'needs a Lv2 barracks', 'iron waits on a Lv2 barracks');
    const sworn = s.spawn(new Villager(0, 0, s.world.houses[0], 'soldier', 20, 'Sworn', s.mods));
    assert(sworn.weapons.melee === 0 && s.craftWeapon(sworn, 'bow') && sworn.weapons.bow === 1, 'soldiers start crude and can be forged for too');
    assert(s.towerDmg(s.world.barracks[0]) === p.towerDmg && p.towerDmg === 5, 'a Lv1 tower fires light arrows');
    // the dodge roll: a committed tumble on a cooldown, the way you are moving or facing
    s = fresh(); clearing(s); s.agents = [s.player]; Object.assign(s.player, World.center(121, 100));
    const keysOff = () => ({ W: { isDown: false }, A: { isDown: false }, S: { isDown: false }, D: { isDown: false } });
    const cooled = () => { step(s, p.rollCd + 0.05); };
    s.player.keys = { ...keysOff(), D: { isDown: true } };
    const rx = s.player.x, ry = s.player.y;
    assert(!!s.player.pressRoll() && !!s.player.roll, 'the head takes a roll');
    s.player.keys = keysOff(); // let go: the roll is committed, and walking on would muddy the measurement
    step(s, p.rollTime + 0.05);
    const rolled = s.player.x - rx;
    assert(!s.player.roll && Math.abs(rolled - p.rollDist) < 0.5 && Math.abs(s.player.y - ry) < 0.01, `a roll carries exactly ${p.rollDist} px the way you press (${rolled.toFixed(1)})`);
    assert(!s.player.pressRoll(), 'no second roll while the cooldown runs');
    cooled();
    assert(!!s.player.pressRoll(), 'the roll comes back once the cooldown is up');
    step(s, p.rollTime + 0.05);
    // standing still, it goes the way you face
    cooled(); s.player.keys = keysOff(); s.player.facing = { x: 0, y: 1 };
    const fy = s.player.y, fx = s.player.x;
    s.player.pressRoll(); step(s, p.rollTime + 0.05);
    assert(s.player.y - fy > p.rollDist * 0.8 && Math.abs(s.player.x - fx) < 0.01, 'standing still, the head rolls the way it faces');
    // a swing is a commitment: no rolling out of it
    cooled(); s.player.tool = 'sword'; s.player.pressAttack();
    assert(!!s.player.swing && !s.player.pressRoll(), 'no rolling out of a swing');
    step(s, 0.6); cooled();
    // walls still stop it, and the head never ends up inside one
    Object.assign(s.player, World.center(121, 100)); s.world.placeDefense('wall', 123, 100);
    s.player.keys = { ...keysOff(), D: { isDown: true } };
    s.player.pressRoll(); step(s, p.rollTime + 0.05);
    assert(s.player.fits(s.player.x, s.player.y, s.world) && s.player.tile.tx < 123, `a roll stops at a wall instead of going through it (tx ${s.player.tile.tx})`);
    // the payoff: rolling out of a wind-up beats the blow, because the strike re-checks its reach
    s = fresh(); clearing(s); s.agents = [s.player]; Object.assign(s.player, World.center(121, 100));
    s.player.keys = { ...keysOff(), A: { isDown: true } }; // roll away from him, not past him
    const ambush = s.spawn(new Brute(s.player.x + 10, s.player.y)); ambush.update = () => {};
    ambush.startAttack(s, s.player, 24, 30, 0.3, 0.4);
    const hpBeforeRoll = s.player.hp;
    s.player.pressRoll(); step(s, p.rollTime + 0.02);
    ambush.attackTick(0.31, s);
    assert(s.player.hp === hpBeforeRoll && s.fx.some(e => e.kind === 'miss'), 'a roll out of the wind-up beats the brute\'s blow');
    s = fresh(); s.agents = [s.player]; s.day = p.firstRaidDay; s.spawnRaid();
    const wave1 = s.agents.filter(a => a instanceof Raider && !a.lairBound);
    assert(wave1.length === hostSize(p.firstRaidDay) && s.raidActive && s.hosts[0]?.state === 'marching', `the first raid is a host of ${wave1.length} (hostBase ${p.hostBase}), marching`);
    s = fresh(); s.agents = [s.player]; s.day = p.firstRaidDay + 3; s.spawnRaid();
    const kinds = s.agents.filter((a): a is Raider => a instanceof Raider).map(a => a.kind);
    const want = hostCounts(hostSize(s.day)), count = (k: string) => kinds.filter((q) => q === k).length;
    assert((['raider', 'brute', 'shaman', 'rat', 'wrecker', 'snatcher'] as const).every((k) => count(k) === want[k]), `a host is made by its mix (${(['raider', 'brute', 'shaman', 'rat', 'wrecker', 'snatcher'] as const).map((k) => `${count(k)} ${k}`).join(', ')})`);
    // the Ogre: asleep and hidden by day, out at night, home at dawn with a quarter of his health back; never counts as a raid
    s = fresh(); s.agents = [s.player, s.ogre!]; const ogre = s.ogre!;
    assert(ogre instanceof Ogre && ogre.hidden && ogre.state === 'sleeping' && ogre.lairBound && ogre.huge, 'the Ogre starts asleep and hidden in his lair');
    Object.assign(s.player, World.center(COLS / 2, ROWS / 2)); s.dayTime = 0.86; step(s, 2);
    assert(!ogre.hidden && ogre.state === 'roaming', 'the Ogre comes out at night');
    ogre.hp = 300; s.dayTime = 0.3; step(s, 20);
    assert(ogre.hidden && ogre.state === 'sleeping' && ogre.hp === 450, 'the Ogre goes home at dawn and heals a quarter');
    assert(!s.agents.some(a => a instanceof Raider && !a.lairBound), 'the Ogre does not count toward an active raid');
    Object.assign(s.player, { x: ogre.x, y: ogre.y + 40 }); s.player.hp = s.player.maxHp = 500; s.dayTime = 0.86; step(s, 3);
    assert(ogre.state === 'hunting' && s.player.hp <= s.player.maxHp - 25, 'the Ogre hunts a player near his lair at night and hits for 25');
    // once roused he never sleeps again: dawn comes and he stays out, unhealed, still hunting
    assert(ogre.aggroed && ogre.lastMove === 'swing', 'the first target rouses the Ogre for good, and first contact is the wide swing');
    const awakeHp = ogre.hp; Object.assign(s.player, World.center(5, 5)); s.dayTime = 0.3; step(s, 20);
    assert(!ogre.hidden && ogre.state === 'hunting' && ogre.hp === awakeHp, 'a roused Ogre ignores the dawn and never goes home to heal');
    // a stationary farmer for him to hit
    const straw = (s: VillageScene, tx: number, ty: number) => { const v = s.spawn(new Villager(0, 0, s.world.houses[0], 'farmer', 20, `Straw ${tx}`, s.mods)); Object.assign(v, World.center(tx, ty)); v.update = () => {}; return v; };
    const rouse = (s: VillageScene, tx: number, ty: number) => { const o = s.ogre!; o.state = 'roaming'; o.hidden = false; o.aggroed = true; Object.assign(o, World.center(tx, ty)); s.dayTime = 0.86; return o; };
    // wide swing: everyone in the half-circle in front of him, nobody behind
    s = fresh(); clearing(s); s.agents = [s.player, s.ogre!]; Object.assign(s.player, World.center(5, 5));
    const og = rouse(s, 120, 100); og.cd.smash = og.cd.charge = 99;
    const front1 = straw(s, 122, 100), front2 = straw(s, 122, 101), behind = straw(s, 118, 100);
    step(s, 2);
    assert(og.lastMove === 'swing' && front1.hp < front1.maxHp && front2.hp < front2.maxHp && behind.hp === behind.maxHp, 'the wide swing hits both villagers in front and misses the one behind');
    // ground smash: a crowd draws it; it bruises the wall segments under the shockwave
    s = fresh(); fort(s); s.agents = [s.player, s.ogre!]; Object.assign(s.player, World.center(5, 5));
    const og2 = rouse(s, 125, 107); og2.cd.charge = 99;
    const c1 = straw(s, 124, 107), c2 = straw(s, 126, 107);
    const seg = s.world.get(124, 105)!.defense!, segHp = seg.hp;
    step(s, 3);
    assert(og2.lastMove === 'smash' && c1.hp < c1.maxHp && c2.hp < c2.maxHp && seg.hp < segHp, `the ground smash hits the crowd and cracks the wall beside him (${seg.hp}/${segHp})`);
    // charge: closes eight tiles in a straight rush and bowls the target over
    s = fresh(); clearing(s); s.agents = [s.player, s.ogre!];
    const og3 = rouse(s, 120, 100); Object.assign(s.player, World.center(128, 100)); s.player.hp = s.player.maxHp = 500;
    const x0 = og3.x, hp0 = s.player.hp;
    step(s, 0.7); assert(og3.move?.kind === 'charge', 'at eight tiles the Ogre charges');
    step(s, 2.5); assert(og3.lastMove === 'charge' && og3.x - x0 > 80 && s.player.hp < hp0, `the charge closes the distance (${((og3.x - x0) / 16).toFixed(1)} tiles) and hits`);
    // charge into a gate: no path in, so he rushes it anyway; the gate takes a heavy blow and he is left dazed
    s = fresh(); fort(s); s.agents = [s.player, s.ogre!];
    const og4 = rouse(s, 125, 110); Object.assign(s.player, World.center(125, 100)); s.player.hp = s.player.maxHp = 500;
    const bar = s.world.get(125, 105)!.defense!, barHp = bar.hp;
    step(s, 2);
    assert(og4.task === 'dazed' && bar.hp < barHp, `a charge into the barred gate batters it (${bar.hp}/${barHp}) and leaves him dazed`);
    // hauling: nothing counts until it's carried to the woodyard / granary
    s = fresh(); clearing(s); s.agents = [s.player, s.ogre!]; s.wood = 0; s.food = 0;
    for (const b of s.hearthBuildings()) b.firewood = p.hearthNights; // full piles, so this armful is for the woodyard
    const yard = s.world.woodyard!, yd = doorstep(yard);
    s.world.set(yd.tx, yd.ty + 3, 'tree'); s.world.set(yd.tx, yd.ty + 4, 'tree');
    const cutter = s.spawn(new Villager(...Object.values(World.center(yd.tx + 1, yd.ty + 3)) as [number, number], s.world.houses[0], 'woodcutter', 22, 'Haul tester', s.mods));
    step(s, 6);
    assert(cutter.load?.kind === 'wood' && cutter.load.n >= p.treeYield && s.wood === 0, 'a chopped tree goes into the woodcutter\'s arms, not the stockpile');
    step(s, 20);
    assert(s.wood >= p.treeYield, 'the woodcutter carries the wood to the woodyard and the stockpile takes it');
    Object.assign(s.player, World.center(yd.tx + 3, yd.ty + 8)); s.player.tool = 'axe'; s.player.facing = { x: 0, y: -1 }; s.hoverTile = null;
    s.world.set(yd.tx + 3, yd.ty + 7, 'tree'); const w0 = s.wood;
    for (let i = 0; i < 3; i++) s.interact();
    assert(s.player.pack.bulk()[0]?.kind === 'wood' && s.player.pack.bulk()[0].n === p.playerTreeYield && s.wood === w0, 'the head\'s chop clears the tree for a token of wood');
    clearBulk(s); s.player.pickUp('wood', STACK.wood); while(!s.player.pack.full)s.player.pack.put({kind:'tool',tool:'axe'}); s.world.set(yd.tx + 3, yd.ty + 7, 'tree'); s.interact();
    assert(s.world.get(yd.tx + 3, yd.ty + 7)!.kind === 'tree' && s.hint().includes('full'), 'full arms refuse another tree and say so');
    Object.assign(s.player, World.center(yd.tx, yd.ty)); s.tick(1 / 60);
    assert(!s.player.pack.bulk().length && s.wood === w0 + HAUL.player.wood, 'walking up to the woodyard unloads the head\'s arms');
    // taking things down: a sound wall comes down after a few hammer blows for half its cost; a hurt one is mended first
    s = fresh(); clearing(s); s.agents = [s.player]; s.wood = 50;
    Object.assign(s.player, World.center(121, 100)); s.player.tool = 'hammer'; s.player.facing = { x: 1, y: 0 }; s.hoverTile = null;
    const seg2 = s.world.placeDefense('wall', 122, 100)!; seg2.hp -= p.wallRepair;
    let w1 = s.wood; s.interact();
    assert(seg2.hp === seg2.maxHp && s.wood === w1 - 1 && s.world.get(122, 100)!.defense === seg2, 'the hammer mends a hurt wall instead of taking it down');
    w1 = s.wood; for (let i = 0; i < DISMANTLE.hits - 1; i++) s.interact();
    assert(s.world.get(122, 100)!.defense === seg2 && s.hint().includes('take down'), 'a sound wall stands until the last hammer blow, and the hint counts them');
    s.interact();
    assert(!s.world.get(122, 100)!.defense && s.world.get(122, 100)!.kind === 'grass' && s.wood === w1 + Math.round(DEFENSE_COST.wall * DISMANTLE.refund), 'the last blow takes the wall down and returns half its wood');
    // demolishing a house: tenants move to another house, anyone inside steps out, half the wood spent comes back
    s = fresh(); clearing(s); s.agents = [s.player]; s.wood = 50;
    const spare = s.world.place('house', 122, 100), old = s.world.houses.find((h) => h !== spare)!;
    const tenant2 = s.spawn(new Villager(0, 0, old, 'farmer', 20, 'Tenant', s.mods)); old.residents++; Object.assign(tenant2, World.center(125, 100));
    tenant2.hidden = true; tenant2.indoors = old;
    const before2 = s.wood, oldRes = old.residents;
    assert(s.demolishProblem(old) === null && s.demolishRefund(old) === Math.round(COST.house * DISMANTLE.refund), 'a house with another house standing can be demolished for half its build cost');
    assert(s.demolish(old), 'the house comes down');
    assert(!s.world.buildings.includes(old) && s.world.get(old.tx, old.ty)!.kind === 'grass' && !s.world.get(old.tx, old.ty)!.building, 'its footprint is grass again');
    assert(tenant2.home === spare && spare.residents === 1 && old.residents === oldRes - 1 && !tenant2.hidden && !tenant2.indoors, 'the tenant moves to the other house and steps outside');
    assert(s.wood === before2 + Math.round(COST.house * DISMANTLE.refund), 'half the wood comes back');
    assert(s.demolishProblem(spare) !== null && !s.demolish(spare), 'the last house cannot be demolished while someone lives in it');
    // a woodcutter walled in with the trees outside doesn't stand there "looking for a tree" forever with wood on his back
    s = fresh(); s.agents = [s.player]; Object.assign(s.player, World.center(5, 5)); s.wood = 0;
    for (const b of s.hearthBuildings()) b.firewood = p.hearthNights;
    const yd2 = doorstep(s.world.woodyard!), bx = yd2.tx, by = yd2.ty + 5;
    for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) if (s.world.get(bx + dx, by + dy)?.kind === 'tree') s.world.set(bx + dx, by + dy, 'grass');
    s.world.set(bx, by, 'tree').stage = 99; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) s.world.placeDefense('wall', bx + dx, by + dy); // a tree boxed in by walls: the nearest, and unreachable
    const trapped = s.spawn(new Villager(World.center(bx, by - 3).x, World.center(bx, by - 3).y, s.world.houses[0], 'woodcutter', 22, 'Penned', s.mods));
    trapped.load = { kind: 'wood', n: 12 };
    step(s, 10);
    assert(s.wood >= 12 && s.world.get(bx, by)!.kind === 'tree' && !(trapped.goal?.tx === bx && trapped.goal?.ty === by), `a woodcutter whose first-choice tree is unreachable brings his armful in and moves on (${trapped.task})`);
    // hearths: piles burn a night at dawn, cold buildings stall, woodcutters bring firewood before logs
    s = fresh(); clearing(s); s.agents = [s.player]; Object.assign(s.player, { x: -400, y: -400 }); s.day = 1; s.dayTime = 0.3;
    const home2 = s.world.houses[0], keep2 = s.world.barracks[0];
    assert(home2.firewood === 1 && keep2.firewood === 1 && s.world.woodyard!.firewood === 0 && home2.warm, 'new buildings come with one night of wood; storage has no hearth');
    const cost0 = hearthCost(home2); s.wood = 100;
    s.newDay(); assert(home2.firewood === 0 && home2.warm && keep2.warm, 'dawn burns a night and the building stays warm');
    const parent1 = s.spawn(new Villager(0, 0, home2, 'farmer', 20, 'Ma', s.mods)), parent2 = s.spawn(new Villager(0, 0, home2, 'farmer', 20, 'Pa', s.mods));
    parent1.update = parent2.update = () => {}; home2.residents = 2;
    const kid2 = s.spawn(new Villager(0, 0, home2, 'kid', 5, 'Sprout', s.mods)); kid2.update = () => {}; kid2.parents = [parent1, parent2]; kid2.hungerDays = 0; kid2.ateDay = 99; // fed from a pen every day, for the care sums
    kid2.trained = 0; home2.residents = 3;
    const careBefore = kid2.care, trainedBefore = kid2.trained; s.food = 200;
    s.newDay();
    assert(!home2.warm && !keep2.warm, 'an empty pile leaves the building cold the next dawn');
    // fed +1, well fed from the yard +1 and two parents +1 would make 3; the cold night takes one back
    assert(kid2.care - careBefore === 2, `a cold night costs the child a care point (${kid2.care - careBefore} instead of 3)`);
    assert(kid2.trained === trainedBefore, 'a child promised nothing trains nowhere');
    const cadet = s.spawn(new Villager(World.center(123, 98).x, World.center(123, 98).y, home2, 'kid', 1, 'Cadet', s.mods)); cadet.calling = 'soldier'; cadet.ateDay = s.day; cadet.mealAt = 1e9; home2.residents = 4;
    step(s, 2); assert(cadet.trained === 0, 'a cold barracks drills nobody');
    assert(births(s, 25) === 0, 'no children are born in a cold house');
    s.wood = 1; assert(!s.stockHearth(home2) && home2.firewood === 0, 'stocking a hearth needs the wood');
    s.wood = 50; assert(s.stockHearth(home2) && home2.firewood === 1 && s.wood === 50 - cost0, `a night of wood costs ${cost0} from the village pile`);
    s.stockHearth(home2); s.stockHearth(home2); assert(home2.firewood === p.hearthNights && !s.stockHearth(home2), 'the pile holds three nights and no more');
    cadet.ateDay = s.day; s.newDay(); assert(home2.warm && !keep2.warm, 'a stocked house is warm again while the barracks stays cold');
    step(s, 2); assert(cadet.trained === 0, 'still no drill while the barracks is cold');
    const soldier2 = s.spawn(new Villager(World.center(125, 100).x, World.center(125, 100).y, home2, 'soldier', 20, 'Guard', s.mods)); soldier2.hp = 10; soldier2.trained = 3;
    s.mods.soldierRegen = 5; step(s, 2); assert(soldier2.hp === 10, 'soldiers do not mend while the barracks is cold');
    keep2.firewood = 1; cadet.ateDay = s.day; s.newDay(); step(s, 2); assert(soldier2.hp > 10, 'a warm barracks mends them again');
    assert(cadet.trained > 0 && Math.abs(cadet.trained - 2 / (p.dayLength * 0.52)) < 0.01, `a fed child promised a sword drills by the waking hour once the barracks is warm (${cadet.trained.toFixed(3)} days after 2 s)`);
    cadet.dead = true; s.removeDead();
    for (const b of s.hearthBuildings()) b.firewood = p.hearthNights;
    const cabin = s.world.place('house', 122, 96); cabin.firewood = 0; // the one empty pile in the village, in the clearing
    const carrier = s.spawn(new Villager(World.center(124, 104).x, World.center(124, 104).y, home2, 'woodcutter', 22, 'Carrier', s.mods));
    carrier.load = { kind: 'wood', n: HAUL.villager.wood }; const woodBefore = s.wood;
    step(s, 1); assert(carrier.task === 'bringing firewood to the house', `a loaded woodcutter heads for the empty pile first (${carrier.task})`);
    step(s, 30);
    // (the cutter goes straight back to the grove afterwards, so the pile may have grown further by now)
    assert(cabin.firewood === Math.min(p.hearthNights, Math.floor(HAUL.villager.wood / hearthCost(cabin))) && s.wood >= woodBefore + HAUL.villager.wood - cabin.firewood * hearthCost(cabin), `the pile takes ${cabin.firewood} nights and the rest reaches the woodyard`);
    // Baby Fever: births surge while the larder holds a surplus; more mouths eat the surplus away
    s = fresh(); clearing(s); s.agents = [s.player]; Object.assign(s.player, { x: -400, y: -400 });
    const nest = s.world.houses[0]; nest.firewood = p.hearthNights; nest.warm = true;
    const ma = s.spawn(new Villager(0, 0, nest, 'farmer', 20, 'Ma', s.mods)), pa = s.spawn(new Villager(0, 0, nest, 'farmer', 20, 'Pa', s.mods));
    ma.update = pa.update = () => {}; nest.residents = 2;
    s.mods.babyFever = false; s.food = 40;
    assert(Math.abs(s.surplusDays() - 20) < 0.01 && !s.feverActive() && s.birthChance(nest) === p.birthChance, 'without the boon the larder is just a number and births stay at the base chance');
    s.mods.babyFever = true;
    assert(s.feverActive() && Math.abs(s.birthChance(nest) - (p.birthChance + p.feverBonus)) < 1e-9, `with Baby Fever and ${s.surplusDays()} days of food, births run at ${Math.round(100 * s.birthChance(nest))}%`);
    s.food = 2 * p.feverDays - 1; assert(!s.feverActive() && s.birthChance(nest) === p.birthChance, 'below the surplus line the fever breaks and births fall back to normal');
    const dawns = 30, tally = (fever: boolean) => { s.reset(7); s.screen = 'playing'; s.paused = true; s.agents = [s.player]; Object.assign(s.player, { x: -400, y: -400 }); const h = s.world.houses[0]; h.firewood = 99; const a = s.spawn(new Villager(0, 0, h, 'farmer', 20, 'A', s.mods)), b = s.spawn(new Villager(0, 0, h, 'farmer', 20, 'B', s.mods)); a.update = b.update = () => {}; h.residents = 2; s.mods.babyFever = fever; let born = 0; for (let i = 0; i < dawns; i++) { s.food = 1000; h.firewood = 99; h.warm = true; h.residents = 2; born += births(s, 1); for (const k of s.villagers()) if (k.role === 'infant') k.dead = true; s.removeDead(); } return born; };
    const plain = tally(false), fevered = tally(true);
    assert(fevered > plain, `over ${dawns} well-fed birth rolls the fever brought ${fevered} births against ${plain} without it`);
    // the breeding program: nurseries, callings and their caps, the basket, the stages of life
    s = fresh(); clearing(s); s.agents = [s.player]; Object.assign(s.player, World.center(124, 100)); s.mods.babyFever = false;
    const hearth = s.world.houses[0]; hearth.firewood = 99; hearth.warm = true;
    const mum = s.spawn(new Villager(0, 0, hearth, 'farmer', 20, 'Mum', s.mods)), dad = s.spawn(new Villager(0, 0, hearth, 'farmer', 20, 'Dad', s.mods));
    mum.update = dad.update = () => {}; hearth.residents = 2; s.food = 200;
    const chanceWas = p.birthChance; p.birthChance = 1;
    assert(!s.birthProblem(hearth), `a warm house with a couple, a free crib and food is ready for births (${s.birthProblem(hearth)})`);
    const bornNow = births(s, s.cribs(hearth) + 5);
    const infants = s.infantsOf(hearth);
    assert(bornNow === s.cribs(hearth) && infants.length === s.cribs(hearth) && infants.every((v) => v.role === 'infant' && v.hidden && v.indoors === hearth), `births fill the nursery and stop at ${s.cribs(hearth)} cribs (${bornNow} born)`);
    assert(s.birthProblem(hearth) === 'the nursery is full', 'a full nursery stalls births');
    p.birthChance = chanceWas;
    // every newborn is promised a trade with a place open, and holds that place while it grows
    assert(infants.every((v) => !!v.calling && CALLINGS.includes(v.calling)), `a newborn is promised a calling (${infants.map((v) => v.calling).join(', ')})`);
    assert(CALLINGS.every((c) => s.callingFilled(c) >= infants.filter((v) => v.calling === c).length), 'and an infant already fills its place');
    const first = infants[0]; first.age = p.infantDays; s.tickAges(0);
    assert(first.role === 'kid' && !first.hidden && !!first.calling, `an infant of age ${p.infantDays} walks out of the nursery into the yard (${first.role}, ${first.calling})`);
    assert(s.villagers().filter((v) => v.role === 'infant').length === s.cribs(hearth) - 1 && !s.birthProblem(hearth), 'the crib frees up for the next birth');
    // the basket: fill at the granary, toss into a home's yard
    s.player.tool = 'basket'; clearBulk(s); s.food = 100;
    const g = s.world.granary!; Object.assign(s.player, World.center(g.tx + 1, g.ty + BUILDINGS[g.kind].h)); s.fillBasket();
    const basket = s.player.pack.bulk()[0] as { kind: string; n: number } | null; assert(basket?.kind === 'food' && basket.n === STACK.food && s.food === 100 - STACK.food, 'the basket fills with food from the granary');
    // a throw is a thing in the world: it flies where you point, bounces, rolls and lies where it stops
    // the yard is YARD tiles round the house the children live in: find open ground in it to throw at
    const hc = buildingCenter(hearth), hcx = Math.round(hc.tx), hcy = Math.round(hc.ty);
    const yardSpot = ([[0, 3], [1, 3], [-1, 3], [2, 3], [3, 2], [-3, 2], [0, -3], [3, 0]] as const)
      .map(([dx, dy]) => ({ tx: hcx + dx, ty: hcy + dy }))
      .find((q) => !s.world.isBlocked(q.tx, q.ty)) ?? { tx: hcx, ty: hcy + 3 };
    const standAt = ([[0, 2], [1, 2], [-1, 2], [0, 1], [2, 0], [-2, 0]] as const)
      .map(([dx, dy]) => ({ tx: yardSpot.tx + dx, ty: yardSpot.ty + dy }))
      .find((q) => !s.world.isBlocked(q.tx, q.ty)) ?? yardSpot;
    Object.assign(s.player, World.center(standAt.tx, standAt.ty));
    const aim = World.center(yardSpot.tx, yardSpot.ty); s.hoverPoint = aim;
    const thrown = s.toss()!;
    assert(!!thrown && !thrown.rest && thrown.vz > 0 && thrown.n === p.tossSize && thrown.food === 'wheat' && s.player.pack.bulk()[0].n === STACK.food - p.tossSize, `a throw launches ${p.tossSize} food into the air (aim ${(aim.x/16).toFixed(1)},${(aim.y/16).toFixed(1)} head ${(s.player.x/16).toFixed(1)},${(s.player.y/16).toFixed(1)} house ${hearth.tx},${hearth.ty} centre ${hc.tx},${hc.ty} why ${s.tossProblem(aim)} basket ${s.player.carriedOf("food", s.player.basketKind)})`);
    settle(s);
    assert(thrown.rest && thrown.z === 0 && Math.hypot(thrown.x - aim.x, thrown.y - aim.y) < 1.5 * 16 && s.world.inYard(thrown.x, thrown.y), `it comes down near the aim and lies there (${Math.hypot(thrown.x - aim.x, thrown.y - aim.y).toFixed(0)} px off, in the yard)`);
    s.hoverPoint = { x: aim.x, y: aim.y - (p.tossRange + 3) * 16 }; assert(s.tossProblem() === 'too far to throw', 'the throw has a range');
    for (let x = 121; x <= 125; x++) s.world.placeDefense('wall', x, 94);
    Object.assign(s.player, World.center(123, 97)); s.hoverPoint = World.center(123, 92); const atWall = s.toss()!; settle(s);
    assert(atWall.rest && atWall.y > 95 * 16 && !s.world.isBlocked(Math.floor(atWall.x / 16), Math.floor(atWall.y / 16), true), `a throw at a wall bounces back and never rests inside it (y ${(atWall.y / 16).toFixed(1)})`);
    for (let x = 121; x <= 125; x++) { const d = s.world.get(x, 94)!.defense; if (d) s.world.damageDefense(d, Infinity); }
    s.world.removeItem(atWall); s.hoverPoint = null;
    // G: throw the whole armful, wood or food, with any tool in hand — the only way to put wood down away from the woodyard
    s.player.tool = 'axe'; clearBulk(s); s.player.pickUp('wood',17);
    Object.assign(s.player, World.center(123, 100)); const logAim = World.center(123, 98); s.hoverPoint = logAim;
    const logs = s.tossLoad()!;
    assert(!!logs && logs.kind === 'wood' && logs.n === 17 && !s.player.pack.bulk().length, 'G throws the whole armful of wood, axe in hand');
    settle(s);
    assert(logs.rest && Math.hypot(logs.x - logAim.x, logs.y - logAim.y) < 1.5 * 16, `the logs land near the aim and lie there (${Math.hypot(logs.x - logAim.x, logs.y - logAim.y).toFixed(0)} px off)`);
    assert(s.tossLoad() === null, 'empty-handed, there is nothing to throw');
    clearBulk(s); s.player.pickUp('food',9,'carrot');
    s.hoverPoint = { x: logAim.x, y: logAim.y - (p.tossRange + 3) * 16 };
    const ranged = s.tossLoad(); assert(!!ranged && !s.player.pack.bulk().length, 'G clamps a distant aim to throwing range'); s.world.removeItem(ranged!); s.player.pickUp('food',9,'carrot');
    s.hoverPoint = null; s.player.facing = { x: 0, y: 1 };
    const spill = s.tossLoad()!;
    assert(spill.kind === 'food' && spill.food === 'carrot' && spill.n === 9 && !s.player.pack.bulk().length, 'with no cursor it throws the way you face');
    settle(s); s.world.removeItem(logs); s.world.removeItem(spill); s.player.tool = 'basket';
    // a child walks to food lying in its own yard and eats; what lies beyond it is not theirs
    s.world.removeItem(thrown);
    const strayAt = World.center(hcx + YARD + 6, hcy + YARD + 6); // well clear of every home
    const stray = s.world.dropItem('food', 5, strayAt.x, strayAt.y, 'wheat');
    assert(!s.world.inYard(stray.x, stray.y), 'a pile thrown well clear of every house is in no yard at all');
    Object.assign(first, World.center(yardSpot.tx, yardSpot.ty)); first.mealAt = 0; first.ateDay = 0; s.day = 5;
    step(s, 3); assert(first.ateDay === 0 && first.task === 'hungry — nothing by the house' && stray.n === 5, `a child ignores food lying outside its yard (${first.task})`);
    const mealAt = World.center(yardSpot.tx, yardSpot.ty);
    const meal = s.world.dropItem('food', p.tossSize, mealAt.x + 5, mealAt.y - 3, 'wheat');
    step(s, 6);
    assert(first.ateDay === 5 && Math.abs(meal.n - (p.tossSize - p.kidFood / 2)) < 1e-9, `a hungry child eats half of ${p.kidFood} per meal from food lying in its yard (${meal.n} left, ate day ${first.ateDay})`);
    s.world.removeItem(meal); s.world.removeItem(stray);
    // the sword is the one trade that needs a building: a warm barracks, or no lesson
    first.calling = 'soldier'; first.trained = 0; s.world.barracks[0].firewood = 99; s.world.barracks[0].warm = true; first.mealAt = 1e9;
    step(s, 3); assert(first.trained > 0 && first.hungerDays === 0, 'a fed child at home, with a warm barracks, drills');
    const drilled = first.trained; first.ateDay = 0; s.newDay(); assert(first.hungerDays === 1, 'a day without food from the yard is a hungry day');
    first.mealAt = 0; step(s, 2); assert(first.trained === drilled && first.task === 'hungry — nothing by the house', 'a hungry child with nothing to eat stops training');
    first.update = () => {};
    for (let i = 1; i < p.kidStarveDays && !first.dead; i++) s.newDay();
    assert(first.dead, `${p.kidStarveDays} hungry days starve a child in the yard`);
    s.removeDead();
    // coming of age takes the calling they were promised; old age slows, then ends
    const second = s.infantsOf(hearth)[0]; second.age = p.infantDays; s.tickAges(0); second.update = () => {}; second.calling = 'soldier';
    second.trained = Villager.drillNeeded(s); second.age = s.adultAge; second.ateDay = s.day; s.tickAges(0);
    assert(second.role === 'soldier' && second.skilled && second.isAdult, `a drilled child promised a sword comes of age a skilled soldier (${second.role})`);
    const third = s.infantsOf(hearth)[0]; third.age = p.infantDays; s.tickAges(0); third.update = () => {}; third.calling = 'woodcutter'; third.trained = 0; third.age = s.adultAge; s.tickAges(0);
    assert(third.role === 'woodcutter' && !third.skilled, `an untaught child still comes of age to its trade, just a plain one (${third.role})`);
    const nopen = s.infantsOf(hearth)[0]; nopen.age = p.infantDays; s.tickAges(0); nopen.update = () => {}; nopen.calling = null; nopen.age = s.adultAge + 1; s.tickAges(0);
    assert(nopen.role === 'kid', 'a child promised nothing never comes of age: no place, no trade');
    nopen.dead = true; s.removeDead();
    const speedWas = second.speed; second.age = s.elderAge; s.tickAges(0);
    assert(second.elder && second.speed < speedWas, 'past adultDays a villager grows old and slows');
    second.age = second.deathAt(s); s.tickAges(0); assert(second.dead, 'an elder passes away at the end of elderDays');
    s.removeDead();
    // the callings and their caps: the buildings decide what the village may raise
    s = fresh(); clearing(s); s.agents = [s.player]; s.mods.babyFever = false;
    const cHome = s.world.houses[0]; cHome.firewood = 99; cHome.warm = true;
    const cMum = s.spawn(new Villager(0, 0, cHome, 'farmer', 20, 'CapMum', s.mods)), cDad = s.spawn(new Villager(0, 0, cHome, 'farmer', 20, 'CapDad', s.mods));
    cMum.update = cDad.update = () => {}; cHome.residents = 2; s.food = 500;
    const wasChance = p.birthChance, wasTwins = s.mods.twinChance; p.birthChance = 1; s.mods.twinChance = 0;
    assert(s.callingCap('soldier') === p.soldierCap * s.world.barracks.length && s.callingCap('farmer') === p.farmerCap * 1 && s.callingCap('woodcutter') === p.woodcutterCap * 1,
      `each building keeps its own number in work (${CALLINGS.map((c) => `${c} ${s.callingCap(c)}`).join(', ')})`);
    assert(s.callingFilled('farmer') === 2 && s.callingFilled('soldier') === 0, 'the grown fill their own places');
    // a place is reserved at birth: an infant holds it while it grows
    const filledWas = CALLINGS.map((c) => s.callingFilled(c));
    cHome.nextBirth = 0; // the very first roll on a house only schedules the next one
    assert(bornIn(s, 8) === 1, 'a house with a free place bears a child');
    const baby = s.infantsOf(cHome)[0];
    assert(!!baby.calling && s.callingFilled(baby.calling) === filledWas[CALLINGS.indexOf(baby.calling)] + 1,
      `a newborn takes its place from the cap while it is still an infant (${baby.calling})`);
    // no place anywhere, no child at all
    const capsWere = [p.farmerCap, p.woodcutterCap, p.soldierCap];
    p.farmerCap = p.woodcutterCap = p.soldierCap = 0;
    assert(s.freeCallings().length === 0 && (s.birthProblem(cHome) ?? '').startsWith('no work for another villager'),
      `with every trade full the house says so (${s.birthProblem(cHome)})`);
    assert(births(s, 30) === 0, 'and bears nobody');
    // building room makes children again
    p.soldierCap = 4;
    assert(!s.birthProblem(cHome) && bornIn(s, 8) === 1, `room for a warrior and the house bears one (why ${s.birthProblem(cHome)} · soldier ${s.callingFilled('soldier')}/${s.callingCap('soldier')})`);
    assert(s.infantsOf(cHome).slice(-1)[0].calling === 'soldier', 'promised the only trade with a place');
    // a second barracks doubles the warrior places
    const capOne = s.callingCap('soldier');
    const capBx = s.world.houses[0].tx + 10;
    const second2 = s.world.canBuild('barracks', capBx, 96) ? s.world.place('barracks', capBx, 96) : null;
    assert(!!second2 && s.callingCap('soldier') === capOne * 2, `a second barracks makes room for ${p.soldierCap} more warriors (${s.callingCap('soldier')})`);
    // a ruin keeps nobody in work
    s.world.granary!.ruined = true; p.farmerCap = 5;
    assert(s.callingCap('farmer') === 0, 'a ruined granary closes its farmers\u2019 places');
    s.world.granary!.ruined = false;
    // a death frees the place it held
    const capDoomed = s.infantsOf(cHome).find((v) => v.calling === 'soldier')!;
    const heldBy = s.callingFilled('soldier');
    capDoomed.dead = true; s.removeDead();
    assert(s.callingFilled('soldier') === heldBy - 1, 'a child that dies gives its place back');
    // the emptiest trade by share of its cap: a 5/5/10 village opens farmer, woodcutter, warrior, warrior
    s = fresh(); clearing(s); s.agents = [s.player]; s.mods.babyFever = false; s.mods.twinChance = 0;
    const rHome = s.world.houses[0]; rHome.firewood = 99; rHome.warm = true; s.food = 500;
    const rMum = s.spawn(new Villager(0, 0, rHome, 'farmer', 20, 'RatioMum', s.mods)), rDad = s.spawn(new Villager(0, 0, rHome, 'farmer', 20, 'RatioDad', s.mods));
    rMum.update = rDad.update = () => {}; rHome.residents = 2; rHome.nextBirth = 0; p.birthChance = 1;
    p.farmerCap = 5; p.woodcutterCap = 5; p.soldierCap = 10;
    const order: string[] = [];
    for (let i = 0; i < 4; i++) if (bornIn(s, 8)) order.push(s.villagers()[s.villagers().length - 1].calling ?? '?');
    // the couple already hold 2 of the 5 farmer places, so farming is the fullest trade and waits its turn:
    // picking by free places alone would have promised all four to the barracks (10 open beats 5).
    assert(order.join(',') === 'woodcutter,soldier,soldier,woodcutter', `the emptiest trade by share of its cap goes first (${order.join(', ')})`);
    p.farmerCap = capsWere[0]; p.woodcutterCap = capsWere[1]; p.soldierCap = capsWere[2]; p.birthChance = wasChance; s.mods.twinChance = wasTwins;
    // diet: the pantry keeps kinds apart
    // diet: the pantry keeps kinds apart, crops and wild food have kinds, and what a child eats is who they become
    const held = () => s.player.pack.bulk()[0] as { kind: string; n: number; food?: string } | null;
    s = fresh(); clearing(s); s.agents = [s.player]; Object.assign(s.player, World.center(124, 100));
    for (const k of FOOD_KINDS) s.pantry[k] = 0;
    s.food = 50; assert(s.pantry.wheat === 50 && s.food === 50, 'a plainKid food gain lands in wheat');
    s.addFood(20, 'carrot'); s.addFood(5, 'berry'); assert(s.food === 75 && s.pantry.carrot === 20, 'the granary keeps each kind apart');
    s.food -= 60; assert(s.food === 15 && s.pantry.wheat === 0 && s.pantry.carrot === 10 && s.pantry.berry === 5, `generic spending drains the fullest kind first (${JSON.stringify(s.pantry)})`);
    s.player.tool = 'seeds'; s.player.cropKind = 'carrot'; s.world.set(122, 98, 'tilled'); s.hoverTile = { tx: 122, ty: 98 }; Object.assign(s.player, World.center(122, 99)); s.interact();
    const sown = s.world.get(122, 98)!;
    assert(sown.kind === 'crop' && sown.food === 'carrot' && s.cropDaysOf(sown) === s.cropDays + FOODS.carrot.days, 'seeds sow the chosen crop and it ripens on its own clock');
    sown.stage = 99; clearBulk(s); assert(s.handsAt({ tx: 122, ty: 98 }), 'a ripe crop comes up under your hands, whatever you are holding');
    assert(held()?.food === 'carrot' && held()!.n === s.cropYieldOf('carrot') && s.world.get(122, 98)!.kind === 'tilled' && s.world.get(122, 98)!.food === 'carrot', 'harvesting by hand yields the crop and the soil remembers it');
    const sower = s.spawn(new Villager(World.center(122, 99).x, World.center(122, 99).y, s.world.houses[0], 'farmer', 20, 'Sower', s.mods));
    for (const q of s.world.find(t => t.kind === 'crop' || t.kind === 'tilled')) if (q.tx !== 122 || q.ty !== 98) s.world.set(q.tx, q.ty, 'grass');
    step(s, 6); assert(s.world.get(122, 98)!.kind === 'crop' && s.world.get(122, 98)!.food === 'carrot', `a farmer replants what the soil remembers (${s.world.get(122, 98)!.kind} ${s.world.get(122, 98)!.food})`);
    sower.dead = true; s.removeDead();
    s.world.set(126, 98, 'bush').stage = 99; Object.assign(s.player, World.center(126, 99)); clearBulk(s); s.handsAt({ tx: 126, ty: 98 });
    const bush = s.world.get(126, 98)!;
    assert(held()?.food === 'berry' && held()!.n === FOODS.berry.yield && bush.kind === 'bush' && bush.stage === 0 && !s.wildRipe(bush), 'a ripe bush is picked by hand and starts regrowing');
    const berries = held()!.n; s.interact(); assert(held()?.n === berries, 'a picked bush gives nothing');
    for (let i = 0; i < s.regrowDays('berry'); i++) s.newDay(); assert(s.wildRipe(bush), `a bush bears again after ${s.regrowDays('berry')} days`);
    s.hoverTile = null; clearBulk(s);
    // the basket takes one kind; a child's bites build a diet that freezes at coming of age
    s.player.tool = 'basket'; s.player.basketKind = 'carrot'; s.pantry.carrot = 40;
    const g2 = s.world.granary!; Object.assign(s.player, World.center(g2.tx + 1, g2.ty + BUILDINGS[g2.kind].h)); s.fillBasket();
    assert(held()?.food === 'carrot' && held()!.n === STACK.food && s.pantry.carrot === 40 - STACK.food, 'the basket fills with the chosen kind');
    const yc = buildingCenter(s.world.houses[0]), yx = Math.round(yc.tx), yy = Math.round(yc.ty);
    const dSpot = ([[0, 3], [1, 3], [-1, 3], [2, 3], [3, 2], [-3, 2], [0, -3], [3, 0]] as const)
      .map(([dx, dy]) => ({ tx: yx + dx, ty: yy + dy })).find((q) => !s.world.isBlocked(q.tx, q.ty)) ?? { tx: yx, ty: yy + 3 };
    const dStand = ([[0, 2], [1, 2], [-1, 2], [0, 1], [2, 0], [-2, 0]] as const)
      .map(([dx, dy]) => ({ tx: dSpot.tx + dx, ty: dSpot.ty + dy })).find((q) => !s.world.isBlocked(q.tx, q.ty)) ?? dSpot;
    Object.assign(s.player, World.center(dStand.tx, dStand.ty)); s.hoverPoint = World.center(dSpot.tx, dSpot.ty); const carrots = s.toss()!; s.hoverPoint = null; settle(s);
    assert(carrots.food === 'carrot' && carrots.n === p.tossSize && s.world.inYard(carrots.x, carrots.y), 'a throw carries its kind');
    const carrotAt = World.center(dSpot.tx, dSpot.ty); // where the throw landed: the eater stands on it
    const shroomAt = World.center(dSpot.tx + 2, dSpot.ty); s.world.dropItem('food', 1, shroomAt.x, shroomAt.y, 'mushroom');
    const eater = s.spawn(new Villager(carrotAt.x, carrotAt.y, s.world.houses[0], 'kid', 1, 'Eater', s.mods)); eater.calling = 'farmer'; eater.mealAt = 0; s.day = 9;
    const careWas = eater.care; step(s, 8);
    assert(eater.diet.carrot > 0 && eater.ateDay === 9, `bites go on the diet (${JSON.stringify(eater.diet)})`);
    eater.update = () => {}; eater.diet = zeroFood();
    eater.eatBite('mushroom', 0.5); eater.eatBite('mushroom', 0.5); assert(eater.care === careWas + 1, 'a mushroom meal is worth one care point');
    eater.diet.carrot = p.dietFull; eater.diet.wheat = p.dietFull / 2;
    const live = eater.dietNow(); assert(Math.abs(live.speed - DIET_CAP.speed * p.dietMul) < 1e-9 && Math.abs(live.hp - DIET_CAP.hp * p.dietMul / 2) < 1e-9 && live.work === 0, `the diet projects its bonuses (${JSON.stringify(live)})`);
    const plainKid = s.spawn(new Villager(0, 0, s.world.houses[0], 'kid', 1, 'Plain', s.mods)); plainKid.update = () => {};
    for (const k of [eater, plainKid]) { k.age = s.adultAge; k.calling = 'farmer'; } s.tickAges(0);
    assert(eater.isAdult && plainKid.isAdult && eater.dietBonus.speed === live.speed && eater.speed > plainKid.speed && eater.maxHp > plainKid.maxHp && plainKid.dietBonus.hp === 0, `the diet freezes at coming of age: ${eater.speed.toFixed(1)} vs ${plainKid.speed.toFixed(1)} speed, ${eater.maxHp} vs ${plainKid.maxHp} HP`);
    eater.diet.wheat = 99; assert(eater.dietNow().hp === eater.dietBonus.hp, 'the bonuses of a grown villager no longer move');
    s.removeDead();
    // what the dead were carrying, and what raiders drop, lies where they fell; the head walks over it
    s = fresh(); clearing(s); s.agents = [s.player]; Object.assign(s.player, World.center(124, 100)); s.world.items.length = 0;
    const hauler = s.spawn(new Villager(World.center(130, 100).x, World.center(130, 100).y, s.world.houses[0], 'woodcutter', 20, 'Hauler', s.mods)); hauler.load = { kind: 'wood', n: 9 };
    hauler.hp = 0; hauler.dead = true; s.tick(1 / 60); settle(s);
    const dropped = s.world.items.find((it) => it.kind === 'wood');
    assert(!!dropped && dropped.n === 9 && dropped.rest && Math.hypot(dropped.x - World.center(130, 100).x, dropped.y - World.center(130, 100).y) < 24, 'a villager killed hauling drops the armful where they fell');
    const scrapWas = s.scrap; const orc = s.spawn(new Raider(World.center(134, 100).x, World.center(134, 100).y)); orc.hp = 0; orc.dead = true; s.tick(1 / 60); settle(s);
    const loot = s.world.items.find((it) => it.kind === 'scrap');
    assert(!!loot && loot.n > 0 && s.scrap === scrapWas, 'a slain raider drops scrap on the ground instead of into your pocket');
    Object.assign(s.player, { x: loot!.x, y: loot!.y }); s.player.tool = 'sword'; s.tick(1 / 60);
    assert(s.scrap === scrapWas && s.player.carriedOf('scrap') > 0 && !s.world.items.includes(loot!), 'scrap goes in the pack and must be deposited before forging');
    Object.assign(s.player, { x: dropped!.x, y: dropped!.y }); clearBulk(s); s.player.tool = 'sword'; s.tick(1 / 60);
    assert(held()?.kind === 'wood' && held()!.n === 9 && !s.world.items.includes(dropped!), 'an armful comes along with the sword out — whatever you are holding picks it up');
    for (const tool of ['axe', 'hammer', 'basket', 'sword'] as const) {
      clearBulk(s);
      const armful = s.world.dropItem('wood', 4, s.player.x, s.player.y);
      s.player.tool = tool; s.tick(1 / 60);
      assert(held()?.kind === 'wood' && !s.world.items.includes(armful), `and with the ${tool} too`);
    }
    clearBulk(s);
    const flying = s.world.dropItem('wood', 4, s.player.x, s.player.y);
    flying.rest = false; flying.z = 8;
    s.tick(1 / 60);
    assert(!s.player.pack.bulk().length && s.world.items.includes(flying), 'but nothing is caught in mid-air — a thrown armful gets away');
    flying.rest = true; flying.z = 0; s.tick(1 / 60);
    assert(held()?.kind === 'wood', 'once it comes to rest it is fair game');
    clearBulk(s);
    const outOfReach = s.world.dropItem('wood', 4, s.player.x + ITEM.reach + 6, s.player.y);
    s.tick(1 / 60);
    assert(!s.player.pack.bulk().length && s.world.items.includes(outOfReach), `and one out of reach (${ITEM.reach}px) stays where it lies`);
    s.world.removeItem(outOfReach);
    clearBulk(s); s.player.pickUp('wood',9);
    const snack = s.world.dropItem('food', 3, s.player.x, s.player.y, 'berry'); s.tick(1 / 60);
    assert(!s.world.items.includes(snack) && s.player.carriedOf('food','berry')===3 && held()?.kind === 'wood', 'the pack carries food alongside wood');
    // bodies: nobody stands inside anybody; the light give way to the heavy; walls are never entered
    s = fresh(); clearing(s); s.agents = [s.player]; Object.assign(s.player, World.center(124, 100)); s.world.items.length = 0;
    const home3 = s.world.houses[0];
    const twinA = s.spawn(new Villager(World.center(128, 100).x, World.center(128, 100).y, home3, 'farmer', 20, 'A', s.mods));
    const twinB = s.spawn(new Villager(World.center(128, 100).x, World.center(128, 100).y, home3, 'farmer', 20, 'B', s.mods));
    twinA.update = twinB.update = () => {};
    s.tick(1 / 60); s.tick(1 / 60);
    assert(twinA.dist(twinB) >= twinA.radius + twinB.radius - 0.01, `two bodies on one spot push apart (${twinA.dist(twinB).toFixed(1)} px)`);
    // dead centre, separate() picks its direction from the two ids, so test the shares and not the axis:
    // both move, equally and opposite. (Checking the x offset alone broke whenever an earlier block
    // changed how many agents had been spawned and the pair drew a near-vertical push.)
    const twinAt = World.center(128, 100);
    const offA = { x: twinA.x - twinAt.x, y: twinA.y - twinAt.y }, offB = { x: twinB.x - twinAt.x, y: twinB.y - twinAt.y };
    assert(Math.hypot(offA.x, offA.y) > 0.5 && Math.hypot(offB.x, offB.y) > 0.5 && Math.abs(offA.x + offB.x) < 0.01 && Math.abs(offA.y + offB.y) < 0.01,
      `equals share the push, equally and opposite (${offA.x.toFixed(2)},${offA.y.toFixed(2)} vs ${offB.x.toFixed(2)},${offB.y.toFixed(2)})`);
    const giant = s.ogre!; s.agents.push(giant); giant.hidden = false; giant.state = 'hunting'; giant.update = () => {}; Object.assign(giant, World.center(132, 100));
    const tot = s.spawn(new Villager(giant.x + 2, giant.y, home3, 'kid', 1, 'Tot', s.mods)); tot.update = () => {};
    const ogreWas = giant.x, totWas = tot.x; s.tick(1 / 60); s.tick(1 / 60); s.tick(1 / 60);
    const giantMoved = Math.abs(giant.x - ogreWas), totMoved = Math.abs(tot.x - totWas);
    assert(tot.dist(giant) >= tot.space + giant.space - 0.01 && giantMoved < totMoved / 10, `the Ogre pushes a child aside and barely moves (giant moved ${giantMoved.toFixed(2)} px, the child ${totMoved.toFixed(1)})`);
    tot.dead = true; s.removeDead(); giant.hidden = true; s.agents = s.agents.filter((a) => a !== giant);
    for (let y = 98; y <= 102; y++) s.world.placeDefense('wall', 135, y);
    const pinned = s.spawn(new Villager(135 * 16 - 3, World.center(135, 100).y, home3, 'farmer', 20, 'Pinned', s.mods)); pinned.update = () => {};
    const pusher = s.spawn(new Villager(135 * 16 - 4, World.center(135, 100).y, home3, 'farmer', 20, 'Pusher', s.mods)); pusher.update = () => {};
    for (let i = 0; i < 5; i++) s.tick(1 / 60);
    assert(pinned.x < 135 * 16 && pusher.x < pinned.x && pinned.dist(pusher) >= 5.9, `a body against a wall is not pushed into it; the other gives way (${pinned.x.toFixed(1)} / ${pusher.x.toFixed(1)})`);
    // a crowd keeps the room its figures take up, not just their hit circles: ten gnomes dropped on one spot
    // spread until no two of them overlap
    {
      const band: Villager[] = [];
      for (let i = 0; i < 10; i++) {
        const g = s.spawn(new Villager(World.center(128, 104).x, World.center(128, 104).y, home3, 'soldier', 20, `Pike${i}`, s.mods));
        g.gnome = true; g.applyRole(s.mods); g.update = () => {}; band.push(g);
      }
      for (let i = 0; i < 60; i++) s.tick(1 / 60);
      let closest = Infinity;
      for (const a of band) for (const b of band) if (a !== b) closest = Math.min(closest, a.dist(b));
      assert(closest >= 2 * BODY.gnome - 0.3 && band[0].space > band[0].radius, `a band of gnomes stands shoulder to shoulder, not inside each other (closest pair ${closest.toFixed(1)} px, room ${2 * BODY.gnome})`);
      for (const g of band) g.dead = true; s.removeDead();
    }
    // a crowd at one pile all get to eat
    s = fresh(); clearing(s); s.agents = [s.player]; Object.assign(s.player, World.center(124, 104)); s.world.items.length = 0;
    const crowd: Villager[] = [];
    const cc = buildingCenter(s.world.houses[0]), ccx = Math.round(cc.tx), ccy = Math.round(cc.ty);
    for (let i = 0; i < 8; i++) { const at = World.center(ccx - 2 + i % 4, ccy + 3 + (i >> 2)); const k = s.spawn(new Villager(at.x, at.y, s.world.houses[0], 'kid', 1, 'C' + i, s.mods)); k.calling = 'farmer'; k.mealAt = 0; crowd.push(k); }
    const ch = buildingCenter(s.world.houses[0]);
    const pileAt = World.center(Math.round(ch.tx), Math.round(ch.ty) + 3); // in their own home's yard
    const pile = s.world.dropItem('food', 40, pileAt.x, pileAt.y, 'wheat'); s.day = 4;
    assert(s.world.inYard(pile.x, pile.y), 'the pile lies in the yard of the house they live in');
    for (let i = 0; i < 12 * 60; i++) s.tick(1 / 60);
    assert(crowd.every((k) => k.ateDay === 4), `eight children round one pile all get a bite (${crowd.filter((k) => k.ateDay === 4).length} of 8 ate, ${pile.n} left)`);
    let minGap = 99; for (const a1 of crowd) for (const b1 of crowd) if (a1 !== b1) minGap = Math.min(minGap, a1.dist(b1));
    assert(minGap >= 3, `no two children share a spot while crowding (closest ${minGap.toFixed(1)} px)`);
    // children run about the pen
    for (const k of crowd) k.mealAt = 1e9;
    const legs: number[] = []; const last = crowd.map((k) => ({ x: k.x, y: k.y }));
    for (let i = 0; i < 10 * 60; i++) { s.tick(1 / 60); if (i % 60 === 59) crowd.forEach((k, j) => { legs.push(Math.hypot(k.x - last[j].x, k.y - last[j].y)); last[j] = { x: k.x, y: k.y }; }); }
    const avg = legs.reduce((n, d) => n + d, 0) / legs.length;
    assert(avg >= 16, `children keep running about the pen (${avg.toFixed(0)} px a second on average)`);
    // the inspector picks anything: a thing on the ground beats the tile, a building beats the tile; pens are managed as a whole
    s = fresh(); clearing(s); s.agents = [s.player]; Object.assign(s.player, World.center(124, 104)); s.world.items.length = 0;
    const pickAt = (tx: number, ty: number, dx = 0, dy = 0) => s.pick({ worldX: World.center(tx, ty).x + dx, worldY: World.center(tx, ty).y + dy });
    pickAt(126, 100); assert(!!s.selectedTile && s.selectedTile.tx === 126 && s.selectedTile.ty === 100 && !s.selected && !s.selectedBuilding, 'picking open ground selects the tile');
    const lump = s.world.dropItem('wood', 5, World.center(126, 100).x + 3, World.center(126, 100).y, undefined);
    pickAt(126, 100, 2); assert(s.selectedItem === lump && !s.selectedTile, 'a thing on the ground under the pointer beats the tile');
    const hut = s.world.houses[0]; pickAt(hut.tx + 1, hut.ty + 1); assert(s.selectedBuilding === hut && !s.selectedItem && !s.selectedTile, 'a building beats the tile');
    s.selectItem(lump); s.world.removeItem(lump); s.tick(1 / 60); assert(!s.selectedItem, 'a vanished thing leaves the inspector');
    s.world.set(120, 100, 'tilled'); s.setFieldPlan({ tx: 120, ty: 100 }, 'tomato');
    const planter = s.spawn(new Villager(World.center(120, 101).x, World.center(120, 101).y, hut, 'farmer', 20, 'Planter', s.mods));
    for (const q of s.world.find((t) => t.kind === 'crop' || t.kind === 'tilled')) if (q.tx !== 120 || q.ty !== 100) s.world.set(q.tx, q.ty, 'grass');
    step(s, 6); assert(s.world.get(120, 100)!.kind === 'crop' && s.world.get(120, 100)!.food === 'tomato', 'the field plan decides what a farmer sows');
    planter.dead = true; s.removeDead();
    s.world.placeDefense('stairs', 130, 100); for (let x = 131; x <= 134; x++) s.world.placeDefense('wall', x, 100);
    assert(s.stairsReach({ tx: 130, ty: 100 }) === 4, 'stairs report the battlements they serve');
    // gnome house: a founding couple, a family raised in the cottage yard, and gnomes of every calling
    s = fresh(); clearing(s); s.agents = [s.player]; s.food = 100;
    const den = s.world.place('gnomehouse', 125, 100), [gma, gpa] = s.foundGnomes(den);
    assert(gma.gnome && gpa.gnome && gma.isAdult && gma.role === 'farmer' && gpa.role === 'woodcutter' && den.residents === 2 && gma.home === den, 'a new gnome house comes with a grown couple: one for the wild, one for the axe');
    { const hp0 = gma.maxHp, was = p.gnomeHp; p.gnomeHp = was * 2; gma.applyRole(s.mods); assert(gma.maxHp > hp0 && gma.speed === p.gnomeSpeed, 'grown gnomes take their stats from the sliders'); p.gnomeHp = was; gma.applyRole(s.mods); gma.hp = gma.maxHp; }
    assert(s.beds(den) === 3 && s.rationOf(gma) === p.foodPerDay * s.mods.foodPerDayMul * p.gnomeRation, 'a Lv1 gnome house has 3 beds and its gnomes eat gnomeRation of a full ration');
    den.nextBirth = 0;
    assert(births(s, 40) > 0, 'a gnome couple in a warm cottage has children');
    const sprout = s.villagers().find((v) => v.role === 'infant')!;
    assert(sprout.gnome && sprout.home === den && sprout.parents.includes(gma), 'a gnome infant is born a gnome, at home in the gnome house');
    sprout.age = p.infantDays; s.tickAges(0);
    assert(sprout.role === 'kid' && !!sprout.calling && !sprout.hidden && sprout.outlook(s).role === sprout.calling, `a gnome child is promised a trade like anyone else (${sprout.calling})`);
    sprout.calling = 'farmer'; // the wild is a gnome's field: take that one, so the rest of the block is fixed
    assert(s.rationOf(sprout) === 0, 'a gnome child takes nothing from the granary');
    step(s, 2); assert(sprout.task === 'learning to forage', `a gnome child promised the wild learns to forage by the cottage (${sprout.task})`);
    s.world.dropItem('food', 4, 126 * 16, 103 * 16, 'carrot'); settle(s); sprout.mealAt = 0; step(s, 8);
    assert(sprout.ateDay === s.day && sprout.diet.carrot > 0, `a hungry gnome child eats what lies by the cottage (ate day ${sprout.ateDay}, day ${s.day})`);
    sprout.age = s.adultAge; s.tickAges(0);
    assert(sprout.role === 'farmer' && sprout.gnome && sprout.home === den && sprout.isAdult, 'a gnome child comes of age to its calling and stays under the toadstool');
    // a gnome warrior is a gnome first: its HP starts at gnomeHp, never a human soldier's
    const warden = s.spawn(new Villager(World.center(126, 101).x, World.center(126, 101).y, den, 'soldier', s.adultAge + 3, 'Warden', s.mods));
    warden.gnome = true; warden.applyRole(s.mods); warden.hp = warden.maxHp; warden.update = () => {};
    const manAtArms = s.spawn(new Villager(0, 0, s.world.houses[0], 'soldier', s.adultAge + 3, 'Tall', s.mods)); manAtArms.update = () => {};
    assert(warden.maxHp < manAtArms.maxHp && warden.radius === 2 && !!warden.pouch,
      `a gnome warrior stays a little person with a pouch (${warden.maxHp} HP against a man-at-arms' ${manAtArms.maxHp})`);
    { const was = p.gnomeHp; p.gnomeHp = was * 2; warden.applyRole(s.mods); assert(warden.maxHp > was, 'and takes its base from gnomeHp, not soldierHp'); p.gnomeHp = was; warden.applyRole(s.mods); warden.hp = warden.maxHp; }
    warden.dead = true; manAtArms.dead = true; s.removeDead();
    const gfoe = s.spawn(new Raider(...Object.values(World.center(128, 102)) as [number, number])); gfoe.update = () => {};
    step(s, 1);
    assert([gma, gpa, sprout].some((v) => v.task === 'fleeing' || v.hidden), 'grown gnomes run home from a raider instead of fighting');
    gfoe.dead = true; s.removeDead(); step(s, 1);
    // foraging: a grown gnome picks one unit off the nearest wild plant, carries it to the granary and goes again
    for (const v of [gma, gpa, sprout]) { v.hidden = false; v.indoors = null; }
    // gnomes keep to their head by default, and forage into their own pouches while they trail you
    for (const q of [...s.world.find((t) => !!WILD_FOOD[t.kind])]) s.world.set(q.tx, q.ty, 'grass'); // a bare map to plant one hazel in
    Object.assign(s.player, World.center(126, 103));
    for (let i = 0; i < 40 && [gma, gpa, sprout].some((v) => v.dist(s.player) > GNOME_PACK.leash * TILE); i++) step(s, 1); // called to heel, they close on you first
    assert([gma, gpa, sprout].every((v) => v.followingPlayer && v.dist(s.player) < GNOME_PACK.leash * TILE), `grown gnomes trail the head by default (${[gma, gpa, sprout].map((v) => `${v.name} ${v.task} ${(v.dist(s.player) / TILE).toFixed(1)}t`).join(", ")})`);
    assert(!!gma.pouch && gma.pouch.slots.length === GNOME_PACK.slots && !gma.pouch.bulk().length, 'and each one carries an empty pouch');
    const nutsBefore = s.pantry.hazelnut;
    const pocketed = () => [gma, gpa, sprout].reduce((n, v) => n + v.pouch!.countOf('food', 'hazelnut'), 0);
    const underfoot = s.world.set(128, 103, 'hazel'); underfoot.stage = 99;
    for (let i = 0; i < 40 && !pocketed(); i++) step(s, 1);
    assert(pocketed() > 0 && ![gma, gpa, sprout].some((v) => v.load), `a follower forages into its own pouch, not its arms (${pocketed()} of ${FOODS.hazelnut.yield} · ${gma.task})`);
    assert(s.pantry.hazelnut === nutsBefore, 'and walks nothing to the granary while it follows');
    // gnomes do woodcutting too: a gnome woodcutter at your heels fells what is near you, into its pouch
    s.wood = 0;
    const gnomeWoodBefore = s.wood, inPouch = () => gpa.pouch!.countOf('wood');
    for (let i = 0; i < TREE_RESERVE + 6; i++) s.world.set(160 + i, 150, 'tree'); // a forest well away: at its floor the axe goes to the fields instead
    s.world.set(129, 104, 'tree'); // and one within the leash, by you
    for (let i = 0; i < 60 && !inPouch(); i++) step(s, 1);
    assert(inPouch() > 0 && s.wood === gnomeWoodBefore, `a gnome woodcutter at your heels chops into its pouch, not the woodyard (${inPouch()} wood · ${gpa.task})`);
    // the leash: what grows across the clearing is not a follower’s business
    for (const q of [...s.world.find((t) => !!WILD_FOOD[t.kind])]) s.world.set(q.tx, q.ty, 'grass');
    const across = s.world.set(126 + GNOME_PACK.leash + 5, 103, 'hazel'); across.stage = 99;
    step(s, 4);
    assert(s.wildLeft(across) === FOODS.hazelnut.yield && [gma, gpa, sprout].every((v) => v.dist(s.player) < GNOME_PACK.leash * TILE), `a plant beyond the leash is left standing (${gma.task})`);
    // H sends them back to work, and the pouches go to the granary on the way (nothing left to pick, so a trip home is all there is to do)
    for (const q of [...s.world.find((t) => !!WILD_FOOD[t.kind])]) s.world.set(q.tx, q.ty, 'grass');
    const packed = pocketed();
    s.paused = false; s.summonGnomes(); s.paused = true;
    assert(!s.gnomesFollow && ![gma, gpa, sprout].some((v) => v.followingPlayer), 'H sends the whole family off foraging');
    for (let i = 0; i < 120 && s.pantry.hazelnut < nutsBefore + packed; i++) step(s, 1);
    assert(s.pantry.hazelnut === nutsBefore + packed && !pocketed(), `sent back to work, the pouches are emptied into the granary (${s.pantry.hazelnut - nutsBefore} of ${packed})`);
    step(s, 3);
    assert(inPouch() > 0 && /firewood|woodyard/.test(gpa.task), `sent back to work, the logs in its pouch are a load to walk in (${inPouch()} wood · ${gpa.task})`);
    for (const v of [gpa, sprout]) v.update = () => {}; // one forager, so the plant isn't stripped before the first find lands
    for (const q of [...s.world.find((t) => !!WILD_FOOD[t.kind])]) s.world.set(q.tx, q.ty, 'grass');
    const hazel = s.world.set(128, 100, 'hazel'); hazel.stage = 99;
    assert(s.wildLeft(hazel) === FOODS.hazelnut.yield && s.world.granary, 'a regrown hazel carries its full yield');
    const nutsWas = s.pantry.hazelnut;
    let carried = false;
    for (let i = 0; i < 40 && s.pantry.hazelnut === nutsWas; i++) { step(s, 1); if (gma.load?.kind === 'food' && gma.load.food === 'hazelnut' && gma.load.n === 1) carried = true; }
    assert(carried, 'a gnome carries exactly one hazelnut at a time');
    assert(s.pantry.hazelnut === nutsWas + 1 && s.wildLeft(hazel) === FOODS.hazelnut.yield - 1 && hazel.stage >= 99, `the find reaches the granary and the plant keeps the rest (${s.wildLeft(hazel)} left)`);
    gma.update = () => {};
    const rest = s.wildLeft(hazel); Object.assign(s.player, World.center(127, 100)); s.player.facing = { x: 1, y: 0 }; clearBulk(s); s.handsAt({ tx: 128, ty: 100 }); const got = s.player.pack.bulk()[0] as { food?: string; n: number } | null;
    assert(got?.food === 'hazelnut' && got.n === rest && hazel.stage === 0 && hazel.left === undefined, `hands take everything left (${rest}) and the plant starts regrowing`);
    for (let d = 0; d < s.regrowDays('hazelnut'); d++) { s.day++; s.newDay(); }
    assert(s.wildLeft(hazel) === FOODS.hazelnut.yield, 'a bare plant regrows to its full yield');
    // every child can starve: a gnome child with nothing thrown by the cottage, and an infant nobody fed can nurse
    for (const it of [...s.world.items]) s.world.removeItem(it);
    for (const v of s.villagers()) if (v.role === 'infant') v.dead = true; s.removeDead(); den.firewood = 5; den.warm = true; // an empty, warm nursery
    den.nextBirth = 0; s.food = 100; assert(births(s, 40) > 0, 'another gnome infant for the nursery');
    const gtot = s.villagers().find((v) => v.role === 'infant')!; gtot.age = p.infantDays; s.tickAges(0); gtot.ateDay = s.day - 5;
    s.day++; s.newDay(); assert(gtot.hungerDays === 1 && !gtot.dead && gtot.task !== 'eating', 'a gnome child with nothing by the cottage goes hungry');
    s.day++; s.newDay(); assert(gtot.dead && gtot.starved, `${p.kidStarveDays} hungry days starve a gnome child`);
    den.nextBirth = 0; den.firewood = 5; den.warm = true; assert(births(s, 40) > 0, 'an infant for the nursery');
    const babe = s.villagers().find((v) => v.role === 'infant')!;
    s.food = 100; s.day++; s.newDay(); assert(babe.hungerDays === 0 && gma.hungerDays === 0, 'an infant is nursed while a grown-up at home is fed');
    s.food = 0; s.day++; s.newDay(); assert(gma.hungerDays === 1 && babe.hungerDays === 1 && !babe.dead, 'when nobody at home eats, the infant goes hungry too');
    s.day++; s.newDay(); assert(babe.dead && babe.starved && !gma.dead, `${p.kidStarveDays} unfed dawns starve an infant before the grown-ups`);
    s.food = 100;
    // the shaman wand: pick a squad, send it, hunt, follow, man the wall, release
    s = fresh(); fort(s); s.agents = [s.player]; s.food = 100;
    const wden = s.world.place('gnomehouse', 127, 102), [wg] = s.foundGnomes(wden);
    const wa = s.spawn(new Villager(...Object.values(World.center(122, 100)) as [number, number], s.world.houses[0], 'soldier', 20, 'Wand A', s.mods));
    const wb = s.spawn(new Villager(...Object.values(World.center(123, 100)) as [number, number], s.world.houses[0], 'soldier', 20, 'Wand B', s.mods));
    const wf = s.spawn(new Villager(...Object.values(World.center(124, 100)) as [number, number], s.world.houses[0], 'farmer', 20, 'Wand farmer', s.mods));
    Object.assign(wg, World.center(125, 100));
    s.selectBox(121 * 16, 99 * 16, 126 * 16, 101 * 16);
    assert(s.squad.length === 2 && s.squad.includes(wa) && s.squad.includes(wb) && !s.squad.includes(wg) && !s.squad.includes(wf), `a box picks soldiers, never a farmer or a gnome (${s.squad.map((v) => v.name).join(', ')})`);
    s.orderHold(128, 98);
    const spots = new Set(s.squad.map((v) => v.order && v.order.kind === 'hold' ? `${v.order.tx},${v.order.ty}` : '?'));
    assert(spots.size === 2 && [...spots].every((k) => Math.max(Math.abs(+k.split(',')[0] - 128), Math.abs(+k.split(',')[1] - 98)) <= 1), `a hold order spreads the squad over the spot (${[...spots].join(' ')})`);
    step(s, 8);
    assert(s.squad.every((v) => v.task === 'holding position' && v.order?.kind === 'hold' && v.tile.tx === v.order.tx && v.tile.ty === v.order.ty), `the squad walks there and holds (${s.squad.map((v) => v.task).join(', ')})`);
    const wfar = s.spawn(new Raider(...Object.values(World.center(121, 103)) as [number, number])); wfar.update = () => {}; wfar.hp = wfar.maxHp = 9999; // (the starting barracks tower would pick off a plain raider)
    step(s, 1);
    assert(s.squad.every((v) => v.task === 'holding position'), 'a raider beyond the leash is left alone');
    const wnear = s.spawn(new Raider(...Object.values(World.center(130, 99)) as [number, number])); wnear.update = () => {}; wnear.hp = wnear.maxHp = 9999;
    step(s, 6);
    assert(s.squad.some((v) => v.task === 'fighting') && wnear.hp < 9999, 'a raider inside the leash is fought from the held spot');
    wnear.dead = true; s.removeDead(); step(s, 3);
    assert(s.squad.every((v) => v.task === 'holding position'), 'with the raider down they drift back to the spot');
    s.orderAttack(wfar); const d0 = wa.dist(wfar); step(s, 3);
    assert(wa.order?.kind === 'attack' && wa.dist(wfar) < d0 - 16, `an attack order sends them across the map (${Math.round(d0)} → ${Math.round(wa.dist(wfar))} px)`);
    wfar.dead = true; s.removeDead(); step(s, 0.5);
    assert(wa.order?.kind === 'hold', 'when the quarry falls the squad holds the ground it took');
    s.orderFollow(); Object.assign(s.player, World.center(124, 103)); step(s, 6);
    assert(s.squad.every((v) => v.order?.kind === 'follow' && v.dist(s.player) <= (ORDER.followGap + 1.5) * 16), `follow me keeps the squad at the head's heels (${s.squad.map((v) => Math.round(v.dist(s.player) / 16)).join(', ')} tiles)`);
    s.orderFollow(); assert(s.squad.every((v) => v.order?.kind === 'hold'), 'F again: they hold where they stand');
    const posted = s.orderPost({ tx: 124, ty: 95 });
    assert(posted.length === 2 && posted.every((v) => v.post && !v.order && v.weapon === 'bow') && !wg.order, 'a wall top posts the soldiers (bows out); the gnome was never asked');
    s.release(); assert(s.squad.every((v) => !v.order && !v.post), 'release: no orders, no posts');
    s.clearSquad(); s.orderHold(126, 99);
    assert(s.fighters().every((v) => v.order?.kind === 'hold'), 'with nobody picked an order goes to every fighter');
    s.release();
    // bodies in the way: two soldiers sent through each other, and one sent through the head, get past instead of locking up
    s = fresh(); clearing(s); s.agents = [s.player]; Object.assign(s.player, World.center(125, 100));
    const sa = s.spawn(new Villager(...Object.values(World.center(120, 100)) as [number, number], s.world.houses[0], 'soldier', 20, 'Stall A', s.mods));
    const sb = s.spawn(new Villager(...Object.values(World.center(130, 100)) as [number, number], s.world.houses[0], 'soldier', 20, 'Stall B', s.mods));
    s.selectSquad([sa]); s.orderHold(130, 100); s.selectSquad([sb]); s.orderHold(120, 100);
    step(s, 12);
    assert(sa.tile.tx === 130 && sb.tile.tx === 120, `soldiers walking through each other and the head both arrive (${sa.tile.tx},${sa.tile.ty} · ${sb.tile.tx},${sb.tile.ty})`);
    s.release(); s.clearSquad();
    s = fresh();
    assert(['hazel', 'garlic', 'burdock'].every((k) => [...s.world.find((t) => t.kind === k)].length > 0), 'a new map grows hazel, wild garlic and burdock');
    // long grass: most of the wilderness, slows everyone, the sword mows an arc, it never grows back
    {
      const raw = new World(); raw.generate(new Rng(42));
      const grass = raw.count((t) => t.kind === 'grass'), tall = raw.count((t) => t.kind === 'grass' && !!t.tall);
      assert(tall > grass * 0.7, `most grass is long grass (${tall}/${grass})`);
      assert(raw.count((t) => !!t.tall && (t.trail || t.kind !== 'grass')) === 0, 'trails and everything but grass stay short');
      const hx = COLS / 2, hy = ROWS / 2;
      assert(![...raw.find((t, tx, ty) => !!t.tall && tx >= hx - 11 && tx <= hx + 10 && ty >= hy - 7 && ty <= hy + 4)].length, 'the village clearing starts mown');
      const l = raw.lair!; assert(!raw.get(l.tx + 2, l.ty + BUILDINGS.lair.h)!.tall, 'so does the Ogre\'s doorstep');
      clearing(s); s.agents = [s.player];
      const walk = (x: number, y: number) => { Object.assign(s.player, World.center(x, y)); const x0 = s.player.x; const keys = s.player.keys; s.player.keys = { W: { isDown: false }, A: { isDown: false }, S: { isDown: false }, D: { isDown: true } }; step(s, 0.3); s.player.keys = keys; return s.player.x - x0; };
      const short = walk(120, 100);
      for (let x = 120; x <= 126; x++) s.world.get(x, 100)!.tall = true;
      const slow = walk(120, 100);
      assert(slow > 0 && Math.abs(slow / short - p.grassSlow) < 0.05, `the head wades at ${p.grassSlow}× through long grass (${slow.toFixed(1)} vs ${short.toFixed(1)} px)`);
      const runner = (y: number) => { const v = s.spawn(new Villager(...Object.values(World.center(120, y)) as [number, number], s.world.houses[0], 'soldier', 20, 'Runner', s.mods)); v.speed = 40; s.selectSquad([v]); s.orderHold(126, y); step(s, 0.5); s.release(); s.clearSquad(); const dx = v.x - World.center(120, y).x; v.dead = true; s.removeDead(); return dx; };
      const openRun = runner(102), grassRun = runner(100);
      assert(grassRun > 0 && Math.abs(grassRun / openRun - p.grassSlow) < 0.1, `villagers and raiders wade too (${grassRun.toFixed(1)} vs ${openRun.toFixed(1)} px)`);
      for (let x = 118; x <= 126; x++) for (let y = 98; y <= 102; y++) s.world.get(x, y)!.tall = true;
      Object.assign(s.player, World.center(121, 100)); s.player.facing = { x: 1, y: 0 }; s.player.tool = 'sword'; s.fx.length = 0;
      s.player.pressAttack(); step(s, 0.35);
      const cut = s.fx.filter((e) => e.kind === 'cut').length;
      assert(!s.world.get(121, 100)!.tall && !s.world.get(122, 100)!.tall && !s.world.get(122, 99)!.tall && cut >= 3, `a swing mows the tiles in its arc (${cut} cut)`);
      assert(s.world.get(119, 100)!.tall && s.world.get(121, 98)!.tall, 'the grass behind and out of reach stands');
      s.world.get(124, 100)!.tall = true; s.world.set(124, 100, 'tilled');
      assert(!s.world.get(124, 100)!.tall, 'tilling (or anything replacing the ground) clears the grass');
      const before = s.world.count((t) => !!t.tall); for (let d = 0; d < 5; d++) s.newDay();
      assert(s.world.count((t) => !!t.tall) <= before, 'mown grass never grows back');
    }
    // boars: sounders in the woods that mind their own business until struck, and drop meat the gnomes fetch
    {
      s = fresh(true);
      const boars = s.agents.filter((a): a is Boar => a instanceof Boar);
      assert(s.sounders.length >= 4 && s.sounders.every((sd) => sd.members.length >= BOAR.sounderSize[0] && sd.members.length <= BOAR.sounderSize[1]), `the woods hold ${s.sounders.length} sounders of ${BOAR.sounderSize[0]}–${BOAR.sounderSize[1]} boars (${boars.length} boars)`);
      assert(s.sounders.every((sd) => Math.hypot(sd.home.tx - COLS / 2, sd.home.ty - ROWS / 2) >= BOAR.minDist), 'every sounder is well away from the village');
      assert(boars.every((b) => b.harmless && b.wild && b.lairBound) && !s.raidActive, 'boars start calm, are no raid, and count toward none');
      s = fresh(); clearing(s); s.agents = [s.player]; s.food = 0;
      const sd = s.foundSounder(126, 100, 2), [b1, b2] = sd.members;
      Object.assign(b1, World.center(126, 100)); Object.assign(b2, World.center(127, 100));
      const guard = s.spawn(new Villager(...Object.values(World.center(122, 100)) as [number, number], s.world.houses[0], 'soldier', 20, 'Boar guard', s.mods));
      const hand = s.spawn(new Villager(...Object.values(World.center(124, 101)) as [number, number], s.world.houses[0], 'farmer', 20, 'Boar hand', s.mods));
      s.grid.rebuild(s.agents);
      assert(!s.bestTarget(guard.x, guard.y, 130) && !s.nearestRaider(hand.x, hand.y, 90), 'a calm boar is no target for a soldier and scares no farmer');
      step(s, 2);
      assert(b1.harmless && !b1.provoked && hand.task !== 'fleeing' && !guard.attack, 'two seconds later nobody has bothered anybody');
      Object.assign(s.player, World.center(125, 100)); s.player.facing = { x: 1, y: 0 }; s.player.tool = 'sword'; s.player.hp = s.player.maxHp = 200;
      Object.assign(b1, World.center(126, 100)); Object.assign(b2, World.center(128, 100)); b1.calm(); b2.calm();
      guard.dead = true; hand.dead = true; s.removeDead();
      s.player.pressAttack(); step(s, 0.3);
      assert(b1.provoked && !b1.harmless && b1.prey === s.player, 'a struck boar turns on the head');
      assert(b2.provoked && b2.prey === s.player, 'and its sounder-mate charges too');
      step(s, 3);
      assert(s.player.hp < 200, `the boars land blows (${s.player.hp}/200)`);
      s.grid.rebuild(s.agents);
      assert(s.bestTarget(s.player.x, s.player.y, 130) instanceof Boar, 'a provoked boar is fair game for soldiers');
      Object.assign(s.player, World.center(105, 100)); step(s, BOAR.calmAfter + 2);
      assert(!b1.provoked && b1.harmless && !b2.provoked, 'out of reach, the boars calm down');
      Object.assign(s.player, World.center(125, 100)); Object.assign(b1, World.center(126, 100)); Object.assign(b2, World.center(133, 106));
      b1.hp = 1; const killed = s.stats.raidersKilled, scrapBefore = s.scrap;
      s.player.pressAttack(); for (let i = 0; i < 15; i++) s.tick(1 / 60); // the scene's own tick fires onDeath (the loot); step() would just drop the body
      const meat = s.world.items.find((it) => it.kind === 'food' && it.food === 'meat');
      assert(b1.dead && !!meat && meat.n === BOAR.meat && Math.hypot(meat.x - 126 * 16 - 8, meat.y - 100 * 16 - 8) < 24, `a hunted boar drops ${BOAR.meat} meat where it fell`);
      assert(s.stats.raidersKilled === killed && s.scrap === scrapBefore && s.stats.boarsHunted === 1 && sd.members.length === 1, 'a boar is game, not a raider: no scrap, no kill count');
      b2.calm(); Object.assign(s.player, World.center(118, 92)); s.player.tool = 'hoe';
      const bden = s.world.place('gnomehouse', 129, 96), [bg, bg2] = s.foundGnomes(bden); bg2.dead = true; s.removeDead();
      Object.assign(bg, World.center(129, 98)); bg.load = null; bg.followPlayer(s, false); // it would trail the head otherwise
      settle(s, 2); step(s, 6);
      const held = bg.load as { food?: string; n: number } | null;
      assert(held?.food === 'meat' && held.n === BOAR.meat && !s.world.items.includes(meat!), `a gnome fetches the whole piece (${bg.task})`);
      step(s, 40);
      assert(s.pantry.meat === BOAR.meat && (bg.load as { food?: string } | null)?.food !== 'meat', `and carries it to the granary (${s.pantry.meat} meat stored · ${bg.task})`);
      const eater = s.spawn(new Villager(...Object.values(World.center(120, 100)) as [number, number], s.world.houses[0], 'kid', 1, 'Meat eater', s.mods));
      eater.diet.meat = p.dietFull;
      assert(Math.abs(eater.dietNow().dmg - DIET_CAP.dmg * 2 * p.dietMul) < 1e-9 && eater.dietNow().hp === 0, 'children raised on meat get twice the damage bonus berries give, and nothing else');
      // lurkers: a calm boar in long grass is unseen; treading on it finds it
      s = fresh(); clearing(s); s.agents = [s.player]; s.hoverTile = null;
      const lsd = s.foundSounder(130, 100, 1), [lb] = lsd.members;
      lb.update = () => {}; Object.assign(lb, World.center(130, 100)); s.grid.rebuild(s.agents);
      assert(lb.lurker && !lb.lurking, 'a boar on mown grass is in plain sight');
      for (let x = 128; x <= 132; x++) for (let y = 98; y <= 102; y++) s.world.get(x, y)!.tall = true;
      assert(lb.lurking, 'the same boar standing in long grass is hidden');
      Object.assign(s.player, World.center(129, 100)); s.player.facing = { x: 1, y: 0 }; s.player.tool = 'sword';
      assert(!s.hint().includes('boar'), `the sword hint gives nothing away (${s.hint()})`);
      s.world.cutGrass(130, 100); assert(!lb.lurking && s.hint().includes('boar'), 'mow its tile and it shows — and the hint names it');
      s.world.get(130, 100)!.tall = true; lb.rouse(s.player);
      assert(!lb.lurking && lb.provoked, 'a provoked boar cannot hide, grass or no grass');
      lb.calm(); delete (lb as unknown as { update?: unknown }).update; // back to the real update
      Object.assign(s.player, World.center(126, 100)); s.fx.length = 0;
      step(s, 0.5);
      assert(lb.lurking && !lb.provoked, 'with nobody near it stays hidden and calm');
      Object.assign(s.player, { x: lb.x + 4, y: lb.y }); step(s, 0.2);
      assert(lb.provoked && lb.prey === s.player && s.journal.some((j) => /bursts out of the long grass/.test(j.text)), 'treading on it, the head startles it and it charges');
      lb.calm(); Object.assign(lb, World.center(130, 100)); Object.assign(s.player, World.center(118, 92));
      const hand2 = s.spawn(new Villager(...Object.values(World.center(130, 100)) as [number, number], s.world.houses[0], 'farmer', 20, 'Trodden hand', s.mods));
      step(s, 0.2);
      assert(lb.provoked && lb.prey === hand2, 'a villager blundering onto it is charged just the same');
      hand2.dead = true; s.removeDead(); lb.calm(); Object.assign(lb, World.center(130, 100));
      for (let x = 128; x <= 132; x++) for (let y = 98; y <= 102; y++) s.world.cutGrass(x, y);
      Object.assign(s.player, { x: lb.x + 4, y: lb.y }); step(s, 0.3);
      assert(!lb.provoked, 'a boar in plain sight is not startled by company');
      Object.assign(s.player, World.center(118, 92));
      for (let x = 126; x <= 134; x++) for (let y = 96; y <= 104; y++) s.world.get(x, y)!.tall = true;
      s.fx.length = 0; lb.setGoal(s, 133, 103, true); step(s, 2);
      assert(s.fx.some((e) => e.kind === 'rustle'), 'moving through long grass, the hidden boar stirs it');
      for (let x = 126; x <= 134; x++) for (let y = 96; y <= 104; y++) s.world.cutGrass(x, y);
      s.fx.length = 0; Object.assign(lb, World.center(130, 100)); lb.setGoal(s, 133, 103, true); step(s, 2);
      assert(!s.fx.some((e) => e.kind === 'rustle'), 'on mown grass there is nothing to stir');
      // the head wades through long grass: it stirs as they go, and it is cover to LOOK at only —
      // nothing about who can see or reach them changes (the boar above is the one that truly hides)
      s = fresh(); clearing(s); s.agents = [s.player];
      {
        const home = World.center(124, 100);
        for (let x = 116; x <= 136; x++) for (let y = 94; y <= 106; y++) { const t = s.world.get(x, y)!; if (t.kind === 'grass') { if (!t.tall) { t.tall = true; s.world.tallCount++; } } }
        Object.assign(s.player, home);
        s.fx.length = 0; step(s, 1);
        assert(!s.fx.some((e) => e.kind === 'rustle'), 'standing still in long grass stirs nothing');
        s.player.keys = { ...keysOff(), D: { isDown: true } };
        s.fx.length = 0; step(s, 2);
        assert(s.fx.some((e) => e.kind === 'rustle'), 'but wading through it stirs the grass as a boar does');
        const stirs = s.fx.filter((e) => e.kind === 'rustle').length;
        assert(stirs <= 8, `and only now and then, not every frame (${stirs} in 2s)`);
        // a hostile finds the head in the grass exactly as it would on bare ground: cover is cosmetic
        Object.assign(s.player, home); s.player.keys = keysOff();
        const stalker = s.spawn(new Troll(home.x + 3 * TILE, home.y));
        s.grid.rebuild(s.agents); stalker.update(1 / 60, s);
        assert(stalker.quarry === s.player, 'long grass does not hide the head from a troll');
        assert(!!s.nearestVictim(stalker.x, stalker.y), 'nor from anything else hunting people');
        stalker.dead = true; s.removeDead();
        // mown ground stirs nothing, however fast you cross it
        for (let x = 116; x <= 136; x++) for (let y = 94; y <= 106; y++) s.world.cutGrass(x, y);
        Object.assign(s.player, home);
        s.player.keys = { ...keysOff(), D: { isDown: true } };
        s.fx.length = 0; step(s, 2);
        assert(!s.fx.some((e) => e.kind === 'rustle'), 'mown ground stirs nothing under the head');
        s.player.keys = keysOff();
      }
      // breeding: a sounder of two or more grows, one alone does not, none past the cap
      s = fresh(); s.agents = [s.player];
      const pair = s.foundSounder(126, 100, 2), lone = s.foundSounder(134, 106, 1);
      const breed = p.boarBreed; p.boarBreed = 1; s.newDay();
      assert(pair.members.length === 3 && pair.members[2].young && lone.members.length === 1, 'at dawn a pair gains a young boar; a lone boar never breeds');
      for (let d = 0; d < 6; d++) s.newDay();
      assert(pair.members.length === BOAR.sounderCap && pair.members[2].age >= BOAR.youngDays && !pair.members[2].young, `a sounder grows to ${BOAR.sounderCap} and no further; the young grow up`);
      p.boarBreed = breed;
    }
    // the hidden gnome cottage: out in the woods, nobody's business until the head walks into its glade
    {
      s = fresh();
      const den = s.world.wildGnomeHouse!;
      const c = buildingCenter(den), away = Math.hypot(c.tx - COLS / 2, c.ty - ROWS / 2);
      assert(!!den && den.kind === 'gnomehouse' && den.wild, 'one toadstool cottage stands wild in the world');
      assert(away >= GNOME_HOME.minDist * 0.7 && away <= GNOME_HOME.maxDist + 2, `it hides ${away.toFixed(0)} tiles out`);
      assert(!s.world.lair || Math.hypot(s.world.lair.tx - den.tx, s.world.lair.ty - den.ty) >= GNOME_HOME.clear, 'it keeps its distance from the Ogre');
      assert(s.world.bfs(doorstep(den), { tx: COLS / 2, ty: ROWS / 2 }).length > 0, 'and there is a way there on foot');
      const ring = [...s.world.find((t, tx, ty) => t.kind === 'mushroom' && Math.hypot(tx - c.tx, ty - c.ty) < 5)].length;
      assert(ring >= 4, `a fairy ring of mushrooms grows around it (${ring})`);
      assert(!s.world.get(den.tx, den.ty + BUILDINGS.gnomehouse.h)!.tall, 'the gnomes keep their glade mown');
      // wild: in none of the village's books
      assert(!s.world.gnomeHouses.includes(den) && !s.world.familyHouses.includes(den) && !s.world.villageBuildings.includes(den), 'a wild cottage is in none of the village lists');
      assert(!s.hearthBuildings().includes(den) && !s.reachableBuildings({ tx: COLS / 2, ty: ROWS / 2 }).includes(den), 'no woodcutter stocks it and no wrecker goes for it');
      assert(!s.fog!.isExplored(den.tx, den.ty) && !s.villagers().some((v) => v.gnome), 'it lights no fog of its own, and its family is not out yet');
      // the craft is locked until they teach it
      assert(typeof s.toolLocked('gnomehouse') === 'string' && !s.gnomesFound, 'the GNOME HOUSE tool starts locked');
      s.player.tool = 'sword'; s.setTool('gnomehouse');
      assert(s.player.tool === 'sword', 'picking it up does nothing');
      s.player.tool = 'basket'; s.player.cycleTool(1, (t) => !!s.toolLocked(t));
      assert((s.player.tool as string) === 'wand', 'and cycling the belt skips over it');
      assert(s.buildProblem({ tx: 120, ty: 100 }, 'gnomehouse') === s.toolLocked('gnomehouse'), 'building one says why not');
      // walking in: the glade, then the cottage itself
      const door = doorstep(den);
      Object.assign(s.player, World.center(door.tx, door.ty));
      s.fog!.update(1); s.tick(1 / 60);
      assert(s.gnomesFound && !den.wild, 'walking into sight of the cottage finds the gnomes');
      const pair = s.villagers().filter((v) => v.gnome);
      assert(pair.length === 2 && pair.every((v) => v.home === den && v.isAdult), 'a grown gnome couple comes out of the door');
      assert(s.world.gnomeHouses.includes(den) && s.hearthBuildings().includes(den) && !s.toolLocked('gnomehouse'), 'the cottage joins the village and the craft is learned');
      assert(s.journal.some((j) => /found the gnomes/.test(j.text)), 'and the journal says so');
      // taught: the tool builds as any other
      clearing(s); s.wood = 100; Object.assign(s.player, World.center(120, 100)); s.player.facing = { x: 1, y: 0 }; s.hoverTile = null;
      s.setTool('gnomehouse');
      const before = s.world.gnomeHouses.length, wood = s.wood;
      s.interact();
      assert((s.player.tool as string) === 'gnomehouse' && s.world.gnomeHouses.length === before + 1 && s.wood === wood - COST.gnomehouse, 'and now you can raise your own');
      assert(s.villagers().filter((v) => v.gnome).length === 4, 'which comes with a couple of its own');
    }
    // a village of people opens with the same roster, and every one of them has a place
    {
      const v0 = fresh(), grown = v0.villagers().filter((x) => x.isAdult);
      assert(grown.filter((x) => x.role === 'farmer').length === p.startFarmers
        && grown.filter((x) => x.role === 'woodcutter').length === p.startWoodcutters
        && grown.filter((x) => x.role === 'soldier').length === p.startWarriors + v0.mods.startSoldiers,
        `a village opens ${p.startFarmers} farmer, ${p.startWoodcutters} woodcutter, ${p.startWarriors} warriors (${CALLINGS.map((c) => `${c} ${grown.filter((x) => x.role === c).length}`).join(', ')})`);
      assert(CALLINGS.every((c) => v0.callingFilled(c) <= v0.callingCap(c)), 'and none of them is over its cap');
    }
    // ---- the pike: a thrust down a line, a dead zone, and a set point against a charge -------
    {
      s = fresh(); clearing(s); s.agents = [s.player]; Object.assign(s.player, { x: -400, y: -400 });
      const pk = s.spawn(new Villager(World.center(120, 100).x, World.center(120, 100).y, s.world.houses[0], 'soldier', 20, 'Pikey', s.mods));
      pk.gnome = true; pk.weapon = 'pike'; pk.applyRole(s.mods); pk.hp = pk.maxHp; pk.order = null;
      const dummy = (tx: number) => { const r = s.spawn(new Raider(World.center(tx, 100).x, World.center(tx, 100).y)); r.update = () => {}; r.hp = r.maxHp = 500; return r; };
      // two raiders on one line, both inside pike's length: one thrust takes both
      const nearR = dummy(121), farR = dummy(122);
      const hits = s.pikeStrike(pk, 1, 0, 10);
      assert(hits === 2 && nearR.hp < 500 && farR.hp < 500, `a thrust strikes every raider on its line (${hits} struck)`);
      // beyond the point, nothing
      const beyond = dummy(120 + Math.ceil((p.pikeReach + 20) / TILE)); const bWas = beyond.hp;
      s.pikeStrike(pk, 1, 0, 10);
      assert(beyond.hp === bWas, `a raider past ${p.pikeReach}px is out of the pike's reach`);
      // and off the line, nothing
      const off = s.spawn(new Raider(World.center(121, 100).x, World.center(121, 100).y + 24)); off.update = () => {}; off.hp = off.maxHp = 500;
      s.pikeStrike(pk, 1, 0, 10);
      assert(off.hp === 500, 'a raider beside the line is untouched');
      for (const r of [nearR, farR, beyond, off]) r.dead = true; s.removeDead();
      // the brace: something running onto the point takes far more than something standing on it
      const stand = dummy(122); const sWas = stand.hp; s.pikeStrike(pk, 1, 0, 10); const standTook = sWas - stand.hp; stand.dead = true; s.removeDead();
      const charge = dummy(122); charge.vx = -90; charge.vy = 0; const cWas = charge.hp; s.pikeStrike(pk, 1, 0, 10); const chargeTook = cWas - charge.hp; charge.dead = true; s.removeDead();
      assert(chargeTook > standTook * 1.8, `a charge onto a set pike takes far more of it (${chargeTook} against ${standTook})`);
      // friends never stand in the way: a gnome in front, a raider behind it, and the raider is struck
      const front = s.spawn(new Villager(World.center(121, 100).x, World.center(121, 100).y, s.world.houses[0], 'soldier', 20, 'Front', s.mods)); front.update = () => {};
      const past = dummy(122);
      assert(s.pikeStrike(pk, 1, 0, 10) === 1 && past.hp < 500 && front.hp === front.maxHp, 'a thrust goes straight past a friend in the front rank');
      past.dead = true; front.dead = true; s.removeDead();
      // inside the point it gives ground rather than fight
      const close = dummy(120); Object.assign(close, { x: pk.x + 3, y: pk.y });
      const xWas = pk.x;
      s.grid.rebuild(s.agents); pk.update(1 / 60, s); for (let i = 0; i < 4; i++) pk.update(1 / 60, s);
      assert(pk.x < xWas && pk.task === 'giving ground', `a raider inside the point makes the pikeman give ground (${pk.task}, moved ${(xWas - pk.x).toFixed(1)}px)`);
      close.dead = true; s.removeDead();
      // at pike's length it levels the pike and thrusts on its own
      const mark = dummy(122); Object.assign(pk, World.center(120, 100)); pk.attackCd = 0;
      let thrust = false;
      for (let i = 0; i < 90 && mark.hp === 500; i++) { s.grid.rebuild(s.agents); pk.update(1 / 60, s); if (pk.task === 'levelling the pike') thrust = true; }
      assert(thrust && mark.hp < 500, `at pike's length it levels the pike and the thrust lands (${pk.task})`);
      mark.dead = true; pk.dead = true; s.removeDead();
      // following the head, a pikeman goes to meet a raider it sees near the band, not only one already on the head
      {
        Object.assign(s.player, World.center(120, 100));
        const scout = s.spawn(new Villager(World.center(121, 100).x, World.center(121, 100).y, s.world.houses[0], 'soldier', 20, 'Scout', s.mods));
        scout.gnome = true; scout.weapon = 'pike'; scout.applyRole(s.mods); scout.order = { kind: 'follow' };
        const far = s.spawn(new Raider(World.center(130, 100).x, World.center(130, 100).y)); far.update = () => {}; far.hp = far.maxHp = 500;
        const startGap = scout.dist(far);
        for (let i = 0; i < 60; i++) { s.grid.rebuild(s.agents); scout.update(1 / 60, s); }
        assert((scout as unknown as { target: unknown }).target === far && scout.dist(far) < startGap - 10, `a following pikeman closes on a raider ${Math.round(startGap / TILE)} tiles off that is not on the head (${scout.task}, ${(startGap - scout.dist(far)).toFixed(0)} px closer)`);
        const plain = s.spawn(new Villager(World.center(121, 101).x, World.center(121, 101).y, s.world.houses[0], 'soldier', 20, 'Swordsman', s.mods));
        plain.order = { kind: 'follow' };
        for (let i = 0; i < 30; i++) { s.grid.rebuild(s.agents); plain.update(1 / 60, s); }
        assert((plain as unknown as { target: unknown }).target === null, 'a swordsman at the head\'s heels still waits for a raider to come at the head');
        for (const m of [scout, far, plain]) m.dead = true; s.removeDead();
      }
    }
    // ---- thicket: thorns that slow, hurt and spread, and an axe to cut them back ------------
    {
      const w0 = fresh(false, false, false, false, true);
      assert(w0.world.thicketCount > 0 && w0.world.thicketCount === [...w0.world.find((t) => t.kind === 'thicket')].length, `the wild grows thicket, and the census keeps up (${w0.world.thicketCount})`);
      const hx = COLS / 2, hy = ROWS / 2;
      assert(![...w0.world.find((t) => t.kind === 'thicket')].some((q) => Math.abs(q.tx - hx) < 14 && Math.abs(q.ty - hy) < 10), 'the village clearing starts clear of it');
      assert([...w0.world.find((t) => t.kind === 'thicket')].some((q) => Math.hypot(q.tx - hx, q.ty - hy) < 32), 'but some of it is near enough to come creeping in');
      // the thorn ring: walk out from the square in any direction and you meet thorns or a trail lane
      const open: number[] = [];
      for (let k = 0; k < 72; k++) {
        const a = (k / 72) * Math.PI * 2;
        let met = false;
        for (let r = 12; r <= 30 && !met; r += 0.5) {
          const t = w0.world.get(Math.round(hx + Math.cos(a) * r), Math.round(hy + Math.sin(a) * r * 0.75));
          if (t && (t.kind === 'thicket' || t.trail)) met = true;
        }
        if (!met) open.push(k * 5);
      }
      assert(open.length === 0, `a ring of thorns hems the village in all the way round (open at ${open.join(', ')} degrees)`);
      s = fresh(); clearing(s); s.agents = [s.player];
      s.world.set(126, 100, 'thicket');
      assert(!s.world.isBlocked(126, 100) && s.world.slowAt(World.center(126, 100).x, World.center(126, 100).y) === p.thicketSlow, 'thicket can be walked into, but it drags');
      // the thorns
      const hpWas = s.player.hp; Object.assign(s.player, World.center(126, 100));
      for (let i = 0; i < 60; i++) s.tickThorns(1 / 60);
      assert(s.player.hp < hpWas && Math.abs((hpWas - s.player.hp) - p.thicketDps) < p.thicketDps * 0.3, `a second in it costs about ${p.thicketDps} HP (${(hpWas - s.player.hp).toFixed(1)})`);
      Object.assign(s.player, World.center(124, 100)); s.player.hp = s.player.maxHp;
      for (let i = 0; i < 60; i++) s.tickThorns(1 / 60);
      assert(s.player.hp === s.player.maxHp, 'out of it, nothing');
      // villagers go round it when there is a way round
      for (let y = 98; y <= 102; y++) s.world.set(126, y, 'thicket'); // a detour of 6 beats one thorny step at 9
      const round = s.world.bfs({ tx: 123, ty: 100 }, { tx: 129, ty: 100 });
      assert(round.length > 0 && !round.some((q) => s.world.get(q.tx, q.ty)!.kind === 'thicket'), `a path goes round the thicket rather than through it (${round.length} steps)`);
      for (let y = 90; y <= 110; y++) s.world.set(126, y, 'thicket');
      const through = s.world.bfs({ tx: 123, ty: 100 }, { tx: 129, ty: 100 });
      assert(through.length > 0 && through.some((q) => s.world.get(q.tx, q.ty)!.kind === 'thicket'), 'and through it only when there is no other way');
      // the axe clears a tile in one blow and keeps the canes; the sword takes two swings
      s.world.set(126, 100, 'thicket'); Object.assign(s.player, World.center(125, 100)); s.player.facing = { x: 1, y: 0 };
      s.player.tool = 'axe'; s.hoverTile = { tx: 126, ty: 100 }; clearBulk(s);
      const woodWas = s.player.carriedOf('wood'); s.interact();
      assert(s.world.get(126, 100)!.kind === 'grass' && s.player.carriedOf('wood') === woodWas + p.thicketWood, `one axe blow clears it and leaves ${p.thicketWood} wood in the pack`);
      s.world.set(127, 100, 'thicket');
      assert(!s.world.cutThicket(127, 100, 2) && s.world.get(127, 100)!.kind === 'thicket', 'one sword swing only half-cuts a tile');
      assert(s.world.cutThicket(127, 100, 2) && s.world.get(127, 100)!.kind === 'grass', 'the second clears it');
      // it creeps: over grass, fields and forage, never over a doorstep, a tree or a building
      for (const q of s.world.find((t) => t.kind === 'thicket')) s.world.set(q.tx, q.ty, 'grass');
      s.world.set(130, 100, 'thicket');
      s.world.set(131, 100, 'crop'); s.world.set(129, 100, 'bush'); s.world.set(130, 99, 'tree'); s.world.set(130, 101, 'grass');
      const spareCrop = (tx: number, ty: number) => tx === 131 && ty === 100;
      // one roll a tile a day, in one random direction: over a few dawns a lone tile takes a neighbour
      let took = s.world.spreadThicket(new Rng(3), 1, spareCrop);
      for (let i = 0; i < 8 && !took.length; i++) took = s.world.spreadThicket(new Rng(40 + i), 1, spareCrop);
      assert(took.length === 1 && s.world.get(130, 99)!.kind === 'tree', `a day's creep takes one neighbour, and never a tree (${JSON.stringify(took)})`);
      for (let i = 0; i < 30; i++) s.world.spreadThicket(new Rng(10 + i), 1, spareCrop);
      assert(s.world.get(131, 100)!.kind === 'crop', 'a spared tile is never taken');
      assert(s.world.get(129, 100)!.kind === 'thicket' || s.world.get(130, 101)!.kind === 'thicket', 'forage and open ground go under it');
      for (const q of s.world.find((t) => t.kind === 'thicket')) s.world.set(q.tx, q.ty, 'grass');
    }
    // ---- the gnome start ------------------------------------------------------------------
    const wasGnome = p.gnomeStart, wasPeace = p.peaceful;
    p.gnomeStart = true; s = fresh();
    assert(s.world.houses.length === 0, 'the gnome start raises no house');
    assert(s.world.barracks.length === 1, 'but a barracks stands, so the band may raise warriors from the first frame');
    assert(!s.world.wildGnomeHouse, 'and leaves no hidden cottage to find twice');
    assert(!!s.world.granary && !!s.world.woodyard, 'but the granary and woodyard still stand');
    assert(!s.world.tiles.some((t) => t.kind === 'crop'), 'and no field is sown');
    const cot = s.world.gnomeStart!;
    assert(!!cot && !cot.wild && cot.kind === 'gnomehouse', 'a toadstool cottage stands in the clearing, already yours');
    // a forager and a woodcutter to keep it fed and warm, and a band of pikemen to keep it alive
    const band = s.villagers().filter((v) => v.gnome && v.isAdult);
    const roster = (vs: Villager[]) => CALLINGS.map((c) => `${c} ${vs.filter((v) => v.role === c).length}`).join(', ');
    assert(band.length === p.startFarmers + p.startWoodcutters + p.startPikemen
      && band.filter((v) => v.role === 'farmer').length === p.startFarmers
      && band.filter((v) => v.role === 'woodcutter').length === p.startWoodcutters
      && band.filter((v) => v.role === 'soldier').length === p.startPikemen,
      `with its founding band: ${p.startFarmers} forager, ${p.startWoodcutters} woodcutter, ${p.startPikemen} pikemen (${roster(band)})`);
    assert(band.filter((v) => v.role === 'soldier').every((v) => v.weapon === 'pike'), 'every gnome warrior of the band carries a pike');
    assert(CALLINGS.every((c) => s.callingFilled(c) <= s.callingCap(c)), `and every one of them has a place (${CALLINGS.map((c) => `${s.callingFilled(c)}/${s.callingCap(c)}`).join(', ')})`);
    assert(s.gnomesFound && !s.toolLocked('gnomehouse'), 'and the craft already learned');
    const step0 = World.center(doorstep(cot).tx, doorstep(cot).ty);
    assert(Math.hypot(s.player.x - step0.x, s.player.y - step0.y) < 24, 'the head starts on its doorstep');
    s.pantry.wheat = 40; s.player.tool = 'basket';
    Object.assign(s.player, World.center(s.world.granary!.tx + 1, s.world.granary!.ty + BUILDINGS.granary.h));
    s.fillBasket();
    assert(s.player.pack.bulk()[0]?.kind === 'food' && s.player.pack.bulk()[0].n > 0, 'the basket still fills at the granary');
    s.reset(7); assert(s.world.houses.length === 0 && s.gnomesFound, 'and a new village keeps the gnome start');

    // ---- peace ----------------------------------------------------------------------------
    p.peaceful = true; s = fresh(); s.day = 1;
    assert(!Number.isFinite(s.nextRaidDay) && !s.isRaidDay(p.firstRaidDay), 'nobody is marching while peace is on');
    for (let d = 0; d < p.bossDay + 1 && !s.result; d++) { s.day++; s.newDay(); }
    const raiders = () => s.agents.filter((a) => a instanceof Raider && !a.lairBound);
    assert(raiders().length === 0 && !s.raidActive, 'no raid ever comes');
    assert(!s.journal.some((j) => /Raiders sighted|Scouts report|Warlord marches/.test(j.text)), 'and no warning is ever posted');
    assert(s.result?.won === true && s.day >= p.bossDay, 'outlasting the day the Warlord would have come wins the run');
    s = fresh(); s.spawnRaid();
    assert(s.agents.some((a) => a instanceof Raider && !a.lairBound) && s.raidActive, 'but a raid called by hand still arrives');
    assert(!!s.ogre, 'and the Ogre is untouched');
    p.peaceful = wasPeace;

    // ---- inside the cottage, and the great pot in the square -------------------------------
    s = fresh(); const lodge = s.world.gnomeStart!;
    Object.assign(s.player, World.center(doorstep(lodge).tx, doorstep(lodge).ty));
    assert(s.doorAt() === lodge, 'a gnome cottage has a door you can push');
    s.interior.enter(lodge);
    assert(s.interior.active && s.interior.building === lodge, 'and you can walk inside');
    s.interior.leave();
    // the great pot: it takes what you throw into it, and nothing else
    for (const k of FOOD_KINDS) s.pantry[k] = 0;
    const pot = s.world.cookpot!;
    assert(!!pot && !pot.maxHp, 'a great pot stands in the square, and nothing can break it');
    const potC = buildingCenter(pot);
    assert(s.world.isBlocked(pot.tx, pot.ty) && !s.world.itemBlocked(potC.tx * TILE, potC.ty * TILE, 0),
      'you cannot walk through it, but a throw can land in it');
    const tossedIn = s.world.dropItem('food', 2, potC.tx * TILE, potC.ty * TILE, 'mushroom');
    s.potAbsorb();
    assert(!s.world.items.includes(tossedIn) && s.potStock(pot).mushroom === 2, `food that lands in the pot goes in it (${JSON.stringify(s.potStock(pot))})`);
    const besidePot = s.world.dropItem('food', 2, (pot.tx - 4) * TILE, potC.ty * TILE, 'mushroom');
    s.potAbsorb();
    assert(s.world.items.includes(besidePot), 'and food that lands beside it does not');
    s.world.removeItem(besidePot);
    s.openCooking(pot);
    assert(/burdock/.test(s.cookProblem(RECIPES.stew) ?? ''), `with only mushrooms in it the pot says what else it wants (${s.cookProblem(RECIPES.stew)})`);
    const burdock = s.world.dropItem('food', 1, potC.tx * TILE, potC.ty * TILE, 'burdock'); s.potAbsorb();
    assert(!s.world.items.includes(burdock) && s.cookProblem(RECIPES.stew) === null && s.cook(RECIPES.stew), 'throw the rest in and it cooks');
    const stews = () => (s.potServings(pot).stew ?? 0) + s.player.carriedOf('food', 'stew');
    assert(stews() === RECIPES.stew.makes && s.player.carriedOf('food', 'stew') > 0 && !s.potStock(pot).mushroom && !s.potStock(pot).burdock,
      `the cooked stew goes into the head's pack (${s.player.carriedOf('food', 'stew')} carried) and the ingredients are spent`);
    assert(s.pantry.stew === 0, 'nothing of it goes to the granary — it is ladled out, not stored');
    assert(/needs/.test(s.cookProblem(RECIPES.roast) ?? ''), 'a dish never started says what it wants');

    // the woods tell you what the pot wants: every wild plant some recipe calls for shimmers when ripe
    assert((['berry', 'mushroom', 'garlic', 'burdock'] as const).every((k) => POT_INGREDIENTS.has(k)),
      `every wild plant a recipe calls for is a pot ingredient (${[...POT_INGREDIENTS].join(', ')})`);
    assert(!POT_INGREDIENTS.has('hazelnut'), 'hazelnuts are in no recipe, so nothing marks a hazel');
    assert(Object.values(WILD_FOOD).filter((k) => POT_INGREDIENTS.has(k!)).length === 4, 'four of the five wild plants are worth carrying to the pot');
    // ladling it out: every gnome round the pot gets a bowl, and the bowl takes them somewhere
    for (const v of s.villagers()) if (v.gnome) Object.assign(v, { x: -900, y: -900 }); // the founders are stood well clear of the square
    assert(/no grown gnome/.test(s.servingProblem() ?? ''), `with nobody at the pot there is nobody to serve (${s.servingProblem()})`);
    const potSide = World.center(potC.tx, potC.ty + 3);
    const diner = s.spawn(new Villager(potSide.x, potSide.y, lodge, 'farmer', 20, 'Diner', s.mods));
    diner.gnome = true; diner.applyRole(s.mods); diner.hp = diner.maxHp; diner.update = () => {};
    const farGnome = s.spawn(new Villager(potSide.x + (SERVE_RANGE + 6) * TILE, potSide.y, lodge, 'farmer', 20, 'Far', s.mods));
    farGnome.gnome = true; farGnome.applyRole(s.mods); farGnome.update = () => {};
    assert(s.gnomesAtPot().includes(diner) && !s.gnomesAtPot().includes(farGnome), `only the gnomes within ${SERVE_RANGE} tiles are at the pot`);
    assert(s.servingProblem() === null, 'with a gnome at it and stew in it, the pot can be ladled out');
    const hurt = diner.maxHp - 5; diner.hp = hurt;
    const stewWas = stews();
    assert(s.serveGnomes() === 1 && stews() === stewWas - 1, 'one bowl, one gnome, one serving gone');
    assert(diner.mood?.dish === 'stew' && diner.moodNow === MOODS.stew && diner.hp > hurt, 'the gnome takes the mood of what it ate, and the meal heals it');
    assert(!farGnome.mood, 'and the one across the square gets nothing');
    // every bowl is a way of fighting, not a number: none of them touches how fast it works
    assert(Math.abs(diner.workMul - farGnome.workMul) < 1e-9 && diner.haul('wood') === farGnome.haul('wood'),
      'a bowl out of the pot is no help at all with the day job');
    assert(!!diner.moodNow?.glow && !!diner.moodNow?.spores, 'toadstool stew makes a lantern of it, and a cloud waiting to go up');
    // struck, it bursts: the raiders round it are dazed and thrown off
    const sporeFoe = s.spawn(new Raider(diner.x + 2 * TILE, diner.y)); sporeFoe.update = () => {};
    const foeWasX = sporeFoe.x;
    diner.hit(3, true, sporeFoe);
    assert(diner.sporePending, 'a blow that lands on it sets the spores off');
    diner.update = Villager.prototype.update;
    step(s, 0.05);
    diner.update = () => {};
    assert(sporeFoe.freeze >= MOODS.stew.spores!.freeze - 1e-9 && sporeFoe.pushX !== 0 && Math.abs(sporeFoe.x - foeWasX) >= 0,
      `the cloud leaves the raider reeling (${sporeFoe.freeze.toFixed(2)}s) and shoved off`);
    sporeFoe.dead = true; s.removeDead();
    // it wears off, and everything it wrote is put back
    const plainRadius = farGnome.radius;
    s.simTime += MOODS.stew.secs + 1;
    diner.update = Villager.prototype.update; // the mood clock runs in update(), so let it tick
    step(s, 0.2);
    diner.update = () => {};
    assert(!diner.mood && diner.moodNow === null, 'when the bowl wears off the gnome is itself again');
    // honey cake swells it: bigger, heavier on its feet, and half of a blow bounces off
    s.serveOne(diner, 'cake');
    assert(diner.radius > plainRadius && diner.mass > farGnome.mass, `cake swells it (radius ${diner.radius} against ${plainRadius}, mass ${diner.mass} against ${farGnome.mass})`);
    { const before = diner.hp; diner.hit(10, true); const took = before - diner.hp;
      const plainBefore = farGnome.hp; farGnome.hit(10, true); const plainTook = plainBefore - farGnome.hp;
      assert(took < plainTook, `and half of what lands on it bounces off (${took} against ${plainTook})`); }
    // a berry tart makes it too quick to lay a hand on
    s.serveOne(diner, 'tart');
    assert(diner.speed > farGnome.speed && !!diner.moodNow?.evade, `a tart sends it tearing about (${diner.speed.toFixed(0)} against ${farGnome.speed.toFixed(0)})`);
    { let missed = 0; for (let i = 0; i < 200; i++) { diner.hp = diner.maxHp; diner.hit(1, true); if (diner.hp === diner.maxHp) missed++; }
      assert(missed > 200 * MOODS.tart.evade! * 0.5 && missed < 200 * MOODS.tart.evade! * 1.6, `and near half the blows find nothing (${missed} of 200)`); }
    // garden soup: it slings stones at whatever comes near, with no bow and no arrows from the quiver
    s.serveOne(diner, 'soup');
    const quiverWas = s.arrows;
    const mark = s.spawn(new Raider(diner.x + 3 * TILE, diner.y)); mark.update = () => {};

    Object.assign(s.player, { x: diner.x, y: diner.y }); // at the head it keeps station, so the stone is the only thing that moves
    // it reaches for a stone on its own, on the mood's own clock
    let slings = 0; const realSling = s.slingStone.bind(s); (s as unknown as { slingStone: typeof s.slingStone }).slingStone = (v, sl) => { slings++; realSling(v, sl); };
    diner.update = Villager.prototype.update;
    step(s, MOODS.soup.sling!.every + 0.5);
    diner.update = () => {};
    assert(slings >= 1, `a sharp-eyed gnome reaches for a stone on its own (${slings} in ${(MOODS.soup.sling!.every + 0.5).toFixed(1)}s)`);
    assert(diner.task !== 'fleeing', 'and does not run from the raider at all — the bowl is what steadies it');
    // and what it slings is a real stone in the air, owned by the gnome, off its own arm: the village
    // quiver is never touched, and no bow is needed.
    s.grid.rebuild(s.agents);
    s.slingStone(diner, MOODS.soup.sling!);
    const stone = s.agents.find((x) => x instanceof Arrow) as Arrow | undefined;
    assert(!!stone && stone.owner === diner && stone.dmg === MOODS.soup.sling!.dmg && s.arrows === quiverWas,
      `the stone is loosed off its own arm for ${MOODS.soup.sling!.dmg} and costs the village no arrow (${s.arrows} left)`);
    if (stone) stone.dead = true;
    mark.dead = true; s.removeDead();
    // and a roast makes it stand and fight instead of running home
    s.serveOne(diner, 'roast');
    assert(!!diner.moodNow?.bold && MOODS.roast.knockback! > 3, 'a roast emboldens it, and puts weight behind its swing');
    const bully = s.spawn(new Raider(diner.x + 3 * TILE, diner.y)); bully.update = () => {};
    diner.update = Villager.prototype.update;
    step(s, 1.5);
    assert(diner.task !== 'fleeing' && !diner.hidden, `emboldened, it does not run from a raider (${diner.task})`);
    bully.dead = true; diner.dead = true; farGnome.dead = true; s.removeDead();
    // a dish is worth far more to a growing child than the raw food it was made of
    const fedKid = s.spawn(new Villager(0, 0, lodge, 'kid', 1, 'Fed', s.mods)); fedKid.update = () => {};
    const rawKid = s.spawn(new Villager(0, 0, lodge, 'kid', 1, 'Raw', s.mods)); rawKid.update = () => {};
    fedKid.diet.stew = p.dietFull; rawKid.diet.tomato = p.dietFull;
    assert(fedKid.dietNow().work > rawKid.dietNow().work * 2, `a child raised on stew far outgrows one raised on raw (${fedKid.dietNow().work.toFixed(2)} vs ${rawKid.dietNow().work.toFixed(2)} work)`);

    // eating one: a meal now, and a while of being better at something
    const stewLeft = stews();
    s.player.hp = 10; s.simTime = 100;
    assert(s.buffMul('work') === 1 && s.workHits(3) === 3, 'an unfed head works at the usual pace');
    assert(s.eatFromPot('stew') && s.player.hp > 10, 'a bowl out of the pot heals the head');
    assert(s.buffMul('work') > 1 && s.workHits(3) === 2, 'and a stew takes a swing off every tool');
    assert(stews() === stewLeft - 1, 'one serving is spent');
    s.simTime += RECIPES.stew.buffSecs + 1;
    assert(s.buffMul('work') === 1 && s.workHits(3) === 3, 'and it wears off');
    s.pantry.roast = 1; s.eatDish('roast');
    assert(s.buffMul('dmg') > 1 && s.buffMul('work') === 1, 'a new dish replaces the last one');
    assert(!s.eatDish('roast') && !s.eatDish('wheat'), 'you cannot eat what you do not have, and raw food is not a dish');

    // ---- the head's own belly ------------------------------------------------------------
    {
      const was = { max: p.hungerMax, rate: p.hungerPerDay, meal: p.hungerMeal, dmg: p.starveHpPerDay, on: p.hunger, god: p.godMode, peace: p.peaceful };
      // peaceful for the whole block: a raid landing mid-check would end the run, and a tick() on a
      // finished run returns before tickHunger ever runs — which reads as 'hunger does nothing'
      p.peaceful = true;
      // a quarter day at a time: long spans roll the clock far enough to starve the village out
      const QUARTER = () => p.dayLength / 4;
      try {
        let h = fresh(); let pl = h.player;
        assert(pl.hunger === p.hungerMax, 'a new run starts on a full belly');
        assert(FOOD_KINDS.every((k) => h.hungerOf(k) > 0), 'every food kind fills the belly');

        // the clock, and that the slider drives it
        ticks(h, p.dayLength / p.hungerPerDay);
        assert(Math.abs(pl.hunger - (p.hungerMax - 1)) < 0.05, `the belly empties at hungerPerDay (${pl.hunger.toFixed(2)} left)`);
        const rate = p.hungerPerDay; p.hungerPerDay = rate * 2; pl.hunger = p.hungerMax;
        ticks(h, p.dayLength / rate);
        assert(Math.abs(pl.hunger - (p.hungerMax - 2)) < 0.1, 'doubling the slider empties the belly twice as fast');
        p.hungerPerDay = rate;

        // three off switches, all genuinely off
        h = fresh(); pl = h.player;
        p.hunger = false; pl.hunger = 1; pl.hp = pl.maxHp; ticks(h, QUARTER());
        assert(pl.hunger === p.hungerMax && pl.hp === pl.maxHp && !h.eat(), 'hunger off: the belly stays full, nothing drains and T does nothing');
        p.hunger = true;
        p.hungerPerDay = 0; pl.hunger = 2; ticks(h, QUARTER());
        assert(pl.hunger === 2, 'a rate of 0 holds the belly where it is'); p.hungerPerDay = rate;
        p.starveHpPerDay = 0; pl.hunger = 0; pl.hp = pl.maxHp; ticks(h, QUARTER());
        assert(pl.hp === pl.maxHp, 'and 0 damage leaves the meter with no teeth'); p.starveHpPerDay = was.dmg;

        // the teeth
        h = fresh(); pl = h.player;
        pl.hunger = 0; pl.hp = pl.maxHp; let hp0 = pl.hp; ticks(h, QUARTER());
        assert(Math.abs((hp0 - pl.hp) - p.starveHpPerDay / 4) < 1.5, `an empty belly costs starveHpPerDay a day (${(hp0 - pl.hp).toFixed(1)} in a quarter)`);
        assert(h.buffMul('speed') === 1 && h.buffMul('dmg') === 1 && h.buffMul('work') === 1, 'and starving never touches the head\'s stats');
        h = fresh(); pl = h.player;
        pl.armor.chest = 2; pl.hunger = 0; pl.hp = pl.maxHp; hp0 = pl.hp; ticks(h, QUARTER());
        assert(Math.abs((hp0 - pl.hp) - p.starveHpPerDay / 4) < 1.5, 'armor turns no blow from hunger'); pl.armor.chest = 0;
        h = fresh(); pl = h.player;
        h.mods.playerRegen = 5; pl.hunger = 0; pl.hp = 20; ticks(h, 2);
        assert(pl.hp < 20, 'a starving head does not regenerate'); h.mods.playerRegen = 0;
        h = fresh(); pl = h.player;
        p.godMode = true; pl.hunger = 0; pl.hp = pl.maxHp; ticks(h, QUARTER());
        assert(pl.hp === pl.maxHp && pl.hunger === 0, 'god mode starves without bleeding'); p.godMode = false;

        // the overnight rest
        h = fresh(); pl = h.player;
        pl.hunger = 0; pl.hp = 10; h.newDay();
        assert(pl.hp === 10, 'a night on an empty belly is no rest at all');
        pl.hunger = p.hungerMax; pl.hp = 10; h.newDay();
        assert(pl.hp > 10, 'a fed head wakes mended');

        // eating: pack before granary, raw before cooked
        h = fresh(); pl = h.player;
        clearBulk(h); for (const k of FOOD_KINDS) h.pantry[k] = 0;
        h.pantry.wheat = 20; h.pantry.stew = 5; pl.hunger = 0;
        assert(h.eatKind()?.from === 'granary' && h.eatKind()?.kind === 'wheat', 'an empty pack eats from the granary, raw before cooked');
        pl.pickUp('food', 4, 'meat');
        assert(h.eatKind()?.from === 'pack' && h.eatKind()?.kind === 'meat', 'but what you carry is eaten first');
        assert(h.eat() && Math.abs(pl.hunger - Math.min(p.hungerMax, p.hungerMeal * 2)) < 1e-6, 'meat fills twice its weight (Food.power)');
        assert(pl.carriedOf('food', 'meat') === 4 - p.hungerMeal, 'and exactly one meal leaves the pack');
        pl.hunger = p.hungerMax;
        assert(!h.eat(), 'a full belly refuses the key rather than wasting food');

        // dishes are the same verb, and are never refused
        clearBulk(h); for (const k of FOOD_KINDS) h.pantry[k] = 0;
        h.pantry.stew = 3; pl.hunger = 0; h.simTime = 500;
        assert(h.eat() && h.buffMul('work') > 1 && pl.hunger > 0, 'with only stew left, T both fills you and warms you');
        pl.hunger = 0; h.pantry.roast = 1;
        assert(h.eatDish('roast') && pl.hunger > 0, 'EAT ONE at the pot fills the belly as well as healing');
        pl.hunger = p.hungerMax; h.pantry.roast = 1;
        assert(h.eatDish('roast'), 'a dish is a deliberate spend: a full belly never refuses it');

        // a ruin feeds nobody
        clearBulk(h); for (const k of FOOD_KINDS) h.pantry[k] = 0;
        h.pantry.wheat = 50; h.world.granary!.ruined = true;
        assert(!h.eatKind() && !h.eat(), 'a ruined granary feeds nobody'); h.world.granary!.ruined = false;

        // and it can kill, down the same path any death takes
        h = fresh(); pl = h.player;
        pl.hunger = 0; pl.hp = 2; ticks(h, QUARTER());
        assert(pl.dead && String(h.screen) === 'over', 'an empty belly can kill, and the run ends the way any death does');
      } finally {
        p.hungerMax = was.max; p.hungerPerDay = was.rate; p.hungerMeal = was.meal;
        p.starveHpPerDay = was.dmg; p.hunger = was.on; p.godMode = was.god; p.peaceful = was.peace;
      }
    }
    // dishes are food all the way down, but never a crop and never wild
    assert(!DISHES.some((d) => CROP_KINDS.includes(d)) && !DISHES.some((d) => Object.values(WILD_FOOD).includes(d)), 'and nothing will ever sow or forage one');
    for (const k of FOOD_KINDS) s.pantry[k] = 0;
    s.pantry.stew = 10; s.pantry.wheat = 5;
    assert(s.fullestKind() === 'wheat', 'rations come out of the raw bins first');
    s.food -= 5;
    assert(s.pantry.stew === 10 && s.pantry.wheat === 0, 'so a dawn of eating leaves the dishes alone');
    s.food -= 4;
    assert(s.pantry.stew === 6, 'but once the raw food is gone the dishes are eaten rather than nothing');
    p.gnomeStart = wasGnome; s = fresh();
    assert(s.world.houses.length > 0 && !!s.world.wildGnomeHouse && !s.gnomesFound, 'turning the gnome start off restores the founding family');

    // ---- trolls ---------------------------------------------------------------------------
    const wasTrolls = p.trolls;
    p.trolls = 12; s = fresh(false, true);
    const trolls = () => s.agents.filter((a) => a instanceof Troll && !a.dead) as Troll[];
    assert(trolls().length === 12, `the map is stocked with p.trolls of them (${trolls().length})`);
    p.trolls = 0; s = fresh(false, true);
    assert(trolls().length === 0, 'and the slider can clear them off it entirely');
    p.trolls = 8; s = fresh(false, true);
    const hx = COLS / 2, hy = ROWS / 2;
    assert(trolls().every((t) => Math.hypot(t.tile.tx - hx, t.tile.ty - hy) >= TROLL.minDist), 'none of them starts on top of the village');
    assert(trolls().every((t) => s.world.bfs(t.tile, { tx: hx, ty: hy }, true).length > 0), 'and every one of them can reach it');
    assert(!(trolls()[0] as unknown as { sounder?: unknown }).sounder, 'they keep no families');

    const tr = trolls()[0];
    assert(tr.wild && tr.lairBound && !tr.harmless && !s.raidActive, 'a troll is wild and no raid, but nobody\'s friend either');
    assert(tr.hp === TROLL.hp && tr.dmg === p.trollDmg, 'it is raider-tier, and its blow is on a slider');

    // hostile on sight: it hunts a villager it can see, with no provoking
    s = fresh(); clearing(s);
    const lone = s.spawn(new Troll(World.center(120, 100).x, World.center(120, 100).y));
    const prey = s.spawn(new Villager(World.center(126, 100).x, World.center(126, 100).y, s.world.houses[0], 'farmer', 20, 'Bait', s.mods));
    prey.update = () => {};
    assert(!lone.hunting, 'a troll that has seen nobody is only prowling');
    step(s, 2);
    assert(lone.quarry === prey && lone.hunting && lone.task === 'hunting', 'it hunts a villager on sight, unprovoked');
    const gap0 = lone.dist(prey); step(s, 3);
    assert(lone.dist(prey) < gap0, `and closes on them (${gap0.toFixed(0)}px to ${lone.dist(prey).toFixed(0)}px)`);

    // no leash: distance never calls it off, only losing the quarry does
    s = fresh(); clearing(s);
    const far = s.spawn(new Troll(World.center(120, 100).x, World.center(120, 100).y));
    const runner = s.spawn(new Villager(World.center(125, 100).x, World.center(125, 100).y, s.world.houses[0], 'farmer', 20, 'Runner', s.mods));
    runner.update = () => {};
    step(s, 2); assert(far.quarry === runner, 'it picks up the scent');
    Object.assign(runner, World.center(120, 60)); // bolt 40 tiles away, far past any boar's leash
    step(s, 3);
    assert(far.quarry === runner && far.hunting, 'and however far the quarry runs, it keeps coming');
    runner.hidden = true; step(s, 2);
    assert(far.quarry !== runner, 'only getting indoors shakes it off');

    // a felled troll leaves meat, not scrap
    s = fresh(); clearing(s);
    const doomed = s.spawn(new Troll(World.center(122, 100).x, World.center(122, 100).y));
    doomed.hp = 1; doomed.hit(99, true);
    s.tick(1 / 60);
    const meatLeft = s.world.items.filter((it) => it.kind === 'food' && it.food === 'meat');
    assert(meatLeft.length === 1 && meatLeft[0].n === TROLL.meat, `it drops ${TROLL.meat} meat where it fell`);
    assert(!s.world.items.some((it) => it.kind === 'scrap'), 'and no scrap iron — it carried none');
    p.trolls = wasTrolls;

    // ---- beehives -------------------------------------------------------------------------
    const wasHives = p.hives;
    p.hives = 20; s = fresh(false, false, true);
    assert(s.world.hives.size === 20, `the canopies hold p.hives hives (${s.world.hives.size})`);
    p.hives = 0; s = fresh(false, false, true);
    assert(s.world.hives.size === 0, 'and the slider can clear them off the map');
    p.hives = 15; s = fresh(false, false, true);
    const hvs = [...s.world.hives.values()];
    assert(hvs.every((h) => s.isOldGrowth(s.world.get(h.tx, h.ty)!)), 'every hive hangs in an old-growth canopy');
    assert(hvs.every((h) => Math.hypot(h.tx - COLS / 2, h.ty - ROWS / 2) >= HIVE.minDist), 'and none of them hangs over the village');

    // walking under one wakes the swarm
    s = fresh(false, false, true); clearing(s);
    s.world.set(126, 100, 'tree').stage = 20;
    s.world.hives.set(100 * s.world.cols + 126, { tx: 126, ty: 100, angry: 0 });
    const hive = s.world.hiveAt(126, 100)!;
    const walker = s.spawn(new Villager(World.center(122, 100).x, World.center(122, 100).y, s.world.houses[0], 'farmer', 20, 'Stung', s.mods));
    walker.update = () => {};
    const swarms = () => s.agents.filter((a) => a instanceof Swarm && !a.dead) as Swarm[];
    ticks(s, 0.5);
    assert(swarms().length === 0 && hive.angry === 0, 'four tiles off, the hive is undisturbed');
    Object.assign(walker, World.center(126, 101));
    ticks(s, 0.5);
    assert(swarms().length === 1 && hive.angry > 0, 'step under it and the swarm comes out');
    const hpWas = walker.hp;
    ticks(s, 3);
    assert(walker.hp < hpWas, `and it stings whoever woke it (${hpWas} to ${walker.hp})`);
    assert(swarms().length === 1, 'one hive makes one swarm, however long you stand there');

    // getting indoors sheds it, and the hive settles
    walker.hidden = true;
    ticks(s, HIVE.patience + 4);
    assert(swarms().length === 0, 'behind a door, the bees give up and go home');

    // wildlife is left alone; raiders are not
    s = fresh(false, false, true); clearing(s);
    s.world.set(126, 100, 'tree').stage = 20;
    s.world.hives.set(100 * s.world.cols + 126, { tx: 126, ty: 100, angry: 0 });
    const sow = s.foundSounder(126, 101, 1).members[0];
    Object.assign(sow, World.center(126, 101));
    sow.update = () => {};
    ticks(s, 1);
    assert(s.agents.filter((a) => a instanceof Swarm).length === 0, 'a boar under a hive is nobody\'s business');
    const lured = s.spawn(new Troll(World.center(126, 101).x, World.center(126, 101).y));
    lured.update = () => {};
    ticks(s, 0.5);
    assert(s.agents.some((a) => a instanceof Swarm), 'but a troll gets the same welcome anyone would');

    // chopping the tree brings the hive down, honey and all
    s = fresh(false, false, true); clearing(s);
    s.world.set(126, 100, 'tree').stage = 20;
    s.world.hives.set(100 * s.world.cols + 126, { tx: 126, ty: 100, angry: 0 });
    s.knockDownHive(126, 100, null);
    const honey = s.world.items.filter((it) => it.kind === 'food' && it.food === 'honey');
    assert(honey.length === 1 && honey[0].n === HIVE.honey, `a felled hive leaves ${HIVE.honey} honey`);
    assert(!s.world.hiveAt(126, 100), 'and the hive is gone from the map');
    s.world.set(130, 100, 'tree').stage = 20;
    s.world.hives.set(100 * s.world.cols + 130, { tx: 130, ty: 100, angry: 0 });
    s.world.set(130, 100, 'sapling');
    assert(!s.world.hiveAt(130, 100), 'felling a tree by any route takes its hive with it');

    // honey is food, but nothing will ever sow or forage it
    assert(FOOD_KINDS.includes('honey') && !CROP_KINDS.includes('honey') && !Object.values(WILD_FOOD).includes('honey'), 'honey is food, but neither a crop nor a wild plant');
    for (const k of FOOD_KINDS) s.pantry[k] = 0;
    const honeyPot = s.world.cookpot!;
    Object.assign(s.potStock(honeyPot), { honey: 2, wheat: 1 });
    s.openCooking(honeyPot);
    assert(s.cookProblem(RECIPES.cake) === null && s.cook(RECIPES.cake), 'and the great pot bakes a honey cake from it');
    assert((s.potServings(honeyPot).cake ?? 0) + s.player.carriedOf('food', 'cake') === RECIPES.cake.makes && !s.potStock(honeyPot).honey, 'spending the honey exactly');
    s.openCooking(null);
    // the cook reaches into the head's pack and the granary: nothing has to be thrown in the pot any more
    {
      const pot2 = s.world.cookpot!;
      for (const k of Object.keys(s.potStock(pot2))) delete s.potStock(pot2)[k as never];
      clearBulk(s); s.player.pickUp('food', 1, 'mushroom');
      s.pantry.mushroom = 1; s.pantry.burdock = 0;
      s.openCooking(pot2);
      assert(/burdock/.test(s.cookProblem(RECIPES.stew) ?? '') && /pick it wild/.test(s.cookProblem(RECIPES.stew) ?? ''), `short of burdock, the card says where it grows (${s.cookProblem(RECIPES.stew)})`);
      s.pantry.burdock = 1;
      assert(s.cook(RECIPES.stew), 'with one mushroom carried and the rest in the granary, it cooks');
      assert(s.player.carriedOf('food', 'mushroom') === 0 && s.pantry.mushroom === 0 && s.pantry.burdock === 0 && s.player.carriedOf('food', 'stew') === RECIPES.stew.makes,
        `the pack's mushroom and the granary's go into it, and ${RECIPES.stew.makes} stews come out into the pack`);
      s.openCooking(null); clearBulk(s);
    }
    p.hives = wasHives;

    // ---- skulks: what the long grass keeps ------------------------------------------------
    {
      const wasSkulks = p.skulks, wasTiles = p.skulkTiles, wasEvery = p.skulkEvery, wasClub = p.skulkClub;
      try {
        const s = fresh(false, false, false, true);
        assert(s.world.tallCount === 0 && s.skulkCap() === 0, 'a mown map sustains no skulks at all');

        // the census follows every route that raises or clears long grass
        s.world.get(150, 150)!.tall = true; s.world.tallCount++;
        const raised = s.world.tallCount;
        assert(s.world.cutGrass(150, 150) && s.world.tallCount === raised - 1, 'mowing a tile takes it off the census');
        s.world.get(151, 150)!.tall = true; s.world.tallCount++;
        s.world.set(151, 150, 'tilled');
        assert(s.world.tallCount === raised - 1, 'and so does tilling it');

        // the ceiling is the standing grass, bounded by the slider
        p.skulks = 100; p.skulkTiles = 10; s.world.tallCount = 55;
        assert(s.skulkCap() === 5, 'the ceiling is one skulk per p.skulkTiles of standing grass');
        p.skulks = 3;
        assert(s.skulkCap() === 3, 'and never more than p.skulks, however much grass stands');
        s.world.mowAll();
        assert(s.world.tallCount === 0 && s.skulkCap() === 0, 'mowing the lot closes the ceiling again');

        // they creep out of grass, and never into your lap
        p.skulks = 60; p.skulkTiles = 1; p.skulkEvery = 0.5;
        for (let ty = 60; ty < 70; ty++) for (let tx = 60; tx < 70; tx++) {
          const t = s.world.get(tx, ty)!;
          if (t.kind === 'grass' && !t.building && !t.defense) { t.tall = true; s.world.tallCount++; }
        }
        Object.assign(s.player, World.center(124, 100));
        for (let i = 0; i < 60 && s.skulkCount() < 5; i++) s.tick(1);
        const crept = s.agents.filter(a => a instanceof Skulk && !a.dead) as Skulk[];
        assert(crept.length > 0, 'skulks creep out of the standing grass');
        assert(crept.every(k => Math.hypot(k.x - s.player.x, k.y - s.player.y) >= SKULK.spawnDist * TILE), 'and never within SKULK.spawnDist of the head');
        assert(crept.every(k => k.wild && k.lairBound && !k.harmless), 'a skulk is wild and lair-bound, so it neither starts a raid nor holds one open');
        assert(!s.raidActive, 'a field full of them is still not a raid');

        // ...and stop coming once the grass is gone
        s.world.mowAll();
        for (const k of crept) k.dead = true;
        s.removeDead();
        for (let i = 0; i < 20; i++) s.tick(1);
        assert(s.skulkCount() === 0, 'mow the grass and no more creep out');
      } finally { p.skulks = wasSkulks; p.skulkTiles = wasTiles; p.skulkEvery = wasEvery; p.skulkClub = wasClub; }
    }

    // ---- who a skulk goes for, and what it leaves ------------------------------------------
    {
      const wasClub = p.skulkClub;
      try {
        const s = fresh(false, false, false, true);
        clearing(s);
        const here = World.center(124, 100);
        // a gnome further off still beats a nearer villager
        const near = new Villager(here.x + 3 * TILE, here.y, s.world.houses[0], 'farmer', 20, 'Near', s.mods);
        const far = new Villager(here.x + 6 * TILE, here.y, s.world.houses[0], 'farmer', 20, 'Far', s.mods);
        far.gnome = true;
        s.agents.push(near, far);
        const k = new Skulk(here.x, here.y); s.spawn(k);
        s.grid.rebuild(s.agents);
        k.update(1 / 60, s);
        assert(k.quarry === far, 'a skulk walks past a nearer villager to get at a gnome');
        near.dead = true; far.dead = true; k.dead = true; s.removeDead();

        // the drop is a club, or a single scrap — never meat
        p.skulkClub = 1;
        const a = new Skulk(here.x, here.y); s.spawn(a); a.hp = 0; a.dead = true;
        s.tick(1 / 60);
        const club = s.world.items.find(it => it.kind === 'gear' && it.gear?.kind === 'weapon'); // (not one of the lost tools lying out in the wild)
        assert(!!club && club.gear?.kind === 'weapon' && club.gear.slot === 'melee' && club.gear.tier === 0, 'a slain skulk leaves the club it swung');
        assert(!s.world.items.some(it => it.food === 'meat'), 'and never any meat');
        s.world.items.length = 0;

        p.skulkClub = 0;
        const b = new Skulk(here.x, here.y); s.spawn(b); b.hp = 0; b.dead = true;
        s.tick(1 / 60);
        const scrap = s.world.items.find(it => it.kind === 'scrap');
        assert(!!scrap && scrap.n === 1, 'or a single scrap when it has no club to leave');
        s.world.items.length = 0;
      } finally { p.skulkClub = wasClub; }
    }

    // ---- the chest holds gear, and breaks clubs down ---------------------------------------
    {
      const s = fresh(false, false, false, true);
      const barracks = s.world.barracks[0];
      assert(!!barracks, 'the starting village has a barracks to keep a chest in');
      s.player.pack.clear();
      const club = { kind: 'weapon', slot: 'melee', tier: 0 } as const;
      const i = s.player.pack.put({ ...club });
      assert(s.storeGear(i, barracks) && s.stashOf(barracks).length === 1 && s.player.pack.at(i) === null, 'a club stows in the barracks chest');

      // a full woodyard would swallow the wood, so the chest refuses to break anything up for nothing
      s.wood = s.woodCap;
      assert(!!s.salvageProblem(barracks, 0) && s.stashOf(barracks).length === 1, 'a full woodyard leaves the club in the chest rather than breaking it up for nothing');
      s.wood = s.woodCap - 20;
      const woodWas = s.wood | 0;
      assert(s.salvageProblem(barracks, 0) === null && s.salvage(barracks, 0), 'with room in the woodyard it breaks down there');
      assert((s.wood | 0) === woodWas + SKULK.clubWood && s.stashOf(barracks).length === 0, 'returning its wood and leaving the chest empty');

      // supplies belong in the granary, not the chest
      s.player.pack.clear(); s.player.pickUp('wood', 5);
      const woodSlot = s.player.pack.slots.findIndex(x => !!x);
      assert(!s.storeGear(woodSlot, barracks) && s.stashOf(barracks).length === 0, 'the chest refuses supplies');

      // a tool may be parked, but never broken down: losing the hammer is unrecoverable
      s.player.pack.clear();
      const hammer = s.player.pack.put({ kind: 'tool', tool: 'hammer' });
      assert(s.storeGear(hammer, barracks) && !!s.salvageProblem(barracks, 0), 'a tool parks in the chest but is never broken down');
      assert(s.takeGear(0, barracks) && s.player.pack.hasTool('hammer'), 'and comes back out again');

      // forged gear gives back half of what it cost
      s.player.pack.clear();
      s.storeGear(s.player.pack.put({ kind: 'weapon', slot: 'melee', tier: 1 }), barracks);
      s.wood = Math.min(s.wood, s.woodCap - 40);
      const paid = s.forgeCost(WEAPONS.melee.tiers[1]), before = s.wood | 0, scrapBefore = s.scrap;
      s.salvage(barracks, 0);
      assert((s.wood | 0) === before + Math.floor(paid.wood / 2) && s.scrap === scrapBefore + Math.floor(paid.scrap / 2), 'a forged blade gives back half its forge cost');

      // BREAK DOWN CLUBS takes the clubs and leaves everything else
      s.player.pack.clear();
      for (let n = 0; n < 3; n++) s.storeGear(s.player.pack.put({ ...club }), barracks);
      s.storeGear(s.player.pack.put({ kind: 'armor', slot: 'helmet', tier: 1 }), barracks);
      s.wood = Math.min(s.wood, s.woodCap - 40);
      const woodBefore = s.wood | 0;
      assert(s.salvageClubs(barracks) === 3 && (s.wood | 0) === woodBefore + 3 * SKULK.clubWood, 'breaking down clubs takes every club in one go');
      assert(s.stashOf(barracks).length === 1 && s.stashOf(barracks)[0].kind === 'armor', 'and leaves the armor alone');

      // the chest has a bottom
      while (s.stashOf(barracks).length < STASH_SLOTS) s.stashOf(barracks).push({ ...club });
      s.player.pack.clear();
      const spare = s.player.pack.put({ ...club });
      assert(!s.storeGear(spare, barracks) && s.player.pack.at(spare)?.kind === 'weapon', 'a full chest keeps the club in your pack');
      s.stashOf(barracks).length = 0;
    }

    // ---- camps: between raids the enemies live out in the wild, guard their ground, and leave the village be ----
    {
      const run = (secs: number) => { for (let i = 0; i < Math.ceil(secs * 60); i++) { s.grid.rebuild(s.agents); s.tick(1 / 60); } };
      s = fresh(); clearing(s); s.agents = [s.player]; s.world.items.length = 0;
      const home = World.center(120, 100), at = World.center(150, 100);
      Object.assign(s.player, home);
      const camp = { x: at.x, y: at.y, members: [] as Raider[], cleared: null as number | null, born: 0 };
      s.camps.push(camp); (s as unknown as { manCamp(c: typeof camp): void }).manCamp(camp);
      assert(camp.members.length >= 2 && camp.members.every((m) => m.camp && m.lairBound), `a camp is manned by ${camp.members.length} raiders who belong to it`);
      run(60);
      const far = Math.max(...camp.members.map((m) => Math.hypot(m.x - at.x, m.y - at.y)));
      const nearest = Math.min(...camp.members.map((m) => s.player.dist(m)));
      assert(camp.members.every((m) => !m.dead) && far <= (p.campLeash + 1) * TILE && nearest > 20 * TILE, `left alone for a minute they keep to their camp and never come for the village (${(far / TILE).toFixed(1)} tiles from camp, ${(nearest / TILE).toFixed(0)} from the head)`);
      // walk into their ground and they come for you
      Object.assign(s.player, World.center(146, 100)); s.fog?.update(1);
      const hpWas = s.player.hp; run(1.5); // (long enough to be hit, short of a death that would end the run)
      assert(s.player.hp < hpWas, `walking into their ground, the head is set upon (${hpWas} -> ${s.player.hp} hp)`);
      // run past the leash and they let you go, walk home, and are whole again
      Object.assign(s.player, home); s.player.hp = s.player.maxHp; s.player.dead = false; s.screen = 'playing';
      for (const m of camp.members) m.hp = Math.max(1, m.maxHp - 5);
      run(20);
      assert(camp.members.every((m) => m.hp === m.maxHp && Math.hypot(m.x - at.x, m.y - at.y) <= 2 * TILE), `outrun past the leash, they go home and heal (${camp.members.map((m) => `${m.hp}/${m.maxHp}`).join(", ")})`);
      for (const m of camp.members) m.dead = true; s.removeDead(); s.camps = [];
    }

    // ---- R: a cooked meal lobbed at the reticle feeds everyone in the splash ----------------------------
    {
      const run = (secs: number) => { for (let i = 0; i < Math.ceil(secs * 60); i++) { s.grid.rebuild(s.agents); s.tick(1 / 60); } };
      s = fresh(); clearing(s); s.agents = [s.player]; s.world.items.length = 0;
      Object.assign(s.player, World.center(120, 100)); clearBulk(s);
      const spot = World.center(125, 100), home3 = s.world.houses[0];
      const gnome = (dx: number, dy: number, name: string) => { const g = s.spawn(new Villager(spot.x + dx, spot.y + dy, home3, 'farmer', 20, name, s.mods)); g.gnome = true; g.applyRole(s.mods); g.update = () => {}; return g; };
      const fed = [gnome(0, 0, 'A'), gnome(10, 0, 'B'), gnome(0, 10, 'C')], left = gnome(80, 0, 'Far');
      // with nothing cooked, R puts up the reticle but throws nothing
      s.paused = false;
      s.beginMealAim(); s.releaseMeal();
      assert(s.lobs.length === 0, 'with no meal in the pack, R throws nothing');
      s.player.pickUp('food', 2, 'stew');
      s.hoverPoint = { x: spot.x, y: spot.y }; s.hoverTile = World.toTile(spot.x, spot.y);
      s.beginMealAim();
      assert(s.mealAim && s.loadedMeal() === 'stew', 'holding R puts the reticle up with the stew loaded');
      s.releaseMeal();
      assert(s.lobs.length === 1 && s.player.carriedOf('food', 'stew') === 1, 'letting go lobs one stew out of the pack');
      run(1.5);
      assert(s.lobs.length === 0 && fed.every((g) => g.mood?.dish === 'stew') && !left.mood, `it lands and every gnome in the splash eats it, and none outside (${fed.filter((g) => g.mood).length} fed)`);
      // a meal thrown at your own feet feeds you too
      s.player.hp = 10;
      s.hoverPoint = { x: s.player.x, y: s.player.y }; s.hoverTile = s.player.tile;
      run(1.1); // the throw's cooldown
      s.beginMealAim(); s.releaseMeal(); run(1);
      assert(s.player.hp > 10 && s.buffMul('work') > 1 && s.player.carriedOf('food', 'stew') === 0, `inside the splash the head eats it: healed to ${s.player.hp}, and the stew's buff`);
      s.paused = true; s.hoverPoint = null; s.hoverTile = null;
      for (const g of [...fed, left]) g.dead = true; s.removeDead();
    }

    // ---- paths at scale: a crowd shares one distance field; everything else draws from a per-tick budget ----
    {
      s = fresh(); clearing(s);
      const w = s.world, goal = { tx: 130, ty: 100 };
      w.beginTick(2);
      const many = [118, 119, 120, 121, 122].map((x) => w.route({ tx: x, ty: 96 }, goal));
      assert(many.every((p) => p !== null && p.length > 0) && w.pathBudget === 0, `five walkers to one goal: two A* searches, then the rest walk a shared field (budget left ${w.pathBudget})`);
      assert(w.route({ tx: 118, ty: 104 }, { tx: 125, ty: 92 }) === null, 'a lone walker over the budget is told to ask again next tick');
      w.beginTick();
      assert((w.route({ tx: 118, ty: 104 }, { tx: 125, ty: 92 }) ?? []).length > 0, 'and gets its path once the budget refills');
    }

    // ---- fog at scale: a block of soldiers lights its ground through a dozen merged discs, never less than before ----
    {
      s = fresh(); clearing(s); s.agents = [s.player]; Object.assign(s.player, World.center(120, 100));
      for (let i = 0; i < 100; i++) { const g = s.spawn(new Villager(World.center(110 + (i % 10), 104 + Math.floor(i / 10)).x, World.center(110 + (i % 10), 104 + Math.floor(i / 10)).y, s.world.houses[0], 'soldier', 20, `F${i}`, s.mods)); g.gnome = true; g.applyRole(s.mods); }
      const f = s.fog as unknown as { sources(): { tx: number; ty: number; r: number }[]; bucketed(): { tx: number; ty: number; r: number }[] };
      const lit = (srcs: { tx: number; ty: number; r: number }[]) => { const set = new Set<number>(); for (const q of srcs) for (let y = Math.floor(q.ty - q.r); y <= q.ty + q.r; y++) for (let x = Math.floor(q.tx - q.r); x <= q.tx + q.r; x++) if (Math.hypot(x + 0.5 - q.tx, y + 0.5 - q.ty) < q.r) set.add(y * 1000 + x); return set; };
      const raw = f.sources(), merged = f.bucketed(), a = lit(raw), b = lit(merged);
      assert(merged.length < raw.length / 3 && [...a].every((k) => b.has(k)), `100 soldiers light their ground through ${merged.length} discs instead of ${raw.length}, and nothing they saw goes dark`);
      for (const ag of s.agents) if (ag !== s.player) (ag as Villager).dead = true; s.removeDead();
    }

    // ---- the crowd: gnomes and rank-and-file raiders are drawn as instanced flipbook bodies ----------
    {
      s = fresh(); clearing(s); s.agents = [s.player]; Object.assign(s.player, World.center(120, 100));
      const v = s.view!;
      const g = s.spawn(new Villager(World.center(123, 100).x, World.center(123, 100).y, s.world.houses[0], 'soldier', 20, 'Crowded', s.mods));
      g.gnome = true; g.weapon = 'pike'; g.applyRole(s.mods); g.update = () => {};
      v.snapCamera(); s.draw(); s.draw();
      const actorOf = (id: number) => (v as unknown as { actors: { actors: Map<number, unknown> } }).actors.actors.has(id);
      assert(v.crowd.drawn.has(g.id) && !actorOf(g.id), 'a gnome is drawn by the crowd, not as a rig of its own');
      assert(!v.crowd.drawn.has(s.player.id) && actorOf(s.player.id), 'the head stays a full actor');
      const at = v.projectWorld(g.x, g.y, 0.4);
      assert(v.pickAt(at.x, at.y).agent === g, 'pointing at a crowd body picks that gnome');
      g.dead = true; s.removeDead(); s.draw();
      assert(!v.crowd.drawn.has(g.id), 'a dead one leaves the crowd (it lies down and sinks)');
    }

    // ---- regiments: gnome soldiers fall in under banners and fight as blocks -----------------------
    {
      const run = (secs: number) => { for (let i = 0; i < Math.ceil(secs * 60); i++) { s.grid.rebuild(s.agents); s.tick(1 / 60); } };
      s = fresh(); clearing(s); s.agents = [s.player]; Object.assign(s.player, World.center(104, 100)); s.world.items.length = 0;
      const army: Villager[] = [];
      for (let i = 0; i < 50; i++) {
        const at = World.center(122 + (i % 8), 96 + Math.floor(i / 8));
        const g = s.spawn(new Villager(at.x, at.y, s.world.houses[0], 'soldier', 20, `Rank${i}`, s.mods));
        g.gnome = true; g.applyRole(s.mods); g.weapon = 'pike'; army.push(g);
      }
      run(0.1);
      const reg = s.regiments[0];
      assert(s.regiments.length === 1 && reg.members.length === 50 && army.every((g) => g.regiment === reg) && reg.stance === 'follow', `fifty gnome soldiers fall in under one banner, following the head (${s.regiments.length} banners, ${reg?.members.length} under the first)`);
      const extra = s.spawn(new Villager(army[0].x, army[0].y, s.world.houses[0], 'soldier', 20, 'Recruit', s.mods)); extra.gnome = true; extra.applyRole(s.mods);
      run(0.6);
      assert(s.regiments.length === 2 && extra.regiment === s.regiments[1], `the fifty-first raises a second banner (${s.regiments.length})`);
      extra.dead = true; s.removeDead(); run(0.1);
      assert(s.regiments.length === 1, 'and a banner with nobody under it is struck');
      const off = () => Math.max(...reg.active().map((g) => Math.hypot(g.x - g.slot!.x, g.y - g.slot!.y)));
      // placed with the wand: the block marches to the spot and takes its shape
      const spot = World.center(130, 100);
      s.player.tool = 'wand'; s.selectRegiment(reg);
      for (const g of s.placementPlan({ x0: spot.x, y0: spot.y, x1: spot.x + 40, y1: spot.y })) g.reg.place(g.x, g.y, g.fx, g.fy, g.cols);
      run(14);
      assert(reg.stance === 'hold' && Math.hypot(reg.x - spot.x, reg.y - spot.y) < 1 && off() < TILE / 2, `a placed square marches there and every gnome stands within half a tile of its slot (worst ${off().toFixed(1)} px)`);
      const front = reg.slots.slice(0, Math.ceil(Math.sqrt(50)));
      assert(front.every((q) => q.x > reg.x + 2 * SLOT_GAP), 'facing east: the front rank is the eastmost');
      // turned a quarter: the slots turn with it
      reg.place(reg.x, reg.y, 0, 1);
      run(10);
      assert(reg.slots.slice(0, 8).every((q) => q.y > reg.y + 2 * SLOT_GAP) && off() < TILE / 2, `turned to face south, the front rank is the southmost and the block re-forms (worst ${off().toFixed(1)} px)`);
      // losing ten from the front: the ranks close up, each body about one place, and the front rank stays full
      for (const g of reg.members.slice(0, 10)) g.dead = true;
      s.removeDead(); run(1 / 60);
      const front7 = reg.slots.slice(0, 7);
      assert(reg.members.length === 40 && reg.slots.length === 40 && off() < 2.5 * SLOT_GAP && front7.every((q) => reg.active().some((g) => g.slot === q)),
        `ten fall from the front: the ranks close, the front rank full again and nobody more than a couple of places from its new slot (${reg.members.length} left, worst ${off().toFixed(1)} px)`);
      run(8);
      assert(off() < TILE / 2, `and the ranks close (worst ${off().toFixed(1)} px)`);
      // a charge onto a holding pike block breaks on its front
      reg.place(reg.x, reg.y, 1, 0); run(6);
      const back = reg.x - 2 * TILE;
      const charge: Raider[] = [];
      for (let i = 0; i < 6; i++) {
        const r = s.spawn(new Raider(reg.x + 9 * TILE, reg.y + (i - 2.5) * 10));
        r.update = (dt: number) => { r.vx = -r.speed; r.x -= r.speed * dt; };
        charge.push(r);
      }
      run(8);
      assert(charge.every((r) => r.dead || r.x > back), `six raiders charging a holding pike square never get through it (${charge.filter((r) => r.dead).length} dead, furthest at ${Math.min(...charge.map((r) => r.x - reg.x)).toFixed(0)} px from the banner)`);
      for (const r of charge) r.dead = true; s.removeDead();
      // advance: the block marches on the nearest raider and fights it
      const prey = s.spawn(new Raider(reg.x + 14 * TILE, reg.y)); prey.update = () => {}; prey.hp = prey.maxHp = 400;
      s.setStance([reg], 'advance');
      run(10);
      assert((reg.quarry === prey || prey.dead) && prey.hp < 400, `advancing, the block finds the nearest raider and its pikes strike it (${prey.hp.toFixed(0)} hp left, banner ${Math.round(Math.hypot(reg.x - prey.x, reg.y - prey.y))} px off)`);
      prey.dead = true; s.removeDead();
      // the wand keys: F changes the shape, G holds, H follows
      s.selectRegiment(reg);
      assert(s.regimentKey('F') && reg.shape === 'line', 'with a regiment picked, F turns the square into a line');
      assert(s.regimentKey('H') && (reg.stance as string) === 'follow' && s.regimentKey('G') && (reg.stance as string) === 'hold', 'H sets it following, G holding');
      s.clearSquad(); s.player.tool = 'sword';
      assert(!s.regimentKey('F'), 'with nothing picked (or the wand away) the keys keep their old jobs');
    }

    // ---- warbands: the enemy's blocks, built on the same code as your regiments ------------------------
    {
      const run = (secs: number) => { for (let i = 0; i < Math.ceil(secs * 60); i++) { s.grid.rebuild(s.agents); s.tick(1 / 60); } };
      s = fresh(); clearing(s); s.agents = [s.player]; Object.assign(s.player, World.center(104, 100)); s.world.items.length = 0;
      const wb = new Warband(1, '#e8e0c8', World.center(132, 100).x, World.center(132, 100).y);
      wb.face(-1, 0); s.warbands.push(wb);
      const band: Raider[] = [];
      for (let i = 0; i < 30; i++) {
        const at = World.center(128 + (i % 6), 96 + Math.floor(i / 6));
        const r = s.spawn(i % 6 === 0 ? new Brute(at.x, at.y) : new Raider(at.x, at.y)); r.lairBound = true; wb.add(r); band.push(r);
      }
      run(10);
      const off = () => Math.max(...wb.active().map((r) => Math.hypot(r.x - r.slot!.x, r.y - r.slot!.y)));
      assert(wb.state === 'camp' && off() < TILE / 2 && band.every((r) => r.warband === wb && r.block?.side === 'theirs'), `a warband of 30 stands in camp in its block, every raider within half a tile of its slot (worst ${off().toFixed(1)} px)`);
      const lead = band.slice(0, 6); for (const r of lead) r.dead = true; s.removeDead(); run(6);
      assert(wb.members.length === 24 && off() < TILE / 2, `six fall and its ranks close, as a regiment's do (${wb.members.length} left, worst ${off().toFixed(1)} px)`);
      // one of yours comes within its sight: it charges, and the front rank strikes
      const bait = s.spawn(new Villager(World.center(120, 100).x, World.center(120, 100).y, s.world.houses[0], 'farmer', 20, 'Bait', s.mods)); bait.update = () => {}; bait.hp = bait.maxHp = 500;
      run(6);
      assert(wb.state === 'charge' && wb.quarry === bait && bait.hp < 500, `a villager ${12} tiles off is charged and struck (${bait.hp.toFixed(0)}/500 hp left)`);
      bait.dead = true; s.removeDead(); Object.assign(s.player, World.center(40, 60)); run(1); // (the head, too, out of its sight)
      assert(wb.state === 'camp', 'with nobody left in sight it stands down');
      // released, its raiders are ordinary raiders again
      wb.release(); run(1 / 60);
      assert(band.filter((r) => !r.dead).every((r) => !r.block && !r.slot) && s.warbands.length === 0, 'released, its raiders leave the block and the banner is struck');
      for (const r of band) r.dead = true; s.removeDead();
      // the grid search for victims finds who a scan of everyone would
      const folk = [0, 1, 2, 3].map((i) => s.spawn(new Villager(World.center(110 + i * 9, 92 + i * 4).x, World.center(110 + i * 9, 92 + i * 4).y, s.world.houses[0], 'farmer', 20, `Folk${i}`, s.mods)));
      s.grid.rebuild(s.agents);
      const scan = (x: number, y: number) => [s.player as Villager | typeof s.player, ...folk].filter((m) => !m.dead && !m.hidden).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
      const spots = [[100, 100], [125, 96], [140, 110], [10, 10], [200, 140]].map(([tx, ty]) => World.center(tx, ty));
      assert(spots.every((q) => s.nearestVictim(q.x, q.y) === scan(q.x, q.y)), 'the nearest victim by grid rings is the nearest by a scan of everyone, near or far');
      for (const f of folk) f.dead = true; s.removeDead();
    }

    // ---- hosts: the enemy's armies muster in the wild, march in warbands, storm the walls, and break ------
    {
      const run = (secs: number) => { for (let i = 0; i < Math.ceil(secs * 60); i++) { s.grid.rebuild(s.agents); s.tick(1 / 60); } };
      const days = [0, 3, 6, 9, 12, 15, 18].map((d) => hostSize(p.firstRaidDay + d));
      assert(days.every((n, i) => n === Math.min(p.hostMax, Math.round(p.hostBase * 2 ** (i * 3 / p.hostDoubleDays)))) && hostSize(999) === p.hostMax,
        `hosts double every ${p.hostDoubleDays} days from ${p.hostBase}, never past ${p.hostMax} (${days.join(', ')})`);
      const mix = hostCounts(320);
      assert(Object.values(mix).reduce((a, b) => a + b, 0) === 320 && mix.raider === 192 && hostCounts(1).raider === 1, `the mix adds up: ${JSON.stringify(mix)}`);
      // muster: on the warning day a host gathers out in the wild, in warbands, and waits
      s = fresh(); s.agents = [s.player]; s.world.items.length = 0;
      const c = World.center(COLS / 2, ROWS / 2); Object.assign(s.player, c);
      const warnDay = p.firstRaidDay + 3 - 1; s.day = warnDay; s.dayTime = 0; s.newDay();
      const host = s.hosts[0];
      assert(!!host && host.state === 'mustering' && host.peak === hostSize(warnDay + 1) && s.journal.some((j) => /mustering to the/.test(j.text)), `on the warning day a host of ${host?.peak} musters, and the scouts say so`);
      const ranks = host.warbands.flatMap((w) => w.members);
      assert(Math.hypot(host.at.x - c.x, host.at.y - c.y) >= 40 * TILE && ranks.every((r) => r.warband && r.lairBound) && !s.raidActive, `${ranks.length} of it camp in ${host.warbands.length} warbands ${Math.round(Math.hypot(host.at.x - c.x, host.at.y - c.y) / TILE)} tiles out, not yet a raid`);
      const camped = host.warbands.map((w) => ({ x: w.x, y: w.y }));
      run(5);
      assert(host.warbands.every((w, i) => Math.hypot(w.x - camped[i].x, w.y - camped[i].y) < TILE) && host.state === 'mustering', 'and nobody moves before the day it marches');
      // march: at the raid day's dawn the column sets off down one road
      s.day++; s.newDay();
      // distance by road (a host whose road starts off sideways still closes on the village)
      const road = (w: { x: number; y: number }) => s.world.bfs(World.toTile(w.x, w.y), World.toTile(c.x, c.y), true).length * TILE;
      const d0 = road(host.warbands[0]);
      assert(host.state === 'marching' && s.raidActive && host.bodies().every((r) => !r.lairBound), 'on the raid day it marches and the raid is on');
      run(15);
      const lead = host.warbands.find((w) => w.members.length)!, d1 = road(lead);
      const offs = host.warbands.flatMap((w) => w.active().map((r) => Math.hypot(r.x - r.slot!.x, r.y - r.slot!.y))).sort((a, b) => a - b);
      assert(d1 < d0 - 10 * TILE && offs[offs.length >> 1] < TILE, `the column closes on the village by road (${Math.round(d0 / TILE)} → ${Math.round(d1 / TILE)} tiles), its raiders keeping their places (median ${offs[offs.length >> 1]?.toFixed(1)} px off)`);
      // engage: a regiment across its road is charged; the rest of the column keeps marching
      const ahead = host.pointAt(host.lead + 10 * TILE);
      const guard: Villager[] = [];
      for (let i = 0; i < 30; i++) { const g = s.spawn(new Villager(ahead.x + (i % 6) * 8, ahead.y + Math.floor(i / 6) * 8, s.world.houses[0], 'soldier', 20, `Guard${i}`, s.mods)); g.gnome = true; g.applyRole(s.mods); g.weapon = 'pike'; guard.push(g); }
      run(0.6);
      const reg = guard[0].regiment!; reg.place(ahead.x, ahead.y, lead.x - ahead.x, lead.y - ahead.y);
      const hostHp = () => host.bodies().reduce((a, r) => a + (r.dead ? 0 : r.hp), 0), guardHp = () => guard.reduce((a, g) => a + (g.dead ? 0 : g.hp), 0);
      const h0 = hostHp(), g0 = guardHp();
      let charged = false;
      for (let k = 0; k < 24; k++) { run(0.5); if (host.warbands.some((w) => w.state === 'charge')) charged = true; }
      assert(charged && hostHp() < h0 && guardHp() < g0, `a gnome regiment across the road is charged, and both sides bleed (host ${Math.round(h0)} → ${Math.round(hostHp())} hp, guard ${Math.round(g0)} → ${Math.round(guardHp())})`);
      for (const g of guard) g.dead = true; s.removeDead();
      // assault: a warband that reaches the walls breaks ranks and storms in as raiders
      const stormer = host.warbands.find((w) => w.members.length)!, its = [...stormer.members];
      stormer.x = c.x + 10 * TILE; stormer.y = c.y; for (const r of its) Object.assign(r, { x: stormer.x, y: stormer.y });
      run(1 / 60);
      assert(its.every((r) => r.dead || (!r.block && !r.lairBound)) && s.raidActive, `a warband at the walls releases its ${its.length} as ordinary raiders`);
      // rout: cut below a seventh of its strength, the rest turn for home
      const standing = host.bodies().filter((r) => !r.dead);
      for (const r of standing.slice(0, Math.max(0, standing.length - Math.floor(host.peak * 0.1)))) r.dead = true;
      s.removeDead(); run(1 / 60);
      assert(host.state === 'routed' && host.warbands.every((w) => !w.members.length || (w.goal && Math.hypot(w.goal.x - host.at.x, w.goal.y - host.at.y) < 1 && w.members.every((r) => r.lairBound))), `cut to ${host.alive()} of ${host.peak}, the host breaks and runs for its muster ground`);
      for (const r of host.bodies()) r.dead = true; s.removeDead(); run(0.1);
      assert(!s.raidActive && s.hosts.length === 0, 'and when the last of it is gone the raid is over');
    }

    // ---- loot: tables by danger, the gear the fallen fought with, and a forge that makes only the basics ----
    {
      const tiers = (d: number) => { const r = new Rng(7); return Array.from({ length: 400 }, () => lootTier(r, d)); };
      const low = tiers(0), high = tiers(1);
      assert(low.every((t) => t === 1) && high.some((t) => t === 3) && high.every((t) => t >= 2), `danger 0 rolls only leather and bronze (${[...new Set(low)]}), danger 1 iron and steel (${[...new Set(high)]})`);
      const a = rollLoot(new Rng(99), 0.6, 8), b = rollLoot(new Rng(99), 0.6, 8);
      assert(a.length === 8 && JSON.stringify(a) === JSON.stringify(b) && a.some((q) => q.kind === 'weapon' || q.kind === 'armor') && a.some((q) => q.kind === 'food' || q.kind === 'wood' || q.kind === 'scrap'), `a roll is the same from the same seed, gear and supplies both (${a.map((q) => q.kind).join(', ')})`);
      assert(danger(0, 0) === 0 && danger(Math.hypot(COLS, ROWS), p.bossDay) === 1, 'danger runs from the doorstep on day 0 to the far corner on the day of the Warlord');
      // drops: with dropChance 1 each kind leaves what it fought with; with 0, nothing
      p.dropChance = 1;
      const r = new Rng(3), slots = (k: string) => new Set(Array.from({ length: 60 }, () => enemyDrop(r, k, false, 5)).map((g) => g && g.slot));
      const raider = slots('raider'), brute = slots('brute'), shaman = slots('shaman'), rat = slots('rat');
      const warlord = enemyDrop(r, 'raider', true, 1);
      assert([...raider].every((q) => q === 'melee' || q === 'shield') && [...brute].every((q) => q === 'chest' || q === 'legs') && [...shaman].every((q) => q === 'helmet') && [...rat].every((q) => q === null) && warlord?.tier === 3,
        `raiders drop blades and bucklers, brutes chests and legs, shamans helms, rats nothing, the Warlord steel (${[...raider]} / ${[...brute]} / ${[...shaman]} / ${warlord?.tier})`);
      s = fresh(); s.world.items.length = 0;
      const die = (a: Raider) => (s as unknown as { onDeath(m: Raider): void }).onDeath(a);
      const foe = s.spawn(new Raider(s.player.x + 60, s.player.y)); foe.hp = 0; foe.dead = true; die(foe); s.removeDead();
      const fell = s.world.items.filter((it) => it.kind === 'gear' && it.gear && it.gear.kind !== 'tool');
      p.dropChance = 0;
      const foe2 = s.spawn(new Raider(s.player.x + 60, s.player.y)); foe2.hp = 0; foe2.dead = true; die(foe2); s.removeDead();
      assert(fell.length === 1 && s.world.items.filter((it) => it.kind === 'gear' && it.gear && it.gear.kind !== 'tool').length === 1, 'a slain raider leaves its gear on the ground beside its scrap (and none when dropChance is 0)');
      // forge rare: the barracks makes tier 1 only; iron is found; a found iron piece reforges to steel
      p.forgeMaxTier = 1;
      s = fresh(); s.wood = 999; s.scrap = 999;
      s.world.barracks[0].level = 3; s.world.refresh(s.world.barracks[0]);
      s.player.armor.helmet = 0; s.player.weapons.melee = 0;
      const bronze = s.craftWeapon(s.player, 'melee'), iron = s.craftWeapon(s.player, 'melee');
      assert(bronze && !iron && s.player.weapons.melee === 1 && /looted/.test(s.weaponProblem(s.player, 'melee') ?? ''), `with forgeMaxTier 1 a bronze sword forges and iron does not (${s.weaponProblem(s.player, 'melee')})`);
      s.player.armor.helmet = 2; // a found iron helm
      assert(s.craftArmor(s.player, 'helmet') && s.player.armor.helmet === 3 && s.isReforge(3), 'a found iron helm reforges to steel at a Lv3 barracks');
      p.forgeMaxTier = 3;
    }

    // ---- chests: a camp guards one, the Ogre sleeps on his hoard; opened, they spill for the taking ----
    {
      const run = (secs: number) => { for (let i = 0; i < Math.ceil(secs * 60); i++) { s.grid.rebuild(s.agents); s.tick(1 / 60); } };
      s = fresh(); clearing(s); s.agents = [s.player]; s.world.items.length = 0;
      const at = World.center(128, 100);
      const camp: { x: number; y: number; members: Raider[]; cleared: number | null; born: number; chest?: Chest } = { x: at.x, y: at.y, members: [], cleared: null, born: 0 };
      s.camps.push(camp); (s as unknown as { manCamp(c: typeof camp): void }).manCamp(camp);
      const ch = camp.chest!;
      assert(!!ch && s.world.chests.includes(ch) && !ch.opened && ch.loot.length === Math.round(6 * p.lootMul) && Math.hypot(ch.tx - 128, ch.ty - 100) <= 4,
        `a camp keeps a shut chest of ${ch?.loot.length} things by its fire`);
      assert(!s.openChest(ch) && /Guarded/.test(s.chestGuard(ch) ?? '') && !ch.opened, `it won't open while the camp is held (${s.chestGuard(ch)})`);
      for (const m of camp.members) m.dead = true; s.removeDead();
      // a right-click on it walks the head over and breaks it open
      Object.assign(s.player, World.center(ch.tx - 6, ch.ty));
      s.order({ kind: 'loot', chest: ch }); run(4); settle(s);
      const spilt = s.world.items.filter((it) => Math.hypot(it.x - (ch.tx + 0.5) * TILE, it.y - (ch.ty + 0.5) * TILE) < 3.5 * TILE);
      assert(ch.opened && ch.loot.length === 0 && spilt.length >= 1 && s.world.items.every((it) => it.rest), `cleared, the head walks to it and it bursts: ${spilt.length} things lie round it (some already in the pack)`);
      assert(!s.openChest(ch) && s.chestNear((ch.tx + 0.5) * TILE, (ch.ty + 0.5) * TILE) === null, 'an open chest is empty, and a right-click passes it by');
      (s as unknown as { manCamp(c: typeof camp): void }).manCamp(camp);
      assert(!ch.opened && ch.loot.length > 0 && s.world.chests.filter((c) => c === ch).length === 1, 'when the camp is manned again its chest is stocked again');
      // the hoard: shut while the Ogre is up; opened while he sleeps, it wakes him
      s = fresh();
      const hoard = s.world.chests.find((c) => c.source === 'lair')!, ogre = s.ogre!;
      assert(!!hoard && hoard.loot.length === Math.round(16 * p.lootMul) && hoard.loot.filter((q) => q.kind === 'weapon' || q.kind === 'armor').length > hoard.loot.length / 3, `the Ogre's hoard holds ${hoard?.loot.length} things, mostly gear`);
      ogre.state = 'roaming';
      assert(!s.openChest(hoard) && /Ogre/.test(s.chestGuard(hoard) ?? ''), 'the hoard stays shut while the Ogre is up');
      ogre.state = 'sleeping'; ogre.hidden = true;
      assert(s.openChest(hoard) && (ogre.state as string) === 'roaming' && ogre.aggroed && !ogre.hidden, 'opened while he sleeps, the hoard wakes him');
    }

    // ---- the opening: gnomes by default, no farm, wild food by the door ------------------------------
    {
      assert(savedGnomeStart === true && p.ps1Height === 1080, `the game starts as gnomes (${savedGnomeStart}) and draws 1080 rows (${p.ps1Height})`);
      for (const gnomes of [false, true]) {
        p.gnomeStart = gnomes; s = fresh();
        const field = s.world.tiles.filter((t) => t.kind === 'crop' || t.kind === 'tilled').length;
        const hx = COLS / 2, hy = ROWS / 2, near: { kind: string; tx: number; ty: number }[] = [], from = s.world.nearest((hx + 0.5) * TILE, (hy + 0.5) * TILE, (_t, tx, ty) => !s.world.isBlocked(tx, ty))!;
        for (let ty = hy - 15; ty <= hy + 15; ty++) for (let tx = hx - 15; tx <= hx + 15; tx++) { const t = s.world.get(tx, ty); if (t && t.kind in WILD_FOOD && t.stage >= 99 && Math.hypot(tx - hx, ty - hy) <= 14 && s.world.bfs(from, { tx, ty }).length) near.push({ kind: t.kind, tx, ty }); } // ripe, and a walk from the square
        const n = (k: string) => near.filter((q) => q.kind === k).length;
        assert(field === 0 && near.length >= 24 && n('mushroom') >= 4 && n('burdock') >= 2 && n('garlic') >= 1,
          `a new ${gnomes ? 'gnome' : 'village'} start has no field (${field}) and ${near.length} ripe wild plants by the door — ${n('mushroom')} mushroom, ${n('burdock')} burdock, ${n('garlic')} garlic, ${n('bush')} berry, all a walk from the square`);
      }
      p.gnomeStart = false;
      // the lost tools: none in the pack, each lying where it fell, found by walking onto it
      s.reset(42); s.screen = 'playing'; s.paused = true;
      const sq = { tx: COLS / 2, ty: ROWS / 2 }, from = s.world.nearest((sq.tx + 0.5) * TILE, (sq.ty + 0.5) * TILE, (_t, tx, ty) => !s.world.isBlocked(tx, ty))!;
      const caches = s.world.toolCaches, band = { axe: [22, 32], hammer: [40, 60], hoe: [50, 75] } as const;
      const out = (c: { tx: number; ty: number }) => Math.hypot(c.tx - sq.tx, (c.ty - sq.ty) / 0.75);
      assert(!s.player.pack.hasTool('axe') && !s.player.pack.hasTool('hoe') && !s.player.pack.hasTool('hammer') && /Find your axe/.test(s.toolLocked('axe') ?? '') && !!s.toolLocked('hoe') && !!s.toolLocked('hammer'), `a new village has no axe, hoe or hammer, and says where to find them (${s.toolLocked('axe')})`);
      assert(caches.length === 3 && caches.every((c) => out(c) >= band[c.tool][0] - 1 && out(c) <= band[c.tool][1] + 1 && s.world.bfs(from, c).length > 0 && s.world.items.some((it) => it.gear?.kind === 'tool' && it.gear.tool === c.tool && Math.hypot(it.x - World.center(c.tx, c.ty).x, it.y - World.center(c.tx, c.ty).y) < 2)),
        `the axe, hammer and hoe lie a walk away, in their bands (${caches.map((c) => `${c.tool} ${Math.round(out(c))}`).join(', ')})`);
      assert(s.journal.some((j) => /lost your tools/.test(j.text) && j.toast), 'and the opening says where they went');
      const walkTo = (tool: string) => { const c = caches.find((q) => q.tool === tool)!; Object.assign(s.player, World.center(c.tx, c.ty)); s.pickUpItems(0); };
      s.recoverBasicKit();
      assert(!s.player.pack.hasTool('hammer'), 'recovering the basic kit does not conjure a hammer you have never found');
      walkTo('axe');
      assert(s.player.pack.hasTool('axe') && !s.toolLocked('axe') && s.journal.some((j) => /found your old axe/.test(j.text)), 'walking onto the axe takes it, frees it, and says so');
      walkTo('hammer'); s.player.pack.removeAt(s.player.pack.findSlot((g) => g.kind === 'tool' && g.tool === 'hammer'));
      s.recoverBasicKit();
      assert(s.player.pack.hasTool('hammer'), 'but a found hammer, lost again, is recovered');
    }

    // ---- the news: a fight is told once it is over, not body by body; the night's hunger in one line ----
    {
      const run = (secs: number) => { for (let i = 0; i < Math.ceil(secs * 60); i++) { s.grid.rebuild(s.agents); s.tick(1 / 60); } };
      s = fresh(); clearing(s); s.agents = [s.player]; Object.assign(s.player, World.center(COLS / 2, ROWS / 2)); s.world.items.length = 0;
      const at = World.center(COLS / 2 + 40, ROWS / 2);
      const kill = (n: number, make: (i: number) => Raider | Villager) => { for (let i = 0; i < n; i++) { const m = make(i); m.update = () => {}; m.hp = 0; m.dead = true; } };
      const told = s.journal.length;
      kill(30, (i) => s.spawn(new Raider(at.x + (i % 6) * 8, at.y + Math.floor(i / 6) * 8)));
      kill(10, (i) => s.spawn(new Villager(at.x - 30 + i * 6, at.y, s.world.houses[0], 'soldier', 20, `Fallen${i}`, s.mods)));
      run(1);
      const during = s.journal.slice(told);
      assert(!during.some((j) => /slain|is dead|falls/.test(j.text)) && !during.some((j) => j.toast), `while the fight lasts nothing is posted body by body, and nothing toasts (${during.map((j) => j.text).join(' / ') || 'silence'})`);
      assert(s.battle?.slain === 30 && s.battle?.lost === 10, `but the fallen are counted (${s.battle?.slain} slain, ${s.battle?.lost} lost)`);
      run(6.5);
      const after = s.journal.slice(told).filter((j) => /slain/.test(j.text));
      assert(after.length === 1 && /30 raiders slain, 10 of yours lost/.test(after[0].text) && /to the east/.test(after[0].text) && !after[0].toast && !s.battle,
        `six quiet seconds later the fight is told once, and no alert for ten lost (${after[0]?.text})`);
      const told2 = s.journal.length;
      kill(25, (i) => s.spawn(new Villager(at.x + i * 4, at.y + 20, s.world.houses[0], 'soldier', 20, `Fell${i}`, s.mods)));
      run(7);
      const big = s.journal.slice(told2).find((j) => /25 of yours lost/.test(j.text));
      assert(!!big && big.toast, `losing ${BATTLE_BIG_TEST} or more is worth an alert (${big?.text})`);
      // a night's starving: one line, no alert for one or two
      const told3 = s.journal.length;
      const hungry = [0, 1].map((i) => s.spawn(new Villager(at.x, at.y, s.world.houses[0], 'farmer', 20, `Hungry${i}`, s.mods)));
      for (const v of hungry) { v.update = () => {}; v.hungerDays = 99; }
      s.food = 0; s.day++; s.newDay();
      const night = s.journal.slice(told3).filter((j) => /starved/.test(j.text));
      assert(hungry.every((v) => v.dead) && night.length === 1 && /2 starved in the night/.test(night[0].text) && !night[0].toast, `two who starve in one night make one line and no alert (${night.map((j) => j.text).join(' / ')})`);
      s.removeDead();
    }

    // ---- the warren and the army economy: quick births, a granary-fed nursery, bigger barracks, gnome rations ----
    {
      s = fresh(); clearing(s); s.agents = [s.player]; s.world.items.length = 0; s.mods.babyFever = false;
      s.gnomesFound = false;
      assert(!!s.toolLocked('warren'), 'the warren is locked until the gnomes are found');
      s.gnomesFound = true;
      assert(!s.toolLocked('warren'), 'and open once they are');
      let wt = -1, wy = -1;
      for (let ty = 90; ty < 110 && wt < 0; ty++) for (let tx = 110; tx < 140; tx++) if (s.world.canBuild('warren', tx, ty)) { wt = tx; wy = ty; break; }
      const warren = s.world.place('warren', wt, wy);
      warren.firewood = 99; warren.warm = true; s.food = 500;
      const ma = s.spawn(new Villager(0, 0, warren, 'farmer', 20, 'Warren Ma', s.mods)), pa = s.spawn(new Villager(0, 0, warren, 'woodcutter', 20, 'Warren Pa', s.mods)); warren.residents = 2;
      for (const g of [ma, pa]) { g.gnome = true; g.applyRole(s.mods); g.update = () => {}; }
      assert(s.beds(warren) === WARREN.beds && s.cribs(warren) === WARREN.cribs && s.world.gnomeHouses.includes(warren), `a warren sleeps ${WARREN.beds} and keeps ${WARREN.cribs} cribs, and is a gnome home`);
      assert(!s.birthProblem(warren), `two grown gnomes anywhere in the village are enough for it to breed (${s.birthProblem(warren)})`);
      const wasChance = p.birthChance, wasTwins = s.mods.twinChance; p.birthChance = 1; s.mods.twinChance = 0;
      warren.nextBirth = 0; s.tickBirths();
      const said = s.journal.length;
      let rolls = 0;
      while (s.infantsOf(warren).length < WARREN.cribs && rolls < 40) { s.simTime += p.warrenBirthEvery; s.tickBirths(); rolls++; }
      s.simTime += p.warrenBirthEvery * 5; s.tickBirths();
      const born = s.infantsOf(warren);
      assert(born.length === WARREN.cribs && born.every((v) => v.gnome) && rolls <= WARREN.cribs * 2, `a birth roll every ${p.warrenBirthEvery}s fills its ${WARREN.cribs} cribs with gnomes, and no more (${born.length} in ${rolls} rolls)`);
      assert(!s.journal.slice(said).some((j) => /was born/.test(j.text)), 'and says nothing child by child');
      // the nursery walks out: its children eat from the granary at dawn, with nothing thrown in the yard
      for (const v of born) { v.age = p.infantDays; v.update = () => {}; }
      s.tickAges(0);
      const kids = born.filter((v) => v.role === 'kid');
      const ration = p.foodPerDay * s.mods.foodPerDayMul * p.gnomeRation;
      assert(Math.abs(s.dailyRation() - (kids.length + 2) * ration) < 1e-6, `a dawn's rations are gnomes × foodPerDay × gnomeRation (${s.dailyRation().toFixed(2)} for ${kids.length + 2} gnomes)`);
      const before = s.food, ask = s.dailyRation(), told = s.journal.length;
      s.day++; s.newDay();
      assert(kids.length === WARREN.cribs && kids.every((v) => !v.dead && v.hungerDays === 0) && Math.abs(before - s.food - ask) < 1e-6, `the warren's ${kids.length} children ate from the granary at dawn, nothing thrown in their yard (${(before - s.food).toFixed(2)} food eaten)`);
      const lines = s.journal.slice(told).map((j) => j.text);
      assert(lines.some((t) => t === `${WARREN.cribs} gnomes were born in the warrens`) && lines.some((t) => /toddled out of the warrens/.test(t)) && !lines.some((t) => /going hungry/.test(t)),
        `and the dawn tells the warrens' night in a line or two (${lines.filter((t) => /warren/.test(t)).join(' / ')})`);
      p.birthChance = wasChance; s.mods.twinChance = wasTwins;
      // barracks: forty under arms, twenty more for each level above the first
      const bk = s.world.barracks[0], lvl = bk.level;
      bk.level = 1; const one = s.callingCap('soldier');
      bk.level = 3; const three = s.callingCap('soldier');
      bk.level = lvl;
      assert(p.soldierCap === 40 && one === 40 * s.world.barracks.length && three === one + 2 * SOLDIER_CAP_PER_LEVEL, `a barracks keeps 40 under arms, ${SOLDIER_CAP_PER_LEVEL} more a level (${one} at Lv1, ${three} at Lv3)`);
      s.view?.snapCamera(); s.draw();
      assert(true, 'the warren mound draws');
    }

    // ---- the large map: open plains for battles, searches that cost what they touch, a quiet far wild ----
    {
      // (the harness plays the classic map; the large one is generated here on its own)
      const big = new World(480, 320);
      big.generate(new Rng(7), 3, 'gnome', 7);
      const hx = 240, hy = 160;
      const inner = (q: { tx: number; ty: number; rx: number; ry: number }) => { let open = 0, all = 0; for (let y = q.ty - q.ry; y <= q.ty + q.ry; y++) for (let x = q.tx - q.rx; x <= q.tx + q.rx; x++) { if (((x - q.tx) / q.rx) ** 2 + ((y - q.ty) / q.ry) ** 2 > 0.6) continue; all++; const t = big.get(x, y)!; if (!big.isBlocked(x, y) && t.kind !== 'thicket' && !t.tall) open++; } return open / all; };
      assert(big.plains.length >= 6 && big.plains.every((q) => inner(q) > 0.97 && Math.hypot(q.tx - hx, (q.ty - hy) * 1.3) >= PLAINS.minDist),
        `the large map opens ${big.plains.length} plains out beyond the old country, each clear of wood, thorn and long grass (${big.plains.map((q) => inner(q).toFixed(2)).join(', ')})`);
      assert(big.plains.every((q) => big.bfs({ tx: q.tx, ty: q.ty }, { tx: hx, ty: hy }).length > 0), 'and every one can be marched to from the village');
      assert(big.get(hx, hy - 3)?.building?.kind === 'cookpot' && !!big.lair, 'with the village in the middle as before');
      // a walker's search for an unreachable spot gives up instead of flooding the map
      for (let y = 20; y <= 30; y++) for (let x = 20; x <= 30; x++) if (x === 20 || x === 30 || y === 20 || y === 30) { big.set(x, y, 'grass'); big.placeDefense('wall', x, y); }
      big.set(25, 25, 'grass');
      let t0 = performance.now();
      const none = big.route({ tx: hx, ty: hy + 6 }, { tx: 25, ty: 25 });
      const ms = performance.now() - t0;
      assert(Array.isArray(none) && none.length === 0 && ms < 15, `a walker asking for a walled-in spot on the large map is told no way in ${ms.toFixed(1)} ms`);
      t0 = performance.now();
      const far = big.bfs({ tx: hx, ty: hy + 6 }, { tx: 25, ty: 25 });
      assert(far.length === 0, `while a reachability check searches to the end (${(performance.now() - t0).toFixed(1)} ms)`);
      // the reused search arrays give the same answer twice running
      const goal = { tx: big.plains[0].tx, ty: big.plains[0].ty }, a1 = big.bfs({ tx: hx, ty: hy + 6 }, goal), a2 = big.bfs({ tx: hx, ty: hy + 6 }, goal);
      assert(a1.length > 0 && a1.length === a2.length && a1.every((q, i) => q.tx === a2[i].tx && q.ty === a2[i].ty), `searches share their working arrays and still agree (${a1.length} steps)`);
      // out where nobody of yours is, a creature thinks every fourth tick with four ticks' time
      s = fresh(); s.agents = [s.player]; Object.assign(s.player, World.center(120, 80));
      const lone = s.spawn(new Raider(World.center(10, 10).x, World.center(10, 10).y)), near = s.spawn(new Raider(s.player.x + 40, s.player.y));
      const seen = new Map<Raider, number[]>([[lone, []], [near, []]]);
      for (const r of [lone, near]) r.update = (dt: number) => { seen.get(r)!.push(dt); };
      for (let i = 0; i < 8; i++) { s.grid.rebuild(s.agents); s.tick(1 / 60); }
      const ld = seen.get(lone)!, nd = seen.get(near)!;
      assert(nd.length === 8 && ld.length === 2 && ld.every((d) => Math.abs(d - 4 / 60) < 1e-9), `a raider by the head thinks every tick (${nd.length}/8); one alone in the far wild every fourth, with four ticks' time (${ld.length}/8)`);
      lone.dead = near.dead = true; s.removeDead();
      // the game loop ticks 120 times a second, sharing the heavy work out: the head moves every tick,
      // everyone else on alternate ticks with twice the time — the same ground covered, half the work a frame
      s = fresh(); s.agents = [s.player]; Object.assign(s.player, World.center(120, 80));
      const walker = s.spawn(new Villager(s.player.x + 20, s.player.y, s.world.houses[0], 'farmer', 20, 'Walker', s.mods));
      const steps: number[] = [], headSteps: number[] = [], headUpdate = s.player.update.bind(s.player);
      walker.update = (dt: number) => { steps.push(dt); };
      s.player.update = (dt: number, sc: typeof s) => { headSteps.push(dt); headUpdate(dt, sc); };
      for (let i = 0; i < 8; i++) { s.grid.rebuild(s.agents); s.tick(1 / 120); }
      assert(headSteps.length === 8 && steps.length === 4 && steps.every((d) => Math.abs(d - 1 / 60) < 1e-9), `at 120 ticks a second the head moves every tick (${headSteps.length}/8) and a villager every other with twice the time (${steps.length}/8)`);
      walker.dead = true; s.removeDead(); delete (s.player as { update?: unknown }).update; // back to its own
    }

    // ---- MOBA commands: the head walks where it is sent, hunts what it is told to, uses what it is pointed at ----
    {
      // full ticks: the standing order is driven by the scene's tick, not by the agents alone
      const run = (secs: number) => { for (let i = 0; i < Math.ceil(secs * 60); i++) { s.grid.rebuild(s.agents); s.tick(1 / 60); } };
      s = fresh(); clearing(s); s.agents = [s.player]; Object.assign(s.player, World.center(120, 100)); s.world.items.length = 0;
      // a walk round a wall: the path is found, and the order clears on arrival
      for (let y = 97; y <= 103; y++) s.world.placeDefense('wall', 123, y);
      const there = World.center(126, 100);
      s.order({ kind: 'move', x: there.x, y: there.y });
      run(6);
      assert(s.player.dist(there) < 4 && s.command === null, `a right-click walks the head round the wall to the spot (${s.player.dist(there).toFixed(1)} px off)`);
      for (let y = 97; y <= 103; y++) { const d = s.world.get(123, y)!.defense; if (d) s.world.damageDefense(d, d.hp); }
      // the axe, sent at a tree a few tiles off, walks over and keeps chopping until it is down
      s.world.set(129, 100, 'tree'); s.player.tool = 'axe'; clearBulk(s);
      s.useAt({ tx: 129, ty: 100 });
      run(6);
      assert(s.world.get(129, 100)!.kind !== 'tree' && s.player.carriedOf('wood') === p.playerTreeYield && s.command === null, `one click with the axe fells the tree (${s.world.get(129, 100)!.kind}, ${s.player.carriedOf('wood')} wood)`);
      // an attack order chases the raider and the sword does the rest
      const foe = s.spawn(new Raider(s.player.x + 60, s.player.y + 20)); foe.update = () => {};
      s.player.tool = 'sword';
      s.fog?.update(1); // (the view refreshes sight as it draws; the test never draws)
      s.order({ kind: 'attack', target: foe });
      run(8);
      assert(foe.dead && s.command === null, `an attack order hunts the raider down (${foe.hp} hp left)`);
      s.removeDead();
      // E rolls toward the cursor, not the way the head is walking
      s.player.sinceRoll = 99; s.player.swing = null; s.player.recover = 0;
      s.hoverPoint = { x: s.player.x, y: s.player.y - 40 }; s.hoverTile = World.toTile(s.hoverPoint.x, s.hoverPoint.y);
      const rollFrom = s.player.y;
      s.paused = false; s.ability('E'); s.paused = true; // (abilities wait while the game is paused)
      run(p.rollTime + 0.1);
      assert(s.player.y < rollFrom - p.rollDist * 0.6, `E rolls toward the cursor (${(rollFrom - s.player.y).toFixed(1)} px north)`);
      s.hoverPoint = null; s.hoverTile = null;
    }

    // ---- the BAG on the belt opens the backpack and never empties the head's hand --------------
    {
      const ui = (s as unknown as { ui: { bagShowing: boolean; toggleBag(open?: boolean): void } }).ui;
      s.player.tool = 'axe';
      (document.querySelector('.hotbar .bag') as HTMLElement).click();
      assert(s.player.tool === 'axe' && ui.bagShowing, `clicking BAG opens the backpack and leaves the axe in hand (${String(s.player.tool)})`);
      ui.toggleBag(false);
      s.setTool(undefined as unknown as typeof s.player.tool);
      assert(s.player.tool === 'axe', 'and nothing but a tool can be put in the head\'s hand');
    }

    // ---- toasts never bury the screen ----------------------------------------------------
    {
      const ui = (s as unknown as { ui: { toast(t: string, k: string): void } }).ui;
      const count = () => document.querySelectorAll('.toast').length;
      for (const el of Array.from(document.querySelectorAll('.toast'))) el.remove();
      for (let i = 0; i < 30; i++) ui.toast(`Villager ${i} was killed`, 'death');
      assert(count() <= 2, `thirty different warnings leave at most two alerts on screen (${count()})`);
      for (const el of Array.from(document.querySelectorAll('.toast'))) el.remove();
      for (let i = 0; i < 30; i++) ui.toast('Hearths burned 0 wood', 'wood');
      assert(count() === 1, 'and the same warning thirty times is one toast, not thirty');
      assert((document.querySelector('.toast') as HTMLElement).textContent!.endsWith('30'), 'which counts itself up instead');
      for (const el of Array.from(document.querySelectorAll('.toast'))) el.remove();
    }

    // ---- the minimal HUD: five things on screen, everything else on demand -----------------------
    {
      s = fresh(); s.paused = false; s.screen = 'playing';
      const ui = (s as unknown as { ui: { render(dt: number): void; togglePanel(n: string, open?: boolean): void; closeTop(): boolean } }).ui;
      ui.render(0.2);
      const shown = (el: Element | null) => !!el && (el as HTMLElement).offsetParent !== null && getComputedStyle(el).display !== 'none';
      const hud = Array.from(document.querySelectorAll('#overlay [data-hud]'));
      const drawers = Array.from(document.querySelectorAll('#overlay .drawer, #overlay .bagpanel, #overlay .ctrl-card'));
      assert(hud.length === 5 && hud.filter((e) => e.getAttribute('data-hud') !== 'alerts').every(shown) && !drawers.some(shown) && !document.getElementById('side'),
        `in play the screen holds the five — ${hud.map((e) => e.getAttribute('data-hud')).join(', ')} — and no drawer (${drawers.filter(shown).map((e) => e.className).join(', ') || 'none open'})`);
      const keyed: [string, string][] = [['j', '.drawer.journal'], ['l', '.drawer.roster'], ['i', '.drawer.inspector']];
      const opened = keyed.map(([k, sel]) => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k })); ui.render(0.2); const o = shown(document.querySelector(sel)); return o; });
      while (ui.closeTop()) ui.render(0.2);
      assert(opened.every(Boolean) && !drawers.some(shown), `J, L and I open the journal, the army and the inspector (${opened.join(', ')}), and Esc shuts them again`);
      s.selectBuilding(s.world.granary!); ui.render(0.2);
      const withPick = shown(document.querySelector('.drawer.inspector'));
      s.selectBuilding(null); ui.render(0.2);
      assert(withPick && !shown(document.querySelector('.drawer.inspector')), 'picking a building opens the inspector, and letting it go shuts it');
      // the hammer builds: the belt holds what you hold in your hands, and the builds come up over it with the hammer
      const beltTools = Array.from(document.querySelectorAll<HTMLElement>('#overlay .slots .slot[data-tool]')).map((e) => e.dataset.tool);
      const row = document.querySelector('#overlay .buildrow')!, hammerSlot = document.querySelector('#overlay .slots .slot[data-tool="hammer"]')!;
      assert(beltTools.join() === BELT.join() && !BUILDS.some((t) => beltTools.includes(t)) && BUILDS.every((t) => !!row.querySelector(`.slot[data-tool="${t}"]`)), `the belt is ${beltTools.join(', ')}; every build lives in the hammer's row`);
      s.player.tool = 'sword'; ui.render(0.2);
      const shutWithSword = !shown(row);
      s.setTool('hammer'); ui.render(0.2);
      const openWithHammer = shown(row);
      s.setTool('house'); ui.render(0.2);
      assert(shutWithSword && openWithHammer && String(s.player.tool) === 'house' && shown(row) && hammerSlot.classList.contains('on'), 'the build row is shut with the sword, open with the hammer; picking a house keeps the hammer lit');
      s.player.cycleTool(1, (t) => !!s.toolLocked(t));
      assert(String(s.player.tool) === 'basket', `Tab from a build goes on along the belt from the hammer (${s.player.tool})`);
      s.reset(42); s.screen = 'playing'; s.paused = true;
      assert(/hammer/i.test(s.toolLocked('house') ?? '') && /hoe/i.test(s.toolLocked('seeds') ?? ''), `with no hammer nothing can be built, and with no hoe no seeds (${s.toolLocked('house')})`);
      s.paused = true;
    }

    const n = output.textContent!.split('\n').filter(Boolean).length;
    summary.textContent = `${n} checks passed`; s.paused = true;
  } catch (e) { summary.textContent = 'FAILED'; output.textContent += String(e); console.error(e); } finally { p.adaptiveSpawns = savedAdaptiveSpawns; p.gnomeStart = savedGnomeStart; p.forgeMaxTier = savedForge; p.dropChance = savedDrop; }
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
  } else if (kind === 'gnomehouse' || kind === 'cooking') {
    const b = s.world.place('gnomehouse', 135, 95); b.level = 3; b.warm = true; s.foundGnomes(b);
    s.interior.enter(b); s.interior.x = 162; s.interior.y = 140;
    if (kind === 'cooking') { s.pantry.mushroom = 4; s.pantry.burdock = 2; s.pantry.berry = 3; s.pantry.wheat = 5; s.pantry.honey = 4; s.openCooking(b); }
  } else {
    const b = s.world.buildings.find(b => b.kind === kind) ?? s.world.place('tavern', 135, 95); b.level = 3;
    s.interior.enter(b); s.interior.x = 162; s.interior.y = 140;
  }
  s.dayTime = 0.82; s.draw();
  summary.textContent = `${kind} preview · wall height ${WALL_HEIGHT}px`;
}));
