import Phaser from 'phaser';
import { SimScene, launch } from '@shared/index';
import { World } from './world';
import { Villager, Raider, Player, Mover, type Role, type BuildItem } from './agents';
import { p, TILE, COLS, ROWS, ZOOM, COST, HOUSE_CAP, CROP_YIELD, TREE_YIELD } from './config';
import { Renderer, preloadArt } from './render';
import { UI } from './ui/ui';

const NAMES = ['Ada', 'Bram', 'Cass', 'Dov', 'Eli', 'Fen', 'Gil', 'Hana', 'Ivo', 'Juno', 'Kai', 'Lior', 'Mara', 'Nils', 'Orla', 'Pim', 'Quin', 'Rue', 'Sol', 'Tova', 'Uli', 'Vera', 'Wren', 'Xan', 'Yael', 'Zed'];

export type EventKind = 'birth' | 'grow' | 'soldier' | 'raid' | 'death' | 'build' | 'info' | 'food' | 'wood';
export interface GameEvent { kind: EventKind; text: string; toast: boolean; day: number }
export type Screen = 'title' | 'playing' | 'paused' | 'over';

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
  stats = { peakPop: 0, soldiersRaised: 0, raidsRepelled: 0 };

  private nameIdx = 0;
  private hovered: Mover | null = null;
  private view?: Renderer;
  private ui?: UI;
  private wasd!: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;

  get nextRaidDay(): number {
    return (Math.floor(this.day / p.raidEvery) + 1) * p.raidEvery;
  }

  // ---- setup ----------------------------------------------------------------

  preload(): void {
    preloadArt(this);
  }

  setup(): void {
    this.world = new World();
    this.world.generate(this.rng);
    this.food = 40;
    this.wood = 25;
    this.day = 1;
    this.dayTime = 0.3;
    this.raidActive = false;
    this.selected = null;
    this.journal = [];
    this.stats = { peakPop: 0, soldiersRaised: 0, raidsRepelled: 0 };
    this.nameIdx = this.rng.int(0, NAMES.length - 1);

    const home = this.world.houses[0];
    const c = World.center(home.tx, home.ty + 1);
    this.player = this.spawn(new Player(c.x + TILE * 2, c.y + TILE));
    this.player.keys = this.wasd;

    this.addVillager(home, 'farmer', 22);
    this.addVillager(home, 'woodcutter', 22);
    this.addVillager(home, 'kid', 4);
    this.event('info', 'A new village. Till soil, plant, and keep everyone fed.');
  }

  private addVillager(home: (typeof this.world.houses)[number], role: Role, age: number): Villager {
    const c = World.center(home.tx, home.ty + 1);
    const v = new Villager(c.x + this.rng.range(-4, 4), c.y + this.rng.range(-4, 4), home, role, age, NAMES[this.nameIdx++ % NAMES.length]);
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

    this.goTitle();
  }

  reset(newSeed?: number): void {
    super.reset(newSeed);
    this.view?.rebuild();
    this.ui?.clear();
    if (this.screen !== 'title') { this.screen = 'playing'; this.paused = false; this.ui?.showScreen(null); }
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

  private endGame(): void {
    this.screen = 'over';
    this.paused = true;
    this.ui?.showScreen('over');
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
      const name = m instanceof Villager ? m.name : m instanceof Player ? 'You' : 'Raider';
      const sub = m instanceof Villager ? m.role : m.task;
      this.ui.tooltip(`<div class="t">${name}</div><div class="d">${sub} · ${Math.max(0, m.hp)}/${m.maxHp} hp</div>`, ev.clientX, ev.clientY);
      return;
    }
    const t = this.world.get(Math.floor(ptr.worldX / TILE), Math.floor(ptr.worldY / TILE));
    let html: string | null = null;
    switch (t?.kind) {
      case 'crop': html = `<div class="t">${t.stage >= p.cropDays ? 'Ripe crop' : 'Growing crop'}</div><div class="d">${Math.min(t.stage, p.cropDays)}/${p.cropDays} days · yields ${CROP_YIELD} food</div>`; break;
      case 'tilled': html = `<div class="t">Tilled soil</div><div class="d">plant with E, or a farmer will</div>`; break;
      case 'tree': html = `<div class="t">Tree</div><div class="d">${t.work}/3 chopped · yields ${TREE_YIELD} wood</div>`; break;
      case 'house': html = `<div class="t">House</div><div class="d">${t.house?.residents ?? 0}/${HOUSE_CAP} residents · couples here have children</div>`; break;
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

    this.raidActive = this.agents.some((a) => a instanceof Raider && !a.dead);

    for (const a of this.agents) a.update(dt, this);
    for (const a of this.agents) if (a.dead) this.onDeath(a as Mover);
    this.removeDead();

    if (this.raidActive && !this.agents.some((a) => a instanceof Raider)) {
      this.raidActive = false;
      this.stats.raidsRepelled++;
      this.event('raid', 'Raid repelled!', true);
    }
    this.stats.peakPop = Math.max(this.stats.peakPop, this.villagers().length);
    if (this.player.dead) this.endGame();
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
      if (this.food >= p.foodPerDay) { this.food -= p.foodPerDay; v.hungerDays = 0; }
      else if (++v.hungerDays >= 3) { v.dead = true; v.hp = 0; this.event('death', `${v.name} starved`, true); continue; }
      else this.event('food', `${v.name} went hungry`);
      v.age++;
      if (v.role === 'kid' && v.age >= p.adultAge) v.comeOfAge(this);
      else if (v.age >= p.oldAge && this.rng.chance(0.25)) { v.dead = true; this.event('death', `${v.name} died of old age`); }
    }

    // births: a couple sharing a house with room and food to spare
    for (const h of this.world.houses) {
      const adults = villagers.filter((v) => v.home === h && v.isAdult && !v.dead);
      if (adults.length >= 2 && h.residents < HOUSE_CAP && this.food > 10 && this.rng.chance(p.birthChance)) {
        const kid = this.addVillager(h, 'kid', 0);
        this.event('birth', `${kid.name} was born`, true);
      }
    }

    // move-ins: adults from crowded houses take a spare room elsewhere
    for (const h of this.world.houses) {
      if (h.residents >= HOUSE_CAP) continue;
      const mover = villagers.find((v) => v.isAdult && !v.dead && v.home !== h && villagers.filter((o) => o.home === v.home && o.isAdult).length > 2);
      if (mover) { mover.home.residents--; mover.home = h; h.residents++; this.event('info', `${mover.name} moved into a new house`); }
    }

    if (this.day % p.raidEvery === 0) this.spawnRaid();
    else if ((this.day + 1) % p.raidEvery === 0) this.event('raid', 'Raiders sighted — they arrive tomorrow', true);
  }

  spawnRaid(): void {
    const n = 1 + Math.floor(this.day / 5);
    const side = this.rng.int(0, 3);
    for (let i = 0; i < n; i++) {
      let tx = side === 0 ? 0 : side === 1 ? COLS - 1 : this.rng.int(0, COLS - 1);
      let ty = side === 2 ? 0 : side === 3 ? ROWS - 1 : this.rng.int(0, ROWS - 1);
      const dx = side === 0 ? 1 : side === 1 ? -1 : 0, dy = side === 2 ? 1 : side === 3 ? -1 : 0;
      while (this.world.isBlocked(tx, ty) && this.world.inBounds(tx + dx, ty + dy)) { tx += dx; ty += dy; }
      const c = World.center(tx, ty);
      this.spawn(new Raider(c.x, c.y));
    }
    this.raidActive = true;
    this.event('raid', `RAID! ${n} raider${n > 1 ? 's' : ''} from the ${['west', 'east', 'north', 'south'][side]}`, true);
  }

  private onDeath(a: Mover): void {
    if (a === this.selected) this.selected = null;
    if (a === this.hovered) this.hovered = null;
    if (a instanceof Villager) {
      a.home.residents--;
      if (a.hp <= 0 && a.hungerDays < 3) this.event('death', `${a.name} the ${a.role} was killed`, true);
    } else if (a instanceof Raider && a.hp <= 0) {
      this.event('raid', 'Raider slain');
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

  private interact(): void {
    if (this.screen !== 'playing') return;
    const pl = this.player;
    const raider = this.nearestRaider(pl.x, pl.y, 20);
    if (raider) { pl.tryAttack(raider, 12, 20, 0.5); return; }

    const { tx, ty } = pl.faced;
    const t = this.world.get(tx, ty);
    if (!t) return;

    if (pl.build !== 'none') {
      if (t.kind !== 'grass') { this.event('build', 'Need open grass to build'); return; }
      if (this.wood < COST[pl.build]) { this.event('build', `Need ${COST[pl.build]} wood for a ${pl.build}`); return; }
      this.wood -= COST[pl.build];
      if (pl.build === 'house') this.world.placeHouse(tx, ty); else this.world.placeBarracks(tx, ty);
      this.event('build', `Built a ${pl.build}`, true);
      return;
    }

    switch (t.kind) {
      case 'grass': this.world.set(tx, ty, 'tilled'); break;
      case 'tilled': this.world.set(tx, ty, 'crop'); break;
      case 'crop':
        if (t.stage >= p.cropDays) { this.world.set(tx, ty, 'tilled'); this.food += CROP_YIELD; }
        break;
      case 'tree':
        if (++t.work >= 3) { this.world.set(tx, ty, 'grass'); this.wood += TREE_YIELD; }
        else this.world.dirty.add(ty * COLS + tx);
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
      case 'crop': return t.stage >= p.cropDays ? 'E: harvest' : `growing (${t.stage}/${p.cropDays} days)`;
      case 'tree': return `E: chop (${t.work}/3)`;
      case 'house': return `house — ${t.house?.residents ?? 0}/${HOUSE_CAP} residents`;
      case 'barracks': return 'barracks — kids raised nearby become soldiers';
      default: return '';
    }
  }

  // ---- rendering ------------------------------------------------------------

  draw(): void {
    const dt = this.game.loop.delta / 1000;
    this.view?.sync(dt);
    this.ui?.render(dt);
  }
}

launch(VillageScene, { width: COLS * TILE, height: ROWS * TILE, zoom: ZOOM, pixelArt: true, background: '#1a2a1c' });
