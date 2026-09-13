import Phaser from 'phaser';
import { SimScene, launch } from '@shared/index';
import { World } from './world';
import { Villager, Raider, Player, Mover, type Role, type BuildItem } from './agents';
import { p, TILE, COLS, ROWS, ZOOM, COST, TREE_YIELD, RUN } from './config';
import { Meta, type Mods, type RenownBreakdown } from './meta';
import { Renderer, preloadArt } from './render';
import { UI } from './ui/ui';

const NAMES = ['Ada', 'Bram', 'Cass', 'Dov', 'Eli', 'Fen', 'Gil', 'Hana', 'Ivo', 'Juno', 'Kai', 'Lior', 'Mara', 'Nils', 'Orla', 'Pim', 'Quin', 'Rue', 'Sol', 'Tova', 'Uli', 'Vera', 'Wren', 'Xan', 'Yael', 'Zed'];

export type EventKind = 'birth' | 'grow' | 'soldier' | 'raid' | 'death' | 'build' | 'info' | 'food' | 'wood';
export interface GameEvent { kind: EventKind; text: string; toast: boolean; day: number }
/** Things the sim reports for the renderer to animate; drained every frame. */
export type FxEvent =
  | { kind: 'hit'; attacker: Mover; target: Mover; dmg: number }
  | { kind: 'tool'; tool: 'hoe' | 'axe' | 'seed' | 'hammer'; tx: number; ty: number }
  | { kind: 'death'; who: Mover; x: number; y: number }
  | { kind: 'boss'; who: Mover };

export type Screen = 'title' | 'playing' | 'paused' | 'over' | 'won';

export class VillageScene extends SimScene {
  neighborRadius = 130; // soldier aggro radius = largest grid query

  world!: World;
  player!: Player;
  food = 0;
  wood = 0;
  day = 1;
  /** 0..1 within the day; night around 0.8..0.2 */
  dayTime = 0.3;
  raidActive = false;
  screen: Screen = 'title';
  selected: Mover | null = null;
  journal: GameEvent[] = [];
  fx: FxEvent[] = [];
  stats = { peakPop: 0, soldiersRaised: 0, raidsRepelled: 0, raidersKilled: 0 };
  /** persists across runs (localStorage) */
  meta = new Meta();
  /** this run's modifiers, compiled from the equipped boons */
  mods: Mods = this.meta.mods();
  boss: Raider | null = null;
  /** set when the run ends */
  result: { won: boolean; renown: RenownBreakdown } | null = null;

  private nameIdx = 0;
  private hovered: Mover | null = null;
  private view?: Renderer;
  private ui?: UI;
  private wasd!: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  /** camera follows the player when the world is bigger than the viewport (phones) */
  following = false;

  // the kernel sizes its grid from W/H; in resize mode the viewport varies, the world does not
  get W(): number { return COLS * TILE; }
  get H(): number { return ROWS * TILE; }

  /** Days from seed to harvest for this run (boons can shorten it). */
  get cropDays(): number {
    return Math.max(1, p.cropDays + this.mods.cropDaysDelta);
  }

  /** Next raid day; the warlord's day caps the schedule. */
  get nextRaidDay(): number {
    const next = (Math.floor(this.day / p.raidEvery) + 1) * p.raidEvery;
    return Math.min(next, RUN.bossDay);
  }

  // ---- setup ----------------------------------------------------------------

  preload(): void {
    preloadArt(this);
  }

  setup(): void {
    this.mods = this.meta.mods();
    this.world = new World();
    this.world.generate(this.rng, this.mods.fieldWide ? 5 : 3);
    this.food = this.mods.startFood;
    this.wood = this.mods.startWood;
    this.day = 1;
    this.dayTime = 0.3;
    this.raidActive = false;
    this.selected = null;
    this.journal = [];
    this.fx = [];
    this.stats = { peakPop: 0, soldiersRaised: 0, raidsRepelled: 0, raidersKilled: 0 };
    this.boss = null;
    this.result = null;
    this.nameIdx = this.rng.int(0, NAMES.length - 1);

    const home = this.world.houses[0];
    const c = World.center(home.tx, home.ty + 1);
    this.player = this.spawn(new Player(c.x + TILE * 2, c.y + TILE));
    this.player.keys = this.wasd;
    this.player.maxHp += this.mods.playerHpBonus;
    this.player.hp = this.player.maxHp;

    this.addVillager(home, 'farmer', 22);
    this.addVillager(home, 'woodcutter', 22);
    this.addVillager(home, 'kid', 4);
    for (let i = 0; i < this.mods.startSoldiers; i++) this.addVillager(home, 'soldier', 25);
    if (this.mods.extraAdults > 0) {
      // a second family, two tiles left of the first house
      const h2 = this.world.placeHouse(home.tx - 3, home.ty);
      for (let i = 0; i < this.mods.extraAdults; i++) this.addVillager(h2, i % 2 ? 'woodcutter' : 'farmer', 22);
    }
    this.event('info', 'A new village. Till soil, plant, and keep everyone fed.');
  }

  private addVillager(home: (typeof this.world.houses)[number], role: Role, age: number): Villager {
    const c = World.center(home.tx, home.ty + 1);
    const v = new Villager(c.x + this.rng.range(-4, 4), c.y + this.rng.range(-4, 4), home, role, age, NAMES[this.nameIdx++ % NAMES.length], this.mods);
    home.residents++;
    return this.spawn(v);
  }

  event(kind: EventKind, text: string, toast = false): void {
    this.journal.push({ kind, text, toast, day: this.day });
  }

  create(): void {
    const kb = this.input.keyboard!;
    this.wasd = kb.addKeys('W,A,S,D') as typeof this.wasd;
    kb.on('keydown-E', () => this.interact());
    kb.on('keydown-Q', () => this.player.cycleBuild());
    kb.on('keydown-ESC', () => this.togglePause());

    super.create(); // creates gfx + hud, then calls reset() -> setup()
    kb.removeAllListeners('keydown-SPACE'); // Esc handles pause; Space is free for later
    this.hud.setVisible(false);

    this.view = new Renderer(this);
    this.view.rebuild();
    this.ui = new UI(this);
    this.ui.mount();

    // hover / click on the map
    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => this.onPointerMove(ptr));
    this.input.on('pointerdown', (_ptr: Phaser.Input.Pointer, objs: unknown[]) => { if (objs.length === 0) this.select(null); });
    this.input.on('gameout', () => { this.hovered = null; this.ui?.tooltip(null); });

    this.scale.on('resize', () => this.fitCamera());
    // Phaser only watches the window; the stage can change on its own (drawer, orientation, layout)
    new ResizeObserver(() => this.scale.refresh()).observe(this.game.canvas.parentElement!);
    this.fitCamera();
    this.goTitle();
  }

  reset(newSeed?: number): void {
    super.reset(newSeed);
    this.view?.rebuild();
    this.ui?.clear();
    if (this.following) this.cameras.main.centerOn(this.player.x, this.player.y);
    if (this.screen !== 'title') { this.screen = 'playing'; this.paused = false; this.ui?.showScreen(null); }
  }

  /**
   * Desktop: the whole world fits, so show it all at the largest crisp zoom.
   * Phone: zoom 2 (32 px tiles, good for thumbs) and follow the player.
   */
  private fitCamera(): void {
    const cam = this.cameras.main;
    const fit = Math.min(this.scale.width / this.W, this.scale.height / this.H);
    if (fit >= 2) {
      this.following = false;
      cam.removeBounds();
      cam.setZoom(Math.min(4, Math.floor(fit * 2) / 2));
      cam.centerOn(this.W / 2, this.H / 2);
    } else {
      this.following = true;
      cam.setZoom(2);
      cam.setBounds(0, 0, this.W, this.H, true);
      if (this.player) cam.centerOn(this.player.x, this.player.y);
    }
  }

  // ---- screens / flow -------------------------------------------------------

  startGame(seed?: number): void {
    this.screen = 'playing';
    if (seed !== undefined && seed !== this.seed) {
      const url = new URL(window.location.href);
      url.searchParams.set('seed', String(seed >>> 0));
      window.history.replaceState(null, '', url);
    }
    this.reset(seed !== undefined ? seed >>> 0 : this.seed);
  }

  goTitle(): void {
    this.screen = 'title';
    this.paused = true;
    this.ui?.showScreen('title');
  }

  togglePause(): void {
    if (this.screen === 'playing') { this.screen = 'paused'; this.paused = true; this.ui?.showScreen('pause'); }
    else if (this.screen === 'paused') { this.screen = 'playing'; this.paused = false; this.ui?.showScreen(null); }
  }

  /** The run is over: bank renown and show the result. */
  private endRun(won: boolean): void {
    if (this.result) return;
    const renown = this.meta.bankRun({ won, day: this.day, raidersKilled: this.stats.raidersKilled, soldiersRaised: this.stats.soldiersRaised });
    this.result = { won, renown };
    this.screen = won ? 'won' : 'over';
    this.paused = true;
    this.ui?.showScreen(this.screen);
  }

  setBuild(item: BuildItem): void {
    this.player.build = item;
  }

  select(m: Mover | null): void {
    this.selected = m;
  }

  hoverAgent(m: Mover | null): void {
    this.hovered = m;
  }

  private onPointerMove(ptr: Phaser.Input.Pointer): void {
    if (!this.ui || (this.screen !== 'playing' && this.screen !== 'paused')) { this.ui?.tooltip(null); return; }
    const ev = ptr.event as MouseEvent;
    const m = this.hovered;
    if (m && !m.dead && !m.hidden) {
      const name = m instanceof Villager ? m.name : m instanceof Player ? 'You' : (m as Raider).name;
      const sub = m instanceof Villager ? m.role : m.task;
      this.ui.tooltip(`<div class="t">${name}</div><div class="d">${sub} · ${Math.max(0, m.hp)}/${m.maxHp} hp</div>`, ev.clientX, ev.clientY);
      return;
    }
    const t = this.world.get(Math.floor(ptr.worldX / TILE), Math.floor(ptr.worldY / TILE));
    let html: string | null = null;
    switch (t?.kind) {
      case 'crop': html = `<div class="t">${t.stage >= this.cropDays ? 'Ripe crop' : 'Growing crop'}</div><div class="d">${Math.min(t.stage, this.cropDays)}/${this.cropDays} days · yields ${this.mods.cropYield} food</div>`; break;
      case 'tilled': html = `<div class="t">Tilled soil</div><div class="d">plant with E, or a farmer will</div>`; break;
      case 'tree': html = `<div class="t">Tree</div><div class="d">${t.work}/3 chopped · yields ${TREE_YIELD} wood</div>`; break;
      case 'house': html = `<div class="t">House</div><div class="d">${t.house?.residents ?? 0}/${this.mods.houseCap} residents · couples here have children</div>`; break;
      case 'barracks': html = `<div class="t">Barracks</div><div class="d">children raised nearby grow into soldiers</div>`; break;
    }
    this.ui.tooltip(html, ev.clientX, ev.clientY);
  }

  // ---- simulation -----------------------------------------------------------

  tick(dt: number): void {
    if (this.screen !== 'playing') return;

    this.dayTime += dt / p.dayLength;
    if (this.dayTime >= 1) {
      this.dayTime -= 1;
      this.day++;
      this.newDay();
    }


    for (const a of this.agents) a.update(dt, this);
    for (const a of this.agents) if (a.dead) this.onDeath(a as Mover);
    this.removeDead();

    if (this.raidActive && !this.agents.some((a) => a instanceof Raider)) {
      this.raidActive = false;
      this.stats.raidsRepelled++;
      if (this.boss?.dead) { this.endRun(true); return; }
      this.event('raid', 'Raid repelled!', true);
    }
    this.stats.peakPop = Math.max(this.stats.peakPop, this.villagers().length);
    if (this.player.dead) this.endRun(false);
  }

  private newDay(): void {
    // a night's rest
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + 30);
    // crops grow
    this.world.tiles.forEach((t, i) => { if (t.kind === 'crop') { t.stage++; this.world.dirty.add(i); } });
    // saplings: next to a tree, or rarely anywhere
    for (let i = 0; i < 3; i++) {
      const tx = this.rng.int(0, COLS - 1), ty = this.rng.int(0, ROWS - 1);
      const t = this.world.get(tx, ty);
      const nearTree = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => this.world.get(tx + dx, ty + dy)?.kind === 'tree');
      if (t?.kind === 'grass' && (nearTree || this.rng.chance(0.15))) this.world.set(tx, ty, 'tree');
    }

    // villagers: eat, age, grow up, grow old
    const villagers = this.villagers();
    for (const v of villagers) {
      const ration = p.foodPerDay * this.mods.foodPerDayMul;
      if (this.food >= ration) { this.food -= ration; v.hungerDays = 0; }
      else if (++v.hungerDays >= 3) { v.dead = true; v.hp = 0; this.event('death', `${v.name} starved`, true); continue; }
      else this.event('food', `${v.name} went hungry`);
      v.age++;
      v.hp = v.maxHp; // a night's rest
      if (v.role === 'kid' && v.age >= Math.max(1, p.adultAge + this.mods.adultAgeDelta)) v.comeOfAge(this);
      else if (v.age >= p.oldAge && this.rng.chance(0.25)) { v.dead = true; this.event('death', `${v.name} died of old age`); }
    }

    // births: a couple sharing a house with room and food to spare
    for (const h of this.world.houses) {
      const adults = villagers.filter((v) => v.home === h && v.isAdult && !v.dead);
      if (adults.length >= 2 && h.residents < this.mods.houseCap && this.food > 10 && this.rng.chance(p.birthChance + this.mods.birthBonus)) {
        const kid = this.addVillager(h, 'kid', 0);
        if (h.residents < this.mods.houseCap && this.rng.chance(this.mods.twinChance)) {
          const twin = this.addVillager(h, 'kid', 0);
          this.event('birth', `Twins! ${kid.name} and ${twin.name} were born`, true);
        } else this.event('birth', `${kid.name} was born`, true);
      }
    }

    // move-ins: adults from crowded houses take a spare room elsewhere
    for (const h of this.world.houses) {
      if (h.residents >= this.mods.houseCap) continue;
      const mover = villagers.find((v) => v.isAdult && !v.dead && v.home !== h && villagers.filter((o) => o.home === v.home && o.isAdult).length > 2);
      if (mover) { mover.home.residents--; mover.home = h; h.residents++; this.event('info', `${mover.name} moved into a new house`); }
    }

    if (this.day === RUN.bossDay) this.spawnRaid(true);
    else if (this.day % p.raidEvery === 0 && this.day < RUN.bossDay) this.spawnRaid();
    else if (this.day === RUN.bossDay - RUN.warnDays) this.event('raid', `The Warlord marches — he arrives in ${RUN.warnDays} days`, true);
    else if ((this.day + 1) % p.raidEvery === 0 || this.day + 1 === RUN.bossDay) this.event('raid', 'Raiders sighted — they arrive tomorrow', true);
  }

  spawnRaid(boss = false): void {
    const wave = Math.max(1, Math.floor(this.day / p.raidEvery));
    const n = boss ? 5 : 1 + Math.ceil(wave * 0.8); // 2,3,3,4,5,6 then 5 + the warlord
    const opts = { hpMul: (1 + 0.08 * wave) * this.mods.raiderHpMul, speedMul: this.mods.raiderSpeedMul };
    const side = this.rng.int(0, 3);
    for (let i = 0; i < n + (boss ? 1 : 0); i++) {
      let tx = side === 0 ? 0 : side === 1 ? COLS - 1 : this.rng.int(0, COLS - 1);
      let ty = side === 2 ? 0 : side === 3 ? ROWS - 1 : this.rng.int(0, ROWS - 1);
      const dx = side === 0 ? 1 : side === 1 ? -1 : 0, dy = side === 2 ? 1 : side === 3 ? -1 : 0;
      while (this.world.isBlocked(tx, ty) && this.world.inBounds(tx + dx, ty + dy)) { tx += dx; ty += dy; }
      const c = World.center(tx, ty);
      const isBoss = boss && i === n; // the last one spawned leads
      const r = this.spawn(new Raider(c.x, c.y, { ...opts, boss: isBoss }));
      if (isBoss) { this.boss = r; this.fx.push({ kind: 'boss', who: r }); }
    }
    this.raidActive = true;
    const from = ['west', 'east', 'north', 'south'][side];
    if (boss) this.event('raid', `THE WARLORD ATTACKS from the ${from} with ${n} raiders!`, true);
    else this.event('raid', `RAID! ${n} raider${n > 1 ? 's' : ''} from the ${from}`, true);
  }

  private onDeath(a: Mover): void {
    this.fx.push({ kind: 'death', who: a, x: a.x, y: a.y });
    if (a === this.selected) this.selected = null;
    if (a === this.hovered) this.hovered = null;
    if (a instanceof Villager) {
      a.home.residents--;
      if (a.hp <= 0 && a.hungerDays < 3) this.event('death', `${a.name} the ${a.role} was killed`, true);
    } else if (a instanceof Raider && a.hp <= 0) {
      this.stats.raidersKilled++;
      this.event('raid', a.boss ? 'The Warlord has fallen!' : 'Raider slain', a.boss);
    }
  }

  // ---- queries used by agents -----------------------------------------------

  villagers(): Villager[] {
    return this.agents.filter((a): a is Villager => a instanceof Villager);
  }

  nearestRaider(x: number, y: number, r: number): Raider | null {
    let best: Raider | null = null, bd = Infinity;
    this.grid.forEachInRadius(x, y, r, (o, d2) => {
      if (o instanceof Raider && !o.dead && d2 < bd) { bd = d2; best = o; }
    });
    return best;
  }

  nearestVictim(x: number, y: number): Mover | null {
    let best: Mover | null = null, bd = Infinity;
    for (const a of this.agents) {
      if (!(a instanceof Villager) && a !== this.player) continue;
      const m = a as Mover;
      if (m.dead || m.hidden) continue;
      const d = (m.x - x) ** 2 + (m.y - y) ** 2;
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  pickCivilRole(): Role {
    const vs = this.villagers();
    const farmers = vs.filter((v) => v.role === 'farmer').length;
    const cutters = vs.filter((v) => v.role === 'woodcutter').length;
    return farmers <= cutters ? 'farmer' : 'woodcutter';
  }

  // ---- player actions -------------------------------------------------------

  interact(): void {
    if (this.screen !== 'playing') return;
    const pl = this.player;
    const raider = this.nearestRaider(pl.x, pl.y, 20);
    if (raider) { pl.tryAttack(this, raider, Math.round(12 * this.mods.playerDmgMul), 20, 0.5); return; }

    const { tx, ty } = pl.faced;
    const t = this.world.get(tx, ty);
    if (!t) return;

    if (pl.build !== 'none') {
      if (t.kind !== 'grass') { this.event('build', 'Need open grass to build'); return; }
      if (this.wood < COST[pl.build]) { this.event('build', `Need ${COST[pl.build]} wood for a ${pl.build}`); return; }
      this.wood -= COST[pl.build];
      if (pl.build === 'house') this.world.placeHouse(tx, ty); else this.world.placeBarracks(tx, ty);
      this.fx.push({ kind: 'tool', tool: 'hammer', tx, ty });
      this.event('build', `Built a ${pl.build}`, true);
      return;
    }

    switch (t.kind) {
      case 'grass': this.world.set(tx, ty, 'tilled'); this.fx.push({ kind: 'tool', tool: 'hoe', tx, ty }); break;
      case 'tilled': this.world.set(tx, ty, 'crop'); this.fx.push({ kind: 'tool', tool: 'seed', tx, ty }); break;
      case 'crop':
        if (t.stage >= this.cropDays) { this.world.set(tx, ty, 'tilled'); this.food += this.mods.cropYield; this.fx.push({ kind: 'tool', tool: 'seed', tx, ty }); }
        break;
      case 'tree':
        if (++t.work >= 3) { this.world.set(tx, ty, 'grass'); this.wood += TREE_YIELD; }
        else this.world.dirty.add(ty * COLS + tx);
        this.fx.push({ kind: 'tool', tool: 'axe', tx, ty });
        break;
    }
  }

  hint(): string {
    const pl = this.player;
    if (this.nearestRaider(pl.x, pl.y, 20)) return 'E: attack!';
    if (pl.build !== 'none') return `E: build ${pl.build} (${COST[pl.build]} wood)  ·  Q: cancel`;
    const t = this.world.get(pl.faced.tx, pl.faced.ty);
    switch (t?.kind) {
      case 'grass': return 'E: till soil';
      case 'tilled': return 'E: plant';
      case 'crop': return t.stage >= this.cropDays ? 'E: harvest' : `growing (${t.stage}/${this.cropDays} days)`;
      case 'tree': return `E: chop (${t.work}/3)`;
      case 'house': return `house — ${t.house?.residents ?? 0}/${this.mods.houseCap} residents`;
      case 'barracks': return 'barracks — kids raised nearby become soldiers';
      default: return '';
    }
  }

  // ---- rendering ------------------------------------------------------------

  draw(): void {
    const dt = this.game.loop.delta / 1000;
    if (this.following) {
      const cam = this.cameras.main;
      const k = Math.min(1, dt * 8);
      cam.centerOn(cam.midPoint.x + (this.player.x - cam.midPoint.x) * k, cam.midPoint.y + (this.player.y - cam.midPoint.y) * k);
    }
    this.view?.sync(dt);
    this.ui?.render(dt);
  }
}

// Decide the touch layout before Phaser measures its parent (the side panel becomes a drawer).
if (matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch')) document.body.classList.add('touch');

launch(VillageScene, { width: COLS * TILE, height: ROWS * TILE, zoom: ZOOM, scale: 'resize', pixelArt: true, background: '#1a2a1c' });
