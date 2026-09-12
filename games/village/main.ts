import Phaser from 'phaser';
import { SimScene, launch } from '@shared/index';
import { World } from './world';
import { Villager, Raider, Player, Mover, type Role } from './agents';
import { p, TILE, COLS, ROWS, COST, HOUSE_CAP, CROP_YIELD, TREE_YIELD } from './config';

const NAMES = ['Ada', 'Bram', 'Cass', 'Dov', 'Eli', 'Fen', 'Gil', 'Hana', 'Ivo', 'Juno', 'Kai', 'Lior', 'Mara', 'Nils', 'Orla', 'Pim', 'Quin', 'Rue', 'Sol', 'Tova', 'Uli', 'Vera', 'Wren', 'Xan', 'Yael', 'Zed'];

const COLORS = {
  grass: 0x2f5d34, grassAlt: 0x2b5630, tilled: 0x5a4030, crop: 0x3a6b2a, sprout: 0x8fd35a, ripe: 0xf0c83c,
  tree: 0x1d3f22, trunk: 0x4a3320, house: 0x8a5a3a, roof: 0xb03a2e, barracks: 0x555a66, barracksTrim: 0xc0392b,
};

export class VillageScene extends SimScene {
  neighborRadius = 260; // soldier aggro radius = largest grid query

  world!: World;
  player!: Player;
  food = 0;
  wood = 0;
  day = 1;
  /** 0..1 within the day; night around 0.85..0.15 */
  dayTime = 0.3;
  raidActive = false;
  gameOver = false;
  private nameIdx = 0;
  private logs: string[] = [];
  private banner: { text: string; ttl: number } | null = null;

  private hintText!: Phaser.GameObjects.Text;
  private logText!: Phaser.GameObjects.Text;
  private bannerText!: Phaser.GameObjects.Text;
  private overText!: Phaser.GameObjects.Text;
  private night!: Phaser.GameObjects.Rectangle;

  // ---- setup ----------------------------------------------------------------

  setup(): void {
    this.world = new World();
    this.world.generate(this.rng);
    this.food = 40;
    this.wood = 25;
    this.day = 1;
    this.dayTime = 0.3;
    this.raidActive = false;
    this.gameOver = false;
    this.nameIdx = this.rng.int(0, NAMES.length - 1);
    this.logs = [];
    this.banner = null;

    const home = this.world.houses[0];
    const c = World.center(home.tx, home.ty + 1);
    this.player = this.spawn(new Player(c.x + TILE * 2, c.y + TILE));
    this.player.keys = this.wasd;

    this.addVillager(home, 'farmer', 22);
    this.addVillager(home, 'woodcutter', 22);
    this.addVillager(home, 'kid', 4);
    this.log('Day 1. WASD move · E use · Q build');
  }

  private addVillager(home: (typeof this.world.houses)[number], role: Role, age: number): Villager {
    const c = World.center(home.tx, home.ty + 1);
    const v = new Villager(c.x + this.rng.range(-8, 8), c.y + this.rng.range(-8, 8), home, role, age, this.nextName());
    home.residents++;
    return this.spawn(v);
  }

  private nextName(): string {
    return NAMES[this.nameIdx++ % NAMES.length];
  }

  log(msg: string): void {
    this.logs.push(msg);
    if (this.logs.length > 6) this.logs.shift();
  }

  private wasd!: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;

  create(): void {
    const kb = this.input.keyboard!;
    this.wasd = kb.addKeys('W,A,S,D') as typeof this.wasd;
    kb.on('keydown-E', () => this.interact());
    kb.on('keydown-Q', () => this.player.cycleBuild());

    super.create(); // creates gfx + hud, then calls reset() -> setup()

    this.night = this.add.rectangle(0, 0, this.W, this.H, 0x060612, 0).setOrigin(0).setDepth(5);
    const mono = 'ui-monospace, Menlo, Consolas, monospace';
    this.hintText = this.add.text(this.W / 2, this.H - 10, '', { fontFamily: mono, fontSize: '13px', color: '#fff', backgroundColor: 'rgba(0,0,0,.5)', padding: { x: 8, y: 4 } }).setOrigin(0.5, 1).setDepth(10);
    this.logText = this.add.text(this.W - 8, this.H - 8, '', { fontFamily: mono, fontSize: '11px', color: '#bcc', align: 'right', backgroundColor: 'rgba(0,0,0,.4)', padding: { x: 6, y: 4 } }).setOrigin(1, 1).setDepth(10);
    this.bannerText = this.add.text(this.W / 2, 60, '', { fontFamily: mono, fontSize: '34px', color: '#ff5a5a', fontStyle: 'bold' }).setOrigin(0.5).setDepth(10);
    this.overText = this.add.text(this.W / 2, this.H / 2, '', { fontFamily: mono, fontSize: '24px', color: '#fff', align: 'center', backgroundColor: 'rgba(0,0,0,.7)', padding: { x: 20, y: 14 } }).setOrigin(0.5).setDepth(20).setVisible(false);
  }

  reset(newSeed?: number): void {
    this.paused = false;
    this.overText?.setVisible(false);
    super.reset(newSeed);
  }

  // ---- simulation -----------------------------------------------------------

  tick(dt: number): void {
    if (this.gameOver) return;

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
      this.log('Raid repelled!');
    }
    if (this.banner && (this.banner.ttl -= dt) <= 0) this.banner = null;
    if (this.player.dead) this.endGame();
  }

  private newDay(): void {
    // a night's rest
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + 30);
    // crops grow
    for (const t of this.world.tiles) if (t.kind === 'crop') t.stage++;
    // occasional sapling next to an existing tree
    for (let i = 0; i < 3; i++) {
      const tx = this.rng.int(0, COLS - 1), ty = this.rng.int(0, ROWS - 1);
      const t = this.world.get(tx, ty);
      const nearTree = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => this.world.get(tx + dx, ty + dy)?.kind === 'tree');
      if (t?.kind === 'grass' && (nearTree || this.rng.chance(0.15)))
        this.world.set(tx, ty, 'tree');
    }

    // villagers: eat, age, grow up, grow old
    const villagers = this.villagers();
    for (const v of villagers) {
      if (this.food >= p.foodPerDay) { this.food -= p.foodPerDay; v.hungerDays = 0; }
      else if (++v.hungerDays >= 3) { v.dead = true; this.log(`${v.name} starved`); continue; }
      v.age++;
      if (v.role === 'kid' && v.age >= p.adultAge) v.comeOfAge(this);
      else if (v.age >= p.oldAge && this.rng.chance(0.25)) { v.dead = true; this.log(`${v.name} died of old age`); }
    }

    // births: a couple sharing a house with room and food to spare
    for (const h of this.world.houses) {
      const adults = villagers.filter((v) => v.home === h && v.isAdult && !v.dead);
      if (adults.length >= 2 && h.residents < HOUSE_CAP && this.food > 10 && this.rng.chance(p.birthChance)) {
        const kid = this.addVillager(h, 'kid', 0);
        this.log(`${kid.name} was born`);
      }
    }

    // move-ins: adults from crowded houses take a spare room elsewhere
    for (const h of this.world.houses) {
      if (h.residents >= HOUSE_CAP) continue;
      const mover = villagers.find((v) => v.isAdult && !v.dead && v.home !== h && v.home.residents > 2 && villagers.filter((o) => o.home === v.home && o.isAdult).length > 2);
      if (mover) { mover.home.residents--; mover.home = h; h.residents++; }
    }

    if (this.day % p.raidEvery === 0) this.spawnRaid();
    else if ((this.day + 1) % p.raidEvery === 0) this.showBanner('Raiders sighted — they arrive tomorrow', 4);
  }

  private spawnRaid(): void {
    const n = 1 + Math.floor(this.day / 5);
    const side = this.rng.int(0, 3);
    for (let i = 0; i < n; i++) {
      let tx = side === 0 ? 0 : side === 1 ? COLS - 1 : this.rng.int(0, COLS - 1);
      let ty = side === 2 ? 0 : side === 3 ? ROWS - 1 : this.rng.int(0, ROWS - 1);
      // step inward until we find open ground
      const dx = side === 0 ? 1 : side === 1 ? -1 : 0, dy = side === 2 ? 1 : side === 3 ? -1 : 0;
      while (this.world.isBlocked(tx, ty) && this.world.inBounds(tx + dx, ty + dy)) { tx += dx; ty += dy; }
      const c = World.center(tx, ty);
      this.spawn(new Raider(c.x, c.y));
    }
    this.raidActive = true;
    this.showBanner(`RAID! ${n} raiders`, 5);
    this.log(`Day ${this.day}: ${n} raiders attack`);
  }

  private onDeath(a: Mover): void {
    if (a instanceof Villager) {
      a.home.residents--;
      if (a.hp <= 0) this.log(`${a.name} the ${a.role} was killed`);
    } else if (a instanceof Raider && a.hp <= 0) {
      this.log('Raider slain');
    }
  }

  private endGame(): void {
    this.gameOver = true;
    this.paused = true;
    this.overText.setText(`You died on day ${this.day}\n\n${this.villagers().length} villagers remain\n\nR to restart`).setVisible(true);
  }

  private showBanner(text: string, ttl: number): void {
    this.banner = { text, ttl };
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
    if (this.gameOver || this.paused) return;
    const pl = this.player;
    const raider = this.nearestRaider(pl.x, pl.y, 40);
    if (raider) { pl.tryAttack(raider, 12, 40, 0.5); return; }

    const { tx, ty } = pl.faced;
    const t = this.world.get(tx, ty);
    if (!t) return;

    if (pl.build !== 'none') {
      if (t.kind !== 'grass') { this.log('Need open grass to build'); return; }
      if (this.wood < COST[pl.build]) { this.log(`Need ${COST[pl.build]} wood`); return; }
      this.wood -= COST[pl.build];
      if (pl.build === 'house') this.world.placeHouse(tx, ty); else this.world.placeBarracks(tx, ty);
      this.log(`Built a ${pl.build}`);
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
        break;
    }
  }

  private hint(): string {
    const pl = this.player;
    if (this.nearestRaider(pl.x, pl.y, 40)) return 'E: attack';
    if (pl.build !== 'none') return `E: build ${pl.build} (${COST[pl.build]} wood) · Q: change`;
    const t = this.world.get(pl.faced.tx, pl.faced.ty);
    switch (t?.kind) {
      case 'grass': return 'E: till soil · Q: build';
      case 'tilled': return 'E: plant';
      case 'crop': return t.stage >= p.cropDays ? 'E: harvest' : `growing (${t.stage}/${p.cropDays} days)`;
      case 'tree': return `E: chop (${t.work}/3)`;
      case 'house': return `house (${t.house?.residents ?? 0}/${HOUSE_CAP})`;
      case 'barracks': return 'barracks — kids raised nearby become soldiers';
      default: return '';
    }
  }

  // ---- rendering ------------------------------------------------------------

  draw(): void {
    const g = this.gfx;
    g.clear();
    const w = this.world;
    for (let ty = 0; ty < ROWS; ty++) {
      for (let tx = 0; tx < COLS; tx++) {
        const t = w.tiles[ty * COLS + tx];
        const x = tx * TILE, y = ty * TILE;
        g.fillStyle((tx + ty) % 2 ? COLORS.grass : COLORS.grassAlt, 1);
        g.fillRect(x, y, TILE, TILE);
        switch (t.kind) {
          case 'tilled':
            g.fillStyle(COLORS.tilled, 1); g.fillRect(x + 2, y + 2, TILE - 4, TILE - 4); break;
          case 'crop': {
            g.fillStyle(COLORS.tilled, 1); g.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
            const f = Math.min(1, t.stage / p.cropDays);
            g.fillStyle(f >= 1 ? COLORS.ripe : f > 0.5 ? COLORS.crop : COLORS.sprout, 1);
            const s = 6 + f * 14;
            g.fillRect(x + TILE / 2 - s / 2, y + TILE / 2 - s / 2, s, s);
            break;
          }
          case 'tree':
            g.fillStyle(COLORS.trunk, 1); g.fillRect(x + 13, y + 16, 6, 12);
            g.fillStyle(COLORS.tree, 1); g.fillCircle(x + TILE / 2, y + 13, 11); break;
          case 'house':
            g.fillStyle(COLORS.house, 1); g.fillRect(x + 3, y + 12, TILE - 6, TILE - 14);
            g.fillStyle(COLORS.roof, 1); g.fillTriangle(x + 1, y + 13, x + TILE - 1, y + 13, x + TILE / 2, y + 2); break;
          case 'barracks':
            g.fillStyle(COLORS.barracks, 1); g.fillRect(x + 2, y + 6, TILE - 4, TILE - 8);
            g.fillStyle(COLORS.barracksTrim, 1); g.fillRect(x + 2, y + 6, TILE - 4, 5); g.fillRect(x + 13, y + 16, 6, 10); break;
        }
      }
    }

    // faced tile highlight
    const f = this.player.faced;
    if (w.inBounds(f.tx, f.ty)) {
      g.lineStyle(2, this.player.build !== 'none' ? 0xffe066 : 0xffffff, 0.6);
      g.strokeRect(f.tx * TILE + 1, f.ty * TILE + 1, TILE - 2, TILE - 2);
    }

    // agents
    for (const a of this.agents) {
      const m = a as Mover;
      if (m.hidden) continue;
      g.fillStyle(m.color, 1);
      g.fillCircle(m.x, m.y, m.radius);
      if (a instanceof Villager && a.role === 'soldier') { g.lineStyle(2, 0xffffff, 0.9); g.strokeCircle(m.x, m.y, m.radius + 1); }
      if (a instanceof Raider) { g.lineStyle(2, 0x300000, 1); g.strokeCircle(m.x, m.y, m.radius + 1); }
      if (m === this.player) {
        g.fillStyle(0x000000, 0.6);
        g.fillCircle(m.x + this.player.facing.x * 5, m.y + this.player.facing.y * 5, 2.5);
      }
      if (m.hp < m.maxHp) {
        const bw = 16;
        g.fillStyle(0x000000, 0.6); g.fillRect(m.x - bw / 2, m.y - m.radius - 6, bw, 3);
        g.fillStyle(m.hp / m.maxHp > 0.4 ? 0x5fdc5f : 0xff4040, 1); g.fillRect(m.x - bw / 2, m.y - m.radius - 6, bw * (m.hp / m.maxHp), 3);
      }
    }

    // day/night
    const nightness = Math.max(0, Math.cos((this.dayTime - 0.5) * Math.PI * 2) * -1); // 1 at dayTime 0, 0 at 0.5
    this.night.setAlpha(nightness * 0.55);

    this.hintText.setText(this.hint()).setVisible(!this.gameOver);
    this.logText.setText(this.logs.join('\n'));
    this.bannerText.setText(this.banner?.text ?? '').setAlpha(this.banner ? Math.min(1, this.banner.ttl) : 0);
  }

  hudLines(): Record<string, string | number> {
    const vs = this.villagers();
    const count = (r: Role) => vs.filter((v) => v.role === r).length;
    const hour = Math.floor(this.dayTime * 24);
    return {
      day: `${this.day} ${String(hour).padStart(2, '0')}:00${this.raidActive ? ' ⚔ RAID' : ''}`,
      food: Math.floor(this.food),
      wood: Math.floor(this.wood),
      villagers: `${count('farmer')} farmers · ${count('woodcutter')} cutters · ${count('kid')} kids`,
      soldiers: count('soldier'),
      hp: `${Math.max(0, this.player.hp)}/${this.player.maxHp}`,
      build: this.player.build,
    };
  }
}

launch(VillageScene, { width: COLS * TILE, height: ROWS * TILE, background: '#1a2a1c' });
