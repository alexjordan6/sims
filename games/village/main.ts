import Phaser from 'phaser';
import { SimScene, launch, button } from '@shared/index';
import { World, doorstep, buildingCenter, buildingMaxHp, hasHearth, hearthCost, BUILDINGS, MAX_LEVEL, BUILDABLE, type DefenseKind, type Building, type BuildingKind, type Tile, type TilePos } from './world';
import { Villager, Raider, Player, Mover, Arrow, TOOLS, type Role, type Tool } from './agents';
import { DEFENSE_COST, WALL_HEIGHT } from './config';
import { Interior } from './interior';
import { Rat, Snatcher, Brute, Shaman, Ogre, Wrecker, waveComposition } from './enemies';
import { Fog } from './fog';
import { p, TILE, COLS, ROWS, ZOOM, COST, HAUL, type LoadKind, RUN, SAPLING_DAYS, SEED_BASE, SEED_PER_NEIGHBOUR, SHELTERED_SAPLING_DAYS, OLD_GROWTH_DAYS, CAPS, UPGRADE_COST, HOUSE_BEDS, LEVEL_PERKS, CADET_AGE_BEFORE, HEARTY_RATION, CALLING_NAME, ARMOR, ARMOR_BARRACKS_LEVEL, SCRAP_DROP, DYES, PLUMES, TOWER, REPAIR, DISMANTLE, WEAPONS, type Calling, type ArmorSlot, type WeaponSlot } from './config';
import { Meta, type Mods, type RenownBreakdown } from './meta';
import { Renderer, preloadArt } from './render';
import { UI } from './ui/ui';
import { weaponMul } from './characters';

const NAMES = ['Ada', 'Bram', 'Cass', 'Dov', 'Eli', 'Fen', 'Gil', 'Hana', 'Ivo', 'Juno', 'Kai', 'Lior', 'Mara', 'Nils', 'Orla', 'Pim', 'Quin', 'Rue', 'Sol', 'Tova', 'Uli', 'Vera', 'Wren', 'Xan', 'Yael', 'Zed'];

export type EventKind = 'birth' | 'grow' | 'soldier' | 'raid' | 'death' | 'build' | 'info' | 'food' | 'wood';
export interface GameEvent { kind: EventKind; text: string; toast: boolean; day: number }
/** Things the sim reports for the renderer to animate; drained every frame. */
export type FxEvent =
  | { kind: 'hit'; attacker: Mover; target: Mover; dmg: number; crit: boolean; killed: boolean; streak?: number; ux?: number; uy?: number; push?: number }
  | { kind: 'telegraph'; who: Mover; ms: number }
  | { kind: 'miss'; who: Mover }
  | { kind: 'slowmo' }
  | { kind: 'tool'; tool: 'hoe' | 'axe' | 'seed' | 'hammer'; tx: number; ty: number; who?: Mover }
  | { kind: 'death'; who: Mover; x: number; y: number }
  | { kind: 'boss'; who: Mover }
  | { kind: 'swing'; who: Mover; dx: number; dy: number; stage: number }
  | { kind: 'cast'; who: Mover }
  | { kind: 'impact'; x: number; y: number }
  | { kind: 'upgrade'; building: Building }
  | { kind: 'hearts'; who: Mover }
  | { kind: 'melee'; who: Mover; x: number; y: number }
  | { kind: 'arrow'; who: Mover }
  | { kind: 'thud'; who: Mover }
  | { kind: 'snore'; x: number; y: number }
  | { kind: 'deposit'; x: number; y: number; text: string; colour: string }
  | { kind: 'ruin'; building: Building }
  | { kind: 'demolish'; building: Building }
  /** the Ogre's ground slam (also his crash into a wall): shockwave of radius r */
  | { kind: 'smash'; who: Mover; x: number; y: number; r: number }
  /** the Ogre lowers his head and rushes along (ux, uy) */
  | { kind: 'charge'; who: Mover; ux: number; uy: number };

export type Screen = 'title' | 'playing' | 'paused' | 'over' | 'won';

export class VillageScene extends SimScene {
  neighborRadius = 130; // soldier aggro radius = largest grid query

  world!: World;
  player!: Player;
  food = 0;
  wood = 0;
  arrows = 30;
  /** scrap iron looted from raiders; forges iron and steel armor */
  scrap = 0;
  /** the ARMORY panel's current wearer, or null when closed */
  armoryFor: Mover | null = null;
  /** the barracks whose chest the open armory restocks */
  armoryChest: Building | null = null;
  interior = new Interior(this);
  posting: Villager | null = null;
  day = 1;
  /** 0..1 within the day; night around 0.8..0.2 */
  dayTime = 0.3;
  raidActive = false;
  screen: Screen = 'title';
  selected: Mover | null = null;
  /** a building picked with X / right-click / tap (houses can be sworn from its card) */
  selectedBuilding: Building | null = null;
  journal: GameEvent[] = [];
  fx: FxEvent[] = [];
  private static buttonsMade = false;
  stats = { peakPop: 0, soldiersRaised: 0, childrenRaised: 0, starsTotal: 0, raidsRepelled: 0, raidersKilled: 0, bossesSlain: 0, buildingsLost: 0 };
  /** persists across runs (localStorage) */
  meta = new Meta();
  /** this run's modifiers, compiled from the equipped boons */
  mods: Mods = this.meta.mods();
  boss: Raider | null = null;
  /** the Ogre, asleep in his lair until night */
  ogre: Ogre | null = null;
  /** the fog of war: what has been seen */
  fog!: Fog;
  lairFound = false;
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
  /** true on frames where the renderer repainted tiles (the minimap follows) */
  get tilesChanged(): boolean { return this.view?.tilesChanged ?? false; }
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
    const first = p.firstRaidDay, every = this.raidEvery;
    const next = this.day < first ? first : first + (Math.floor((this.day - first) / every) + 1) * every;
    return Math.min(next, p.bossDay);
  }
  /** Is `day` a raid day (the warlord's day aside)? */
  isRaidDay(day: number): boolean { return day >= p.firstRaidDay && day < p.bossDay && (day - p.firstRaidDay) % this.raidEvery === 0; }

  // ---- setup ----------------------------------------------------------------

  preload(): void {
    preloadArt(this);
  }

  setup(): void {
    this.interior.leave();
    this.posting = null;
    this.arrows = 30; this.feverWas = null;
    this.scrap = 0;
    this.armoryFor = null;
    this.mods = this.meta.mods();
    this.world = new World();
    this.world.generate(this.rng, this.mods.fieldWide ? 5 : 3);
    this.food = this.mods.startFood;
    this.wood = this.mods.startWood;
    if (this.world.granary) this.world.granary.level = this.mods.startGranaryLevel;
    if (this.world.woodyard) this.world.woodyard.level = this.mods.startWoodyardLevel;
    this.day = 1;
    this.dayTime = 0.3;
    this.raidActive = false;
    this.selected = null;
    this.selectedBuilding = null;
    this.journal = [];
    this.fx = [];
    if (this.slowUntil) { clearTimeout(this.slowUntil); this.slowUntil = 0; }
    if (this.speed < 1) this.speed = 1;
    this.stats = { peakPop: 0, soldiersRaised: 0, childrenRaised: 0, starsTotal: 0, raidsRepelled: 0, raidersKilled: 0, bossesSlain: 0, buildingsLost: 0 };
    this.boss = null;
    this.ogre = this.world.lair ? this.spawn(new Ogre(this.world.lair)) : null;
    this.lairFound = false;
    this.fog?.reset();
    this.result = null;
    this.nameIdx = this.rng.int(0, NAMES.length - 1);

    const home = this.world.houses[0];
    const door = doorstep(home);
    const c = World.center(door.tx, door.ty);
    this.player = this.spawn(new Player(c.x + TILE * 3, c.y + TILE));
    this.player.keys = this.wasd;
    this.player.maxHp += this.mods.playerHpBonus;
    this.player.hp = this.player.maxHp;

    const ma = this.addVillager(home, 'farmer', 22);
    const pa = this.addVillager(home, 'woodcutter', 22);
    this.addVillager(home, 'kid', 4).parents = [ma, pa];
    for (let i = 0; i < this.mods.startSoldiers; i++) this.addVillager(home, 'soldier', 25);
    if (this.mods.extraAdults > 0) {
      // a second family, in the nearest open 2x2 to the left of the first house
      const spot = [[-5, 0], [-6, 0], [5, 0], [0, 5], [-5, 5], [5, 5]].map(([dx, dy]) => ({ tx: home.tx + dx, ty: home.ty + dy })).find((q) => this.world.canBuild('house', q.tx, q.ty)) ?? { tx: home.tx - 3, ty: home.ty };
      const h2 = this.world.placeHouse(spot.tx, spot.ty);
      for (let i = 0; i < this.mods.extraAdults; i++) this.addVillager(h2, i % 2 ? 'woodcutter' : 'farmer', 22);
    }
    this.event('info', `A new village in ${this.world.denseForests ? 'the deep woodland' : 'the open meadows'}. Follow trails to explore. Build walls and stairs, then station archers.`);
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
    // playtest buttons on the backtick panel (once: the scene is created a single time)
    if (!VillageScene.buttonsMade) {
      VillageScene.buttonsMade = true;
      button('next day', () => { if (this.screen === 'playing') { this.day++; this.newDay(); } }, 'Jump to the next dawn: rations, hearths, births, raids on schedule.');
      button('spawn raid', () => { if (this.screen === 'playing') this.spawnRaid(); }, 'Start a raid now, sized for the current wave.');
      button('+50 wood', () => { this.wood = Math.min(this.woodCap, this.wood + 50); }, 'Wood into the woodyard, up to its cap.');
      button('+50 food', () => { this.food = Math.min(this.foodCap, this.food + 50); }, 'Food into the granary, up to its cap.');
      button('+20 scrap', () => { this.scrap += 20; }, 'Scrap iron for iron and steel forging.');
    }
    // Stardew-style: C / left click = use tool, X / right click = check, E / Esc = menu, 1-8 or Tab / wheel = tools
    kb.on('keydown-C', () => this.interact());
    kb.on('keydown-X', () => {
      if (this.interior.active) { this.interior.act(); return; }
      if (this.checkNearby()) return;
      if (this.hovered) { this.select(this.hovered); return; }
      const b = this.facedBuilding() ?? this.world.get(this.player.tile.tx, this.player.tile.ty)?.building ?? null;
      if (b) this.selectBuilding(b); else this.select(null);
    });
    kb.on('keydown-E', () => { if (this.armoryFor) this.openArmory(null); else this.togglePause(); });
    kb.on('keydown-ESC', () => { if (this.armoryFor) this.openArmory(null); else this.togglePause(); });
    kb.on('keydown-V', () => this.openArmory(this.armoryFor ? null : this.player));
    kb.on('keydown-TAB', (e: KeyboardEvent) => { e.preventDefault?.(); this.player.cycleTool(e.shiftKey ? -1 : 1); });
    kb.on('keydown-Q', () => this.player.cycleTool());
    kb.on('keydown-M', () => this.toggleMute());
    kb.on('keydown-Z', () => this.cycleZoom());

    super.create(); // creates gfx + hud, then calls reset() -> setup()
    kb.removeAllListeners('keydown-SPACE'); // Esc handles pause; Space is free for later
    // number keys pick tools; game speed moves to - / =
    kb.removeAllListeners('keydown-ONE'); kb.removeAllListeners('keydown-TWO'); kb.removeAllListeners('keydown-THREE');
    kb.on('keydown-MINUS', () => (this.speed = this.speed > 4 ? 4 : 1));
    kb.on('keydown-PLUS', () => (this.speed = this.speed < 4 ? 4 : 16));
    ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'].forEach((k, i) => kb.on(`keydown-${k}`, () => (this.player.tool = TOOLS[i])));
    // the kernel's R (restart) / N (new seed) are far too easy to hit mid-run: restart lives in the pause menu,
    // and R only works on the end screens where it means "new run"
    kb.removeAllListeners('keydown-R');
    kb.removeAllListeners('keydown-N');
    kb.on('keydown-R', () => { if (this.screen === 'over' || this.screen === 'won') this.startGame(); });
    this.hud.setVisible(false);

    this.view = new Renderer(this);
    this.fog = new Fog(this, 45);
    this.view.rebuild();
    this.ui = new UI(this);
    this.ui.mount();

    // hover / click on the map
    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => this.onPointerMove(ptr));
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer, objs: Phaser.GameObjects.GameObject[]) => {
      if (this.posting) { const q = World.toTile(ptr.worldX, ptr.worldY + WALL_HEIGHT); this.assignPost(this.posting, q); return; }
      if (document.body.classList.contains('touch')) { this.pick(ptr, objs); return; }
      if (ptr.rightButtonDown()) { this.pick(ptr, objs); return; }
      if (this.screen !== 'playing') return;
      // left click: face the cursor and use the tool there
      const dx = ptr.worldX - this.player.x, dy = ptr.worldY - this.player.y;
      if (Math.hypot(dx, dy) > 4) this.player.facing = Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
      if (dx) this.player.dir = dx < 0 ? -1 : 1;
      this.interact();
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.player.cycleTool(dy > 0 ? 1 : -1));
    this.input.on('gameout', () => { this.hovered = null; this.hoverTile = null; this.ui?.tooltip(null); });

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
  static readonly ZOOMS = [1, 1.5, 2, 3] as const;
  /** index into ZOOMS; null = automatic */
  zoomChoice: number | null = null;
  /** the zoom the camera should rest at; fx bumps zoom in briefly and always return here */
  baseZoom = 2;

  /**
   * The world is bigger than any normal screen, so the camera follows the player: 2x on
   * desktop (a 40x22-tile window), 1.5x on phones so a portrait screen isn't filled by a single
   * building. Z / the ZOOM button cycle ZOOMS. Only a huge display shows the whole map at once.
   */
  fitCamera(): void {
    const cam = this.cameras.main;
    cam.zoomEffect.reset(); // a zoom bump in flight would otherwise snap back to the old zoom
    const vw = this.scale.width, vh = this.scale.height;
    const fit = Math.min(vw / this.W, vh / this.H);
    if (fit >= 2 && this.zoomChoice === null) {
      this.following = false;
      cam.removeBounds();
      this.baseZoom = Math.min(4, Math.floor(fit * 2) / 2);
      cam.setZoom(this.baseZoom);
      cam.centerOn(this.W / 2, this.H / 2);
      return;
    }
    const auto = Math.min(vw, vh) < 500 ? 1.5 : 2;
    const zoom = this.zoomChoice === null ? auto : VillageScene.ZOOMS[this.zoomChoice];
    this.following = true;
    this.baseZoom = zoom;
    cam.setZoom(zoom);
    cam.setBounds(0, 0, this.W, this.H, true);
    if (this.player) cam.centerOn(this.player.x, this.player.y);
  }

  /** Cycle 1x → 1.5x → 2x → 3x (Z, or the touch zoom button). */
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
    const renown = this.meta.bankRun({ won, day: this.day, raidersKilled: this.stats.raidersKilled, childrenRaised: this.stats.childrenRaised, stars: this.stats.starsTotal, bossesSlain: this.stats.bossesSlain });
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
    if (m) this.selectedBuilding = null;
    // picking a child you're standing next to is how you encourage them
    if (m instanceof Villager && m.role === 'kid' && this.screen === 'playing' && !this.encourageProblem(m)) this.encourage(m);
  }
  selectBuilding(b: Building | null): void {
    this.selectedBuilding = b;
    if (b) this.selected = null;
  }
  /** Pick whatever is under the pointer: an agent first, else a building tile. */
  private pick(ptr: Phaser.Input.Pointer, objs: Phaser.GameObjects.GameObject[]): void {
    if (this.checkNearby(World.toTile(ptr.worldX, ptr.worldY))) return;
    const m = (objs[0]?.getData('agent') as Mover) ?? null;
    if (m) { this.select(m); return; }
    const b = this.world.get(Math.floor(ptr.worldX / TILE), Math.floor(ptr.worldY / TILE))?.building ?? null;
    if (b) this.selectBuilding(b); else this.select(null);
  }

  get adultAge(): number { return Math.max(1, p.adultAge + this.mods.adultAgeDelta); }
  nearestBarracks(x: number, y: number): Building | null {
    let best: Building | null = null, bd = Infinity;
    for (const b of this.world.barracks) { const c = buildingCenter(b); const d = (c.tx * TILE - x) ** 2 + (c.ty * TILE - y) ** 2; if (d < bd) { bd = d; best = b; } }
    return best;
  }

  /** Why a house can't be sworn to the barracks right now, or null. */
  swearProblem(h: Building): string | null {
    if (h.kind !== 'house') return 'Only houses can be sworn';
    if (h.calling === 'soldier') return null;
    const cap = this.world.sponsorship(this.mods.sponsorBonus);
    const used = this.world.swornHouses.length;
    if (!cap) return 'Build a barracks first';
    if (used >= cap) return `Your barracks sponsor ${cap} house${cap === 1 ? '' : 's'} — upgrade one or build another`;
    return null;
  }
  /** Decide what a house raises its children to be. Soldiers need barracks sponsorship. */
  setCalling(h: Building, calling: Calling): boolean {
    if ((h.calling ?? 'farmer') === calling) return true;
    if (calling === 'soldier') {
      const why = this.swearProblem(h);
      if (why) { this.event('info', why, true); return false; }
      h.calling = 'soldier';
      this.event('soldier', `House sworn to the barracks — its children will drill from age ${this.adultAge - CADET_AGE_BEFORE}`, true);
      return true;
    }
    const wasSworn = h.calling === 'soldier';
    h.calling = calling;
    this.event('info', `${wasSworn ? 'House released — it' : 'This house'} now raises ${CALLING_NAME[calling]}`, true);
    return true;
  }
  /** kept for older callers: toggles the soldier calling */
  swear(h: Building): boolean { return this.setCalling(h, h.calling === 'soldier' ? 'farmer' : 'soldier'); }
  /** Hearty rations: the house's children eat double and count as well fed. */
  setRations(h: Building, hearty: boolean): void {
    h.hearty = hearty;
    this.event('food', hearty ? `Hearty rations for the children of this house (${HEARTY_RATION} food a day each)` : 'Back to plain rations', true);
  }

  // ---- armory ---------------------------------------------------------------------------------

  /** Everyone who can wear armor: you and your soldiers. */
  wearers(): Mover[] {
    return [this.player as Mover, ...this.villagers().filter((v) => v.role === 'soldier' && !v.dead)];
  }
  /** Why `who` can't have the next tier in `slot` right now, or null. */
  craftProblem(who: Mover, slot: ArmorSlot): string | null {
    const next = who.armor[slot] + 1;
    const tier = ARMOR[slot].tiers[next];
    if (!tier) return 'already the best there is';
    if (slot === 'shield' && ((who instanceof Villager && who.weapon === 'bow') || (who instanceof Player && who.tool === 'bow'))) return 'a bow needs both hands';
    return this.forgeProblem(next, tier);
  }
  /** Why `who` can't have the next weapon tier in `slot` right now, or null. */
  weaponProblem(who: Mover, slot: WeaponSlot): string | null {
    const next = who.weapons[slot] + 1;
    const tier = WEAPONS[slot].tiers[next];
    if (!tier) return 'already the best there is';
    return this.forgeProblem(next, tier);
  }
  /** Forge a better weapon for a wearer; pays wood and scrap. */
  craftWeapon(who: Mover, slot: WeaponSlot): boolean {
    const why = this.weaponProblem(who, slot);
    if (why) { this.event('info', `Can't forge: ${why}`, true); return false; }
    const next = who.weapons[slot] + 1, tier = WEAPONS[slot].tiers[next];
    const paid = this.forgeCost(tier); this.wood -= paid.wood; this.scrap -= paid.scrap;
    who.weapons = { ...who.weapons, [slot]: next };
    this.fx.push({ kind: 'tool', tool: 'hammer', tx: who.tile.tx, ty: who.tile.ty });
    this.event('build', `${who instanceof Player ? 'You' : (who as Villager).name} now carr${who instanceof Player ? 'y' : 'ies'} a ${tier.name.toLowerCase()}`, true);
    return true;
  }
  /** The forge rules armor and weapons share: a standing barracks of the tier's level, and the wood and scrap. */
  private forgeProblem(next: number, tier: { wood: number; scrap: number }): string | null {
    const need = ARMOR_BARRACKS_LEVEL[next];
    if (!this.world.barracks.length) return 'build a barracks first';
    if (this.world.barracksLevel < need) return `needs a Lv${need} barracks`;
    const cost = this.forgeCost(tier);
    if (this.wood < cost.wood) return `need ${cost.wood} wood (have ${this.wood | 0})`;
    if (this.scrap < cost.scrap) return `need ${cost.scrap} scrap iron (have ${this.scrap})`;
    return null;
  }
  /** Forge the next tier of a slot for a wearer; pays wood and scrap. */
  craftArmor(who: Mover, slot: ArmorSlot): boolean {
    const why = this.craftProblem(who, slot);
    if (why) { this.event('info', `Can't forge: ${why}`, true); return false; }
    const next = who.armor[slot] + 1, tier = ARMOR[slot].tiers[next];
    const paid = this.forgeCost(tier); this.wood -= paid.wood; this.scrap -= paid.scrap;
    who.armor = { ...who.armor, [slot]: next };
    this.refitArmor(who);
    this.fx.push({ kind: 'tool', tool: 'hammer', tx: who.tile.tx, ty: who.tile.ty });
    this.event('build', `${who instanceof Player ? 'You' : (who as Villager).name} now wear${who instanceof Player ? '' : 's'} ${tier.name.toLowerCase()}`, true);
    return true;
  }
  /** Re-derive max HP after armor changes (soldiers via applyRole; the head keeps a base + bonus). */
  private refitArmor(who: Mover): void {
    if (who instanceof Villager) { const frac = who.hp / who.maxHp; who.applyRole(this.mods); who.hp = Math.round(who.maxHp * frac); }
    else if (who instanceof Player) {
      const base = p.playerHp + this.mods.playerHpBonus;
      const frac = who.hp / who.maxHp;
      who.maxHp = base + (ARMOR.helmet.tiers[who.armor.helmet].hp + ARMOR.chest.tiers[who.armor.chest].hp + ARMOR.legs.tiers[who.armor.legs].hp + ARMOR.shield.tiers[who.armor.shield].hp);
      who.hp = Math.round(who.maxHp * frac);
    }
  }
  setDye(who: Mover, dye: number): void { who.dye = ((dye % DYES.length) + DYES.length) % DYES.length; }
  setHelmetStyle(who: Mover, style: number): void { who.helmetStyle = (Math.max(0, Math.min(2, style)) as 0 | 1 | 2); }
  setPlume(who: Mover, plume: number): void { who.plume = ((plume % PLUMES.length) + PLUMES.length) % PLUMES.length; }
  /** Open the armory (needs a barracks) for a wearer, or close it. */
  openArmory(who: Mover | null, chest?: Building | null): void {
    if (who && !this.world.barracks.length) { this.event('info', 'Build a barracks to open an armory', true); return; }
    this.armoryFor = who;
    const sel = this.interior.building?.kind === 'barracks' ? this.interior.building : this.selectedBuilding?.kind === 'barracks' ? this.selectedBuilding : null;
    this.armoryChest = who ? chest ?? sel ?? this.nearestBarracks(this.player.x, this.player.y) : null;
    this.ui?.renderArmory();
  }

  // ---- child rearing ----------------------------------------------------------------------

  /** Can the head encourage this child right now? null when yes, else the reason. */
  encourageProblem(kid: Villager): string | null {
    if (kid.role !== 'kid') return 'only children';
    if (kid.dead) return null;
    if (kid.hidden) return `${kid.name} is indoors`;
    if (kid.encouragedDay === this.day) return 'already today — come back tomorrow';
    if (Math.hypot(kid.x - this.player.x, kid.y - this.player.y) > 28) return 'walk over to them';
    return null;
  }
  /**
   * A moment with a child: the head stops for a second and a half, hearts, and the child gets a
   * care point for the day plus a day's worth of apprenticeship. During a raid it also sends them home.
   */
  encourage(kid: Villager): boolean {
    const why = this.encourageProblem(kid);
    if (why) { this.event('info', `Can't encourage ${kid.name}: ${why}`); return false; }
    kid.encouragedDay = this.day;
    if (kid.apprenticeAt(this)) kid.trained = Math.min(Villager.drillNeeded(this), kid.trained + 1);
    if (this.raidActive) kid.sentHome = true;
    this.player.busy = 1.5;
    this.player.vx = this.player.vy = 0;
    this.fx.push({ kind: 'hearts', who: kid });
    this.event('birth', `You encouraged ${kid.name}${this.raidActive ? ' — go inside!' : ''}`, false);
    return true;
  }
  /** The care checklist for today, as the UI shows it (what's true right now). */
  careToday(kid: Villager): { label: string; ok: boolean; note?: string }[] {
    const sibling = this.villagers().some((v) => v !== kid && v.role === 'kid' && v.home === kid.home && !v.dead);
    const parents = kid.parents.filter((q) => !q.dead).length;
    return [
      { label: 'Fed', ok: kid.hungerDays === 0 },
      { label: 'Well fed', ok: !!kid.home.hearty && !kid.home.ruined && kid.hungerDays === 0, note: 'hearty rations' },
      { label: 'Family', ok: parents >= 2, note: parents === 1 ? 'one parent' : parents === 0 ? 'no parents' : undefined },
      { label: 'Company', ok: sibling, note: 'another child at home' },
      { label: 'Warm', ok: kid.home.warm, note: kid.home.warm ? 'the hearth is lit' : 'their house is cold — stock its hearth' },
      { label: 'Home', ok: kid.home.level >= 2 && !kid.home.ruined && kid.home.warm, note: kid.home.ruined ? 'their house is in ruins' : 'house Lv2+' },
      { label: 'Attention', ok: kid.encouragedDay === this.day, note: 'encourage them' },
      { label: 'Safe', ok: kid.fledDay !== this.day, note: 'ran from raiders' },
    ];
  }
  /** Where a child runs when raiders come: the nearest house or barracks door. */
  nearestShelter(x: number, y: number): Building | null {
    let best: Building | null = null, bd = Infinity;
    for (const b of this.world.buildings) {
      if ((b.kind !== 'house' && b.kind !== 'barracks' && b.kind !== 'tavern') || b.ruined) continue;
      const d = doorstep(b), c = World.center(d.tx, d.ty), dd = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (dd < bd) { bd = dd; best = b; }
    }
    return best;
  }

  hoverAgent(m: Mover | null): void {
    this.hovered = m;
  }

  /** tile under the mouse (null on touch / when the pointer left the canvas); drives cursor placement */
  hoverTile: TilePos | null = null;

  private onPointerMove(ptr: Phaser.Input.Pointer): void {
    this.hoverTile = document.body.classList.contains('touch') ? null : { tx: Math.floor(ptr.worldX / TILE), ty: Math.floor(ptr.worldY / TILE) };
    if (!this.ui || (this.screen !== 'playing' && this.screen !== 'paused')) { this.ui?.tooltip(null); return; }
    const ev = ptr.event as MouseEvent;
    const m = this.hovered;
    if (m && !m.dead && !m.hidden) {
      const name = m instanceof Villager ? m.name : m instanceof Player ? 'You' : (m as Raider).name;
      const sub = m instanceof Villager ? m.role : m.task;
      this.ui.tooltip(`<div class="t">${name}</div><div class="d">${sub} · ${Math.max(0, m.hp)}/${m.maxHp} hp</div>`, ev.clientX, ev.clientY);
      return;
    }
    const tx = Math.floor(ptr.worldX / TILE), ty = Math.floor(ptr.worldY / TILE);
    const t = this.world.get(tx, ty);
    let html: string | null = null;
    switch (t?.kind) {
      case 'crop': html = `<div class="t">${t.stage >= this.cropDays ? 'Ripe crop' : 'Growing crop'}</div><div class="d">${Math.min(t.stage, this.cropDays)}/${this.cropDays} days · yields ${this.mods.cropYield} food</div>`; break;
      case 'tilled': html = `<div class="t">Tilled soil</div><div class="d">plant with seeds, or a farmer will</div>`; break;
      case 'tree': {
        const old = this.isOldGrowth(t), grove = this.world.groveSize(tx, ty);
        const left = this.oldGrowthDays - t.stage;
        const age = old ? `old growth · yields ${this.treeYield(t)} wood` : `young · old growth in ${left} day${left === 1 ? '' : 's'} · yields ${this.treeYield(t)} wood`;
        html = `<div class="t">${old ? 'Old growth' : 'Tree'}</div><div class="d">${age} · grove of ${grove}${grove >= 200 ? '+' : ''} · spreads ${Math.round(this.seedChance(tx, ty) * 100)}%/day${t.work ? ` · ${t.work}/3 chopped` : ''}</div>`;
        break;
      }
      case 'sapling': {
        const days = this.saplingDays(tx, ty) - t.stage;
        html = `<div class="t">${t.stage < 2 ? 'Stump' : 'Sapling'}</div><div class="d">grows into a tree in ${days} day${days === 1 ? '' : 's'}${this.world.treeNeighbours(tx, ty) >= 2 ? ' · sheltered by the grove' : ''}</div>`;
        break;
      }
      case 'house': case 'barracks': case 'granary': case 'woodyard': case 'tavern': {
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
    this.tickTowers(dt);
    for (const a of this.agents) if (a.dead) this.onDeath(a as Mover);
    this.removeDead();

    // finding the lair: the first time it comes into sight
    if (!this.lairFound && this.world.lair && this.fog) {
      const c = buildingCenter(this.world.lair);
      if (this.fog.visibleAt(c.tx * TILE, c.ty * TILE) > 0.5) { this.lairFound = true; this.event('raid', "You found the Ogre's lair. He sleeps by day.", true); }
    }
    if (this.raidActive && !this.agents.some((a) => a instanceof Raider && !a.lairBound)) {
      this.raidActive = false;
      this.stats.raidsRepelled++;
      this.slowMo();
      if (this.boss?.dead) { this.endRun(true); return; }
      this.event('raid', 'Raid repelled!', true);
    }
    // the head unloads by walking up to the woodyard / granary
    if (this.player.load && !this.player.hidden) {
      const b = this.player.load.kind === 'wood' ? this.world.woodyard : this.world.granary;
      const pt = this.player.tile;
      if (b && pt.tx >= b.tx - 1 && pt.tx <= b.tx + BUILDINGS[b.kind].w && pt.ty >= b.ty - 1 && pt.ty <= b.ty + BUILDINGS[b.kind].h) this.deposit(this.player);
    }
    this.stats.peakPop = Math.max(this.stats.peakPop, this.villagers().length);
    if (this.player.dead) { if (p.godMode) { this.player.dead = false; this.player.hp = this.player.maxHp; } else this.endRun(false); }
  }

  newDay(): void {
    // a night's rest
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + 30);
    // crops grow
    this.world.tiles.forEach((t, i) => { if (t.kind === 'crop') { t.stage++; this.world.dirty.add(i); } });
    // stumps and saplings grow back; trees seed their neighbours
    const seeds: { tx: number; ty: number }[] = [];
    this.world.tiles.forEach((t, i) => {
      const tx = i % COLS, ty = (i / COLS) | 0;
      if (t.kind === 'sapling') {
        if (++t.stage >= this.saplingDays(tx, ty)) this.world.set(tx, ty, 'tree'); else this.world.dirty.add(i);
      } else if (t.kind === 'tree') {
        if (++t.stage === this.oldGrowthDays) this.world.dirty.add(i); // grows tall
        if (this.rng.chance(this.seedChance(tx, ty))) {
          const [dx, dy] = this.rng.pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
          if (this.world.get(tx + dx, ty + dy)?.kind === 'grass') seeds.push({ tx: tx + dx, ty: ty + dy });
        }
      }
    });
    // forests spread until the map is about a third trees, but never into the village clearing
    const treeCap = Math.floor(COLS * ROWS * 0.3);
    let trees = this.world.count((t) => t.kind === 'tree' || t.kind === 'sapling');
    for (const q of seeds) {
      if (trees >= treeCap || this.world.get(q.tx, q.ty)?.kind !== 'grass' || this.world.get(q.tx, q.ty)?.trail || this.nearBuilding(q.tx, q.ty, 2)) continue;
      this.world.set(q.tx, q.ty, 'sapling').stage = 2;
      trees++;
    }
    this.warnedFull = false;
    // the rumour: a direction to explore
    if (this.day === 2 && this.world.lair && !this.lairFound) {
      const l = this.world.lair, dx = l.tx + 2 - COLS / 2, dy = l.ty + 2 - ROWS / 2;
      const ns = Math.abs(dy) > Math.abs(dx) * 0.4 ? (dy < 0 ? 'north' : 'south') : '', ew = Math.abs(dx) > Math.abs(dy) * 0.4 ? (dx < 0 ? 'west' : 'east') : '';
      this.event('info', `The woodcutters whisper of a giant in the forest to the ${ns}${ns && ew ? '-' : ''}${ew}. He only walks at night.`, true);
    }

    this.burnHearths();
    // Baby Fever is judged on the larder as the day breaks, before anyone eats
    const fever = this.feverActive();
    if (this.mods.babyFever && this.feverWas !== null && fever !== this.feverWas) this.event('birth', fever ? 'Baby fever: full larders, and the village knows it.' : 'The surplus is gone — births return to normal.', true);
    this.feverWas = fever;

    // villagers: eat, age, grow up, grow old
    const villagers = this.villagers();
    for (const v of villagers) {
      const hearty = v.role === 'kid' && !!v.home.hearty && !v.home.ruined;
      const ration = this.rationOf(v);
      let wellFed = false;
      if (this.food >= ration) { this.food -= ration; v.hungerDays = 0; wellFed = hearty; }
      else if (hearty && this.food >= ration / HEARTY_RATION) { this.food -= ration / HEARTY_RATION; v.hungerDays = 0; } // enough for a plain meal at least
      else if (++v.hungerDays >= 3 + this.mods.starveDaysDelta) { v.dead = true; v.hp = 0; this.event('death', `${v.name} starved`, true); continue; }
      else this.event('food', `${v.name} went hungry`);
      if (v.role === 'kid') {
        // yesterday's care, tallied at dawn: what they ate, who was around, where they live, whether you came by
        const fed = v.hungerDays === 0;
        const parents = v.parents.filter((q) => !q.dead).length;
        const sibling = villagers.some((o) => o !== v && o.role === 'kid' && o.home === v.home && !o.dead);
        let pts = (fed ? 1 : -1) + (wellFed ? 1 : 0) + (parents >= 2 ? 1 : 0) + (sibling ? 1 : 0) + (v.home.level >= 2 && !v.home.ruined && v.home.warm ? 1 : 0) - (v.home.ruined ? 1 : 0) + (v.home.warm ? 0 : p.coldKidCare) + (v.encouragedDay === this.day ? 1 : 0) - (v.fledDay === this.day ? 1 : 0);
        v.care += pts; v.careDays++;
        v.stars = v.starsNow();
        // yesterday's apprenticeship: only if they had somewhere to go (a cold barracks drills nobody)
        const canTrain = v.calling === 'soldier' ? this.world.barracks.some((b) => b.warm) : v.calling === 'woodcutter' ? !!this.world.woodyard : true;
        if (v.apprenticeAt(this) && canTrain) v.trained = Math.min(Villager.drillNeeded(this), v.trained + 1);
      }
      v.age++;
      if (this.mods.dawnHeal) v.hp = v.maxHp; // Second Wind: a night's rest heals everything
      if (v.role === 'kid' && v.age >= Math.max(1, p.adultAge + this.mods.adultAgeDelta)) v.comeOfAge(this);
      else if (v.age >= p.oldAge && this.rng.chance(0.25)) { v.dead = true; this.event('death', `${v.name} died of old age`); }
    }

    // births: a couple sharing a house with room and food to spare
    for (const h of this.world.houses) {
      const adults = villagers.filter((v) => v.home === h && v.isAdult && !v.dead);
      if (adults.length >= 2 && h.warm && h.residents < this.beds(h) && this.food > 10 && this.rng.chance(this.birthChance(h, fever))) {
        const kid = this.addVillager(h, 'kid', 0);
        kid.parents = [adults[0], adults[1]];
        if (h.residents < this.beds(h) && this.rng.chance(this.mods.twinChance)) {
          const twin = this.addVillager(h, 'kid', 0);
          twin.parents = [adults[0], adults[1]];
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

    const warn = 1 + this.mods.warnDaysDelta;
    if (this.day === p.bossDay) this.spawnRaid(true);
    else if (this.isRaidDay(this.day)) this.spawnRaid();
    else if (this.day === p.bossDay - RUN.warnDays) this.event('raid', `The Warlord marches — he arrives in ${RUN.warnDays} days`, true);
    else if (this.isRaidDay(this.day + warn) || this.day + warn === p.bossDay) this.event('raid', warn > 1 ? `Scouts report raiders — they arrive in ${warn} days` : 'Raiders sighted — they arrive tomorrow', true);
  }

  /** Days between raids (Long Peace stretches it). */
  get raidEvery(): number { return p.raidEvery + this.mods.raidEveryDelta; }

  spawnRaid(boss = false): void {
    const wave = Math.max(1, 1 + Math.floor((this.day - p.firstRaidDay) / this.raidEvery));
    const mix = waveComposition(wave, boss);
    // raids are big: every count grows by p.raidSizeMul (the enemies themselves are unchanged)
    for (const k of Object.keys(mix) as (keyof typeof mix)[]) if (mix[k]) mix[k] = Math.max(1, Math.round(mix[k] * p.raidSizeMul));
    // Scouts: every wave is a raider short (never below one); Hearsay: the Warlord's escort halves
    mix.raider = Math.max(1, mix.raider - this.mods.waveShrink);
    if (boss && this.mods.bossEscortMul < 1) for (const k of Object.keys(mix) as (keyof typeof mix)[]) mix[k] = Math.max(k === 'raider' ? 1 : 0, Math.floor(mix[k] * this.mods.bossEscortMul));
    if (mix.rat > 0) mix.rat = Math.max(10, mix.rat);
    const opts = { hpMul: (1 + p.waveHpGrowth * wave) * this.mods.raiderHpMul, speedMul: this.mods.raiderSpeedMul, snatchDelayMul: this.mods.snatchDelayMul, noSnatch: this.mods.noSnatch, harmlessRats: this.mods.ratsHarmless };
    const side = this.rng.int(0, 3);
    const spawnAt = (): { x: number; y: number } => {
      // Raids approach from the wilderness frontier, not a several-minute walk from the far map edge.
      const hx = COLS / 2, hy = ROWS / 2;
      for (let attempt = 0; attempt < 100; attempt++) {
        const distance = this.rng.int(35, 48), along = this.rng.int(-22, 22);
        const tx = hx + (side === 0 ? -distance : side === 1 ? distance : along);
        const ty = hy + (side === 2 ? -distance : side === 3 ? distance : along);
        if (!this.world.isBlocked(tx, ty, true) && this.world.bfs({ tx, ty }, { tx: hx, ty: hy }, true).length) return World.center(tx, ty);
      }
      return World.center(hx, side === 2 ? hy - 35 : hy + 35);
    };
    const make: Record<keyof typeof mix, (x: number, y: number) => Raider> = {
      raider: (x, y) => new Raider(x, y, opts),
      rat: (x, y) => new Rat(x, y, opts),
      snatcher: (x, y) => new Snatcher(x, y, opts),
      brute: (x, y) => new Brute(x, y, opts),
      shaman: (x, y) => new Shaman(x, y, opts),
      wrecker: (x, y) => new Wrecker(x, y, opts),
    };
    for (const b of this.world.buildings) b.alarmed = false;
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
      for (const k of this.villagers()) if (k.role === 'kid' && k.parents.includes(a)) k.care -= 1; // losing a parent
      if (a.hp <= 0 && a.hungerDays < 3) this.event('death', `${a.name} the ${a.role} was killed`, true);
    } else if (a instanceof Raider) {
      if (a.carrying && !a.carrying.dead) { const kid = a.carrying; kid.carriedBy = null; a.carrying = null; this.event('grow', `${kid.name} was rescued!`, true); }
      if (a.hp <= 0) {
        this.stats.raidersKilled++;
        this.scrap += (SCRAP_DROP as Record<string, number>)[a.kind] ?? 2;
        // Bounty: spoils and a second wind for the village head
        if (this.mods.killWood) this.addWood(this.mods.killWood);
        if (this.mods.killFood) this.addFood(this.mods.killFood);
        if (this.mods.killHeal) this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.mods.killHeal);
        if (a instanceof Ogre) {
          this.stats.bossesSlain++;
          a.lair.level = 3; this.world.refresh(a.lair); // the fire goes out
          this.slowMo();
          this.event('raid', 'The Ogre is slain! His lair falls silent.', true);
        } else this.event('raid', a.boss ? 'The Warlord has fallen!' : `${a.name} slain`, a.boss);
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

  // ---- food and births --------------------------------------------------------

  /** What one villager eats at dawn (hearty children eat double while their house stands). */
  rationOf(v: Villager): number {
    const hearty = v.role === 'kid' && !!v.home.hearty && !v.home.ruined;
    return p.foodPerDay * this.mods.foodPerDayMul * (hearty ? HEARTY_RATION : 1);
  }
  /** Everyone's rations for one dawn. */
  dailyRation(): number { return this.villagers().reduce((n, v) => n + this.rationOf(v), 0); }
  /** Days the larder would last at today's population. */
  surplusDays(): number { const r = this.dailyRation(); return r > 0 ? this.food / r : Infinity; }
  /** Baby Fever: equipped, and the larder holds a real surplus. A bigger village needs a bigger larder to keep it. */
  feverActive(): boolean { return this.mods.babyFever && this.surplusDays() >= p.feverDays; }
  private feverWas: boolean | null = null; // null until the first dawn: only changes are announced
  /** Chance a couple in `h` has a child at dawn. */
  birthChance(h: Building, fever = this.feverActive()): number {
    return Math.min(0.95, p.birthChance + this.mods.birthBonus + (h.level >= 3 ? 0.15 : 0) + (fever ? p.feverBonus : 0));
  }

  /** Beds in a house: by level, or the Big Families boon if that is higher. */
  beds(h: Building): number {
    if (h.ruined) return 0;
    return Math.max(0, Math.max(HOUSE_BEDS[h.level] ?? 4, this.mods.houseCap) + this.mods.bedBonus + p.bedBonus);
  }
  get foodCap(): number { return Math.round(CAPS[this.world.granary?.level ?? 1] * this.mods.capMul); }
  get woodCap(): number { return Math.round(CAPS[this.world.woodyard?.level ?? 1] * this.mods.capMul); }
  private warnedFull = false;
  private warnedRuin = false;

  /** Add to the stockpile, respecting storage; says so (once a day) when the store is full. */
  /** Hand a carried load in at its building: the stockpile takes it (up to the cap) and the arms are free. */
  deposit(m: Mover): void {
    const load = m.load;
    if (!load) return;
    const b = load.kind === 'wood' ? this.world.woodyard : this.world.granary;
    if (!b) return;
    if (b.ruined) { if (m === this.player && !this.warnedRuin) { this.warnedRuin = true; this.event('build', `The ${BUILDINGS[b.kind].name.toLowerCase()} is in ruins — rebuild it with the hammer before anything can be stored.`, true); } return; }
    if (load.kind === 'wood') this.addWood(load.n); else this.addFood(load.n);
    m.load = null;
    const c = buildingCenter(b);
    this.fx.push({ kind: 'deposit', x: c.tx * TILE, y: (b.ty + BUILDINGS[b.kind].h) * TILE - 6, text: `+${load.n} ${load.kind}`, colour: load.kind === 'wood' ? '#d9a566' : '#9be36b' });
  }
  /** Why the head can't pick up `kind` right now (arms full, or holding the other thing), or null. */
  loadProblem(kind: LoadKind): string | null {
    const l = this.player.load;
    if (!l) return null;
    if (l.kind !== kind) return `Take the ${l.kind} to the ${l.kind === 'wood' ? 'woodyard' : 'granary'} first`;
    if (l.n >= HAUL.player[kind]) return `Your arms are full — drop the ${kind} at the ${kind === 'wood' ? 'woodyard' : 'granary'}`;
    return null;
  }
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
    return `${BUILDINGS[b.kind].name} Lv${b.level}${b.ruined ? ' · RUINED' : ''}`;
  }
  /** What the building does now, and what the next level adds. */
  buildingBlurb(b: Building): string {
    if (b.ruined) return `in ruins · nothing works until the hammer rebuilds it (${this.rebuildCost(b)} wood)`;
    const hearth = hasHearth(b) ? (b.warm ? ` · hearth ${hearthCost(b)} wood/night · ${b.firewood} night${b.firewood === 1 ? '' : 's'} stocked` : ` · COLD — ${b.firewood ? 'lit again at dawn' : 'the pile is empty'}`) : '';
    const now = b.kind === 'house' ? `${b.residents}/${this.beds(b)} beds${b.level >= 3 ? ' · births +15%' : ''}${' · raises ' + CALLING_NAME[b.calling ?? 'farmer']}${b.hearty ? ' · hearty rations' : ''}`
      : b.kind === 'granary' ? `${this.food | 0}/${CAPS[b.level]} food · the harvest is carried here`
      : b.kind === 'woodyard' ? `${this.wood | 0}/${CAPS[b.level]} wood · chopped logs are carried here`
      : LEVEL_PERKS[b.kind][b.level];
    const next = b.level < MAX_LEVEL ? ` · next Lv${b.level + 1}: ${LEVEL_PERKS[b.kind][b.level + 1]} (${this.upgradeCost(b)} wood, hammer)` : ' · max level';
    const hurt = b.maxHp && b.hp < b.maxHp ? ` · ${Math.ceil(b.hp)}/${b.maxHp} HP (hammer repairs)` : '';
    return now + hearth + next + hurt;
  }

  /** Why the hammer can't upgrade `b` right now, or null. */
  upgradeProblem(b: Building): string | null {
    if (b.kind === 'lair') return "The lair is not yours to improve";
    if (b.ruined) return `rebuild it first (${this.rebuildCost(b)} wood)`;
    if (b.level >= MAX_LEVEL) return `${BUILDINGS[b.kind].name} is already max level`;
    const cost = this.upgradeCost(b);
    if (this.wood < cost) return `need ${cost} wood (have ${this.wood | 0})`;
    return null;
  }

  /** Wood to take a building to its next level (Cheap Timber discounts it). */
  upgradeCost(b: Building): number { return p.freeBuild ? 0 : Math.round(UPGRADE_COST[b.kind][b.level] * this.mods.upgradeCostMul); }
  /** Wood to raise a new house or barracks (Master Builder halves it). */
  buildCost(kind: 'house' | 'barracks' | 'tavern'): number { return p.freeBuild ? 0 : Math.round(COST[kind] * this.mods.buildCostMul); }
  defenseCost(kind: DefenseKind): number { return p.freeBuild ? 0 : DEFENSE_COST[kind]; }
  /** What a forge tier costs after the slider (and free build). */
  forgeCost(tier: { wood: number; scrap: number }): { wood: number; scrap: number } { return p.freeBuild ? { wood: 0, scrap: 0 } : { wood: Math.round(tier.wood * p.forgeCostMul), scrap: Math.round(tier.scrap * p.forgeCostMul) }; }

  private upgrade(b: Building): void {
    const cost = this.upgradeCost(b);
    this.wood -= cost;
    b.level++;
    // sturdier with each level: the new structure is added on top of what's standing
    const max = buildingMaxHp(b); b.hp += max - b.maxHp; b.maxHp = max;
    this.world.refresh(b);
    this.fx.push({ kind: 'upgrade', building: b });
    this.event('build', `${BUILDINGS[b.kind].name} is now Lv${b.level} — ${LEVEL_PERKS[b.kind][b.level]}`, true);
  }

  // ---- building damage ------------------------------------------------------
  // Every building but the lair can be wrecked. A ruin keeps its footprint and does nothing until rebuilt.

  /** Hurt a building; true when this blow reduced it to a ruin. */
  damageBuilding(b: Building, dmg: number, by?: Raider): boolean {
    if (b.kind === 'lair' || b.ruined || !b.maxHp) return false;
    b.hp = Math.max(0, b.hp - dmg);
    this.world.refresh(b);
    if (!b.alarmed) { b.alarmed = true; this.event('raid', `${by ? `A ${by.name.toLowerCase()} is` : 'Raiders are'} tearing at the ${BUILDINGS[b.kind].name.toLowerCase()}!`, true); }
    if (b.hp > 0) return false;
    this.ruinBuilding(b);
    return true;
  }
  private ruinBuilding(b: Building): void {
    b.ruined = true; b.hp = 0;
    for (const v of this.villagers()) if (v.indoors === b) v.unhide(this);
    if (this.interior.building === b) this.interior.leave();
    this.stats.buildingsLost++;
    this.world.refresh(b);
    this.fx.push({ kind: 'ruin', building: b });
    this.event('raid', `The ${BUILDINGS[b.kind].name.toLowerCase()} has fallen to ruin — rebuild it with the hammer (${this.rebuildCost(b)} wood).`, true);
  }
  /** Wood to raise a ruin again: a share of what it cost to build. */
  rebuildCost(b: Building): number {
    const base = b.kind === 'house' || b.kind === 'barracks' || b.kind === 'tavern' ? COST[b.kind] : REPAIR.rebuildDefault / REPAIR.rebuildFraction;
    return p.freeBuild ? 0 : Math.max(1, Math.round(base * REPAIR.rebuildFraction * this.mods.buildCostMul));
  }
  /** Wood back for taking `b` down: half of what went into it. Rubble is worth nothing. */
  demolishRefund(b: Building): number {
    if (b.ruined || !(b.kind === 'house' || b.kind === 'barracks' || b.kind === 'tavern')) return 0;
    let spent = COST[b.kind];
    for (let lv = 1; lv < b.level; lv++) spent += UPGRADE_COST[b.kind][lv];
    return Math.round(spent * DISMANTLE.refund);
  }
  /** Why `b` can't be demolished right now, or null. */
  demolishProblem(b: Building): string | null {
    if (!(b.kind === 'house' || b.kind === 'barracks' || b.kind === 'tavern')) return 'only houses, barracks and the tavern can be taken down';
    if (b.kind === 'house' && this.villagers().some((v) => v.home === b && !v.dead) && !this.world.houses.some((h) => h !== b && !h.ruined)) return 'its tenants would have nowhere to live';
    return null;
  }
  /** Take a building down: tenants move to another house, anyone inside steps out, half the wood comes back. */
  demolish(b: Building): boolean {
    const why = this.demolishProblem(b);
    if (why) { this.event('build', `Can't demolish: ${why}.`); return false; }
    const refund = this.demolishRefund(b);
    for (const v of this.villagers()) {
      if (v.indoors === b) v.unhide(this);
      if (v.home !== b) continue;
      // the evicted take the nearest house with a spare bed, else the nearest house at all
      const houses = this.world.houses.filter((h) => h !== b && !h.ruined);
      const c = buildingCenter(b), byDist = (h: Building) => { const hc = buildingCenter(h); return (hc.tx - c.tx) ** 2 + (hc.ty - c.ty) ** 2; };
      const next = houses.filter((h) => h.residents < this.beds(h)).sort((x, y) => byDist(x) - byDist(y))[0] ?? houses.sort((x, y) => byDist(x) - byDist(y))[0];
      if (next) { b.residents--; v.home = next; next.residents++; }
    }
    if (this.interior.building === b) this.interior.leave();
    if (this.selectedBuilding === b) this.selectedBuilding = null;
    this.world.remove(b);
    this.wood += refund;
    this.fx.push({ kind: 'demolish', building: b });
    this.event('build', `Took down the ${BUILDINGS[b.kind].name.toLowerCase()}${refund ? ` — ${refund} wood recovered` : ''}`, true);
    return true;
  }
  /** Why the hammer can't mend `b` right now, or null. */
  repairProblem(b: Building): string | null {
    if (b.kind === 'lair') return 'The lair is not yours to mend';
    if (b.ruined) { const cost = this.rebuildCost(b); return this.wood < cost ? `need ${cost} wood to rebuild (have ${this.wood | 0})` : null; }
    if (b.hp >= b.maxHp) return 'nothing to repair';
    if (this.wood < 1) return 'need 1 wood';
    return null;
  }
  /** Hammer blow on a hurt building: rebuild a ruin for its rebuild cost, or trade 1 wood for `REPAIR.perWood` HP. */
  repairBuilding(b: Building): boolean {
    const why = this.repairProblem(b);
    if (why) { this.event('build', why); return false; }
    if (b.ruined) {
      this.wood -= this.rebuildCost(b);
      b.ruined = false; b.hp = b.maxHp; b.alarmed = false;
      this.world.refresh(b);
      this.fx.push({ kind: 'upgrade', building: b });
      this.event('build', `The ${BUILDINGS[b.kind].name.toLowerCase()} stands again.`, true);
      return true;
    }
    this.wood--; b.hp = Math.min(b.maxHp, b.hp + REPAIR.perWood);
    this.world.refresh(b);
    return true;
  }
  /** Standing buildings (never the lair) an enemy at `from` can walk to, nearest first; `kinds` narrows it. */
  reachableBuildings(from: TilePos, kinds?: readonly BuildingKind[]): Building[] {
    const fx = (from.tx + 0.5) * TILE, fy = (from.ty + 0.5) * TILE;
    const out: { b: Building; d: number }[] = [];
    for (const b of this.world.buildings) {
      if (b.kind === 'lair' || b.ruined || (kinds && !kinds.includes(b.kind))) continue;
      const f = BUILDINGS[b.kind];
      const adjacent = from.tx >= b.tx - 1 && from.tx <= b.tx + f.w && from.ty >= b.ty - 1 && from.ty <= b.ty + f.h;
      if (!adjacent && !this.world.bfs(from, doorstep(b), true).length) continue;
      const c = buildingCenter(b);
      out.push({ b, d: (c.tx * TILE - fx) ** 2 + (c.ty * TILE - fy) ** 2 });
    }
    return out.sort((a, z) => a.d - z.d).map((o) => o.b);
  }

  // ---- player actions -------------------------------------------------------

  shoot(who: Mover, dx: number, dy: number, dmg: number): boolean {
    if (this.arrows <= 0) { who.task = 'out of arrows'; if (who === this.player) this.event('info', 'Out of arrows. Craft a bundle at the barracks.'); return false; }
    const len = Math.hypot(dx, dy) || 1;
    who.aim = { x: dx / len, y: dy / len }; who.dir = dx < 0 ? -1 : 1;
    this.arrows--; who.attackCd = 0.65;
    this.spawn(new Arrow(who.x, who.y, dx / len, dy / len, dmg, who, len > 2 ? len : who.elevated ? 220 : 170));
    this.fx.push({ kind: 'arrow', who });
    return true;
  }
  craftArrows(): void {
    if (!this.world.barracks.length || this.wood < 2) { this.event('info', 'A barracks and 2 wood are needed for 10 arrows.', true); return; }
    this.wood -= 2; this.arrows += 10; this.event('wood', 'Fletched 10 arrows for the shared quiver.');
  }

  // ---- barracks towers ------------------------------------------------------
  // Every barracks looses arrows at raiders in range from its own chest; the chest is refilled with wood inside.

  towerRange(b: Building): number { return p.towerRange + (b.level - 1) * TOWER.rangePerLevel; }
  towerCap(b: Building): number { return p.towerCap + (b.level - 1) * TOWER.capPerLevel; }
  towerDmg(b: Building): number { return p.towerDmg + (b.level - 1) * TOWER.dmgPerLevel; }
  towerCenter(b: Building): { x: number; y: number } { const c = buildingCenter(b); return { x: c.tx * TILE, y: c.ty * TILE }; }
  /** Where a shot leaves the roof: just past the footprint along the aim, so the arrow's own sweep doesn't die on the barracks tiles. */
  private towerMuzzle(b: Building, ux: number, uy: number): { x: number; y: number } {
    const c = this.towerCenter(b);
    let d = 0;
    for (; d < TILE * 4; d += 4) { const q = World.toTile(c.x + ux * d, c.y + uy * d); if (this.world.get(q.tx, q.ty)?.building !== b) break; }
    return { x: c.x + ux * (d + 2), y: c.y + uy * (d + 2) };
  }
  tickTowers(dt: number): void {
    if (!p.towerFires) return;
    for (const b of this.world.barracks) {
      b.fireCd = Math.max(0, (b.fireCd ?? 0) - dt);
      if (b.fireCd > 0 || !(b.ammo ?? 0)) continue;
      const c = this.towerCenter(b), range = this.towerRange(b);
      // nearest raider with a clear line from the roof (trees and buildings are cover, walls are not);
      // no fog test: the barracks is itself a sight source, and fog is only painted for the camera's view
      const inRange: { r: Raider; d2: number }[] = [];
      this.grid.forEachInRadius(c.x, c.y, range, (o, d2) => { if (o instanceof Raider && !o.dead && !o.harmless) inRange.push({ r: o, d2 }); });
      inRange.sort((a, z) => a.d2 - z.d2);
      let shot: { t: Raider; m: { x: number; y: number }; ux: number; uy: number } | null = null;
      for (const { r: t } of inRange) {
        const len = Math.hypot(t.x - c.x, t.y - c.y) || 1, ux = (t.x - c.x) / len, uy = (t.y - c.y) / len;
        const m = this.towerMuzzle(b, ux, uy);
        if (this.world.lineClear(m, t, true)) { shot = { t, m, ux, uy }; break; }
      }
      if (!shot) continue;
      const { m, ux, uy } = shot;
      const arrow = this.spawn(new Arrow(m.x, m.y, ux, uy, this.towerDmg(b), null, range + 24));
      this.fx.push({ kind: 'arrow', who: arrow });
      b.ammo!--; b.fireCd = p.towerCd;
      if (!b.ammo && !b.dryWarned) { b.dryWarned = true; this.event('raid', 'The barracks tower is out of arrows — restock at its chest.', true); }
    }
  }
  /** Why the tower chest can't be restocked right now, or null. */
  restockProblem(b: Building): string | null {
    if ((b.ammo ?? 0) >= this.towerCap(b)) return 'the chest is full';
    if (this.wood < TOWER.restockWood) return `need ${TOWER.restockWood} wood (have ${this.wood | 0})`;
    return null;
  }
  /** Put a bundle of arrows in a barracks' chest for wood. */
  restockTower(b: Building): boolean {
    const why = this.restockProblem(b);
    if (why) { this.event('info', `Can't restock: ${why}`, true); return false; }
    this.wood -= TOWER.restockWood;
    b.ammo = Math.min(this.towerCap(b), (b.ammo ?? 0) + TOWER.restockArrows); b.dryWarned = false;
    const c = this.towerCenter(b);
    this.fx.push({ kind: 'deposit', x: c.x, y: c.y - TILE, text: `+${TOWER.restockArrows} arrows`, colour: '#ffe066' });
    this.event('wood', `Stocked the tower chest · ${b.ammo} / ${this.towerCap(b)} arrows.`);
    return true;
  }
  /** Arrows across every barracks chest, for the HUD. */
  towerAmmo(): { ammo: number; cap: number } {
    let ammo = 0, cap = 0;
    for (const b of this.world.barracks) { ammo += b.ammo ?? 0; cap += this.towerCap(b); }
    return { ammo, cap };
  }

  // ---- hearths --------------------------------------------------------------
  // Houses, barracks and taverns burn a night of firewood at dawn. Woodcutters keep the piles stocked;
  // a pile that runs dry leaves the building cold for the day: no births, no drill, no regen, no meals.

  /** standing buildings with a hearth */
  hearthBuildings(): Building[] { return this.world.buildings.filter((b) => hasHearth(b) && !b.ruined); }
  /** Dawn: every hearth burns one night, or goes cold. */
  private burnHearths(): void {
    let burned = 0; const cold: string[] = [];
    for (const b of this.hearthBuildings()) {
      if (!p.hearths) { b.warm = true; continue; } // debug: nothing burns, nothing is cold
      if (b.firewood > 0) { b.firewood--; b.warm = true; burned += hearthCost(b); }
      else { b.warm = false; cold.push(BUILDINGS[b.kind].name.toLowerCase()); }
      this.world.refresh(b);
    }
    for (const b of this.world.buildings) if (b.ruined || !hasHearth(b)) b.warm = false;
    if (cold.length) this.event('wood', `Hearths burned ${burned} wood · cold today: ${cold.join(', ')}. Woodcutters stock the piles; the card can too.`, true);
    else if (burned) this.event('wood', `Hearths burned ${burned} wood through the night.`);
  }
  /** Why the village pile can't stock `b`'s hearth right now, or null. */
  stockProblem(b: Building): string | null {
    if (!hasHearth(b)) return 'no hearth here';
    if (b.ruined) return 'rebuild it first';
    if (b.firewood >= p.hearthNights) return 'the pile is full';
    const cost = p.freeBuild ? 0 : hearthCost(b);
    if (this.wood < cost) return `need ${cost} wood (have ${this.wood | 0})`;
    return null;
  }
  /** Stack a night's wood by the hearth from the village pile. */
  stockHearth(b: Building): boolean {
    const why = this.stockProblem(b);
    if (why) { this.event('info', `Can't stock the hearth: ${why}`, true); return false; }
    this.wood -= p.freeBuild ? 0 : hearthCost(b); b.firewood++;
    const c = this.towerCenter(b);
    this.fx.push({ kind: 'deposit', x: c.x, y: c.y - TILE, text: '+1 night', colour: '#ffb060' });
    return true;
  }
  /** The hearth a woodcutter with `load` wood should serve first: an empty pile before a low one, nearest first; null when every pile is full. */
  hearthNeeding(x: number, y: number, load: number): Building | null {
    let best: Building | null = null, bs = Infinity;
    for (const b of this.hearthBuildings()) {
      if (b.firewood >= p.hearthNights || hearthCost(b) > load) continue;
      const d = doorstep(b), c = World.center(d.tx, d.ty);
      const score = Math.hypot(c.x - x, c.y - y) + b.firewood * 400; // an empty pile is worth a long walk
      if (score < bs) { bs = score; best = b; }
    }
    return best;
  }
  /** A carried load becomes nights of firewood, as many as fit; whatever is left stays in the arms for the woodyard. */
  stockFromLoad(b: Building, m: Mover): number {
    const load = m.load;
    if (!load || load.kind !== 'wood' || !hasHearth(b) || b.ruined) return 0;
    const cost = hearthCost(b);
    let nights = 0;
    while (b.firewood < p.hearthNights && load.n >= cost) { load.n -= cost; b.firewood++; nights++; }
    if (load.n <= 0) m.load = null;
    if (nights) { const c = this.towerCenter(b); this.fx.push({ kind: 'deposit', x: c.x, y: c.y - TILE, text: `+${nights} night${nights > 1 ? 's' : ''}`, colour: '#ffb060' }); }
    return nights;
  }
  /** For the HUD: how many hearths are stocked for tonight. */
  hearthReport(): { stocked: number; total: number; nightly: number } {
    const hs = this.hearthBuildings();
    return { stocked: hs.filter((b) => b.firewood > 0).length, total: hs.length, nightly: hs.reduce((n, b) => n + hearthCost(b), 0) };
  }
  equipSoldier(v: Villager, weapon: 'sword' | 'bow'): void {
    if (v.role !== 'soldier' || v.dead) return;
    v.weapon = weapon; v.attack = null; v.clearGoal();
  }
  reachableStairs(m: Mover, post?: TilePos): TilePos | null {
    const candidates = [...this.world.defenses.values()].filter(d => d.kind === 'stairs').sort((a, b) => m.dist(World.center(a.tx, a.ty)) - m.dist(World.center(b.tx, b.ty)));
    for (const q of candidates) {
      const ground = m.dist(World.center(q.tx, q.ty)) < 3 || this.world.bfs(m.tile, q, false, m.elevated).length > 0;
      if (ground && (!post || (post.tx === q.tx && post.ty === q.ty) || this.world.bfs(q, post, false, true).length > 0)) return q;
    }
    return null;
  }
  assignPost(v: Villager, q: TilePos): boolean {
    if (!this.world.get(q.tx, q.ty)?.defense || !this.reachableStairs(v, q)) { this.event('info', 'Choose a wall top connected to reachable stairs.', true); return false; }
    if (this.villagers().some(o => o !== v && o.post?.tx === q.tx && o.post?.ty === q.ty)) { this.event('info', 'That post is already occupied.', true); return false; }
    v.post = q; this.equipSoldier(v, 'bow'); this.posting = null;
    this.event('soldier', `${v.name} is taking an archer post.`, true); return true;
  }
  rescueFallenGuards(): void {
    for (const m of this.agents as Mover[]) if (m.elevated && !this.world.get(m.tile.tx, m.tile.ty)?.defense) {
      const q = this.world.nearest(m.x, m.y, (_t, tx, ty) => !this.world.isBlocked(tx, ty));
      if (q) { Object.assign(m, World.center(q.tx, q.ty)); m.elevated = false; m.clearGoal(); if (m instanceof Villager) m.post = null; }
    }
  }
  /** Where a wall/gate/stairs would go: the pointed-at tile (walls are placed where you point, even behind other walls), else the tile ahead. */
  defenseTarget(): TilePos {
    return this.hoverTile ?? this.player.faced;
  }
  /** Why a defense can't be built at `q` right now, or null. */
  defenseProblem(kind: DefenseKind, q: TilePos): string | null {
    const t = this.player.tile, cost = this.defenseCost(kind);
    if (Math.max(Math.abs(q.tx - t.tx), Math.abs(q.ty - t.ty)) > VillageScene.BUILD_REACH) return `Too far — build within ${VillageScene.BUILD_REACH} tiles of you`;
    if (this.wood < cost) return `Need ${cost} wood for construction`;
    const tile = this.world.get(q.tx, q.ty);
    if (tile?.defense) return `There is already a ${tile.defense.kind} here`;
    if (!BUILDABLE.has(tile?.kind ?? 'tree')) return 'Clear trees and crops before building defenses';
    if (this.world.buildings.some(b => { const d = doorstep(b); return d.tx === q.tx && d.ty === q.ty; })) return 'Leave the doorway clear';
    if ((this.agents as Mover[]).some(m => !m.hidden && !m.dead && m.tile.tx === q.tx && m.tile.ty === q.ty)) return 'Place the wall beside people, not beneath them';
    return null;
  }
  buildDefense(kind: DefenseKind): void {
    const q = this.defenseTarget(), cost = this.defenseCost(kind);
    const why = this.defenseProblem(kind, q);
    if (why) { this.event('build', why + '.'); return; }
    if (this.world.placeDefense(kind, q.tx, q.ty)) { this.wood -= cost; this.fx.push({ kind: 'tool', tool: 'hammer', ...q }); }
  }
  /** Context action: use a nearby doorway, stairs, or gate. Both mouse and touch use this path. */
  checkNearby(point?: TilePos): boolean {
    if (this.screen !== 'playing') return false;
    if (this.interior.active) { this.interior.act(); return true; }
    const pl = this.player;
    const q = point ?? this.target;
    const d = this.world.get(q.tx, q.ty)?.defense ?? this.world.get(pl.tile.tx, pl.tile.ty)?.defense;
    if (d && pl.dist(World.center(d.tx, d.ty)) < 28) {
      if (d.kind === 'stairs') { Object.assign(pl, World.center(d.tx, d.ty)); pl.elevated = !pl.elevated; pl.clearGoal(); return true; }
      if (d.kind === 'gate' && !pl.elevated) { this.world.setGateOpen(d, !d.open); this.event('build', d.open ? 'Gate open to everyone — enemies can enter.' : 'Gate guarded — allies can pass, enemies must break it.'); return true; }
    }
    return false;
  }

  /** The building whose doorstep the player is standing on, if any (entered by walking up into the door). */
  doorAt(): Building | null {
    const pt = this.player.tile;
    return this.world.buildings.find((b) => {
      if (!['house', 'barracks', 'tavern'].includes(b.kind) || b.ruined) return false; // a ruin has no door to push
      const d = doorstep(b);
      return d.tx === pt.tx && d.ty === pt.ty;
    }) ?? null;
  }
  /** seconds the player has been pushing up into a door */
  doorT = 0;
  /**
   * Walking up into a door enters the building: you have to be on its doorstep, facing the
   * door, and hold up for a beat (so brushing past a house never drops you inside).
   */
  pushDoor(dt: number, pushingUp: boolean): void {
    if (this.player.elevated) { this.doorT = 0; return; }
    const b = pushingUp ? this.doorAt() : null;
    if (!b) { this.doorT = 0; return; }
    this.doorT += dt;
    if (this.doorT >= 0.15) { this.doorT = 0; this.interior.enter(b); }
  }

  /** How far from the player the mouse can place a building, in tiles. */
  static readonly BUILD_REACH = 6;

  /**
   * Top-left of the footprint a new building would take. With a mouse nearby, the footprint
   * follows the pointer (the hovered tile becomes the door tile). Otherwise it sits one whole
   * tile in front of the player's own tile, so the player can never be inside it.
   */
  buildAnchor(kind: BuildingKind = this.player.build === 'none' ? 'house' : this.player.build): { tx: number; ty: number } {
    const { w, h, door } = BUILDINGS[kind];
    const pt = this.player.tile, d = this.player.facing;
    const hv = this.hoverTile;
    if (hv && Math.max(Math.abs(hv.tx - pt.tx), Math.abs(hv.ty - pt.ty)) <= VillageScene.BUILD_REACH) {
      return { tx: hv.tx - door, ty: hv.ty - h + 1 }; // door on the hovered tile
    }
    const half = Math.floor(w / 2) - 1;
    if (d.y > 0) return { tx: pt.tx - half, ty: pt.ty + 1 };
    if (d.y < 0) return { tx: pt.tx - half, ty: pt.ty - h };
    if (d.x > 0) return { tx: pt.tx + 1, ty: pt.ty - half };
    return { tx: pt.tx - w, ty: pt.ty - half };
  }
  /** Is the current build anchor following the mouse (vs. sitting in front of the player)? */
  get cursorPlacing(): boolean {
    const hv = this.hoverTile, pt = this.player.tile;
    return !!hv && Math.max(Math.abs(hv.tx - pt.tx), Math.abs(hv.ty - pt.ty)) <= VillageScene.BUILD_REACH;
  }

  /** Why a building can't go at `a`, or null if it can. */
  buildProblem(a: { tx: number; ty: number }, kind: BuildingKind = this.player.build === 'none' ? 'house' : this.player.build): string | null {
    const { w, h } = BUILDINGS[kind];
    if (!this.world.canBuild(kind, a.tx, a.ty)) return `Need ${w}x${h} of open ground (no trees, crops or buildings)`;
    if (this.agents.some((m) => m instanceof Raider && !m.dead && this.insideFootprint(m, a, kind))) return 'A raider is in the way';
    return null;
  }
  private insideFootprint(m: Mover, a: { tx: number; ty: number }, kind: BuildingKind): boolean {
    const { w, h } = BUILDINGS[kind];
    return !m.hidden && m.x >= a.tx * TILE && m.x < (a.tx + w) * TILE && m.y >= a.ty * TILE && m.y < (a.ty + h) * TILE;
  }
  /** After a building goes up, anyone standing in it (you included) steps out onto the doorstep. */
  private stepOut(b: Building): void {
    const d = doorstep(b), c = World.center(d.tx, d.ty);
    for (const m of this.agents as Mover[]) {
      if (m instanceof Raider || !this.insideFootprint(m, b, b.kind)) continue;
      m.x = c.x; m.y = c.y; m.vx = m.vy = 0;
      m.clearGoal();
    }
  }

  // ---- groves: trees shelter each other and age into old growth ------------------------------

  /** A tree's daily chance to seed a neighbour: lone trees barely spread, a grove spreads fast. */
  seedChance(tx: number, ty: number): number {
    return (SEED_BASE + SEED_PER_NEIGHBOUR * Math.min(4, this.world.treeNeighbours(tx, ty))) * this.mods.seedMul;
  }
  /** Days a sapling at (tx, ty) needs: quicker with two or more trees around it. */
  saplingDays(tx: number, ty: number): number {
    return this.world.treeNeighbours(tx, ty) >= 2 ? Math.max(1, SHELTERED_SAPLING_DAYS + this.mods.shelteredDaysDelta) : SAPLING_DAYS;
  }
  /** Days a tree takes to become old growth (Old Growth boon shortens it). */
  get oldGrowthDays(): number { return Math.max(1, OLD_GROWTH_DAYS + this.mods.oldGrowthDaysDelta); }
  isOldGrowth(t: Tile): boolean { return t.kind === 'tree' && t.stage >= this.oldGrowthDays; }
  /** Wood a tree pays when felled. */
  treeYield(t: Tile): number { return (this.isOldGrowth(t) ? p.oldYield + this.mods.oldYieldBonus : p.treeYield) + this.mods.treeYieldBonus; }

  /** Is (tx, ty) within `pad` tiles of any building footprint (including its yard)? */
  nearBuilding(tx: number, ty: number, pad: number): boolean {
    return this.world.buildings.some((b) => {
      const f = BUILDINGS[b.kind];
      return tx >= b.tx - pad && tx < b.tx + f.w + pad && ty >= b.ty - pad && ty < b.ty + f.h + 1 + pad;
    });
  }

  /** How far from the player's tile the mouse can aim a tool (Chebyshev), in tiles. */
  static readonly TOOL_REACH = 1;
  /** Is the mouse aiming the tool (hovering a tile within reach)? */
  get cursorAiming(): boolean {
    const hv = this.hoverTile, pt = this.player.tile;
    return !!hv && Math.max(Math.abs(hv.tx - pt.tx), Math.abs(hv.ty - pt.ty)) <= VillageScene.TOOL_REACH;
  }
  /** The tile a tool acts on: the hovered tile when it's next to you (mouse), else the tile you face. */
  get target(): TilePos {
    return this.cursorAiming ? this.hoverTile! : this.player.faced;
  }
  /** flatten-in-progress bookkeeping: the tile being hammered/flattened resets when you move on */
  private workTile: TilePos | null = null;
  private workOn(tx: number, ty: number): void {
    if (this.workTile && (this.workTile.tx !== tx || this.workTile.ty !== ty)) {
      const prev = this.world.get(this.workTile.tx, this.workTile.ty);
      if (prev && (prev.kind === 'tilled' || prev.building || prev.defense)) { prev.work = 0; this.world.markDirty(this.workTile.tx, this.workTile.ty); }
    }
    this.workTile = { tx, ty };
  }

  /** The building in front of the player (or under the mouse when aiming), if any. */
  facedBuilding(): Building | null {
    const t = this.world.get(this.target.tx, this.target.ty);
    return t?.building ?? null;
  }

  /** Use the equipped tool on the faced tile (or swing the sword). */
  interact(): void {
    if (this.screen !== 'playing') return;
    if (this.interior.active) { this.interior.act(); return; }
    const pl = this.player;
    if (pl.busy > 0) return;
    if (pl.tool === 'hands' && this.checkNearby()) return;
    if (pl.elevated && pl.tool !== 'bow' && pl.tool !== 'sword' && pl.tool !== 'hands') { this.event('info', 'Use the stairs to return to ground level first.'); return; }
    const { tx, ty } = this.target;
    const t = this.world.get(tx, ty);
    if (pl.tool !== 'sword') this.workOn(tx, ty); // acting elsewhere abandons a half-done flatten / upgrade

    switch (pl.tool) {
      case 'bow': {
        if (pl.attackCd > 0) return;
        const hv = this.hoverTile, aim = hv ? World.center(hv.tx, hv.ty) : null;
        const auto = !aim ? this.bestTarget(pl.x, pl.y, 165) : null;
        this.shoot(pl, aim ? aim.x - pl.x : auto ? auto.x - pl.x : pl.facing.x, aim ? aim.y - pl.y : auto ? auto.y - pl.y : pl.facing.y, Math.round(14 * weaponMul(pl.weapons, 'bow') * this.mods.playerDmgMul));
        return;
      }
      case 'wall': case 'gate': case 'stairs': this.buildDefense(pl.tool); return;
      case 'sword': {
        const stage = pl.pressAttack();
        if (stage >= 0) this.fx.push({ kind: 'swing', who: pl, dx: pl.facing.x, dy: pl.facing.y, stage });
        return;
      }
      case 'house':
      case 'tavern':
      case 'barracks': {
        const a = this.buildAnchor(pl.tool);
        const why = this.buildProblem(a, pl.tool);
        if (why) { this.event('build', why); return; }
        if (this.wood < this.buildCost(pl.tool)) { this.event('build', `Need ${this.buildCost(pl.tool)} wood for a ${pl.tool}`); return; }
        this.wood -= this.buildCost(pl.tool);
        this.stepOut(this.world.place(pl.tool, a.tx, a.ty));
        this.fx.push({ kind: 'tool', tool: 'hammer', tx: a.tx + 1, ty: a.ty + BUILDINGS[pl.tool].h - 1 });
        this.event('build', `Built a ${pl.tool}`, true);
        return;
      }
      case 'hammer': {
        if (t?.defense) {
          this.fx.push({ kind: 'tool', tool: 'hammer', tx, ty });
          // a hurt wall is mended; a sound one is taken down after a few more blows (half its cost back)
          if (t.defense.hp < t.defense.maxHp) { if (this.wood < 1) return; this.wood--; t.defense.hp = Math.min(t.defense.maxHp, t.defense.hp + p.wallRepair); return; }
          if (++t.work < DISMANTLE.hits) return;
          const refund = Math.round(this.defenseCost(t.kind as DefenseKind) * DISMANTLE.refund), name = t.kind;
          this.world.damageDefense(t.defense, Infinity); this.rescueFallenGuards();
          this.wood += refund; this.event('build', `Took down the ${name}${refund ? ` — ${refund} wood recovered` : ''}`);
          return;
        }
        const b = this.facedBuilding();
        this.fx.push({ kind: 'tool', tool: 'hammer', tx, ty });
        if (!b || !t) return;
        // a hurt building is mended before it is improved
        if (b.kind !== 'lair' && (b.ruined || b.hp < b.maxHp)) { this.repairBuilding(b); return; }
        const why = this.upgradeProblem(b);
        if (why) { this.event('build', why); return; }
        if (++t.work >= this.mods.hammerHits) { t.work = 0; this.upgrade(b); }
        return;
      }
      case 'hoe':
        if (t?.kind === 'grass') this.world.set(tx, ty, 'tilled');
        else if (t?.kind === 'sapling') this.world.set(tx, ty, 'grass'); // dig out a stump
        else if (t?.kind === 'tilled') { // flattening soil is deliberate: three hits on the same tile
          if (++t.work >= 3) this.world.set(tx, ty, 'grass');
        }
        this.fx.push({ kind: 'tool', tool: 'hoe', tx, ty });
        return;
      case 'seeds':
        if (t?.kind === 'tilled') { this.world.set(tx, ty, 'crop'); this.fx.push({ kind: 'tool', tool: 'seed', tx, ty }); }
        else if (t?.kind === 'grass') { this.world.set(tx, ty, 'sapling'); this.fx.push({ kind: 'tool', tool: 'seed', tx, ty }); }
        return;
      case 'axe':
        if (t?.kind === 'tree') {
          const why = this.loadProblem('wood');
          if (why) { this.event('wood', why + '.'); return; }
          // the head clears ground; the real wood comes in on woodcutters' backs
          if (++t.work >= 3) { this.world.set(tx, ty, 'sapling'); this.player.pickUp('wood', p.playerTreeYield); }
          else this.world.dirty.add(ty * COLS + tx);
        } else if (t?.kind === 'sapling') this.world.set(tx, ty, 'grass'); // clear the stump
        this.fx.push({ kind: 'tool', tool: 'axe', tx, ty });
        return;
      case 'hands':
        if (t?.kind === 'crop' && t.stage >= this.cropDays) {
          const why = this.loadProblem('food');
          if (why) { this.event('food', why + '.'); return; }
          this.world.set(tx, ty, 'tilled'); this.player.pickUp('food', this.mods.cropYield); this.fx.push({ kind: 'tool', tool: 'seed', tx, ty });
        }
        return;
    }
  }

  /** What the tool would do right now, as "E: verb" (or a reason it won't). */
  /** "carrying 8 wood — walk up to the woodyard to unload", shown while the head holds something. */
  carryHint(): string | null {
    const l = this.player.load;
    return l ? `carrying ${l.n} ${l.kind} — walk up to the ${l.kind === 'wood' ? 'woodyard' : 'granary'} to unload` : null;
  }
  hint(): string {
    if (this.interior.active) return this.interior.hint();
    const door = this.doorAt();
    if (door && !this.player.elevated) return `▲ walk up into the door to enter ${BUILDINGS[door.kind].name}`;
    if (this.posting) return `Pick a connected battlement for ${this.posting.name} (or cancel in their card)`;
    const pl = this.player;
    const tg = this.target;
    const t = this.world.get(tg.tx, tg.ty);
    const kind = t?.kind;
    const need = (tool: string) => `need the ${tool}`;
    const b = t?.building;
    if (b && pl.tool !== 'hammer' && pl.tool !== 'sword') return `${this.buildingTitle(b)} — ${this.buildingBlurb(b)}`;
    switch (pl.tool) {
      case 'bow': return `E: shoot arrow (${this.arrows} left · craft 10 for 2 wood in the barracks)`;
      case 'wall': case 'gate': case 'stairs': {
        const why = this.defenseProblem(pl.tool, this.defenseTarget());
        if (why) return `${pl.tool}: ${why}`;
        return `E: build ${pl.tool} (${this.defenseCost(pl.tool)} wood construction) · ${pl.tool === 'stairs' ? 'connect to a wall; hands to climb' : pl.tool === 'gate' ? 'allies pass; X opens to everyone' : 'point where it goes — walls stand behind walls too'}`;
      }
      case 'sword': {
        const near = this.nearestRaider(pl.x, pl.y, 40);
        return near ? 'E: attack!' : 'E: swing sword';
      }
      case 'house':
      case 'tavern':
      case 'barracks': {
        const why = this.buildProblem(this.buildAnchor(pl.tool), pl.tool);
        return `E: build ${pl.tool} ${this.cursorPlacing ? 'where you point' : 'ahead'} (${this.buildCost(pl.tool)} wood)${pl.tool === 'barracks' ? ' · the ring is its arrow range' : ''}${why ? ' — ' + why : ''}`;
      }
      case 'hammer': {
        if (t?.defense) return t.defense.hp < t.defense.maxHp ? `E: repair ${t.kind} (${Math.ceil(t.defense.hp)}/${t.defense.maxHp} HP · 1 wood repairs ${p.wallRepair})` : `E: take down ${t.kind} (${DISMANTLE.hits - t.work} more hits · ${Math.round(this.defenseCost(t.kind as DefenseKind) * DISMANTLE.refund)} wood back)`;
        if (!b) return 'hammer: face a building to upgrade it';
        if (b.kind !== 'lair' && b.ruined) { const why = this.repairProblem(b); return why ? `${this.buildingTitle(b)} — ${why}` : `E: rebuild ${BUILDINGS[b.kind].name} (${this.rebuildCost(b)} wood)`; }
        if (b.kind !== 'lair' && b.hp < b.maxHp) return `E: repair ${BUILDINGS[b.kind].name} (${Math.ceil(b.hp)}/${b.maxHp} HP · 1 wood repairs ${REPAIR.perWood})`;
        const why = this.upgradeProblem(b);
        return why ? `${this.buildingTitle(b)} — ${why}` : `E: upgrade ${BUILDINGS[b.kind].name} → Lv${b.level + 1}: ${LEVEL_PERKS[b.kind][b.level + 1]} (${this.upgradeCost(b)} wood, ${this.mods.hammerHits - (t?.work ?? 0)} hits)`;
      }
      case 'hoe':
        if (kind === 'grass') return 'E: till soil';
        if (kind === 'sapling') return t!.stage < 2 ? 'E: dig out the stump' : 'E: clear the sapling';
        if (kind === 'tilled') return `E: flatten back to grass (${t!.work}/3 — hit it three times)`;
        if (kind === 'crop') return t!.stage >= this.cropDays ? `ripe — ${need('hands')}` : `growing (${t!.stage}/${this.cropDays} days) — harvest with hands`;
        if (kind === 'tree') return `tree — ${need('axe')}`;
        return 'hoe: face open grass';
      case 'seeds':
        if (kind === 'tilled') return 'E: plant crops';
        if (kind === 'grass') return `E: plant a tree (grows in ${this.saplingDays(tg.tx, tg.ty)} days${this.world.treeNeighbours(tg.tx, tg.ty) >= 2 ? ', sheltered' : ''})`;
        if (kind === 'sapling') return `sapling — a tree in ${this.saplingDays(tg.tx, tg.ty) - t!.stage} days`;
        if (kind === 'crop') return t!.stage >= this.cropDays ? `ripe — ${need('hands')}` : `growing (${t!.stage}/${this.cropDays} days)`;
        return 'seeds: crops on soil, trees on grass';
      case 'axe':
        if (kind === 'tree') { const why = this.loadProblem('wood'); return why ?? `E: clear ${this.isOldGrowth(t!) ? 'old growth' : 'young tree'} (${t!.work}/3 · ${p.playerTreeYield} wood for you; a woodcutter gets ${this.treeYield(t!)})${pl.load ? ` · carrying ${pl.load.n}/${HAUL.player.wood} wood` : ''}`; }
        if (kind === 'sapling') return t!.stage < 2 ? 'E: clear the stump' : 'E: cut down the sapling';
        return 'axe: face a tree';
      case 'hands':
        if (t?.defense?.kind === 'stairs' || this.world.get(pl.tile.tx, pl.tile.ty)?.kind === 'stairs') return `E: ${pl.elevated ? 'descend' : 'climb'} stairs`;
        if (t?.defense?.kind === 'gate') return `E: ${t.defense.open ? 'close' : 'open'} gate`;
        if (kind === 'crop') { const why = this.loadProblem('food'); return t!.stage >= this.cropDays ? (why ?? `E: harvest${pl.load ? ` · carrying ${pl.load.n}/${HAUL.player.food} food` : ''}`) : `growing (${t!.stage}/${this.cropDays} days)`; }
        if (kind === 'grass') return `grass — ${need('hoe')} to till`;
        if (kind === 'tilled') return `tilled — ${need('seeds')}`;
        if (kind === 'tree') return `tree — ${need('axe')}`;
        if (kind === 'sapling') return `sapling — a tree in ${this.saplingDays(tg.tx, tg.ty) - t!.stage} days`;
        return 'hands: harvest ripe crops';
    }
  }

  // ---- rendering ------------------------------------------------------------

  draw(): void {
    const dt = this.game.loop.delta / 1000;
    if (this.following) {
      const cam = this.cameras.main;
      const k = Math.min(1, dt * 8);
      cam.centerOn(cam.midPoint.x + (this.player.x - cam.midPoint.x) * k, cam.midPoint.y + (this.player.y - (this.player.elevated ? WALL_HEIGHT : 0) - cam.midPoint.y) * k);
    }
    this.view?.sync(dt);
    this.ui?.render(dt);
    this.interior.draw();
  }
}

// Decide the touch layout before Phaser measures its parent (the side panel becomes a drawer).
if (matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch')) document.body.classList.add('touch');

launch(VillageScene, { width: COLS * TILE, height: ROWS * TILE, zoom: ZOOM, scale: 'resize', pixelArt: true, background: '#1a2a1c' });
