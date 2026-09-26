import './main';
import { runPackChecks } from './pack-test';
import { STACK } from './config';
const clearBulk = (s: VillageScene) => s.player.pack.slots.forEach((b,i)=>{if(b && ['wood','food','scrap'].includes(b.kind))s.player.pack.removeAt(i);});
import type { VillageScene } from './main';
import { World, WILD_FOOD, doorstep, buildingCenter, hearthCost, BUILDINGS, type BuildingKind } from './world';
import { Rng } from '../../src/shared/rng';
import { Villager, Arrow, Raider } from './agents';
import { Brute, Rat, Ogre, Wrecker, Troll, Skulk, waveComposition } from './enemies';
import { Boar, Swarm } from './wildlife';
import { TILE, COLS, ROWS, WALL_HEIGHT, HAUL, TOWER, ORDER, p, BUILDING_HP, WRECKER, DISMANTLE, DEFENSE_COST, COST, FOODS, FOOD_KINDS, DIET_CAP, ITEM, BOAR, GNOME_HOME, RECIPES, DISHES, CROP_KINDS, zeroFood, TROLL, HIVE, SKULK, STASH_SLOTS, WEAPONS } from './config';

const scene = () => (window as unknown as { game: { scene: { scenes: VillageScene[] } } }).game.scene.scenes[0];
const output = document.getElementById('test-results')!, summary = document.getElementById('test-summary')!;
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); output.textContent += `PASS ${message}\n`; };
/** `wild` keeps the boars, `trolls` keeps the trolls, `hives` keeps the beehives — both wander into timed checks otherwise, and a troll fights back. */
function fresh(wild = false, trolls = false, hives = false, skulks = false): VillageScene {
  const s = scene(); s.reset(42); s.screen = 'playing'; s.paused = true; s.wood = 150; s.food = 150; s.fx.length = 0;
  s.world.mowAll(); // mown: the checks below time walks; the long grass checks raise it where they need it (mowAll keeps world.tallCount honest)
  if (!wild) { for (const a of s.agents) if (a instanceof Boar) a.dead = true; s.sounders = []; } // no stray sounder wanders into a check
  if (!trolls) for (const a of s.agents) if (a instanceof Troll) a.dead = true; // nor a troll, which would fight back
  if (!hives) s.world.hives.clear(); // nor a hive over a check that walks somebody past it
  if (!skulks) for (const a of s.agents) if (a instanceof Skulk) a.dead = true; // nor a skulk that crept out during an earlier check
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
/** Like step(), but through the scene's own tick — for what the scene does per frame rather than what agents do. */
function ticks(s: VillageScene, seconds: number) {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) { s.grid.rebuild(s.agents); s.tick(1 / 60); }
}
function step(s: VillageScene, seconds: number) {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) { s.grid.rebuild(s.agents); for (const a of [...s.agents]) if (!a.dead) a.update(1 / 60, s); s.world.tickItems(1 / 60); s.removeDead(); }
}
document.getElementById('run-checks')!.addEventListener('click', () => {
  output.textContent = ''; summary.textContent = 'Running';
  try {
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
    s = fresh(); s.agents = [s.player]; s.day = 3; s.spawnRaid();
    const wave1 = s.agents.filter(a => a instanceof Raider && !a.lairBound);
    assert(wave1.length === Math.round(2 * p.raidSizeMul), `the first raid brings ${wave1.length} raiders`);
    s = fresh(); s.agents = [s.player]; s.day = 6; s.spawnRaid();
    const kinds = s.agents.filter((a): a is Raider => a instanceof Raider).map(a => a.kind);
    const rats = kinds.filter(k => k === 'rat').length, wreckers = kinds.filter(k => k === 'wrecker').length;
    assert(rats === Math.round(10 * p.raidSizeMul) && wreckers === Math.round(1 * p.raidSizeMul), `the second raid brings ${rats} rats and ${wreckers} wreckers`);
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
    // fed +1, well fed from the pen +1 and two parents +1 would make 3; the cold night takes one back
    assert(kid2.care - careBefore === 2, `a cold night costs the child a care point (${kid2.care - careBefore} instead of 3)`);
    assert(kid2.trained === trainedBefore, 'a child with no pen trains nowhere');
    s.world.paintPen(123, 98, 'soldier');
    const cadet = s.spawn(new Villager(World.center(123, 98).x, World.center(123, 98).y, home2, 'kid', 1, 'Cadet', s.mods)); cadet.pen = 'soldier'; cadet.ateDay = s.day; cadet.mealAt = 1e9; home2.residents = 4;
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
    assert(cadet.trained > 0 && Math.abs(cadet.trained - 2 / (p.dayLength * 0.52)) < 0.01, `a fed child in the drill yard drills by the waking hour once the barracks is warm (${cadet.trained.toFixed(3)} days after 2 s)`);
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
    // the breeding program: nurseries, pens, the basket, the stages of life
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
    assert(s.world.paintPen(123, 96, 'soldier') && s.world.get(123, 96)!.pen === 'soldier', 'the pen tool paints a drill yard on grass');
    s.world.set(130, 96, 'tree'); assert(!s.world.paintPen(130, 96, 'farmer'), 'pens only go on open ground');
    s.world.paintPen(124, 96, 'soldier'); s.world.paintPen(124, 96, 'soldier'); assert(!s.world.get(124, 96)!.pen && s.world.pens.get('soldier')!.size === 1, 'painting the same kind again erases it');
    const first = infants[0]; first.age = p.infantDays; s.tickAges(0);
    assert(first.role === 'kid' && !first.hidden && first.pen === 'soldier', `an infant of age ${p.infantDays} walks out of the nursery to the house's pen (${first.role}, ${first.pen})`);
    assert(s.villagers().filter((v) => v.role === 'infant').length === s.cribs(hearth) - 1 && !s.birthProblem(hearth), 'the crib frees up for the next birth');
    // the basket: fill at the granary, toss onto the pen
    s.player.tool = 'basket'; clearBulk(s); s.food = 100;
    const g = s.world.granary!; Object.assign(s.player, World.center(g.tx + 1, g.ty + BUILDINGS[g.kind].h)); s.fillBasket();
    const basket = s.player.pack.bulk()[0] as { kind: string; n: number } | null; assert(basket?.kind === 'food' && basket.n === STACK.food && s.food === 100 - STACK.food, 'the basket fills with food from the granary');
    // a throw is a thing in the world: it flies where you point, bounces, rolls and lies where it stops
    for (let y = 95; y <= 97; y++) for (let x = 122; x <= 124; x++) if (s.world.get(x, y)!.pen !== 'soldier') s.world.paintPen(x, y, 'soldier');
    Object.assign(s.player, World.center(123, 100)); const aim = World.center(123, 96); s.hoverPoint = aim;
    const thrown = s.toss()!;
    assert(!!thrown && !thrown.rest && thrown.vz > 0 && thrown.n === p.tossSize && thrown.food === 'wheat' && s.player.pack.bulk()[0].n === STACK.food - p.tossSize, `a throw launches ${p.tossSize} food into the air`);
    settle(s);
    assert(thrown.rest && thrown.z === 0 && Math.hypot(thrown.x - aim.x, thrown.y - aim.y) < 1.5 * 16 && s.world.inPen(thrown, 'soldier'), `it comes down near the aim and lies there (${Math.hypot(thrown.x - aim.x, thrown.y - aim.y).toFixed(0)} px off, in the pen)`);
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
    // a pen child walks to food lying in the pen and eats; food stray the pen is not theirs
    s.world.removeItem(thrown);
    const stray = s.world.dropItem('food', 5, World.center(119, 99).x, World.center(119, 99).y, 'wheat');
    Object.assign(first, World.center(123, 97)); first.mealAt = 0; first.ateDay = 0; s.day = 5;
    step(s, 3); assert(first.ateDay === 0 && first.task === 'hungry — nothing in the pen' && stray.n === 5, 'a child ignores food lying stray the pen');
    const meal = s.world.dropItem('food', p.tossSize, World.center(124, 96).x + 5, World.center(124, 96).y - 3, 'wheat');
    step(s, 6);
    assert(first.ateDay === 5 && Math.abs(meal.n - (p.tossSize - p.kidFood / 2)) < 1e-9, `a hungry pen child eats half of ${p.kidFood} per meal from food lying in the pen (${meal.n} left, ate day ${first.ateDay})`);
    s.world.removeItem(meal); s.world.removeItem(stray);
    s.world.set(123, 96, 'tree'); assert(!s.world.get(123, 96)!.pen && !s.world.pens.get('soldier')!.has(96 * s.world.cols + 123), 'a tree on a pen tile takes it out of the pen');
    s.world.set(123, 96, 'grass'); s.world.paintPen(123, 96, 'soldier');
    first.trained = 0; s.world.barracks[0].firewood = 99; s.world.barracks[0].warm = true; Object.assign(first, World.center(123, 96)); first.mealAt = 1e9;
    step(s, 3); assert(first.trained > 0 && first.hungerDays === 0, 'time in the drill yard, fed, is drill');
    const drilled = first.trained; first.ateDay = 0; s.newDay(); assert(first.hungerDays === 1, 'a day without food from the pile is a hungry day');
    first.mealAt = 0; step(s, 2); assert(first.trained === drilled && first.task === 'hungry — nothing in the pen', 'a hungry child with nothing to eat stops training');
    first.update = () => {};
    for (let i = 1; i < p.kidStarveDays && !first.dead; i++) s.newDay();
    assert(first.dead, `${p.kidStarveDays} hungry days starve a pen child`);
    s.removeDead();
    // coming of age takes the pen's role; old age slows, then ends
    const second = s.infantsOf(hearth)[0]; second.age = p.infantDays; s.tickAges(0); second.update = () => {};
    second.trained = Villager.drillNeeded(s); second.age = s.adultAge; second.ateDay = s.day; s.tickAges(0);
    assert(second.role === 'soldier' && second.skilled && second.isAdult, `a drilled child of the drill yard comes of age a skilled soldier (${second.role})`);
    const third = s.infantsOf(hearth)[0]; third.age = p.infantDays; s.tickAges(0); third.update = () => {}; third.trained = 0; third.age = s.adultAge; s.tickAges(0);
    assert(third.role === 'soldier' && !third.skilled, `an undrilled drill-yard child still comes of age a soldier, just a plain one (${third.role})`);
    const nopen = s.infantsOf(hearth)[0]; nopen.age = p.infantDays; for (const i of [...s.world.pens.get('soldier') ?? []]) s.world.paintPen(i % s.world.cols, (i / s.world.cols) | 0, null); s.tickAges(0); nopen.update = () => {}; nopen.pen = null; nopen.age = s.adultAge + 1; s.tickAges(0);
    assert(nopen.role === 'kid', 'a child with no pen never comes of age: nothing decided what they are');
    nopen.dead = true; s.removeDead(); s.world.paintPen(123, 96, 'soldier');
    const speedWas = second.speed; second.age = s.elderAge; s.tickAges(0);
    assert(second.elder && second.speed < speedWas, 'past adultDays a villager grows old and slows');
    second.age = second.deathAt(s); s.tickAges(0); assert(second.dead, 'an elder passes away at the end of elderDays');
    s.removeDead();
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
    sown.stage = 99; s.player.tool = 'hands'; clearBulk(s); s.interact();
    assert(held()?.food === 'carrot' && held()!.n === s.cropYieldOf('carrot') && s.world.get(122, 98)!.kind === 'tilled' && s.world.get(122, 98)!.food === 'carrot', 'harvesting by hand yields the crop and the soil remembers it');
    const sower = s.spawn(new Villager(World.center(122, 99).x, World.center(122, 99).y, s.world.houses[0], 'farmer', 20, 'Sower', s.mods));
    for (const q of s.world.find(t => t.kind === 'crop' || t.kind === 'tilled')) if (q.tx !== 122 || q.ty !== 98) s.world.set(q.tx, q.ty, 'grass');
    step(s, 6); assert(s.world.get(122, 98)!.kind === 'crop' && s.world.get(122, 98)!.food === 'carrot', `a farmer replants what the soil remembers (${s.world.get(122, 98)!.kind} ${s.world.get(122, 98)!.food})`);
    sower.dead = true; s.removeDead();
    s.world.set(126, 98, 'bush').stage = 99; s.hoverTile = { tx: 126, ty: 98 }; Object.assign(s.player, World.center(126, 99)); clearBulk(s); s.interact();
    const bush = s.world.get(126, 98)!;
    assert(held()?.food === 'berry' && held()!.n === FOODS.berry.yield && bush.kind === 'bush' && bush.stage === 0 && !s.wildRipe(bush), 'a ripe bush is picked by hand and starts regrowing');
    const berries = held()!.n; s.interact(); assert(held()?.n === berries, 'a picked bush gives nothing');
    for (let i = 0; i < s.regrowDays('berry'); i++) s.newDay(); assert(s.wildRipe(bush), `a bush bears again after ${s.regrowDays('berry')} days`);
    s.hoverTile = null; clearBulk(s);
    // the basket takes one kind; a child's bites build a diet that freezes at coming of age
    s.world.paintPen(123, 96, 'farmer'); s.player.tool = 'basket'; s.player.basketKind = 'carrot'; s.pantry.carrot = 40;
    const g2 = s.world.granary!; Object.assign(s.player, World.center(g2.tx + 1, g2.ty + BUILDINGS[g2.kind].h)); s.fillBasket();
    assert(held()?.food === 'carrot' && held()!.n === STACK.food && s.pantry.carrot === 40 - STACK.food, 'the basket fills with the chosen kind');
    for (let y = 95; y <= 97; y++) for (let x = 122; x <= 124; x++) if (s.world.get(x, y)!.pen !== 'farmer') s.world.paintPen(x, y, 'farmer');
    Object.assign(s.player, World.center(123, 100)); s.hoverPoint = World.center(123, 96); const carrots = s.toss()!; s.hoverPoint = null; settle(s);
    assert(carrots.food === 'carrot' && carrots.n === p.tossSize && s.world.inPen(carrots, 'farmer'), 'a throw carries its kind');
    s.world.dropItem('food', 1, World.center(122, 96).x, World.center(122, 96).y, 'mushroom');
    const eater = s.spawn(new Villager(World.center(123, 97).x, World.center(123, 97).y, s.world.houses[0], 'kid', 1, 'Eater', s.mods)); eater.pen = 'farmer'; eater.mealAt = 0; s.day = 9;
    const careWas = eater.care; step(s, 8);
    assert(eater.diet.carrot > 0 && eater.ateDay === 9, `bites go on the diet (${JSON.stringify(eater.diet)})`);
    eater.update = () => {}; eater.diet = zeroFood();
    eater.eatBite('mushroom', 0.5); eater.eatBite('mushroom', 0.5); assert(eater.care === careWas + 1, 'a mushroom meal is worth one care point');
    eater.diet.carrot = p.dietFull; eater.diet.wheat = p.dietFull / 2;
    const live = eater.dietNow(); assert(Math.abs(live.speed - DIET_CAP.speed * p.dietMul) < 1e-9 && Math.abs(live.hp - DIET_CAP.hp * p.dietMul / 2) < 1e-9 && live.work === 0, `the diet projects its bonuses (${JSON.stringify(live)})`);
    const plainKid = s.spawn(new Villager(0, 0, s.world.houses[0], 'kid', 1, 'Plain', s.mods)); plainKid.update = () => {};
    for (const k of [eater, plainKid]) { k.age = s.adultAge; k.pen = 'farmer'; } s.tickAges(0);
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
    for (const tool of ['axe', 'hammer', 'basket', 'hands'] as const) {
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
    assert(Math.abs(twinA.x - World.center(128, 100).x) > 0.5 && Math.abs(twinB.x - World.center(128, 100).x) > 0.5, 'equals share the push');
    const giant = s.ogre!; s.agents.push(giant); giant.hidden = false; giant.state = 'hunting'; giant.update = () => {}; Object.assign(giant, World.center(132, 100));
    const tot = s.spawn(new Villager(giant.x + 2, giant.y, home3, 'kid', 1, 'Tot', s.mods)); tot.update = () => {};
    const ogreWas = giant.x; s.tick(1 / 60); s.tick(1 / 60); s.tick(1 / 60);
    assert(tot.dist(giant) >= tot.radius + giant.radius - 0.01 && Math.abs(giant.x - ogreWas) < 0.5, `the Ogre pushes a child aside and barely moves (giant moved ${Math.abs(giant.x - ogreWas).toFixed(2)} px)`);
    tot.dead = true; s.removeDead(); giant.hidden = true; s.agents = s.agents.filter((a) => a !== giant);
    for (let y = 98; y <= 102; y++) s.world.placeDefense('wall', 135, y);
    const pinned = s.spawn(new Villager(135 * 16 - 3, World.center(135, 100).y, home3, 'farmer', 20, 'Pinned', s.mods)); pinned.update = () => {};
    const pusher = s.spawn(new Villager(135 * 16 - 4, World.center(135, 100).y, home3, 'farmer', 20, 'Pusher', s.mods)); pusher.update = () => {};
    for (let i = 0; i < 5; i++) s.tick(1 / 60);
    assert(pinned.x < 135 * 16 && pusher.x < pinned.x && pinned.dist(pusher) >= 5.9, `a body against a wall is not pushed into it; the other gives way (${pinned.x.toFixed(1)} / ${pusher.x.toFixed(1)})`);
    // a crowd at one pile all get to eat
    s = fresh(); clearing(s); s.agents = [s.player]; Object.assign(s.player, World.center(124, 104)); s.world.items.length = 0;
    for (let y = 95; y <= 99; y++) for (let x = 120; x <= 126; x++) if (s.world.get(x, y)!.pen !== 'farmer') s.world.paintPen(x, y, 'farmer');
    const crowd: Villager[] = [];
    for (let i = 0; i < 8; i++) { const k = s.spawn(new Villager(World.center(120 + i % 4, 95 + (i >> 2)).x, World.center(120 + i % 4, 95 + (i >> 2)).y, s.world.houses[0], 'kid', 1, 'C' + i, s.mods)); k.pen = 'farmer'; k.mealAt = 0; crowd.push(k); }
    const pile = s.world.dropItem('food', 40, World.center(123, 97).x, World.center(123, 97).y, 'wheat'); s.day = 4;
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
    for (let y = 95; y <= 97; y++) for (let x = 121; x <= 123; x++) if (s.world.get(x, y)!.pen !== 'farmer') s.world.paintPen(x, y, 'farmer');
    for (let y = 95; y <= 96; y++) for (let x = 126; x <= 127; x++) if (s.world.get(x, y)!.pen !== 'farmer') s.world.paintPen(x, y, 'farmer');
    const region = s.world.penRegion(122, 96);
    assert(region.length === 9 && !region.includes(95 * s.world.cols + 126), 'a pen region is the connected pen, not every pen of the kind');
    const card = s.penCard({ tx: 122, ty: 96 })!; assert(card.kind === 'farmer' && card.tiles.length === 9, 'the pen card describes the connected pen');
    s.repaintPen(region, 'soldier');
    assert(region.every((i) => s.world.get(i % s.world.cols, (i / s.world.cols) | 0)!.pen === 'soldier') && s.world.get(126, 95)!.pen === 'farmer', 'repainting changes every tile of the pen and nothing outside it');
    s.erasePen(region); assert(region.every((i) => !s.world.get(i % s.world.cols, (i / s.world.cols) | 0)!.pen) && s.world.get(126, 95)!.pen === 'farmer', 'erasing clears the whole pen and leaves the other alone');
    s.world.set(120, 100, 'tilled'); s.setFieldPlan({ tx: 120, ty: 100 }, 'tomato');
    const planter = s.spawn(new Villager(World.center(120, 101).x, World.center(120, 101).y, hut, 'farmer', 20, 'Planter', s.mods));
    for (const q of s.world.find((t) => t.kind === 'crop' || t.kind === 'tilled')) if (q.tx !== 120 || q.ty !== 100) s.world.set(q.tx, q.ty, 'grass');
    step(s, 6); assert(s.world.get(120, 100)!.kind === 'crop' && s.world.get(120, 100)!.food === 'tomato', 'the field plan decides what a farmer sows');
    planter.dead = true; s.removeDead();
    s.world.placeDefense('stairs', 130, 100); for (let x = 131; x <= 134; x++) s.world.placeDefense('wall', x, 100);
    assert(s.stairsReach({ tx: 130, ty: 100 }) === 4, 'stairs report the battlements they serve');
    // gnome house: a founding couple, a family raised without a pen, grown gnomes who fight
    s = fresh(); clearing(s); s.agents = [s.player]; s.food = 100;
    const den = s.world.place('gnomehouse', 125, 100), [gma, gpa] = s.foundGnomes(den);
    assert(gma.gnome && gpa.gnome && gma.role === 'gnome' && gma.isAdult && den.residents === 2 && gma.home === den, 'a new gnome house comes with a grown gnome couple');
    { const hp0 = gma.maxHp, was = p.gnomeHp; p.gnomeHp = was * 2; gma.applyRole(s.mods); assert(gma.maxHp > hp0 && gma.speed === p.gnomeSpeed, 'grown gnomes take their stats from the sliders'); p.gnomeHp = was; gma.applyRole(s.mods); gma.hp = gma.maxHp; }
    assert(s.beds(den) === 3 && s.rationOf(gma) === p.foodPerDay * s.mods.foodPerDayMul, 'a Lv1 gnome house has 3 beds and its gnomes eat a full ration');
    den.nextBirth = 0;
    assert(births(s, 40) > 0, 'a gnome couple in a warm cottage has children');
    const sprout = s.villagers().find((v) => v.role === 'infant')!;
    assert(sprout.gnome && sprout.home === den && sprout.parents.includes(gma), 'a gnome infant is born a gnome, at home in the gnome house');
    sprout.age = p.infantDays; s.tickAges(0);
    assert(sprout.role === 'kid' && sprout.pen === null && !sprout.hidden && sprout.outlook(s).role === 'gnome', 'a gnome child leaves the nursery without looking for a pen');
    assert(s.rationOf(sprout) === 0, 'a gnome child takes nothing from the granary');
    step(s, 2); assert(sprout.pen === null && sprout.task === 'playing by the gnome house', 'a gnome child plays by the cottage');
    s.world.dropItem('food', 4, 126 * 16, 103 * 16, 'carrot'); settle(s); sprout.mealAt = 0; step(s, 8);
    assert(sprout.ateDay === s.day && sprout.diet.carrot > 0, `a hungry gnome child eats what lies by the cottage (ate day ${sprout.ateDay}, day ${s.day})`);
    sprout.age = s.adultAge; s.tickAges(0);
    assert(sprout.role === 'gnome' && sprout.gnome && sprout.home === den && sprout.isAdult, 'a gnome child comes of age a gnome and stays under the toadstool');
    const gfoe = s.spawn(new Raider(...Object.values(World.center(128, 102)) as [number, number])); gfoe.update = () => {};
    step(s, 1);
    assert([gma, gpa, sprout].some((v) => v.task === 'fleeing' || v.hidden), 'grown gnomes run home from a raider instead of fighting');
    gfoe.dead = true; s.removeDead(); step(s, 1);
    // foraging: a grown gnome picks one unit off the nearest wild plant, carries it to the granary and goes again
    for (const v of [gma, gpa, sprout]) { v.hidden = false; v.indoors = null; }
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
    const rest = s.wildLeft(hazel); Object.assign(s.player, World.center(127, 100)); s.player.tool = 'hands'; s.player.facing = { x: 1, y: 0 }; clearBulk(s); s.interact(); const got = s.player.pack.bulk()[0] as { food?: string; n: number } | null;
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
      s.world.get(125, 100)!.tall = true; s.world.paintPen(125, 100, 'farmer');
      assert(!s.world.get(125, 100)!.tall, 'painting a pen tramples it');
      s.world.paintPen(125, 100, 'farmer');
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
      Object.assign(bg, World.center(129, 98)); bg.load = null;
      settle(s, 2); step(s, 6);
      const held = bg.load as { food?: string; n: number } | null;
      assert(held?.food === 'meat' && held.n === BOAR.meat && !s.world.items.includes(meat!), `a gnome fetches the whole piece (${bg.task})`);
      step(s, 40);
      assert(s.pantry.meat === BOAR.meat && !bg.load, `and carries it to the granary (${s.pantry.meat} meat stored · ${bg.task})`);
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
      Object.assign(s.player, World.center(126, 100)); s.player.tool = 'hands'; s.fx.length = 0;
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
      s.player.tool = 'hands'; s.setTool('gnomehouse');
      assert(s.player.tool === 'hands', 'picking it up does nothing');
      s.player.tool = 'basket'; s.player.cycleTool(1, (t) => !!s.toolLocked(t));
      assert((s.player.tool as string) === 'wand', 'and cycling the belt skips over it');
      assert(s.buildProblem({ tx: 120, ty: 100 }, 'gnomehouse') === s.toolLocked('gnomehouse'), 'building one says why not');
      // walking in: the glade, then the cottage itself
      const door = doorstep(den);
      Object.assign(s.player, World.center(door.tx, door.ty));
      s.cameras.main.centerOn(s.player.x, s.player.y); s.cameras.main.preRender(); // worldView only refreshes on render, and the test never renders
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
    // ---- the gnome start ------------------------------------------------------------------
    const wasGnome = p.gnomeStart, wasPeace = p.peaceful;
    p.gnomeStart = true; s = fresh();
    assert(s.world.houses.length === 0 && s.world.allBarracks.length === 0, 'the gnome start raises no house and no barracks');
    assert(!s.world.wildGnomeHouse, 'and leaves no hidden cottage to find twice');
    assert(!!s.world.granary && !!s.world.woodyard, 'but the granary and woodyard still stand');
    assert(!s.world.tiles.some((t) => t.kind === 'crop'), 'and no field is sown');
    const cot = s.world.gnomeStart!;
    assert(!!cot && !cot.wild && cot.kind === 'gnomehouse', 'a toadstool cottage stands in the clearing, already yours');
    assert(s.villagers().filter((v) => v.gnome && v.isAdult).length === 2, 'with its two founders');
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

    // ---- inside the cottage, and the pot ---------------------------------------------------
    s = fresh(); const lodge = s.world.gnomeStart!;
    Object.assign(s.player, World.center(doorstep(lodge).tx, doorstep(lodge).ty));
    assert(s.doorAt() === lodge, 'a gnome cottage has a door you can push');
    s.interior.enter(lodge);
    assert(s.interior.active && s.interior.building === lodge, 'and you can walk inside');
    for (const k of FOOD_KINDS) s.pantry[k] = 0;
    s.pantry.mushroom = 2; s.pantry.burdock = 1;
    lodge.warm = false; s.openCooking(lodge);
    assert(/cold/i.test(s.cookProblem(RECIPES.stew) ?? ''), 'a cold hearth cooks nothing');
    lodge.warm = true;
    assert(s.cookProblem(RECIPES.stew) === null && s.cook(RECIPES.stew), 'a lit one does');
    assert(s.pantry.stew === RECIPES.stew.makes && s.pantry.mushroom === 0 && s.pantry.burdock === 0, 'and the pot spends exactly what the recipe asks');
    assert(/need/.test(s.cookProblem(RECIPES.stew) ?? ''), 'then says what is missing once the ingredients run out');
    assert(/need/.test(s.cookProblem(RECIPES.roast) ?? ''), 'as it does for a dish never started');

    // a dish is worth far more to a growing child than the raw food it was made of
    const fedKid = s.spawn(new Villager(0, 0, lodge, 'kid', 1, 'Fed', s.mods)); fedKid.update = () => {};
    const rawKid = s.spawn(new Villager(0, 0, lodge, 'kid', 1, 'Raw', s.mods)); rawKid.update = () => {};
    fedKid.diet.stew = p.dietFull; rawKid.diet.tomato = p.dietFull;
    assert(fedKid.dietNow().work > rawKid.dietNow().work * 2, `a child raised on stew far outgrows one raised on raw (${fedKid.dietNow().work.toFixed(2)} vs ${rawKid.dietNow().work.toFixed(2)} work)`);

    // eating one: a meal now, and a while of being better at something
    s.player.hp = 10; s.simTime = 100;
    assert(s.buffMul('work') === 1 && s.workHits(3) === 3, 'an unfed head works at the usual pace');
    assert(s.eatDish('stew') && s.player.hp > 10, 'eating a dish heals');
    assert(s.buffMul('work') > 1 && s.workHits(3) === 2, 'and a stew takes a swing off every tool');
    assert(s.pantry.stew === RECIPES.stew.makes - 1, 'one serving is spent');
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
    s.pantry.honey = 2; s.pantry.wheat = 1;
    const kitchen = s.world.place('gnomehouse', 135, 95); kitchen.warm = true;
    s.openCooking(kitchen);
    assert(s.cookProblem(RECIPES.cake) === null && s.cook(RECIPES.cake), 'and the pot bakes a honey cake from it');
    assert(s.pantry.cake === RECIPES.cake.makes && s.pantry.honey === 0, 'spending the honey exactly');
    s.openCooking(null);
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
        s.world.get(152, 150)!.tall = true; s.world.tallCount++;
        s.world.paintPen(152, 150, 'farmer');
        assert(s.world.tallCount === raised - 1, 'and so does painting a pen over it');
        s.world.paintPen(152, 150, null);

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
        const club = s.world.items.find(it => it.kind === 'gear');
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
