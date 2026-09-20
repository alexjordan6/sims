import './main';
import type { VillageScene } from './main';
import { World, doorstep, hearthCost, BUILDINGS, type BuildingKind } from './world';
import { Rng } from '../../src/shared/rng';
import { Villager, Arrow, Raider } from './agents';
import { Brute, Rat, Ogre, Wrecker, waveComposition } from './enemies';
import { COLS, ROWS, WALL_HEIGHT, HAUL, TOWER, p, BUILDING_HP, WRECKER, DISMANTLE, DEFENSE_COST, COST, FOODS, FOOD_KINDS, DIET_CAP } from './config';

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
/** Let thrown things fly, bounce and settle. */
function settle(s: VillageScene, seconds = 6) { for (let i = 0; i < seconds * 60; i++) s.world.tickItems(1 / 60); }
/** Roll every house for births `rolls` times (p.birthEvery seconds apart) and return how many were born. */
function births(s: VillageScene, rolls: number): number {
  const n = s.villagers().length;
  for (let i = 0; i < rolls; i++) { s.simTime += p.birthEvery; s.tickBirths(); }
  return s.villagers().length - n;
}
function step(s: VillageScene, seconds: number) {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) { s.grid.rebuild(s.agents); for (const a of [...s.agents]) if (!a.dead) a.update(1 / 60, s); s.world.tickItems(1 / 60); s.removeDead(); }
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
    for (const kind of ['house', 'barracks', 'granary', 'woodyard', 'tavern'] as BuildingKind[]) {
      const b = s.world.buildings.find(q => q.kind === kind) ?? s.world.place(kind, 135, 95);
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
    assert(s.player.load?.kind === 'wood' && s.player.load.n === p.playerTreeYield && s.wood === w0, 'the head\'s chop clears the tree for a token of wood');
    s.player.load = { kind: 'wood', n: HAUL.player.wood }; s.world.set(yd.tx + 3, yd.ty + 7, 'tree'); s.interact();
    assert(s.world.get(yd.tx + 3, yd.ty + 7)!.kind === 'tree' && s.hint().includes('full'), 'full arms refuse another tree and say so');
    Object.assign(s.player, World.center(yd.tx, yd.ty)); s.tick(1 / 60);
    assert(!s.player.load && s.wood === w0 + HAUL.player.wood, 'walking up to the woodyard unloads the head\'s arms');
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
    const kid2 = s.spawn(new Villager(0, 0, home2, 'kid', 5, 'Sprout', s.mods)); kid2.update = () => {}; kid2.parents = [parent1, parent2]; kid2.hungerDays = 0;
    home2.calling = 'soldier'; kid2.trained = 0; home2.residents = 3;
    const careBefore = kid2.care, trainedBefore = kid2.trained; s.food = 200;
    s.newDay();
    assert(!home2.warm && !keep2.warm, 'an empty pile leaves the building cold the next dawn');
    // fed +1 and two parents +1 would make 2; the cold night takes one back
    assert(kid2.care - careBefore === 1, `a cold night costs the child a care point (${kid2.care - careBefore} instead of 2)`);
    assert(kid2.trained === trainedBefore, 'a child with no pen trains nowhere');
    s.world.paintPen(123, 98, 'soldier');
    const cadet = s.spawn(new Villager(0, 0, home2, 'kid', 1, 'Cadet', s.mods)); cadet.update = () => {}; cadet.pen = 'soldier'; cadet.ateDay = s.day; home2.residents = 4;
    s.newDay(); assert(cadet.trained === 0, 'a cold barracks drills nobody');
    assert(births(s, 25) === 0, 'no children are born in a cold house');
    s.wood = 1; assert(!s.stockHearth(home2) && home2.firewood === 0, 'stocking a hearth needs the wood');
    s.wood = 50; assert(s.stockHearth(home2) && home2.firewood === 1 && s.wood === 50 - cost0, `a night of wood costs ${cost0} from the village pile`);
    s.stockHearth(home2); s.stockHearth(home2); assert(home2.firewood === p.hearthNights && !s.stockHearth(home2), 'the pile holds three nights and no more');
    cadet.ateDay = s.day; s.newDay(); assert(home2.warm && !keep2.warm, 'a stocked house is warm again while the barracks stays cold');
    assert(cadet.trained === 0, 'still no drill while the barracks is cold');
    const soldier2 = s.spawn(new Villager(World.center(125, 100).x, World.center(125, 100).y, home2, 'soldier', 20, 'Guard', s.mods)); soldier2.hp = 10; soldier2.trained = 3;
    s.mods.soldierRegen = 5; step(s, 2); assert(soldier2.hp === 10, 'soldiers do not mend while the barracks is cold');
    keep2.firewood = 1; cadet.ateDay = s.day; s.newDay(); step(s, 2); assert(soldier2.hp > 10, 'a warm barracks mends them again');
    assert(cadet.trained === 1, 'a fed child in the drill yard earns a day of drill once the barracks is warm');
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
    const hearth = s.world.houses[0]; hearth.firewood = 99; hearth.warm = true; hearth.calling = 'soldier';
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
    s.player.tool = 'basket'; s.player.load = null; s.food = 100;
    const g = s.world.granary!; Object.assign(s.player, World.center(g.tx + 1, g.ty + BUILDINGS[g.kind].h)); s.fillBasket();
    const basket = s.player.load as { kind: string; n: number } | null; assert(basket?.kind === 'food' && basket.n === HAUL.player.food && s.food === 100 - HAUL.player.food, 'the basket fills with food from the granary');
    // a throw is a thing in the world: it flies where you point, bounces, rolls and lies where it stops
    for (let y = 95; y <= 97; y++) for (let x = 122; x <= 124; x++) if (s.world.get(x, y)!.pen !== 'soldier') s.world.paintPen(x, y, 'soldier');
    Object.assign(s.player, World.center(123, 100)); const aim = World.center(123, 96); s.hoverPoint = aim;
    const thrown = s.toss()!;
    assert(!!thrown && !thrown.rest && thrown.vz > 0 && thrown.n === p.tossSize && thrown.food === 'wheat' && s.player.load!.n === HAUL.player.food - p.tossSize, `a throw launches ${p.tossSize} food into the air`);
    settle(s);
    assert(thrown.rest && thrown.z === 0 && Math.hypot(thrown.x - aim.x, thrown.y - aim.y) < 1.5 * 16 && s.world.inPen(thrown, 'soldier'), `it comes down near the aim and lies there (${Math.hypot(thrown.x - aim.x, thrown.y - aim.y).toFixed(0)} px off, in the pen)`);
    s.hoverPoint = { x: aim.x, y: aim.y - (p.tossRange + 3) * 16 }; assert(s.tossProblem() === 'too far to throw', 'the throw has a range');
    for (let x = 121; x <= 125; x++) s.world.placeDefense('wall', x, 94);
    Object.assign(s.player, World.center(123, 97)); s.hoverPoint = World.center(123, 92); const atWall = s.toss()!; settle(s);
    assert(atWall.rest && atWall.y > 95 * 16 && !s.world.isBlocked(Math.floor(atWall.x / 16), Math.floor(atWall.y / 16), true), `a throw at a wall bounces back and never rests inside it (y ${(atWall.y / 16).toFixed(1)})`);
    for (let x = 121; x <= 125; x++) { const d = s.world.get(x, 94)!.defense; if (d) s.world.damageDefense(d, Infinity); }
    s.world.removeItem(atWall); s.hoverPoint = null;
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
    first.update = () => {}; first.trained = 0; s.world.barracks[0].firewood = 99; s.world.barracks[0].warm = true;
    s.newDay(); assert(first.trained === 1 && first.hungerDays === 0, 'a fed day in the drill yard is a day of drill');
    first.ateDay = 0; s.newDay(); assert(first.trained === 1 && first.hungerDays === 1, 'a day without food from the pile is a hungry day and no training');
    for (let i = 1; i < p.kidStarveDays && !first.dead; i++) s.newDay();
    assert(first.dead, `${p.kidStarveDays} hungry days starve a pen child`);
    s.removeDead();
    // coming of age takes the pen's role; old age slows, then ends
    const second = s.infantsOf(hearth)[0]; second.age = p.infantDays; s.tickAges(0); second.update = () => {};
    second.trained = Villager.drillNeeded(s); second.age = s.adultAge; second.ateDay = s.day; s.tickAges(0);
    assert(second.role === 'soldier' && second.skilled && second.isAdult, `a drilled child of the drill yard comes of age a skilled soldier (${second.role})`);
    const third = s.infantsOf(hearth)[0]; third.age = p.infantDays; s.tickAges(0); third.update = () => {}; third.trained = 0; third.age = s.adultAge; s.tickAges(0);
    assert(third.role === 'farmer' && !third.skilled, `an undrilled drill-yard child comes of age a plain farmer (${third.role})`);
    const speedWas = second.speed; second.age = s.elderAge; s.tickAges(0);
    assert(second.elder && second.speed < speedWas, 'past adultDays a villager grows old and slows');
    second.age = second.deathAt(s); s.tickAges(0); assert(second.dead, 'an elder passes away at the end of elderDays');
    s.removeDead();
    // diet: the pantry keeps kinds apart
    // diet: the pantry keeps kinds apart, crops and wild food have kinds, and what a child eats is who they become
    const held = () => s.player.load as { kind: string; n: number; food?: string } | null;
    s = fresh(); clearing(s); s.agents = [s.player]; Object.assign(s.player, World.center(124, 100));
    for (const k of FOOD_KINDS) s.pantry[k] = 0;
    s.food = 50; assert(s.pantry.wheat === 50 && s.food === 50, 'a plainKid food gain lands in wheat');
    s.addFood(20, 'carrot'); s.addFood(5, 'berry'); assert(s.food === 75 && s.pantry.carrot === 20, 'the granary keeps each kind apart');
    s.food -= 60; assert(s.food === 15 && s.pantry.wheat === 0 && s.pantry.carrot === 10 && s.pantry.berry === 5, `generic spending drains the fullest kind first (${JSON.stringify(s.pantry)})`);
    s.player.tool = 'seeds'; s.player.cropKind = 'carrot'; s.world.set(122, 98, 'tilled'); s.hoverTile = { tx: 122, ty: 98 }; Object.assign(s.player, World.center(122, 99)); s.interact();
    const sown = s.world.get(122, 98)!;
    assert(sown.kind === 'crop' && sown.food === 'carrot' && s.cropDaysOf(sown) === s.cropDays + FOODS.carrot.days, 'seeds sow the chosen crop and it ripens on its own clock');
    sown.stage = 99; s.player.tool = 'hands'; s.player.load = null; s.interact();
    assert(held()?.food === 'carrot' && held()!.n === s.cropYieldOf('carrot') && s.world.get(122, 98)!.kind === 'tilled' && s.world.get(122, 98)!.food === 'carrot', 'harvesting by hand yields the crop and the soil remembers it');
    const sower = s.spawn(new Villager(World.center(122, 99).x, World.center(122, 99).y, s.world.houses[0], 'farmer', 20, 'Sower', s.mods));
    for (const q of s.world.find(t => t.kind === 'crop' || t.kind === 'tilled')) if (q.tx !== 122 || q.ty !== 98) s.world.set(q.tx, q.ty, 'grass');
    step(s, 6); assert(s.world.get(122, 98)!.kind === 'crop' && s.world.get(122, 98)!.food === 'carrot', `a farmer replants what the soil remembers (${s.world.get(122, 98)!.kind} ${s.world.get(122, 98)!.food})`);
    sower.dead = true; s.removeDead();
    s.world.set(126, 98, 'bush').stage = 99; s.hoverTile = { tx: 126, ty: 98 }; Object.assign(s.player, World.center(126, 99)); s.player.load = null; s.interact();
    const bush = s.world.get(126, 98)!;
    assert(held()?.food === 'berry' && held()!.n === FOODS.berry.yield && bush.kind === 'bush' && bush.stage === 0 && !s.wildRipe(bush), 'a ripe bush is picked by hand and starts regrowing');
    const berries = held()!.n; s.interact(); assert(held()?.n === berries, 'a picked bush gives nothing');
    for (let i = 0; i < s.regrowDays('berry'); i++) s.newDay(); assert(s.wildRipe(bush), `a bush bears again after ${s.regrowDays('berry')} days`);
    s.hoverTile = null; s.player.load = null;
    // the basket takes one kind; a child's bites build a diet that freezes at coming of age
    s.world.paintPen(123, 96, 'farmer'); s.player.tool = 'basket'; s.player.basketKind = 'carrot'; s.pantry.carrot = 40;
    const g2 = s.world.granary!; Object.assign(s.player, World.center(g2.tx + 1, g2.ty + BUILDINGS[g2.kind].h)); s.fillBasket();
    assert(held()?.food === 'carrot' && held()!.n === HAUL.player.food && s.pantry.carrot === 40 - HAUL.player.food, 'the basket fills with the chosen kind');
    for (let y = 95; y <= 97; y++) for (let x = 122; x <= 124; x++) if (s.world.get(x, y)!.pen !== 'farmer') s.world.paintPen(x, y, 'farmer');
    Object.assign(s.player, World.center(123, 100)); s.hoverPoint = World.center(123, 96); const carrots = s.toss()!; s.hoverPoint = null; settle(s);
    assert(carrots.food === 'carrot' && carrots.n === p.tossSize && s.world.inPen(carrots, 'farmer'), 'a throw carries its kind');
    s.world.dropItem('food', 1, World.center(122, 96).x, World.center(122, 96).y, 'mushroom');
    const eater = s.spawn(new Villager(World.center(123, 97).x, World.center(123, 97).y, s.world.houses[0], 'kid', 1, 'Eater', s.mods)); eater.pen = 'farmer'; eater.mealAt = 0; s.day = 9;
    const careWas = eater.care; step(s, 8);
    assert(eater.diet.carrot > 0 && eater.ateDay === 9, `bites go on the diet (${JSON.stringify(eater.diet)})`);
    eater.update = () => {}; eater.diet = { wheat: 0, carrot: 0, tomato: 0, berry: 0, mushroom: 0 };
    eater.eatBite('mushroom', 0.5); eater.eatBite('mushroom', 0.5); assert(eater.care === careWas + 1, 'a mushroom meal is worth one care point');
    eater.diet.carrot = p.dietFull; eater.diet.wheat = p.dietFull / 2;
    const live = eater.dietNow(); assert(Math.abs(live.speed - DIET_CAP.speed * p.dietMul) < 1e-9 && Math.abs(live.hp - DIET_CAP.hp * p.dietMul / 2) < 1e-9 && live.work === 0, `the diet projects its bonuses (${JSON.stringify(live)})`);
    const plainKid = s.spawn(new Villager(0, 0, s.world.houses[0], 'kid', 1, 'Plain', s.mods)); plainKid.update = () => {};
    for (const k of [eater, plainKid]) { k.age = s.adultAge; k.pen = null; } s.tickAges(0);
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
    assert(s.scrap === scrapWas + loot!.n && !s.world.items.includes(loot!), 'walking over scrap picks it up with any tool');
    Object.assign(s.player, { x: dropped!.x, y: dropped!.y }); s.player.load = null; s.tick(1 / 60);
    assert(s.world.items.includes(dropped!) && !s.player.load, 'an armful on the ground waits for hands');
    s.player.tool = 'hands'; s.tick(1 / 60);
    assert(held()?.kind === 'wood' && held()!.n === 9 && !s.world.items.includes(dropped!), 'with hands out the head picks the armful up');
    const snack = s.world.dropItem('food', 3, s.player.x, s.player.y, 'berry'); s.tick(1 / 60);
    assert(s.world.items.includes(snack) && held()?.kind === 'wood', 'arms full of wood leave food lying');
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
