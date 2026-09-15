import Phaser from 'phaser';
import { SimScene, launch } from '@shared/index';
import { World, doorstep, BUILDINGS, MAX_LEVEL, type Building, type BuildingKind } from './world';
import { Villager, Raider, Player, Mover, TOOLS, type Role, type Tool } from './agents';
import { Rat, Snatcher, Brute, Shaman, waveComposition } from './enemies';
import { p, TILE, COLS, ROWS, ZOOM, COST, TREE_YIELD, RUN, SAPLING_DAYS, TREE_SEED_CHANCE, CAPS, UPGRADE_COST, HOUSE_BEDS } from './config';
import { Meta, type Mods, type RenownBreakdown } from './meta';
import { Renderer, preloadArt } from './render';
import { UI } from './ui/ui';

const NAMES = ['Ada', 'Bram', 'Cass', 'Dov', 'Eli', 'Fen', 'Gil', 'Hana', 'Ivo', 'Juno', 'Kai', 'Lior', 'Mara', 'Nils', 'Orla', 'Pim', 'Quin', 'Rue', 'Sol', 'Tova', 'Uli', 'Vera', 'Wren', 'Xan', 'Yael', 'Zed'];

export type EventKind = 'birth' | 'grow' | 'soldier' | 'raid' | 'death' | 'build' | 'info' | 'food' | 'wood';
export interface GameEvent { kind: EventKind; text: string; toast: boolean; day: number }
/** Things the sim reports for the renderer to animate; drained every frame. */
export type FxEvent =
  | { kind: 'hit'; attacker: Mover; target: Mover; dmg: number; crit: boolean; killed: boolean; streak?: number; ux?: number; uy?: number; push?: number }
  | { kind: 'telegraph'; who: Mover; ms: number }
  | { kind: 'miss'; who: Mover }
  | { kind: 'slowmo' }
  | { kind: 'tool'; tool: 'hoe' | 'axe' | 'seed' | 'hammer'; tx: number; ty: number }
  | { kind: 'death'; who: Mover; x: number; y: number }
  | { kind: 'boss'; who: Mover }
  | { kind: 'swing'; who: Mover; dx: number; dy: number; stage: number }
  | { kind: 'cast'; who: Mover }
  | { kind: 'impact'; x: number; y: number };

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

  /** Agents need the world for pushes to respect walls. */
  spawn<T extends { id: number }>(agent: T): T {
    (agent as unknown as Mover).world = this.world;
    return super.spawn(agent as unknown as Parameters<SimScene['spawn']>[0]) as unknown as T;
  }

  /** Brief slow motion for a big moment (real-time 0.5 s), then back to the speed the player had. */
  slowMo(): void {
    if (this.slowUntil) return;
    const prev = this.speed;
    this.speed = 0.2;
    this.fx.push({ kind: 'slowmo' });
    this.slowUntil = window.setTimeout(() => { if (this.speed === 0.2) this.speed = prev; this.slowUntil = 0; }, 500);
  }
  private slowUntil = 0;

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
    if (this.slowUntil) { clearTimeout(this.slowUntil); this.slowUntil = 0; }
    if (this.speed < 1) this.speed = 1;
    this.stats = { peakPop: 0, soldiersRaised: 0, raidsRepelled: 0, raidersKilled: 0 };
    this.boss = null;
    this.result = null;
    this.nameIdx = this.rng.int(0, NAMES.length - 1);

    const home = this.world.houses[0];
    const door = doorstep(home);
    const c = World.center(door.tx, door.ty);
    this.player = this.spawn(new Player(c.x + TILE * 3, c.y + TILE));
    this.player.keys = this.wasd;
    this.player.maxHp += this.mods.playerHpBonus;
    this.player.hp = this.player.maxHp;

    this.addVillager(home, 'farmer', 22);
    this.addVillager(home, 'woodcutter', 22);
    this.addVillager(home, 'kid', 4);
    for (let i = 0; i < this.mods.startSoldiers; i++) this.addVillager(home, 'soldier', 25);
    if (this.mods.extraAdults > 0) {
      // a second family, in the nearest open 2x2 to the left of the first house
      const spot = [[-5, 0], [-6, 0], [5, 0], [0, 5], [-5, 5], [5, 5]].map(([dx, dy]) => ({ tx: home.tx + dx, ty: home.ty + dy })).find((q) => this.world.canBuild('house', q.tx, q.ty)) ?? { tx: home.tx - 3, ty: home.ty };
      const h2 = this.world.placeHouse(spot.tx, spot.ty);
      for (let i = 0; i < this.mods.extraAdults; i++) this.addVillager(h2, i % 2 ? 'woodcutter' : 'farmer', 22);
    }
    this.event('info', 'A new village. Till soil, plant, and keep everyone fed.');
  }

  private addVillager(home: (typeof this.world.houses)[number], role: Role, age: number): Villager {
    const d = doorstep(home);
    const c = World.center(d.tx, d.ty);
    const v = new Villager(c.x + this.rng.range(-4, 4), c.y + this.rng.range(-4, 4), home, role, age, NAMES[this.nameIdx++ % NAMES.length], this.mods);
    if (role === 'soldier') { v.barracksHp = this.world.barracksLevel >= 3 ? 30 : this.world.barracksLevel >= 2 ? 15 : 0; v.applyRole(this.mods); v.hp = v.maxHp; }
    home.residents++;
    return this.spawn(v);
  }

  event(kind: EventKind, text: string, toast = false): void {
    this.journal.push({ kind, text, toast, day: this.day });
  }

  create(): void {
    const kb = this.input.keyboard!;
    this.wasd = kb.addKeys('W,A,S,D') as typeof this.wasd;
    // Stardew-style: C / left click = use tool, X / right click = check, E / Esc = menu, 1-8 or Tab / wheel = tools
    kb.on('keydown-C', () => this.interact());
    kb.on('keydown-X', () => this.select(this.hovered));
    kb.on('keydown-E', () => this.togglePause());
    kb.on('keydown-ESC', () => this.togglePause());
    kb.on('keydown-TAB', (e: KeyboardEvent) => { e.preventDefault?.(); this.player.cycleTool(e.shiftKey ? -1 : 1); });
    kb.on('keydown-Q', () => this.player.cycleTool());
    kb.on('keydown-M', () => this.toggleMute());

    super.create(); // creates gfx + hud, then calls reset() -> setup()
    kb.removeAllListeners('keydown-SPACE'); // Esc handles pause; Space is free for later
    // number keys pick tools; game speed moves to - / =
    kb.removeAllListeners('keydown-ONE'); kb.removeAllListeners('keydown-TWO'); kb.removeAllListeners('keydown-THREE');
    kb.on('keydown-MINUS', () => (this.speed = this.speed > 4 ? 4 : 1));
    kb.on('keydown-PLUS', () => (this.speed = this.speed < 4 ? 4 : 16));
    ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT'].forEach((k, i) => kb.on(`keydown-${k}`, () => (this.player.tool = TOOLS[i])));
    // the kernel's R (restart) / N (new seed) are far too easy to hit mid-run: restart lives in the pause menu,
    // and R only works on the end screens where it means "new run"
    kb.removeAllListeners('keydown-R');
    kb.removeAllListeners('keydown-N');
    kb.on('keydown-R', () => { if (this.screen === 'over' || this.screen === 'won') this.startGame(); });
    this.hud.setVisible(false);

    this.view = new Renderer(this);
    this.view.rebuild();
    this.ui = new UI(this);
    this.ui.mount();

    // hover / click on the map
    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => this.onPointerMove(ptr));
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer, objs: Phaser.GameObjects.GameObject[]) => {
      if (document.body.classList.contains('touch')) { this.select((objs[0]?.getData('agent') as Mover) ?? null); return; }
      if (ptr.rightButtonDown()) { this.select((objs[0]?.getData('agent') as Mover) ?? null); return; }
      if (this.screen !== 'playing') return;
      // left click: face the cursor and use the tool there
      const dx = ptr.worldX - this.player.x, dy = ptr.worldY - this.player.y;
      if (Math.hypot(dx, dy) > 4) this.player.facing = Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
      if (dx) this.player.dir = dx < 0 ? -1 : 1;
      this.interact();
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.player.cycleTool(dy > 0 ? 1 : -1));
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

  /** Follow-camera zoom levels the player can cycle through on small screens. */
  static readonly ZOOMS = [1, 1.5, 2] as const;
  /** index into ZOOMS; null = automatic */
  zoomChoice: number | null = null;

  /**
   * Desktop: the whole world fits, so show it all at the largest crisp zoom.
   * Small screens: follow the player. The default zoom keeps about 16-18 tiles across the
   * narrow side, so a phone in portrait isn't filled by a single building.
   */
  fitCamera(): void {
    const cam = this.cameras.main;
    const vw = this.scale.width, vh = this.scale.height;
    const fit = Math.min(vw / this.W, vh / this.H);
    if (fit >= 2 && this.zoomChoice === null) {
      this.following = false;
      cam.removeBounds();
      cam.setZoom(Math.min(4, Math.floor(fit * 2) / 2));
      cam.centerOn(this.W / 2, this.H / 2);
      return;
    }
    const auto = Math.min(vw, vh) < 500 ? 1.5 : 2;
    const zoom = this.zoomChoice === null ? auto : VillageScene.ZOOMS[this.zoomChoice];
    this.following = true;
    cam.setZoom(zoom);
    cam.setBounds(0, 0, this.W, this.H, true);
    if (this.player) cam.centerOn(this.player.x, this.player.y);
  }

  /** Cycle 1x → 1.5x → 2x (touch zoom button). */
  cycleZoom(): void {
    const zooms: readonly number[] = VillageScene.ZOOMS;
    const cur = this.zoomChoice ?? Math.max(0, zooms.indexOf(this.cameras.main.zoom));
    this.zoomChoice = (cur + 1) % zooms.length;
    this.fitCamera();
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

  /** Sound on/off (M). Returns the new muted state. */
  toggleMute(): boolean {
    return this.view?.fx.sfx.toggleMute() ?? true;
  }
  get muted(): boolean {
    return this.view?.fx.sfx.muted ?? true;
  }

  setTool(tool: Tool): void {
    this.player.tool = tool;
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
      case 'tilled': html = `<div class="t">Tilled soil</div><div class="d">plant with seeds, or a farmer will</div>`; break;
      case 'tree': html = `<div class="t">Tree</div><div class="d">${t.work}/3 chopped · yields ${TREE_YIELD} wood</div>`; break;
      case 'sapling': html = `<div class="t">${t.stage < 2 ? 'Stump' : 'Sapling'}</div><div class="d">grows into a tree in ${SAPLING_DAYS - t.stage} day${SAPLING_DAYS - t.stage === 1 ? '' : 's'}</div>`; break;
      case 'house': case 'barracks': case 'granary': case 'woodyard': {
        const b = t.building!;
        html = `<div class="t">${this.buildingTitle(b)}</div><div class="d">${this.buildingBlurb(b)}</div>`;
        break;
      }
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
      this.slowMo();
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
    // stumps and saplings grow back; trees seed their neighbours
    const seeds: { tx: number; ty: number }[] = [];
    this.world.tiles.forEach((t, i) => {
      const tx = i % COLS, ty = (i / COLS) | 0;
      if (t.kind === 'sapling') {
        if (++t.stage >= SAPLING_DAYS) this.world.set(tx, ty, 'tree'); else this.world.dirty.add(i);
      } else if (t.kind === 'tree' && this.rng.chance(TREE_SEED_CHANCE)) {
        const [dx, dy] = this.rng.pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
        if (this.world.get(tx + dx, ty + dy)?.kind === 'grass') seeds.push({ tx: tx + dx, ty: ty + dy });
      }
    });
    // forests spread until the map is about a third trees, but never into the village clearing
    const treeCap = Math.floor(COLS * ROWS * 0.3);
    let trees = this.world.count((t) => t.kind === 'tree' || t.kind === 'sapling');
    for (const q of seeds) {
      if (trees >= treeCap || this.world.get(q.tx, q.ty)?.kind !== 'grass' || this.nearBuilding(q.tx, q.ty, 2)) continue;
      this.world.set(q.tx, q.ty, 'sapling').stage = 2;
      trees++;
    }
    this.warnedFull = false;

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
      if (adults.length >= 2 && h.residents < this.beds(h) && this.food > 10 && this.rng.chance(p.birthChance + this.mods.birthBonus + (h.level >= 3 ? 0.15 : 0))) {
        const kid = this.addVillager(h, 'kid', 0);
        if (h.residents < this.beds(h) && this.rng.chance(this.mods.twinChance)) {
          const twin = this.addVillager(h, 'kid', 0);
          this.event('birth', `Twins! ${kid.name} and ${twin.name} were born`, true);
        } else this.event('birth', `${kid.name} was born`, true);
      }
    }

    // move-ins: adults from crowded houses take a spare room elsewhere
    for (const h of this.world.houses) {
      if (h.residents >= this.beds(h)) continue;
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
    const mix = waveComposition(wave, boss);
    const opts = { hpMul: (1 + 0.08 * wave) * this.mods.raiderHpMul, speedMul: this.mods.raiderSpeedMul };
    const side = this.rng.int(0, 3);
    const spawnAt = (): { x: number; y: number } => {
      let tx = side === 0 ? 0 : side === 1 ? COLS - 1 : this.rng.int(0, COLS - 1);
      let ty = side === 2 ? 0 : side === 3 ? ROWS - 1 : this.rng.int(0, ROWS - 1);
      const dx = side === 0 ? 1 : side === 1 ? -1 : 0, dy = side === 2 ? 1 : side === 3 ? -1 : 0;
      while (this.world.isBlocked(tx, ty) && this.world.inBounds(tx + dx, ty + dy)) { tx += dx; ty += dy; }
      return World.center(tx, ty);
    };
    const make: Record<keyof typeof mix, (x: number, y: number) => Raider> = {
      raider: (x, y) => new Raider(x, y, opts),
      rat: (x, y) => new Rat(x, y, opts),
      snatcher: (x, y) => new Snatcher(x, y, opts),
      brute: (x, y) => new Brute(x, y, opts),
      shaman: (x, y) => new Shaman(x, y, opts),
    };
    const parts: string[] = [];
    for (const kind of Object.keys(mix) as (keyof typeof mix)[]) {
      const n = mix[kind];
      if (!n) continue;
      parts.push(`${n} ${kind}${n > 1 ? 's' : ''}`);
      for (let i = 0; i < n; i++) { const c = spawnAt(); this.spawn(make[kind](c.x, c.y)); }
    }
    if (boss) {
      const c = spawnAt();
      const w = this.spawn(new Raider(c.x, c.y, { ...opts, boss: true }));
      this.boss = w;
      this.fx.push({ kind: 'boss', who: w });
    }
    this.raidActive = true;
    this.cropsEatenThisRaid = false;
    const from = ['west', 'east', 'north', 'south'][side];
    if (boss) this.event('raid', `THE WARLORD ATTACKS from the ${from} with ${parts.join(', ')}!`, true);
    else this.event('raid', `RAID! ${parts.join(', ')} from the ${from}`, true);
  }

  // ---- hooks called by enemies ----------------------------------------------

  private cropsEatenThisRaid = false;
  cropEaten(): void {
    if (this.cropsEatenThisRaid) return;
    this.cropsEatenThisRaid = true;
    this.event('food', 'Rats are gnawing the crops!', true);
  }
  childGrabbed(kid: Villager, by: Raider): void {
    this.event('raid', `A ${by.name.toLowerCase()} grabbed ${kid.name}!`, true);
  }
  childCarriedOff(kid: Villager, _by: Raider): void {
    kid.carriedBy = null;
    kid.dead = true;
    kid.hp = 0;
    kid.hungerDays = 99; // keeps onDeath from logging "was killed"
    this.event('death', `${kid.name} was carried off`, true);
  }


  private onDeath(a: Mover): void {
    this.fx.push({ kind: 'death', who: a, x: a.x, y: a.y });
    if (a === this.selected) this.selected = null;
    if (a === this.hovered) this.hovered = null;
    if (a instanceof Villager) {
      a.home.residents--;
      if (a.hp <= 0 && a.hungerDays < 3) this.event('death', `${a.name} the ${a.role} was killed`, true);
    } else if (a instanceof Raider) {
      if (a.carrying && !a.carrying.dead) { const kid = a.carrying; kid.carriedBy = null; a.carrying = null; this.event('grow', `${kid.name} was rescued!`, true); }
      if (a.hp <= 0) {
        this.stats.raidersKilled++;
        this.event('raid', a.boss ? 'The Warlord has fallen!' : `${a.name} slain`, a.boss);
      }
    }
  }

  // ---- queries used by agents -----------------------------------------------

  villagers(): Villager[] {
    return this.agents.filter((a): a is Villager => a instanceof Villager);
  }

  /** Nearest enemy; rats are skipped unless `includeHarmless` (they're no threat to people). */
  nearestRaider(x: number, y: number, r: number, includeHarmless = false): Raider | null {
    let best: Raider | null = null, bd = Infinity;
    this.grid.forEachInRadius(x, y, r, (o, d2) => {
      if (o instanceof Raider && !o.dead && (includeHarmless || !o.harmless) && d2 < bd) { bd = d2; best = o; }
    });
    return best;
  }

  /** What a soldier should go for: a snatcher carrying a child first (seen from further away), then real threats, rats last. */
  bestTarget(x: number, y: number, r: number): Raider | null {
    let best: Raider | null = null, bs = Infinity;
    this.grid.forEachInRadius(x, y, r * 2.5, (o, d2) => {
      if (o instanceof Raider && !o.dead && o.carrying && d2 < bs) { bs = d2; best = o; }
    });
    if (best) return best;
    this.grid.forEachInRadius(x, y, r, (o, d2) => {
      if (!(o instanceof Raider) || o.dead) return;
      const score = Math.sqrt(d2) - (o.carrying ? 120 : o.harmless ? -60 : 0);
      if (score < bs) { bs = score; best = o; }
    });
    return best;
  }

  nearestSoldier(x: number, y: number, r: number): Villager | null {
    let best: Villager | null = null, bd = Infinity;
    this.grid.forEachInRadius(x, y, r, (o, d2) => {
      if (o instanceof Villager && o.role === 'soldier' && !o.dead && !o.hidden && d2 < bd) { bd = d2; best = o; }
    });
    return best;
  }

  nearestChild(x: number, y: number): Villager | null {
    let best: Villager | null = null, bd = Infinity;
    for (const a of this.agents) {
      if (!(a instanceof Villager) || a.role !== 'kid' || a.dead || a.hidden || a.carriedBy) continue;
      const d = (a.x - x) ** 2 + (a.y - y) ** 2;
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  nearestVictim(x: number, y: number): Mover | null {
    let best: Mover | null = null, bd = Infinity;
    for (const a of this.agents) {
      if (!(a instanceof Villager) && a !== this.player) continue;
      const m = a as Mover;
      if (m.dead || m.hidden || (a instanceof Villager && a.carriedBy)) continue;
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

  // ---- buildings: beds, caps, upgrades ----------------------------------------------

  /** Beds in a house: by level, or the Big Families boon if that is higher. */
  beds(h: Building): number {
    return Math.max(HOUSE_BEDS[h.level] ?? 4, this.mods.houseCap);
  }
  get foodCap(): number { return CAPS[this.world.granary?.level ?? 1]; }
  get woodCap(): number { return CAPS[this.world.woodyard?.level ?? 1]; }
  private warnedFull = false;

  /** Add to the stockpile, respecting storage; says so (once a day) when the store is full. */
  addFood(n: number): void {
    const room = this.foodCap - this.food;
    if (n > room && !this.warnedFull) { this.warnedFull = true; this.event('food', 'The granary is full — upgrade it with the hammer', true); }
    this.food = Math.min(this.foodCap, this.food + n);
  }
  addWood(n: number): void {
    const room = this.woodCap - this.wood;
    if (n > room && !this.warnedFull) { this.warnedFull = true; this.event('wood', 'The woodyard is full — upgrade it with the hammer', true); }
    this.wood = Math.min(this.woodCap, this.wood + n);
  }

  buildingTitle(b: Building): string {
    return `${BUILDINGS[b.kind].name} Lv${b.level}`;
  }
  buildingBlurb(b: Building): string {
    const up = b.level < MAX_LEVEL ? ` · hammer: upgrade (${UPGRADE_COST[b.kind][b.level]} wood)` : ' · max level';
    switch (b.kind) {
      case 'house': return `${b.residents}/${this.beds(b)} beds${b.level >= 3 ? ' · births +15%' : ''}${up}`;
      case 'barracks': return `children raised nearby become soldiers${b.level >= 2 ? ` · soldiers +${b.level >= 3 ? 30 : 15} HP` : ''}${b.level >= 3 ? ' · +20% damage, regen' : ''}${up}`;
      case 'granary': return `holds ${CAPS[b.level]} food (${this.food | 0} stored)${up}`;
      case 'woodyard': return `holds ${CAPS[b.level]} wood (${this.wood | 0} stored)${up}`;
    }
  }

  /** Why the hammer can't upgrade `b` right now, or null. */
  upgradeProblem(b: Building): string | null {
    if (b.level >= MAX_LEVEL) return `${BUILDINGS[b.kind].name} is already max level`;
    const cost = UPGRADE_COST[b.kind][b.level];
    if (this.wood < cost) return `need ${cost} wood (have ${this.wood | 0})`;
    return null;
  }

  private upgrade(b: Building): void {
    const cost = UPGRADE_COST[b.kind][b.level];
    this.wood -= cost;
    b.level++;
    this.world.refresh(b);
    this.event('build', `${BUILDINGS[b.kind].name} upgraded to level ${b.level}`, true);
  }

  // ---- player actions -------------------------------------------------------

  /**
   * Top-left of the footprint a new building would take: always the full building in front of
   * the player (never overlapping them), roughly centred on the faced tile.
   */
  buildAnchor(kind: BuildingKind = this.player.build === 'none' ? 'house' : this.player.build): { tx: number; ty: number } {
    const f = this.player.faced, d = this.player.facing;
    const { w, h } = BUILDINGS[kind];
    const half = Math.floor(w / 2) - 1;
    if (d.y > 0) return { tx: f.tx - half, ty: f.ty };
    if (d.y < 0) return { tx: f.tx - half, ty: f.ty - h + 1 };
    if (d.x > 0) return { tx: f.tx, ty: f.ty - half };
    return { tx: f.tx - w + 1, ty: f.ty - half };
  }

  /** Why a building can't go at `a`, or null if it can. */
  buildProblem(a: { tx: number; ty: number }, kind: BuildingKind = this.player.build === 'none' ? 'house' : this.player.build): string | null {
    const { w, h } = BUILDINGS[kind];
    if (!this.world.canBuild(kind, a.tx, a.ty)) return `Need a clear ${w}x${h} of grass to build`;
    const inside = (m: Mover) => !m.hidden && m.x >= a.tx * TILE - 2 && m.x < (a.tx + w) * TILE + 2 && m.y >= a.ty * TILE - 2 && m.y < (a.ty + h) * TILE + 2;
    if (this.agents.some((m) => inside(m as Mover))) return "Someone's standing in the way";
    return null;
  }

  /** Is (tx, ty) within `pad` tiles of any building footprint (including its yard)? */
  nearBuilding(tx: number, ty: number, pad: number): boolean {
    return this.world.buildings.some((b) => {
      const f = BUILDINGS[b.kind];
      return tx >= b.tx - pad && tx < b.tx + f.w + pad && ty >= b.ty - pad && ty < b.ty + f.h + 1 + pad;
    });
  }

  /** The building in front of the player, if any. */
  facedBuilding(): Building | null {
    const t = this.world.get(this.player.faced.tx, this.player.faced.ty);
    return t?.building ?? null;
  }

  /** Use the equipped tool on the faced tile (or swing the sword). */
  interact(): void {
    if (this.screen !== 'playing') return;
    const pl = this.player;
    const { tx, ty } = pl.faced;
    const t = this.world.get(tx, ty);

    switch (pl.tool) {
      case 'sword': {
        const stage = pl.pressAttack();
        if (stage >= 0) this.fx.push({ kind: 'swing', who: pl, dx: pl.facing.x, dy: pl.facing.y, stage });
        return;
      }
      case 'house':
      case 'barracks': {
        const a = this.buildAnchor(pl.tool);
        const why = this.buildProblem(a, pl.tool);
        if (why) { this.event('build', why); return; }
        if (this.wood < COST[pl.tool]) { this.event('build', `Need ${COST[pl.tool]} wood for a ${pl.tool}`); return; }
        this.wood -= COST[pl.tool];
        this.world.place(pl.tool, a.tx, a.ty);
        this.fx.push({ kind: 'tool', tool: 'hammer', tx: a.tx + 1, ty: a.ty + BUILDINGS[pl.tool].h - 1 });
        this.event('build', `Built a ${pl.tool}`, true);
        return;
      }
      case 'hammer': {
        const b = this.facedBuilding();
        this.fx.push({ kind: 'tool', tool: 'hammer', tx, ty });
        if (!b || !t) return;
        const why = this.upgradeProblem(b);
        if (why) { this.event('build', why); return; }
        if (++t.work >= 3) { t.work = 0; this.upgrade(b); }
        return;
      }
      case 'hoe':
        if (t?.kind === 'grass' || t?.kind === 'sapling') this.world.set(tx, ty, 'tilled');
        this.fx.push({ kind: 'tool', tool: 'hoe', tx, ty });
        return;
      case 'seeds':
        if (t?.kind === 'tilled') { this.world.set(tx, ty, 'crop'); this.fx.push({ kind: 'tool', tool: 'seed', tx, ty }); }
        else if (t?.kind === 'grass') { this.world.set(tx, ty, 'sapling'); this.fx.push({ kind: 'tool', tool: 'seed', tx, ty }); }
        return;
      case 'axe':
        if (t?.kind === 'tree') {
          if (++t.work >= 3) { this.world.set(tx, ty, 'sapling'); this.addWood(TREE_YIELD); }
          else this.world.dirty.add(ty * COLS + tx);
        }
        this.fx.push({ kind: 'tool', tool: 'axe', tx, ty });
        return;
      case 'hands':
        if (t?.kind === 'crop' && t.stage >= this.cropDays) { this.world.set(tx, ty, 'tilled'); this.addFood(this.mods.cropYield); this.fx.push({ kind: 'tool', tool: 'seed', tx, ty }); }
        return;
    }
  }

  /** What the tool would do right now, as "E: verb" (or a reason it won't). */
  hint(): string {
    const pl = this.player;
    const t = this.world.get(pl.faced.tx, pl.faced.ty);
    const kind = t?.kind;
    const need = (tool: string) => `need the ${tool}`;
    const b = t?.building;
    if (b && pl.tool !== 'hammer' && pl.tool !== 'sword') return `${this.buildingTitle(b)} — ${this.buildingBlurb(b)}`;
    switch (pl.tool) {
      case 'sword': {
        const near = this.nearestRaider(pl.x, pl.y, 40);
        return near ? 'E: attack!' : 'E: swing sword';
      }
      case 'house':
      case 'barracks': {
        const why = this.buildProblem(this.buildAnchor(pl.tool), pl.tool);
        return `E: build ${pl.tool} (${COST[pl.tool]} wood)${why ? ' — ' + why : ''}`;
      }
      case 'hammer': {
        if (!b) return 'hammer: face a building to upgrade it';
        const why = this.upgradeProblem(b);
        return why ? `${this.buildingTitle(b)} — ${why}` : `E: upgrade ${BUILDINGS[b.kind].name} to Lv${b.level + 1} (${UPGRADE_COST[b.kind][b.level]} wood, ${3 - (t?.work ?? 0)} hits)`;
      }
      case 'hoe':
        if (kind === 'grass') return 'E: till soil';
        if (kind === 'sapling') return 'E: clear the sapling';
        if (kind === 'tilled') return `tilled — ${need('seeds')}`;
        if (kind === 'crop') return t!.stage >= this.cropDays ? `ripe — ${need('hands')}` : `growing (${t!.stage}/${this.cropDays} days)`;
        if (kind === 'tree') return `tree — ${need('axe')}`;
        return 'hoe: face open grass';
      case 'seeds':
        if (kind === 'tilled') return 'E: plant crops';
        if (kind === 'grass') return `E: plant a tree (grows in ${SAPLING_DAYS} days)`;
        if (kind === 'sapling') return `sapling — a tree in ${SAPLING_DAYS - t!.stage} days`;
        if (kind === 'crop') return t!.stage >= this.cropDays ? `ripe — ${need('hands')}` : `growing (${t!.stage}/${this.cropDays} days)`;
        return 'seeds: crops on soil, trees on grass';
      case 'axe':
        if (kind === 'tree') return `E: chop (${t!.work}/3)`;
        if (kind === 'sapling') return `sapling — a tree in ${SAPLING_DAYS - t!.stage} days`;
        return 'axe: face a tree';
      case 'hands':
        if (kind === 'crop') return t!.stage >= this.cropDays ? 'E: harvest' : `growing (${t!.stage}/${this.cropDays} days)`;
        if (kind === 'grass') return `grass — ${need('hoe')} to till`;
        if (kind === 'tilled') return `tilled — ${need('seeds')}`;
        if (kind === 'tree') return `tree — ${need('axe')}`;
        if (kind === 'sapling') return `sapling — a tree in ${SAPLING_DAYS - t!.stage} days`;
        return 'hands: harvest ripe crops';
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
