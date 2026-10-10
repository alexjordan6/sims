import { PackUI } from './pack-ui';

/** An armory tier as pips: three for the forged tiers, and a gold star for a found piece. */
/** A soldier's rank as five pips, the tiers it holds filled. */
const rankPips = (tier: number) => `<span class="rank t${tier}">${'◆'.repeat(tier)}<span class="dim">${'◇'.repeat(Math.max(0, 5 - tier))}</span></span>`;
const pips = (tier: number) => `${'●'.repeat(Math.min(3, Math.max(0, tier)))}${'○'.repeat(Math.max(0, 3 - Math.max(0, tier)))}${tier >= 4 ? '<b class="found" title="found, never forged">★</b>' : ''}`;
import { slotName, type Gear, type EquipmentSlot } from '../pack';
import { gearUrl } from '../gear-art';
import { STACK, WARREN, SOLDIER_CAP_PER_LEVEL, UNIT, UNIT_NAMES, PERK_TEXT, unitName, type UnitBranch } from '../config';
import { REGIMENT_SIZE, GROUPS, GROUP_NAME, ORDER_MENUS, SHAPE_NAME, type Regiment } from '../regiment';
import { getGui } from '@shared/index';
import { Villager, Raider, Player, Mover, BUILDS, type Tool } from '../agents';
import { Boar } from '../wildlife';
import { CHAR, TOWN, FARM, DUNGEON, framePos } from '../atlas';
import { BANDAGE, OGRE, BOAR, HAUL, TILE, COST, ORDER, YARD, GNOME_PACK, p, TOWER, HEARTH_WOOD, WEAPONS, WEAPON_SLOTS, type WeaponSlot, LEGACY_TEST_MODE, LEVEL_PERKS, TRAITS, ARMOR, ARMOR_SLOTS, DYES, DYE_NAMES, PLUMES, type ArmorSlot, UPGRADE_COST, SERVE_RANGE, MOODS, FOODS, FOOD_KINDS, RAW_KINDS, DISHES, RECIPES, isDish, foodCount, hasInterior, type DishKind, DISMANTLE, DIET_CAP, DIET_STAT_NAME, type FoodKind, LEVEL_LOOKS, SAPLING_DAYS, SHELTERED_SAPLING_DAYS, TREE_RESERVE, OLD_GROWTH_DAYS } from '../config';
import { BRANCHES, nodeById, nodesOf, type Branch, type Node } from '../meta';
import type { VillageScene, EventKind, GameEvent } from '../main';
import { Minimap } from './minimap';
import { frameDataUrl, BUILDING_TEXTURE, FLORA } from '../pixelart';
import { charImg, armorStats, weaponMul } from '../characters';
import { lookFor, tileArt } from '../look';
import { BUILDINGS, MAX_LEVEL, hasHearth, hearthCost, WILD_FOOD, type BuildingKind, type TilePos, type Building } from '../world';
import type { Item } from '../items';

// ---------------------------------------------------------------------------
// helpers

const h = (html: string): HTMLElement => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Inline sprite from one of the sheets. size: 16 | 24 | 32 | 48 */
export function spr(key: string, frame: number, size = 32, extra = ''): string {
  const scale = size / 16;
  const cls = size === 32 ? '' : `s${size}`;
  return `<span class="spr ${key} ${cls} ${extra}" style="background-position:${framePos(frame, scale)}"></span>`;
}

const ROLE_LABEL: Record<string, string> = { infant: 'Infant', kid: 'Child', farmer: 'Farmer', woodcutter: 'Woodcutter', soldier: 'Soldier', gnome: 'Gnome' };
/** a grown gnome's portrait, for chips and outlooks */
/** the GNOME HOUSE slot's tooltip once the craft is learned (locked, it says how to learn it) */
const WARREN_TITLE = () => `A gnome warren: a burrow mound that sleeps ${WARREN.beds} and keeps ${WARREN.cribs} cribs. Any two grown gnomes in the village are enough for it to breed — a roll every ${p.warrenBirthEvery}s — and its children eat from the granary by themselves (${p.gnomeRation} of a ration each a dawn), so nobody throws food in its yard. The army of hundreds is raised here`;
const GNOME_TITLE = 'A toadstool cottage: a gnome couple moves in and raises a family like any house. Their grown ones take a calling like anyone else — the wild instead of the fields, the axe, or the club — and H calls the whole train to your heels';

const ENEMY_LABEL: Record<string, string> = { raider: 'Hollow raider', warlord: 'The Warlord', rat: 'Plague rat — gnaws the granary', snatcher: 'Snatcher — steals children', brute: 'Butcher — heavy', shaman: 'Bone shaman — ranged', wrecker: 'Wrecker — tears down buildings', boar: 'Boar — wild game, fights back', troll: 'Bog troll — prowls the wild', skulk: 'Skulk — creeps from long grass, hunts gnomes' };

const EVENT_ICON: Record<EventKind, { key: string; frame: number }> = {
  birth: { key: 'dungeon', frame: DUNGEON.villager },
  grow: { key: 'farm', frame: FARM.farmerHat },
  soldier: { key: 'dungeon', frame: DUNGEON.knight },
  raid: { key: 'dungeon', frame: DUNGEON.orc },
  death: { key: 'dungeon', frame: DUNGEON.ghost },
  build: { key: 'town', frame: TOWN.iconHammer },
  info: { key: 'town', frame: TOWN.sign },
  food: { key: 'farm', frame: FARM.iconTomato },
  wood: { key: 'town', frame: TOWN.iconWood },
};

function charOf(m: Mover): { key: string; frame: number } {
  if (m instanceof Player) return CHAR.player;
  if (m instanceof Raider) return CHAR[m.kind];
  if (m instanceof Villager) return CHAR[m.role];
  return CHAR.kid;
}

// ---------------------------------------------------------------------------

export class UI {
  private overlay = document.getElementById('overlay')!;
  private screens = document.getElementById('screens')!;
  private stage = document.getElementById('stage')!;

  private top!: HTMLElement;
  private hotbar!: HTMLElement;
  /** the backpack panel: hidden until the BAG on the belt (or B) opens it */
  private bag!: HTMLElement;
  private bagOpen = false;
  /** Open or shut the backpack. Called by the BAG slot, by B, and by Esc through the scene. */
  toggleBag(open = !this.bagOpen): void {
    this.bagOpen = open;
    this.bag.hidden = !open;
    this.hotbar.querySelector('.bag')!.classList.toggle('on', open);
  }
  get bagShowing(): boolean { return this.bagOpen; }
  /** Open or shut one of the on-demand panels: the journal (J), the army (L), the inspector (I), the controls (K). */
  togglePanel(name: 'journal' | 'army' | 'inspector' | 'controls', open?: boolean): void {
    if (name === 'controls') { this.setControls(open ?? !this.controlsOpen()); return; }
    if (name === 'inspector') { this.inspectPinned = open ?? !(this.inspectPinned || !this.inspector.hidden); if (!this.inspectPinned) this.scene.select(null); return; }
    const el = name === 'journal' ? this.journalEl : this.roster;
    el.hidden = !(open ?? el.hidden);
    if (!el.hidden && name === 'army') { this.lastRoster = ''; this.renderRoster(); }
  }
  /** Esc: shut the uppermost open panel. True when there was one (the menu is next otherwise). */
  closeTop(): boolean {
    if (this.controlsOpen()) { this.setControls(false); return true; }
    if (!this.journalEl.hidden) { this.journalEl.hidden = true; return true; }
    if (!this.roster.hidden) { this.roster.hidden = true; return true; }
    if (!this.inspector.hidden) { this.inspectPinned = false; const s = this.scene; s.select(null); s.selectBuilding(null); s.selectTile(null); s.selectItem(null); this.inspector.hidden = true; return true; }
    return false;
  }
  private feed!: HTMLElement;
  private toasts!: HTMLElement;
  private inspector!: HTMLElement;
  private roster!: HTMLElement;
  private minimap!: Minimap;
  private journalEl!: HTMLElement;
  /** the inspector held open with I, though nothing is picked */
  private inspectPinned = false;
  /** the controls card, open or shut (set from mountControls) */
  private setControls: (open: boolean) => void = () => {};
  private controlsOpen = (): boolean => false;
  /** when the hint caption last changed (it fades once it has been read) */
  private hintAt = 0;
  private tooltipEl!: HTMLElement;

  private lastTop = '';
  private lastRoster = '';
  private inspT = 0;
  private lastInspector = '';
  private rosterT = 0;
  private reticle!: HTMLElement;
  private lastDuel = '';
  private topT = 0;
  private feedSeen = 0;
  private lastBuilding: import('../world').Building | null = null;
  /** the building whose DEMOLISH button has been pressed once (the second press does it) */
  private confirmDemolish: import('../world').Building | null = null;

  readonly inventory: PackUI;
  constructor(private scene: VillageScene) { this.inventory = new PackUI(scene); }

  mount(): void {
    const s = this.scene;

    // --- 1. the status strip: the day, the stores, the army, and what is coming (hover any figure for more)
    this.top = h(`<div class="hud-status" data-hud="status">
      <span class="st t-day" title="Survive to day ${p.bossDay} and beat the Warlord"><span class="sun"></span><span class="day"></span><span class="hour"></span></span>
      <span class="st t-wood" title="Wood: woodcutters bring it in; the woodyard sets the cap">${spr('town', TOWN.iconWood, 16)}<span class="num wood"></span></span>
      <span class="st t-food">${spr('farm', FARM.iconTomato, 16)}<span class="num food"></span></span>
      <span class="st t-scrap" title="Scrap iron: raiders drop it where they fall. Forges iron and steel at the barracks"><span class="scrap-ico"></span><span class="num scrap"></span></span>
      <span class="st t-army">${spr('dungeon', DUNGEON.knight, 16)}<span class="num army"></span></span>
      <span class="st t-raid" title="Hosts muster in the wild and march on the village; the Warlord comes on day ${p.bossDay}"><span class="raid"></span></span>
    </div>`);

    // --- tool belt: the equipped tool decides what E does
    const slot = (tool: Tool, key: string, frame: number, label: string, title: string, cost?: number) =>
      `<div class="slot" data-tool="${tool}" title="${esc(title)}">${spr(key, frame, 32)}<span class="lbl">${label}</span>${cost ? `<span class="cost">${cost}${spr('town', TOWN.iconWood, 16)}</span>` : ''}</div>`;
    this.hotbar = h(`<div class="hotbar">
      <div class="hint"><span class="hint-text"></span></div>
      <div class="vitals" data-hud="vitals">
        <div class="t-hp" title="Your HP. You heal overnight — not on an empty belly. If you die the run ends"><span class="bar hp"><i></i></span></div>
        <div class="t-hunger" title="Your belly. Empty, you lose HP and stop mending. T eats (your pack first, then the granary). Click to eat"><span class="bar belly"><i></i></span><span class="belly-num"></span></div>
        <div class="abilities">${(["Q", "W", "E", "R"] as const).map((k) => `<div class="ability" data-ab="${k}"><kbd>${k === "Q" || k === "W" ? "LMB" : k === "E" ? "Space" : k}</kbd><span class="ab-name"></span><span class="ab-cd"></span><span class="ab-count"></span></div>`).join("")}</div>
        <div class="t-stam" title="Wind. A blow, a sprint and a guard that turns one all spend it; it comes back when you leave off"><span class="bar stam"><i></i></span></div>
        <div class="t-buff" hidden title="The dish you last ate, and how long it keeps working"><span class="buff"></span></div>
      </div>
      <div class="orders" data-panel="orders" hidden></div>
      <div class="buildrow" hidden>
        ${slot('gnomehouse', 'town', TOWN.wallWoodDoor, 'COTTAGE', GNOME_TITLE, COST.gnomehouse)}
        ${slot('warren', 'town', TOWN.wallWoodDoor, 'WARREN', WARREN_TITLE(), COST.warren)}
        ${slot('barracks', 'town', TOWN.wallStoneDoor, 'BARRACKS', `Room for ${p.soldierCap} more warriors, and what drills them: a child promised a sword needs a warm barracks standing. Its tower shoots arrows at raiders in range; restock the chest inside with wood`, COST.barracks)}
        ${slot('wall', 'town', TOWN.wallStoneDoor, 'WALL', 'Build a connected stone perimeter. 4 wood per segment', 4)}
        ${slot('gate', 'town', TOWN.wallWoodDoor, 'GATE', 'Friendly villagers pass; X toggles opening to everyone', 12)}
        ${slot('stairs', 'town', TOWN.iconHammer, 'STAIRS', 'Connect stairs to your walls. Right click or X to climb and descend', 10)}
      </div>
      <div class="slots" data-hud="belt">
        <span class="cap slots-cap">TOOLS <kbd>1-9</kbd></span>
        ${slot('sword', 'dungeon', DUNGEON.sword, 'SWORD', 'Swing at raiders in front of you. You start with a club — forge a real blade at the barracks chest')}
        ${slot('bow', 'dungeon', DUNGEON.sword, 'BOW', 'Fire physical arrows. Shared ammunition is made at the barracks; a better bow is forged at its chest')}
        ${slot('axe', 'town', TOWN.iconAxe, 'AXE', 'Chop trees for wood (3 hits); clears stumps and saplings')}
        ${slot('hammer', 'town', TOWN.iconHammer, 'HAMMER', 'Upgrade the building in front of you (3 hits)')}
        ${slot('basket', 'farm', FARM.crate, 'BASKET', 'F picks a kind of food; walk up to the granary to fill the basket with it, then throw it into a home yard. It flies where you point, bounces and rolls; children only eat what lies in the yard of the home they live in, and what they eat is who they become')}
        ${slot('wand', 'dungeon', DUNGEON.wizard, 'WAND', 'Shaman wand: left click or drag a box to pick soldiers, right click to send them — open ground = go there and hold, a raider = attack it, a wall top = take that archer post. F = follow me (again to stop). With no one picked, orders go to everyone')}
        <div class="slot bag" data-bag="1" title="Your backpack: what you are carrying, and what you are wearing. B opens it">${spr('farm', FARM.crate, 32)}<span class="lbl">BAG</span><span class="cost bagfull"></span></div>
      </div>
    </div>`);
    // only the tool slots pick a tool: the BAG shares the slot look but opens the backpack
    this.hotbar.querySelectorAll<HTMLElement>('.slot[data-tool]').forEach((el) => el.addEventListener('click', () => { const t = el.dataset.tool as Tool; s.setTool(s.player.tool === t && BUILDS.includes(t) ? 'hammer' : t); }));
    // the command bar: a formation card picks its group (Shift adds), a menu button opens it, an item gives the order
    this.hotbar.querySelector<HTMLElement>('.orders')!.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-group],[data-menu],[data-item],[data-back]');
      if (!t) return;
      if (t.dataset.group) s.selectGroup(Number(t.dataset.group), (e as MouseEvent).shiftKey);
      else if (t.dataset.menu) s.openCommand(Number(t.dataset.menu));
      else if (t.dataset.item) s.commandItem(s.commandMenu(), Number(t.dataset.item));
      else s.commandBack();
      this.lastOrders = '';
    });

    this.bag = h(`<div class="bagpanel panel" hidden>
      <div class="ph"><h2>Backpack</h2><span class="cap">B or ESC to shut it</span><button class="btn small close">CLOSE</button></div>
      <div class="inventory-host"></div>
    </div>`);
    this.hotbar.querySelector('.bag')!.addEventListener('click', () => this.toggleBag());
    this.hotbar.querySelector('.ability[data-ab="R"]')?.addEventListener('click', () => s.cycleMeal(1)); // which meal R throws
    this.bag.querySelector('.close')!.addEventListener('click', () => this.toggleBag(false));
    // --- 5. the alert line: what is worth stopping for, two lines at most
    this.toasts = h('<div class="toasts" data-hud="alerts"></div>');
    // the journal: the whole log, opened with J
    this.journalEl = h(`<div class="drawer journal" hidden><div class="ph"><h2>Journal</h2><span class="cap">J or Esc to close</span></div><div class="feed"></div></div>`);
    this.feed = this.journalEl.querySelector('.feed')!;
    this.overlay.append(this.top, this.bag, this.hotbar, this.toasts, this.journalEl);
    this.inventory.mount(this.bag.querySelector('.inventory-host')!);
    this.hotbar.querySelector('.t-hunger')!.addEventListener('click', () => this.scene.eat());

    // --- on demand: the inspector (whatever is picked, or I), the army and villagers (L)
    this.inspector = h('<div class="inspector drawer" hidden></div>');
    this.roster = h(`<div class="roster drawer" hidden><div class="ph">${spr('dungeon', DUNGEON.villager, 24)}<h2>Army &amp; villagers</h2><span class="cap">L or Esc to close</span></div><div class="list"></div></div>`);
    // --- 4. the minimap, in the corner
    this.minimap = new Minimap(s, 2);
    const box = h('<div class="hud-map" data-hud="map"></div>');
    box.append(this.minimap.el);
    this.overlay.append(box, this.inspector, this.roster);
    this.roster.addEventListener('click', (e) => {
      // a regiment's row: its buttons set the stance or the shape; anywhere else on it picks the block for the wand
      const reg = (e.target as HTMLElement).closest<HTMLElement>('.reg-row');
      if (reg) {
        const r = s.regiments.find((x) => x.id === Number(reg.dataset.reg));
        if (!r) return;
        const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
        if (act === 'shape') s.cycleShape([r]);
        else if (act === 'hold' || act === 'advance' || act === 'follow') s.setStance([r], act);
        else if (act === 'promote') s.promoteReady(r);
        else if (act === 'branch') r.branch = r.branch === 'a' ? 'b' : 'a';
        else { s.player.tool = 'wand'; s.selectRegiment(r, (e as MouseEvent).shiftKey); }
        this.lastRoster = ''; this.renderRoster();
        return;
      }
      const row = (e.target as HTMLElement).closest<HTMLElement>('.row');
      if (!row) return;
      const v = s.villagers().find((x) => x.id === Number(row.dataset.id));
      if (v) s.select(v);
    });

    this.tooltipEl = h('<div class="tooltip" hidden></div>');
    this.overlay.append(this.tooltipEl);
    // the crosshair, and round it the dial that says which way the blow or the guard is set
    this.reticle = h(`<div class="reticle" hidden><i class="dot"></i>${['up', 'down', 'left', 'right'].map((d) => `<i class="arm ${d}"></i>`).join('')}<span class="draw"></span></div>`);
    this.overlay.append(this.reticle);

    this.mountControls();

    // debug sliders hidden until backtick
    getGui().hide();
    window.addEventListener('keydown', (e) => {
      if (e.key === '`') { const g = getGui(); g._hidden ? g.show() : g.hide(); }
    });

    this.renderInspector(true);
  }

  // ---- controls reference (collapsible) ---------------------------------------------

  /**
   * A small always-available key reference: a tab in the corner that flips open into a card.
   * Toggle by clicking the tab, pressing H, or the × — it never pauses the game.
   * Open by default for new players; remembers the last state.
   */
  private mountControls(): void {
    // Every binding in the game, read off main.ts's keyboard map and view.ts's pointer handlers. It is
    // the reference you test by, so when a binding moves, it moves here in the same commit.
    const rows: [string, string][] = [
      ['click the view', 'take the mouse — Alt or Esc hands it back for the menus'],
      ['W A S D', 'walk, relative to wherever you are looking'],
      ['Shift · Space', 'run, which spends wind · dodge roll'],
      ['hold LMB, move the mouse', 'wind a blow and choose it — up overhead · down thrust · left or right a swing — let go to strike'],
      ['hold RMB, move the mouse', 'guard, the same four ways: only the side you hold turns the blow'],
      ['their blow, thrown back', 'a chamber — start the same blow during their wind-up and theirs never lands'],
      ['Q', 'kick: goes through a guard, and through whatever was being wound up behind it'],
      ['hold middle mouse', 'look about without moving your wind-up or your guard'],
      ['wheel · Z', 'camera distance'],
      ['C', 'use the tool in hand at the crosshair'],
      ['X', 'check a villager'],
      ['1 – 8 · Tab', 'pick a tool — with the hammer out, pick what to build (0: the hammer again)'],
      ['F', 'which food the basket throws · which order the wand gives'],
      ['hold R', 'aim a meal (the wheel picks which) — let go to lob it'],
      ['T · G · U', 'eat a meal · throw the largest supply stack · bind a wound'],
      ['H', 'call the gnomes to your heels'],
      ['F1 – F5', 'order the banners: Movement · Facing · Form · Fire · Work — then F1-F7 picks the order'],
      ['1 – 8 with the bar open', 'pick a group · Alt+1-8 moves the picked banners into one'],
      ['G · T · H with the wand out', 'the picked banners instead: hold · advance · follow'],
      ['B · V', 'your bag · the armory'],
      ['J · L · I', 'journal · army and villagers · inspector'],
      ['K · ? · M', 'this panel · how to play · sound on and off'],
      ['Esc · − =', 'menu · game speed'],
    ];
    const panel = h(`<div class="ctrl-panel">
      <button class="ctrl-tab" title="Controls (K)">${spr('town', TOWN.iconKey, 16)} CONTROLS <span class="arrow">▴</span></button>
      <div class="ctrl-card panel">
        <div class="ph">${spr('town', TOWN.iconKey, 24)}<h2>Controls</h2><button class="btn small ctrl-close">×</button></div>
        <div class="ctrl-rows">${rows.map(([k, d]) => `<kbd>${esc(k)}</kbd><span>${esc(d)}</span>`).join('')}</div>
        <div class="ctrl-foot">The mouse is the weapon: it is taken by the page while you fight, so the cursor vanishes. Alt or Esc gives it back for the armory, the roster and the build menus. A settled wind-up hits harder than a tap.</div>
        <div class="ctrl-foot"><button class="btn small mute">SOUND</button></div>
      </div>
    </div>`);
    // open unless it was shut last time: it is the control reference, and a control reference nobody can
    // find is no reference at all. (The stored state was written here but never read until now.)
    let open = true;
    // a fresh key: anyone who shut the old MOBA card years of commits ago should still be shown this one
    try { open = localStorage.getItem('village.controls.v2') !== 'closed'; } catch { /* no storage: show it */ }
    const set = (v: boolean) => {
      open = v;
      panel.classList.toggle('open', open);
      try { localStorage.setItem('village.controls.v2', open ? 'open' : 'closed'); } catch { /* ignore */ }
    };
    panel.classList.toggle('open', open);
    panel.querySelector('.ctrl-tab')!.addEventListener('click', () => set(!open));
    this.setControls = set; this.controlsOpen = () => open;
    panel.querySelector('.ctrl-close')!.addEventListener('click', () => set(false));
    const muteBtn = panel.querySelector<HTMLElement>('.mute')!;
    const paintMute = () => { muteBtn.textContent = this.scene.muted ? 'SOUND: OFF' : 'SOUND: ON'; muteBtn.classList.toggle('on', !this.scene.muted); };
    muteBtn.addEventListener('click', () => { this.scene.toggleMute(); paintMute(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'm' || e.key === 'M') setTimeout(paintMute, 0); });
    setTimeout(paintMute, 0);
    window.addEventListener('keydown', (e) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('input')) return; // typing a village name is not a shortcut
      if (e.key === 'k' || e.key === 'K') set(!open); // H is the gnome whistle (main.ts), and one key does one thing
      if (this.scene.screen === 'playing' && !e.repeat) {
        if (e.key === 'j' || e.key === 'J') this.togglePanel('journal');
        if (e.key === 'l' || e.key === 'L') this.togglePanel('army');
        if (e.key === 'i' || e.key === 'I') this.togglePanel('inspector');
      }
      if (e.key === '?') this.showHelp(); // the row below has always advertised it
    });
    this.overlay.append(panel);
    set(open);
  }

  // ---- per-frame -------------------------------------------------------------

  render(dt: number): void {
    const s = this.scene;
    this.stage.classList.toggle('raid', s.raidActive);
    if (s.selectedBuilding !== this.lastBuilding) { this.lastBuilding = s.selectedBuilding; this.confirmDemolish = null; this.renderInspector(true); }
    const pickKey = s.selectedItem ? `item${s.selectedItem.id}` : s.selectedTile ? `tile${s.selectedTile.tx},${s.selectedTile.ty}` : '';
    if (pickKey !== this.lastPick) { this.lastPick = pickKey; this.renderInspector(true); }
    this.topT += dt; this.rosterT += dt;
    this.minimap.render(dt, s.tilesChanged);
    // the inspector shows while something is picked (or I holds it open)
    const picked = !!(s.selected || s.selectedBuilding || s.selectedTile || s.selectedItem);
    const showInspector = picked || this.inspectPinned;
    if (this.inspector.hidden === showInspector) { this.inspector.hidden = !showInspector; if (showInspector) this.renderInspector(true); }
    if (this.topT > 0.1) {
      this.topT = 0; this.renderTop(); this.renderHotbar();
      this.inspT += 0.1; if (this.inspT >= 0.25 && showInspector) { this.inspT = 0; this.renderInspector(); } // cards rebuild their DOM: a few times a second is plenty
    }
    if (this.rosterT > 0.5 && !this.roster.hidden) { this.rosterT = 0; this.renderRoster(); }
    this.renderDuel();
    this.renderFeed();
    this.inventory.render();
    if(this.scene.armoryFor)this.renderArmory();
    if (this.scene.pouchOf) this.renderPouch();
    if (this.scene.cookingAt) this.renderCooking();
    // the BAG slot carries how full it is, so the bag can stay shut (outside the top bar's memo gate:
    // what you are carrying changes far more often than the clock does)
    const bagFull = this.hotbar.querySelector<HTMLElement>('.bagfull');
    if (bagFull) { const pk = this.scene.player.pack, txt = `${pk.slots.length - pk.emptySlots}/${pk.slots.length}`; if (bagFull.textContent !== txt) bagFull.textContent = txt; }

  }

  private renderTop(): void {
    const s = this.scene;
    const hour = Math.floor(s.dayTime * 24);
    const night = s.dayTime < 0.22 || s.dayTime > 0.8;
    const raidIn = s.nextRaidDay - s.day;
    const host = s.hostStatus();
    const hostKey = host ? `${host.marching}${host.alive}/${host.peak}@${host.tiles}` : '';
    const army = s.callingFilled('soldier'), armyCap = s.callingCap('soldier');
    const key = `${s.day}|${hour}|${s.food | 0}/${s.foodCap}|${s.surplusDays().toFixed(1)}|${s.wood | 0}/${s.woodCap}|${s.scrap}|${army}/${armyCap}|${Math.round(s.player.hp / Math.max(1, s.player.maxHp) * 40)}|${p.hunger ? Math.ceil(s.player.hunger * 2) / 2 : 'off'}/${p.hungerMax}|${s.raidActive}|${s.boss?.hp ?? ''}|${raidIn}|${night}|${s.buff?.dish ?? ''}${Math.ceil(s.buffLeft())}|${hostKey}`;
    if (key === this.lastTop) return;
    this.lastTop = key;
    const q = (sel: string) => (this.top.querySelector<HTMLElement>(sel) ?? this.hotbar.querySelector<HTMLElement>(sel))!;
    q('.sun').classList.toggle('moon', night);
    q('.day').textContent = p.peaceful ? `DAY ${s.day}` : `DAY ${s.day}/${p.bossDay}`;
    q('.hour').textContent = `${String(hour).padStart(2, '0')}:00`;
    q('.wood').innerHTML = `${s.wood | 0}<small>/${s.woodCap}</small>`;
    const days = s.surplusDays();
    q('.food').innerHTML = `${s.food | 0}<small>${Number.isFinite(days) ? ` · ${days.toFixed(days < 10 ? 1 : 0)}d` : ''}</small>`;
    q('.t-food').title = `Food: ${FOOD_KINDS.filter((k) => s.pantry[k] >= 1).map((k) => `${s.pantry[k] | 0} ${FOODS[k].one}`).join(' · ') || 'empty'} (cap ${s.foodCap}). The small number is how many days the larder would last.`;
    q('.scrap').textContent = String(s.scrap);
    q('.army').innerHTML = `${army}<small>/${armyCap}</small>`;
    q('.t-army').title = `Warriors under arms (and children promised the sword) / places the barracks keep · ${s.regiments.length} regiment${s.regiments.length === 1 ? '' : 's'} · L for the army`;
    const raid = q('.raid'), bossNext = s.nextRaidDay === p.bossDay;
    if (s.raidActive && s.boss && !s.boss.dead) { raid.innerHTML = `WARLORD <span class="bar boss"><i style="width:${Math.max(0, (s.boss.hp / s.boss.maxHp) * 100)}%"></i></span>`; raid.className = 'raid now'; }
    else if (host?.marching) { raid.textContent = `HOST ${host.alive}/${host.peak} · ${host.tiles} tiles`; raid.className = 'raid now'; }
    else if (s.raidActive) { raid.textContent = 'UNDER ATTACK'; raid.className = 'raid now'; }
    else if (host) { const d = Math.max(0, host.marchDay - s.day); raid.textContent = `HOST ${host.peak} · ${d <= 1 ? (d ? 'TOMORROW' : 'TODAY') : d + 'd'}`; raid.className = d <= 1 ? 'raid soon' : 'raid'; }
    else if (!Number.isFinite(raidIn)) { raid.textContent = 'PEACE'; raid.className = 'raid'; }
    else { raid.textContent = raidIn <= 1 ? (bossNext ? 'WARLORD TOMORROW' : 'RAID TOMORROW') : `${bossNext ? 'WARLORD' : 'RAID'} · ${raidIn}d`; raid.className = raidIn <= 1 || bossNext ? 'raid soon' : 'raid'; }
    // the vitals: HP, the belly, the meal working in you
    const hpShare = Math.max(0, s.player.hp / Math.max(1, s.player.maxHp));
    const hp = q('.bar.hp');
    hp.classList.toggle('low', hpShare <= 0.3);
    (hp.firstElementChild as HTMLElement).style.width = `${Math.round(hpShare * 100)}%`;
    q('.t-hp').title = `Your HP ${Math.ceil(s.player.hp)}/${s.player.maxHp}. You heal overnight — not on an empty belly. If you die the run ends`;
    const meal = q('.t-buff');
    meal.hidden = !s.buff || s.buffLeft() <= 0;
    if (!meal.hidden && s.buff) q('.buff').innerHTML = `<span style="color:${FOODS[s.buff.dish].colour}">+${Math.round((s.buff.mul - 1) * 100)}% ${DIET_STAT_NAME[s.buff.stat]}</span> <small>${Math.ceil(s.buffLeft())}s</small>`;
    const belly = q('.t-hunger');
    belly.hidden = !p.hunger;
    if (p.hunger) {
      const left = Math.max(0, Math.min(s.player.hunger, p.hungerMax)), share = left / Math.max(1e-6, p.hungerMax);
      const num = q('.belly-num'), want = `${left < 10 ? left.toFixed(1) : Math.round(left)}`;
      if (num.textContent !== want) num.textContent = want;
      const bar = q('.bar.belly');
      bar.className = `bar belly ${left <= 0 ? 'empty' : share <= 0.25 ? 'low' : ''}`;
      (bar.firstElementChild as HTMLElement).style.width = `${Math.round(share * 100)}%`;
      belly.classList.toggle('empty', left <= 0);
    }
  }

  /**
   * The duel, drawn every frame because a blow is chosen and let go inside a handful of them: the
   * crosshair, the arm of the dial that says which way the blow or the guard is set, the arm that says
   * which way one is coming at you, and the wind left to pay for any of it.
   */
  private renderDuel(): void {
    const s = this.scene;
    const show = s.screen === 'playing' && !s.interior.active;
    if (this.reticle.hidden === show) this.reticle.hidden = !show;
    if (!show) return;
    const d = s.duelState();
    const key = `${d.wind}|${d.guard}|${d.incoming}|${Math.round(d.stam)}|${Math.round(d.draw * 20)}|${d.chambered}`;
    if (key === this.lastDuel) return;
    this.lastDuel = key;
    const set = d.wind ?? d.guard;
    this.reticle.classList.toggle('guarding', !!d.guard && !d.wind);
    this.reticle.classList.toggle('chambered', d.chambered);
    for (const arm of this.reticle.querySelectorAll<HTMLElement>('.arm')) {
      const dir = arm.className.split(' ')[1];
      arm.classList.toggle('set', set === dir);
      arm.classList.toggle('coming', d.incoming === dir);
    }
    const draw = this.reticle.querySelector<HTMLElement>('.draw')!;
    draw.hidden = d.draw < 0;
    if (d.draw >= 0) draw.style.setProperty('--d', `${Math.round(d.draw * 100)}%`);
    const bar = this.hotbar.querySelector<HTMLElement>('.bar.stam i');
    if (bar) { bar.style.width = `${Math.round((d.stam / d.stamMax) * 100)}%`; bar.parentElement!.classList.toggle('low', d.stam < 25); }
  }

  private renderHotbar(): void {
    const s = this.scene;
    this.hotbar.querySelectorAll<HTMLElement>('.slot[data-tool]').forEach((el) => {
      const tool = el.dataset.tool as Tool;
      el.classList.toggle('on', s.player.tool === tool || (tool === 'hammer' && BUILDS.includes(s.player.tool)));
      el.classList.toggle('off', !!s.toolLocked(tool) || ((tool === 'barracks' || tool === 'gnomehouse' || tool === 'warren') && s.wood < COST[tool]));
      if (tool === 'warren') { const want = s.toolLocked(tool) ? 'Find the gnomes first: they dig the warrens.' : WARREN_TITLE(); if (el.title !== want) el.title = want; }
      if (tool === 'gnomehouse') { const want = s.toolLocked(tool) ? 'Somewhere in these woods a gnome family keeps house. Warm motes drift over their glade — walk into it and they will teach you the craft.' : GNOME_TITLE; if (el.title !== want) el.title = want; }
      if (tool === 'basket') { const lbl = el.querySelector('.lbl')!, want = `BASKET · ${s.player.carriedOf('food',s.player.basketKind)} ${FOODS[s.player.basketKind].name.toUpperCase()}`; if (lbl.textContent !== want) lbl.textContent = want; }
    });
    const row = this.hotbar.querySelector<HTMLElement>('.buildrow')!;
    if (row.hidden === s.hammerOut()) row.hidden = !s.hammerOut();
    this.renderOrders();
    // the ability bar: a dark sweep over each key while it cools down, greyed when it cannot fire at all
    for (const a of s.abilityState()) {
      const el = this.hotbar.querySelector<HTMLElement>(`.ability[data-ab="${a.key}"]`);
      if (!el) continue;
      const pct = a.left > 0 ? Math.round((a.left / a.full) * 100) : 0;
      const memo = `${a.name}|${pct}|${a.usable}|${a.note}`;
      if (el.dataset.memo === memo) continue;
      el.dataset.memo = memo;
      el.querySelector('.ab-name')!.textContent = a.name;
      el.style.setProperty('--cd', `${pct}%`);
      el.classList.toggle('cooling', pct > 0);
      el.classList.toggle('off', !a.usable);
      el.title = a.key === "Q" ? "Blade: hold LMB, move to wind, release to strike" : a.key === "W" ? "Bow: equip bow, hold LMB to draw, release to shoot" : a.key === "E" ? "Space: dodge in your movement direction" : `${a.key} · ${a.name}: ${a.note}`;
    }
    const quiver = this.hotbar.querySelector<HTMLElement>('.ability[data-ab="W"] .ab-count');
    if (quiver && quiver.textContent !== String(s.arrows)) quiver.textContent = String(s.arrows);
    const hint = this.hotbar.querySelector('.hint-text')!;
    const carry = s.carryHint();
    const raw = s.hint();
    const text = (carry && !raw.startsWith('E:') && !/full|first/.test(raw) ? carry : raw).replace(/^E: /, '');
    // and what your hands would do there, since the right button is always available whatever you hold
    const hands = s.handsHint();
    const full = hands ? `${text} · right click: ${hands}` : text;
    // a faint caption: it shows when what a click would do changes, and fades once it has been read
    const now = performance.now();
    if (hint.textContent !== full) { hint.textContent = full; this.hintAt = now; }
    this.hotbar.querySelector('.hint')!.classList.toggle('faded', !full || now - this.hintAt > 3000);
  }

  private lastPick = '';
  /** Portrait for a tile or a thing on the ground, from the same art the map draws. */
  private tilePortrait(art: { key: string; frame: number }): string {
    if (art.key === 'flora' || art.key === 'fort') return `<img class="art" src="${frameDataUrl(this.scene, art.key, art.frame)}" alt="" style="image-rendering:pixelated;width:48px;height:${art.key === 'fort' ? 'auto' : '48px'}">`;
    return spr(art.key, art.frame, 48);
  }
  /** A card for something lying on the ground. */
  private renderItemCard(it: Item, head: string): void {
    const s = this.scene;
    const art = it.kind === 'gear' && it.gear ? `<img class="art" src="${gearUrl(it.gear)}" alt="">` : it.kind === 'wood' ? spr('town', TOWN.iconWood, 48) : this.tilePortrait({ key: 'flora', frame: it.kind === 'scrap' ? FLORA.scrap : FLORA.pile[it.food ?? 'wheat'][Math.min(2, Math.max(0, Math.ceil(it.n / Math.max(1, p.tossSize)) - 1))] });
    const name = it.kind === 'gear' && it.gear ? slotName(it.gear) : it.kind === 'scrap' ? 'Scrap iron' : it.kind === 'wood' ? 'Wood' : FOODS[it.food ?? 'wheat'].name;
    const amount = it.n % 1 ? it.n.toFixed(1) : String(it.n);
    const q = { tx: Math.floor(it.x / 16), ty: Math.floor(it.y / 16) };
    const where = !it.rest ? 'in the air' : s.world.inYard(it.x, it.y) ? 'in a home yard' : 'on open ground';
    const eaters = it.kind === 'food' ? s.villagers().filter((v) => v.eatingFrom === it && !v.dead).length : 0;
    let html = `${head}<div class="head">${art}<div><div class="name">${amount} ${name.toLowerCase()}</div><span class="badge ${it.kind === 'scrap' ? 'soldier' : 'farmer'}">${it.kind === 'scrap' ? 'loot' : it.kind === 'wood' ? 'supplies' : it.kind === 'gear' ? 'equipment' : 'food on the ground'}</span></div><button class="btn small close">x</button></div><div class="rows">`;
    html += `<b>Where</b><span>${where} · tile ${q.tx}, ${q.ty}${it.rest ? '' : ' <em>· still moving</em>'}</span>`;
    if (it.kind === 'food') html += `<b>Feeds</b><span>${FOODS[it.food ?? 'wheat'].blurb}${s.world.inYard(it.x, it.y) ? ` · ${eaters ? `${eaters} eating from it now` : 'the children of this home will eat it'}` : ' · <em class="warn">no home yard here — children only eat what lands by the home they live in</em>'}</span>`;
    html += `<b>Pick up</b><span>${it.kind === 'scrap' ? 'walk over it' : 'approach to collect into your pack when space is available'}</span></div>`;
    html += `<p class="d">Thrown things fly where you point, bounce off walls and trees, and lie where they stop.</p>`;
    this.inspector.innerHTML = html;
    this.inspector.querySelector('.close')?.addEventListener('click', () => s.selectItem(null));
  }
  /** A card for a tile: tree, wild food, wall, gate, stairs, or plain grass. */
  private renderTileCard(q: TilePos, head: string): void {
    const s = this.scene, w = s.world, t = w.get(q.tx, q.ty);
    if (!t) { s.selectTile(null); return; }
    const art = this.tilePortrait(tileArt(t, s));
    const close = `<button class="btn small close">x</button>`;
    const lying = w.itemsOn(q.tx, q.ty);
    const lyingRow = lying.length ? `<b>Lying here</b><span>${lying.map((it) => `<a href="#" class="pick-item" data-id="${it.id}">${it.n % 1 ? it.n.toFixed(1) : it.n} ${it.kind === 'gear' && it.gear ? slotName(it.gear) : it.kind === 'scrap' ? 'scrap' : it.kind === 'wood' ? 'wood' : FOODS[it.food ?? 'wheat'].one}</a>`).join(', ')}</span>` : '';
    let title = '', badge = '', badgeCls = 'farmer', rows = '', extra = '';
    if (t.defense) {
      const d = t.defense, pct = Math.round(100 * d.hp / d.maxHp);
      title = d.kind === 'wall' ? 'Wall' : d.kind === 'gate' ? 'Gate' : 'Stairs'; badge = d.kind === 'gate' ? (d.open ? 'open to everyone' : 'guarded — allies pass') : d.kind === 'stairs' ? 'up to the battlements' : 'stone rampart'; badgeCls = 'soldier';
      rows += `<b>Structure</b><span>${Math.ceil(d.hp)} / ${d.maxHp} HP${d.hp < d.maxHp ? ` <em>· hammer mends ${p.wallRepair} per wood</em>` : ''}<div class="bar hp ${pct <= 40 ? 'low' : ''}"><i style="width:${pct}%"></i></div></span>`;
      if (d.kind === 'stairs') { const reach = s.stairsReach(q); rows += `<b>Serves</b><span>${reach} connected battlement${reach === 1 ? '' : 's'} · ${s.villagers().filter((v) => v.post && Math.abs(v.post.tx - q.tx) + Math.abs(v.post.ty - q.ty) <= 12).length} soldiers posted along it</span>`; }
      if (d.kind === 'gate') extra = `<div class="raise"><div class="cap">GATE</div><div class="seg"><button class="btn small ${d.open ? '' : 'on'}" data-gate="closed">GUARDED</button><button class="btn small ${d.open ? 'on' : ''}" data-gate="open">OPEN</button></div><div class="d">Guarded: allies pass, enemies must break it. Open: everyone walks through.</div></div>`;
      rows += `<b>Take down</b><span>${DISMANTLE.hits} hammer hits for half the wood back</span>`;
    } else if (t.kind === 'tree' || t.kind === 'sapling') {
      if (t.kind === 'tree') {
        const old = s.isOldGrowth(t), grove = w.groveSize(q.tx, q.ty), left = s.oldGrowthDays - t.stage;
        title = old ? 'Old growth' : 'Tree'; badge = old ? `yields ${s.treeYield(t)} wood` : `old growth in ${left} day${left === 1 ? '' : 's'}`;
        rows += `<b>Wood</b><span>${s.treeYield(t)} to a woodcutter · ${p.playerTreeYield} to your own axe${t.work ? ` · ${t.work}/3 chopped` : ''}</span><b>Grove</b><span>${grove}${grove >= 200 ? '+' : ''} trees together · spreads ${Math.round(s.seedChance(q.tx, q.ty) * 100)}% a day</span><b>Shelters</b><span>${old ? 'berries and mushrooms may sprout beside it' : 'nothing yet — old growth seeds wild food'}</span>`;
      } else {
        const days = s.saplingDays(q.tx, q.ty) - t.stage;
        title = t.stage < 2 ? 'Stump' : 'Sapling'; badge = `a tree in ${days} day${days === 1 ? '' : 's'}`;
        rows += `<b>Growth</b><span>${t.stage} / ${s.saplingDays(q.tx, q.ty)} days${w.treeNeighbours(q.tx, q.ty) >= 2 ? ' · sheltered by the grove' : ''}</span><b>Clear</b><span>the axe removess it</span>`;
      }
    } else if (WILD_FOOD[t.kind]) {
      const fk = WILD_FOOD[t.kind]!, ripe = s.wildRipe(t), left = s.regrowDays(fk) - t.stage;
      title = FOODS[fk].name; badge = ripe ? `${s.wildLeft(t)} left — right click to pick, or a gnome will` : `back in ${left} day${left === 1 ? '' : 's'}`;
      rows += `<b>Yield</b><span>${FOODS[fk].yield} ${FOODS[fk].one} when regrown · ${FOODS[fk].blurb}</span><b>Regrows</b><span>every ${s.regrowDays(fk)} days${ripe ? '' : ` · ${t.stage} so far`}</span>`;
    } else {
      title = t.trail ? 'Trail' : t.tall ? 'Long grass' : 'Grass'; badge = t.biome === 'deepwood' ? 'deep woodland' : t.biome === 'woodland' ? 'woodland' : 'meadow';
      rows += `<b>Ground</b><span>${t.trail ? 'a woodland trail — trees never grow over it' : t.tall ? `slows anyone wading through it to ${Math.round(p.grassSlow * 100)}% — raiders too · things hide in it · the sword mows an arc per swing; it never grows back` : 'open ground'}</span><b>Could be</b><span>tilled with the hoe · a tree with seeds · a pen with the PEN tool · a building</span>`;
    }
    let html = `${head}<div class="head">${art}<div><div class="name">${title}</div><span class="badge ${badgeCls}">${badge}</span></div>${close}</div><div class="rows">${rows}${lyingRow}<b>Tile</b><span>${q.tx}, ${q.ty}</span></div>${extra}`;
    this.inspector.innerHTML = html;
    this.inspector.querySelector('.close')?.addEventListener('click', () => s.selectTile(null));
    this.inspector.querySelectorAll<HTMLElement>('.pick-item').forEach((el) => el.addEventListener('click', (e) => { e.preventDefault(); const it = w.items.find((i) => i.id === Number(el.dataset.id)); if (it) s.selectItem(it); }));
    this.inspector.querySelectorAll<HTMLButtonElement>('[data-gate]').forEach((el) => el.addEventListener('click', () => { if (t.defense) w.setGateOpen(t.defense, el.dataset.gate === 'open'); this.renderInspector(true); }));
  }

  private renderInspector(force = false): void {
    const s = this.scene;
    const m = s.selected;
    const head = `<div class="ph">${spr('town', TOWN.sign, 24)}<h2>Inspector</h2></div>`;
    const b = s.selectedBuilding;
    if (!m && !b && s.selectedItem) { this.renderItemCard(s.selectedItem, head); return; }
    if (!m && !b && s.selectedTile) { this.renderTileCard(s.selectedTile, head); return; }
    if (!m && b && b.kind === 'lair') {
      const dead = b.level >= 3;
      const html = `${head}<div class="head"><img class="art" src="${frameDataUrl(s, BUILDING_TEXTURE.lair, dead ? 2 : 0)}" alt=""><div><div class="name">${BUILDINGS.lair.name}</div><span class="badge ${dead ? 'farmer' : 'soldier'}">${dead ? 'silent — the fire is out' : 'the Ogre sleeps here by day'}</span></div><button class="btn small close">x</button></div>
        <p>${dead ? 'The Ogre is slain. Bones and cold ashes are all that remain.' : `A cave mouth banked with earth and bones. The Ogre sleeps inside from dawn to dusk and prowls the woods around it at night — he hunts anyone within ${OGRE.hunt} tiles. Once he has your scent he never sleeps again. He has three attacks, all telegraphed: a wide swing for ${OGRE.swing.dmg} that catches everyone in front of him, a ground smash for ${OGRE.smash.dmg} that cracks walls and buildings around him, and a charge for ${OGRE.charge.dmg} that bowls over anyone in its path and batters whatever stops it. He has ${OGRE.hp} HP and heals a quarter of it each day he still sleeps.`}</p>`;
      this.inspector.innerHTML = html;
      this.inspector.querySelector('.close')?.addEventListener('click', () => s.selectBuilding(null));
      return;
    }
    if (!m && b) {
      // a building: what it does, what the next level adds, and for houses the RAISE toggle
      const cost = b.level < MAX_LEVEL ? UPGRADE_COST[b.kind][b.level] : 0;
      let html = `${head}<div class="head"><img class="art" src="${frameDataUrl(s, BUILDING_TEXTURE[b.kind], b.level - 1)}" alt=""><div><div class="name">${BUILDINGS[b.kind].name} <small>Lv${b.level}</small></div><span class="badge ${b.kind === 'barracks' ? 'soldier' : 'farmer'}">${LEVEL_PERKS[b.kind][b.level]}</span></div><button class="btn small close">x</button></div>`;
      html += `<div class="rows">`;
      if (b.kind !== 'lair') {
        html += b.ruined
          ? `<b>Walls</b><span><em class="warn">RUINED</em> · nothing works until it's rebuilt · <b>hammer · ${s.rebuildCost(b)} wood</b></span>`
          : `<b>Walls</b><span>${Math.ceil(b.hp)} / ${b.maxHp} HP${b.hp < b.maxHp ? ' <em>· hammer repairs 60 per wood</em>' : ''}<div class="bar hp ${b.hp / b.maxHp <= 0.4 ? 'low' : ''}"><i style="width:${Math.round(100 * b.hp / b.maxHp)}%"></i></div></span>`;
      }
      if (hasHearth(b) && !b.ruined) {
        const why = s.stockProblem(b);
        html += `<b>Hearth</b><span>${b.warm ? 'warm' : '<em class="warn">COLD</em>'} · ${b.firewood} / ${p.hearthNights} night${b.firewood === 1 ? '' : 's'} stocked · burns ${hearthCost(b)} wood a night <button class="btn small ${why ? '' : 'ok'} stock-hearth" ${why ? 'disabled' : ''} title="${why ? esc(why) : 'from the village pile; woodcutters stock it on their own'}">STOCK +1 NIGHT · ${hearthCost(b)} WOOD</button>${!b.warm ? `<em class="d"> ${b.firewood ? 'lit again at dawn' : 'empty — no births, drill, regen or meals until it burns'}</em>` : ''}</span>`;
      }
      if (b.kind === 'gnomehouse') {
        const infants = s.infantsOf(b).length, why = s.birthProblem(b);
        html += `<b>Beds</b><span>${s.bedsTaken(b)} / ${s.beds(b)}${s.bedsTaken(b) > s.beds(b) ? ' <em class="warn">· crowded</em>' : ''}</span>`;
        html += `<b>Nursery</b><span>${infants} / ${s.cribs(b)} cribs${b.ruined ? '' : why ? ` · <em class="warn">no births: ${esc(why)}</em>` : ` · ${Math.round(100 * s.birthChance(b))}% every ${p.birthEvery}s · next roll in ${Math.ceil(s.birthIn(b))}s${s.feverActive() ? ' <em class="fever-txt">· baby fever</em>' : ''}`}<em class="d"> infants walk out into the yard after ${p.infantDays} days</em></span>`;
      }
      if (b.kind === 'warren') {
        const infants = s.infantsOf(b).length, why = s.birthProblem(b), folk = s.villagers().filter((v) => v.home === b && !v.dead);
        const kids = folk.filter((v) => v.role === 'kid').length, eat = folk.reduce((n, v) => n + s.rationOf(v), 0);
        html += `<b>Beds</b><span>${s.bedsTaken(b)} / ${s.beds(b)}</span>`;
        html += `<b>Nursery</b><span>${infants} / ${s.cribs(b)} cribs${b.ruined ? '' : why ? ` · <em class="warn">no births: ${esc(why)}</em>` : ` · ${Math.round(100 * s.birthChance(b))}% every ${p.warrenBirthEvery}s · next roll in ${Math.ceil(s.birthIn(b))}s`}<em class="d"> any two grown gnomes in the village will do</em></span>`;
        html += `<b>Larder</b><span>${kids} children and ${folk.length - kids - infants} grown eat ${eat.toFixed(1)} food from the granary a dawn<em class="d"> nobody needs to throw food in this yard</em></span>`;
      }
      if (b.kind === 'granary') {
        const bin = (ks: readonly FoodKind[]) => ks.filter((k) => s.pantry[k] >= 1).map((k) => `<span style="color:${FOODS[k].colour}">${s.pantry[k] | 0}</span> ${FOODS[k].one}`).join(' · ');
        const raw = bin(RAW_KINDS), cooked = bin(DISHES);
        html += `<b>Stock</b><span>${[raw || 'empty', cooked].filter(Boolean).join(' — ')}<em class="d"> the basket takes one kind at a time (F)</em></span>`;
      }
      if (b.kind === 'barracks') {
        const ammo = b.ammo ?? 0, cap = s.towerCap(b);
        html += `<b>Arrows</b><span>${ammo ? `${ammo} / ${cap}` : `<em class="warn">OUT OF ARROWS</em> · 0 / ${cap}`} · range ${s.towerRange(b)} px<div class="bar ammo ${ammo / cap <= 0.25 ? 'low' : ''}"><i style="width:${Math.round(100 * ammo / cap)}%"></i></div></span>`;
      }
      html += `<b>Next</b><span>${b.kind === 'warren' ? 'one size — dig another' : b.level < MAX_LEVEL ? `Lv${b.level + 1}: ${LEVEL_PERKS[b.kind][b.level + 1]} <em>· ${cost} wood with the hammer</em>` : 'max level'}</span></div>`;
      if (b.kind === 'gnomehouse') html += `<p class="d">A gnome couple raises children here; grown gnomes potter about it and fight whatever comes.</p>`;
      if (hasInterior(b.kind)) {
        const onStep = s.doorAt() === b;
        html += `<p class="d">${onStep ? '<b>Walk up into the door</b> to go inside.' : 'To go inside, stand on the doorstep and walk up into the door.'}</p>`;
      }
      if (b.kind === 'barracks') {
        const why = s.restockProblem(b);
        html += `<p>The tower shoots raiders inside the ring while the chest has arrows.</p><button class="btn small ${why ? '' : 'ok'} restock" ${why ? 'disabled' : ''} title="${why ? esc(why) : ''}">RESTOCK ${TOWER.restockArrows} ARROWS · ${TOWER.restockWood} WOOD</button>${why ? `<span class="d"> ${esc(why)}</span>` : ''}`;
        html += `<p>Equip soldiers with bows in their cards. SET WALL POST, then click a connected battlement. Stairs are required.</p><button class="btn small craft-arrows">FLETCH 10 ARROWS · 2 WOOD</button> <button class="btn small ok open-armory" title="The chest inside: armor and tower arrows">ARMOR CHEST</button><p class="d">Forges leather now, iron at Lv2, steel at Lv3. Scrap iron drops where a raider falls — walk over it.</p>`;
      }
      if ((b.kind === 'gnomehouse' || b.kind === 'warren') && !b.ruined) html += `<p class="d">A gear chest: stow loot here for your soldiers to FETCH. <button class="btn small ok open-armory">OPEN CHEST</button></p>`;
      if (b.kind === 'barracks' || b.kind === 'gnomehouse' || b.kind === 'warren') {
        const why = s.demolishProblem(b), refund = s.demolishRefund(b), arming = this.confirmDemolish === b;
        html += `<p class="d"><button class="btn small ${arming ? 'danger' : ''} demolish" ${why ? 'disabled' : ''} title="${why ? esc(why) : 'Take it down'}">${arming ? `REALLY TAKE IT DOWN? · ${refund} WOOD BACK` : `DEMOLISH · ${refund} WOOD BACK`}</button>${why ? ` ${esc(why)}` : arming ? ' <em class="warn">tenants move out, anyone inside steps out</em>' : b.ruined ? ' rubble is worth nothing' : ''}</p>`;
      }
      if(b.kind==='granary'||b.kind==='woodyard')html += '<button class="btn small recover-kit">RECOVER BASIC KIT</button><p class="d">Free missing tools and basic weapons. Make room in your pack first.</p>';
      if (force || html !== this.lastInspector) {
        this.inspector.innerHTML = html; this.lastInspector = html;
        this.inspector.querySelector('.recover-kit')?.addEventListener('click',()=>s.recoverBasicKit());
        this.inspector.querySelector('.close')?.addEventListener('click', () => s.selectBuilding(null));
        this.inspector.querySelector('.craft-arrows')?.addEventListener('click', () => s.craftArrows());
        this.inspector.querySelector('.restock')?.addEventListener('click', () => { s.restockTower(b); this.renderInspector(true); });
        this.inspector.querySelector('.stock-hearth')?.addEventListener('click', () => { s.stockHearth(b); this.renderInspector(true); });
        this.inspector.querySelector('.open-armory')?.addEventListener('click', () => { s.openArmory(s.player, b); });
        this.inspector.querySelector('.demolish')?.addEventListener('click', () => {
          if (this.confirmDemolish !== b) { this.confirmDemolish = b; this.renderInspector(true); return; }
          this.confirmDemolish = null; if (s.demolish(b)) s.selectBuilding(null); else this.renderInspector(true);
        });
        // a ruin does nothing: every control but CLOSE waits for the hammer
        if (b.ruined) this.inspector.querySelectorAll<HTMLButtonElement>('button:not(.close):not(.demolish):not(.recover-kit)').forEach((el) => { el.disabled = true; });
      }
      return;
    }
    if (!m || m.dead) {
      const html = `${head}<p class="empty">Click anything: a villager, a building, a plant, a tree, a wall, or something lying on the ground.<br>Children are the point: feed them well in the yard, keep them safe, and <b>encourage</b> them — how they're raised is who they become.</p>`;
      if (force || this.lastInspector !== html) { this.inspector.innerHTML = html; this.lastInspector = html; }
      return;
    }
    const c = charOf(m);
    const roleKey = m instanceof Villager ? m.role : m instanceof Player ? 'player' : 'raider';
    const roleText = m instanceof Villager ? ROLE_LABEL[m.role] : m instanceof Player ? 'Village head (you)' : ENEMY_LABEL[(m as Raider).kind] ?? 'Raider';
    const look = lookFor(m);
    const portrait = look ? `<img class="art portrait" src="${charImg(look)}" alt="">` : spr(c.key, c.frame, 48);
    let html = `${head}<div class="head">${portrait}<div><div class="name">${m instanceof Villager ? esc(m.name) : m instanceof Player ? 'You' : (m as Raider).name}</div><span class="badge ${roleKey}">${roleText}</span></div><button class="btn small close">x</button></div>`;
    const hpPct = Math.max(0, m.hp / m.maxHp * 100);
    html += `<div class="rows">`;
    html += `<b>Health</b><div class="bar hp ${hpPct < 40 ? 'low' : ''}"><i style="width:${hpPct}%"></i><span class="bar-txt">${Math.max(0, m.hp | 0)} / ${m.maxHp}</span></div>`;
    if (m instanceof Villager) {
      const stage = m.role === 'infant' ? ` <em>· infant, leaves the nursery in ${Math.max(0, p.infantDays - m.age).toFixed(1)} days</em>`
        : m.role === 'kid' ? ` <em>· child, comes of age in ${Math.max(0, s.adultAge - m.age).toFixed(1)} days by the cottage</em>`
        : m.elder ? ` <em>· elder</em>` : ` <em>· grows old at ${Math.round(s.elderAge)}</em>`;
      html += `<b>Age</b><span>${m.age.toFixed(1)} days${stage}</span>`;
      html += `<b>Home</b><span>${s.bedsTaken(m.home)} of ${s.beds(m.home)} beds</span>`;
      if (m.role === 'soldier') html += `<b>Rank</b><span>${esc(m.unitName)} ${rankPips(m.tier)} <small>${Math.floor(m.xp)}${m.tier < UNIT.maxTier ? ` / ${UNIT.xp[m.tier + 1]}` : ''} xp${s.promoteEarned(m) ? ' · <b>ready to promote</b> at the armory' : ''}</small></span>`;
      html += `<b>Fed</b><span>${m.role === 'infant' ? (m.hungerDays ? `<em class="warn">hungry for ${m.hungerDays} days — nobody at home was fed; ${p.kidStarveDays} days starve an infant</em>` : 'nursed — a fed grown-up at home feeds the nursery') : m.role === 'kid' ? (m.ateDay >= s.day ? `ate today from a pile by the cottage` : m.hungerDays ? `<em class="warn">hungry for ${m.hungerDays} days — throw food in the yard (BASKET)</em>` : 'not yet today') : m.hungerDays === 0 ? 'yes' : `<em class="warn">hungry for ${m.hungerDays} days</em>`}</span>`;
    }
    if (m instanceof Player) html += `<b>Belly</b><span>${!p.hunger ? 'hunger is off' : m.hunger <= 0 ? `<em class="warn">empty — starving, ${p.starveHpPerDay} HP a day and no mending</em>` : `${m.hunger.toFixed(1)} / ${p.hungerMax} · about ${(m.hunger / Math.max(1e-6, p.hungerPerDay)).toFixed(1)} days · T eats a meal`}</span>`;
    if(m instanceof Player)html += `<b>Pack</b><span>${m.pack.slots.length-m.pack.emptySlots} / ${m.pack.slots.length} slots used</span>`;
    if (m.load) html += `<b>Carrying</b><span>${m.load.n} ${m.load.kind}</span>`;
    if (m instanceof Boar) {
      html += `<b>Temper</b><span>${m.provoked ? '<em class="warn">provoked — it charges whoever struck it</em>' : 'calm — leave it be and it leaves you be'}${m.lurking ? ' · hidden in the long grass' : ''}</span>`;
      html += `<b>Sounder</b><span>${m.sounder.members.filter((b) => !b.dead).length} boar${m.sounder.members.length === 1 ? '' : 's'} at ${m.sounder.home.tx}, ${m.sounder.home.ty}${m.young ? ' · young, grown in ' + Math.max(0, BOAR.youngDays - m.age) + ' days' : ''}</span>`;
      html += `<b>Meat</b><span>${m.meat} when hunted · gnomes carry it to the granary · ${FOODS.meat.blurb}</span>`;
    }
    html += `<b>Doing</b><span>${esc(m.task || '—')}${m instanceof Villager && m.carriedBy ? ` <em class="warn">— kill the ${esc(m.carriedBy.name.toLowerCase())} to free them</em>` : ''}</span></div>`;
    if (m instanceof Villager && m.role === 'kid') {
      const o = m.outlook(s), need = Villager.drillNeeded(s);
      const stars = m.starsNow();
      const line = !m.calling ? 'no place was open when they were born — they stay a child until one is'
        : `learning at home · ${m.trained.toFixed(1)}/${need} fed days to be skilled`;
      const list = s.careToday(m).map((c) => `<li class="${c.ok ? 'ok' : ''}">${c.ok ? '✓' : '✗'} ${c.label}${!c.ok && c.note ? ` <small>· ${esc(c.note)}</small>` : ''}</li>`).join('');
      const why = s.encourageProblem(m);
      html += `<div class="upbring"><div class="cap">UPBRINGING</div>
        <div class="stars">${'★'.repeat(stars)}<span class="dim">${'☆'.repeat(5 - stars)}</span> <small>${stars === 5 ? 'gifted' : stars >= 3 ? 'well raised' : stars >= 2 ? 'getting by' : m.careDays ? 'neglected' : 'a fresh start'}</small></div>
        <div class="lean ${o.role === 'soldier' ? 'm' : 'c'}">${o.role ? `will be ${o.skilled ? 'a skilled' : 'a plain'} ${o.role.toUpperCase()} at age ${s.adultAge.toFixed(1)}` : 'no place open for them yet'}</div><div class="d">${line}</div>
        <ul class="care">${list}</ul>
        <button class="btn small ok encourage" ${why ? 'disabled' : ''}>ENCOURAGE${why ? ` · ${esc(why)}` : ''}</button></div>`;
      const d = s.dietReport(m);
      html += `<div class="upbring diet"><div class="cap">DIET</div>
        ${d.kinds.filter((k) => k.n > 0 || !isDish(k.kind)).map((k) => `<div class="lbl"><span>${FOODS[k.kind].name}</span><span>${k.n % 1 ? k.n.toFixed(1) : k.n} · ${FOODS[k.kind].stat === 'care' ? 'care' : `+${Math.round(DIET_CAP[FOODS[k.kind].stat as keyof typeof DIET_CAP] * (FOODS[k.kind].power ?? 1) * p.dietMul * k.share * 100)}% ${DIET_STAT_NAME[FOODS[k.kind].stat]}`}</span></div><div class="bar diet"><i style="width:${Math.round(k.share * 100)}%;background:${FOODS[k.kind].colour}"></i></div>`).join('')}
        <div class="d">${d.bonuses ? `growing up: ${d.bonuses}` : `nothing eaten from the yard yet — ${p.dietFull} of one food for its full bonus`}</div></div>`;
    } else if (m instanceof Villager) {
      const d = s.dietReport(m);
      html += `<div class="upbring"><div class="cap">RAISED</div><div class="stars">${'★'.repeat(m.stars)}<span class="dim">${'☆'.repeat(5 - m.stars)}</span> <small>${m.skilled ? 'skilled' : 'plain'}${m.trait ? ` · ${TRAITS[m.trait].name} — ${TRAITS[m.trait].blurb}` : ''}</small></div>${d.bonuses ? `<div class="d">fed on ${d.kinds.filter((k) => k.n > 0).sort((a, b) => b.n - a.n).slice(0, 2).map((k) => FOODS[k.kind].name.toLowerCase()).join(' and ')}: ${d.bonuses}</div>` : ''}</div>`;
    }
    if (m instanceof Player || (m instanceof Villager && m.role === 'soldier')) {
      const st = armorStats(m.armor);
      const pips = ARMOR_SLOTS.map((slot) => `<span class="pip t${m.armor[slot]}" title="${ARMOR[slot].tiers[m.armor[slot]].name}">${ARMOR[slot].name[0]}${m.armor[slot] ? '·'.repeat(m.armor[slot]) : ''}</span>`).join('');
      html += `<div class="raise"><div class="cap">ARMOR</div><div class="pips">${pips}</div><div class="d">${st.hp ? `+${st.hp} HP · ` : ''}${Math.round((1 - st.dmgMul) * 100)}% less damage · ${Math.round(st.block * 100)}% block${st.speedMul > 1 ? ` · +${Math.round((st.speedMul - 1) * 100)}% speed` : ''}</div><button class="btn small open-armory">ARMORY</button></div>`;
    }
    if (m instanceof Villager && m.pouch) {
      const held = m.pouch.slots.filter(Boolean).length;
      html += `<div class="raise"><div class="cap">POUCH</div><div class="d">${held ? esc(m.pouch.slots.filter(Boolean).map((slot) => slotName(slot!)).join(` · `)) : 'empty'} · ${held}/${m.pouch.slots.length} slots</div><button class="btn small open-pouch">OPEN POUCH</button></div>`;
    }
    if (m instanceof Villager && m.role === 'soldier') html += `<div class="raise"><div class="cap">EQUIPMENT & ORDERS</div><div class="seg"><button class="btn small ${m.weapon === 'sword' ? 'on' : ''}" data-weapon="sword">SWORD</button><button class="btn small ${m.weapon === 'bow' ? 'on' : ''}" data-weapon="bow">BOW</button><button class="btn small ${m.weapon === 'pike' ? 'on' : ''}" data-weapon="pike" title="Thrusts along a line out to ${Math.round(p.pikeReach / 16 * 10) / 10} tiles, striking everything on it; murderous against a charge, useless at arm's length — a pikeman gives ground to keep its point between it and the enemy">PIKE</button></div><p>Carries a ${WEAPONS.melee.tiers[m.weapons.melee].name.toLowerCase()} and a ${WEAPONS.bow.tiers[m.weapons.bow].name.toLowerCase()} — forge better in the ARMORY. Arrows in shared quiver: ${s.arrows}. ${m.post ? `Post: ${m.post.tx}, ${m.post.ty}.` : m.order?.kind === 'hold' ? `Holding at ${m.order.tx}, ${m.order.ty} (wand).` : m.order?.kind === 'attack' ? `Hunting ${(m.order.target as Raider).name ?? 'a raider'} (wand).` : m.order?.kind === 'follow' ? 'Following you (wand).' : 'Patrolling on the ground.'}</p><button class="btn small post-soldier">${s.posting === m ? 'CANCEL PLACEMENT' : 'SET WALL POST'}</button><button class="btn small recall-soldier">RETURN TO PATROL</button></div>`;
    if (html !== this.lastInspector) {
      this.inspector.innerHTML = html;
      this.lastInspector = html;
      this.inspector.querySelector('.close')?.addEventListener('click', () => s.select(null));
      this.inspector.querySelector('.encourage')?.addEventListener('click', () => { if (m instanceof Villager) s.encourage(m); this.renderInspector(true); });
      this.inspector.querySelector('.open-armory')?.addEventListener('click', () => { s.openArmory(m); });
      this.inspector.querySelector('.open-pouch')?.addEventListener('click', () => { if (m instanceof Villager) s.openPouch(m); });
      this.inspector.querySelectorAll<HTMLElement>('[data-weapon]').forEach(el => el.addEventListener('click', () => { if (m instanceof Villager) s.equipSoldier(m, el.dataset.weapon as 'bow' | 'sword' | 'pike'); this.renderInspector(true); }));
      this.inspector.querySelector('.post-soldier')?.addEventListener('click', () => { if (m instanceof Villager) s.posting = s.posting === m ? null : m; this.renderInspector(true); });
      this.inspector.querySelector('.recall-soldier')?.addEventListener('click', () => { if (m instanceof Villager) { m.post = null; m.order = null; m.clearGoal(); s.posting = null; } this.renderInspector(true); });
    }
  }

  private renderRoster(): void {
    const s = this.scene;
    const vs = s.villagers();
    const groups: [string, string, Villager[]][] = [
      ['Infants', 'kid', vs.filter((v) => v.role === 'infant').sort((a, b) => b.age - a.age)],
      ['Children', 'kid', vs.filter((v) => v.role === 'kid').sort((a, b) => b.age - a.age)],
      ['Gnomes', 'gnome', vs.filter((v) => v.isAdult && !v.regiment)], // their calling shows on the row (the army is listed by banner)
    ];
    let html = '';
    // the army: one row a banner — strength, shape, stance — rather than a row a gnome
    if (s.regiments.length) {
      const picked = new Set(s.pickedRegiments()), n = s.regiments.reduce((a, r) => a + r.members.length, 0);
      html += `<div class="grp soldier">Regiments <b>${n}</b><span class="grp-note">click: pick · F1-F4 order menus · 1-8 pick a group</span></div>`;
      for (const r of [...s.regiments].sort((a, b) => a.group - b.group || a.id - b.id)) {
        const pct = Math.round(r.members.length / Math.max(1, r.peak) * 100);
        const st = (k: string, label: string) => `<button class="btn tiny${r.stance === k ? ' on' : ''}" data-act="${k}">${label}</button>`;
        html += `<div class="reg-row${picked.has(r) ? ' sel' : ''}" data-reg="${r.id}"><i class="swatch" style="background:${r.colour}"></i><span class="n">${GROUP_NAME[r.group]} · Banner ${r.id}</span><span class="a">${r.members.length}/${r.peak}</span>`
          + `<button class="btn tiny" data-act="shape" title="cycle the formation">${SHAPE_NAME[r.shape].toUpperCase()}</button>${st('follow', 'FOLLOW')}${st('hold', 'HOLD')}${st('advance', 'ADVANCE')}`
          + this.bannerRank(r)
          + `<div class="bar hp ${pct < 40 ? 'low' : ''}"><i style="width:${pct}%"></i></div></div>`;
      }
    }
    for (const [label, cls, list] of groups) {
      if (!list.length) continue;
      html += `<div class="grp ${cls}">${label} <b>${list.length}</b>${cls === 'kid' ? '<span class="grp-note">trade · care stars</span>' : ''}</div>`;
      // a big village lists the first forty of each group, and says how many more there are
      for (const v of list.slice(0, 40)) {
        const c = CHAR[v.role];
        let bar = '';
        if (v.role === 'kid') {
          const o = v.outlook(s);
          const icon = o.role === 'soldier' ? spr('dungeon', DUNGEON.sword, 16) : o.role === 'woodcutter' ? spr('town', TOWN.iconAxe, 16) : o.role === 'farmer' ? spr('town', TOWN.iconHoe, 16) : '?';
          bar = `<span class="outlook ${o.role === 'soldier' ? 'm' : 'c'}">${icon}${v.apprenticeAt(s) ? ` ${v.trained.toFixed(1)}/${Villager.drillNeeded(s)}` : ''} <span class="rstars">${'★'.repeat(v.starsNow())}</span></span>`;
        } else {
          const pct = Math.max(0, v.hp / v.maxHp * 100);
          bar = `<div class="bar hp ${pct < 40 ? 'low' : ''}"><i style="width:${pct}%"></i></div>`;
        }
        const lk = lookFor(v);
        html += `<div class="row ${s.selected === v ? 'sel' : ''}" data-id="${v.id}">${lk ? `<img class="art row-portrait" src="${charImg(lk)}" alt="">` : spr(c.key, c.frame, 24)}<span class="n">${esc(v.name)}</span><span class="a">${v.role === 'soldier' ? `${esc(v.unitName)} · ` : ''}${v.age.toFixed(1)}d${v.elder ? ' · old' : ''}</span>${bar}</div>`;
      }
      if (list.length > 40) html += `<div class="grp-more">… and ${list.length - 40} more</div>`;
    }
    if (!vs.length) html = '<p class="empty">Nobody lives here yet.</p>';
    // health changes every tick in a fight: patch the bars in place rather than rebuilding the list
    const structure = html.replace(/width:[\d.]+%/g, 'width:%').replace(/ low"/g, '"');
    const list = this.roster.querySelector('.list')!;
    if (structure !== this.lastRoster) { list.innerHTML = html; this.lastRoster = structure; return; }
    const byId = new Map(vs.map((v) => [String(v.id), v]));
    for (const row of list.querySelectorAll<HTMLElement>('.row[data-id]')) {
      const v = byId.get(row.dataset.id!);
      const bar = row.querySelector<HTMLElement>('.bar.hp');
      if (!v || !bar) continue;
      const pct = Math.max(0, v.hp / v.maxHp * 100);
      const fill = bar.firstElementChild as HTMLElement;
      const w = `${pct}%`;
      if (fill.style.width !== w) fill.style.width = w;
      bar.classList.toggle('low', pct < 40);
    }
  }

  private renderFeed(): void {
    const evs = this.scene.journal;
    while (this.feedSeen < evs.length) {
      const ev = evs[this.feedSeen++];
      const ic = EVENT_ICON[ev.kind];
      this.feed.prepend(h(`<div class="ev ${ev.kind}">${spr(ic.key, ic.frame, 24)}<span><small>day ${ev.day}</small> ${esc(ev.text)}</span></div>`));
      if (ev.toast) this.toast(ev.text, ev.kind);
    }
    while (this.feed.children.length > 200) this.feed.lastElementChild!.remove();
  }

  /**
   * Toasts are capped and deduplicated. The feed has always trimmed itself to six; this stack never
   * did, so a burst — the same dawn warning at 16x speed, a raid's worth of deaths — could grow a
   * column tall enough to bury the screen. Nothing is lost by dropping one: every toast is already
   * in the journal beside it.
   */
  private static readonly MAX_TOASTS = 2;
  private toastTimers = new Map<HTMLElement, number>();

  toast(text: string, kind: EventKind): void {
    // the same line again counts up in place rather than stacking a second copy
    const same = Array.from(this.toasts.children).find((el) => (el as HTMLElement).dataset.toast === text) as HTMLElement | undefined;
    if (same) {
      const n = Number(same.dataset.n ?? '1') + 1;
      same.dataset.n = String(n);
      same.textContent = `${text} \u00d7${n}`;
      this.holdToast(same);
      return;
    }
    const el = h(`<div class="toast ${kind === 'raid' || kind === 'death' ? 'raid' : ''}">${esc(text)}</div>`);
    el.dataset.toast = text;
    this.toasts.append(el);
    while (this.toasts.children.length > UI.MAX_TOASTS) this.dropToast(this.toasts.firstElementChild as HTMLElement);
    this.holdToast(el);
  }
  /** Start (or restart) a toast's life, rewinding the CSS fade so a repeat reads as fresh. */
  private holdToast(el: HTMLElement): void {
    const prev = this.toastTimers.get(el);
    if (prev) clearTimeout(prev);
    el.style.animation = 'none';
    void el.offsetWidth; // reflow, or the fade never replays
    el.style.animation = '';
    this.toastTimers.set(el, window.setTimeout(() => this.dropToast(el), 3300));
  }
  private dropToast(el: HTMLElement | null): void {
    if (!el) return;
    const t = this.toastTimers.get(el);
    if (t) clearTimeout(t);
    this.toastTimers.delete(el);
    el.remove();
  }

  /** Reset transient DOM state after a scene reset. */
  clear(): void {
    this.minimap.invalidate();
    this.feed.innerHTML = '';
    for (const el of Array.from(this.toasts.children)) this.dropToast(el as HTMLElement);
    this.feedSeen = 0;
    this.lastTop = this.lastRoster = this.lastInspector = '';
    this.renderInspector(true);
  }

  // ---- tooltip ---------------------------------------------------------------

  /** What's under the pointer, in a card docked under the top bar — never beside the cursor, so it can't cover what you're aiming at. */
  tooltip(html: string | null, _x = 0, _y = 0): void {
    if (!html) { this.tooltipEl.hidden = true; return; }
    this.tooltipEl.hidden = false;
    this.tooltipEl.style.top = `${this.top.offsetTop + this.top.offsetHeight + 8}px`; // the top bar wraps on narrow screens
    if (this.tooltipEl.innerHTML !== html) this.tooltipEl.innerHTML = html;
  }

  // ---- armory ----------------------------------------------------------------

  private armoryEl: HTMLElement | null = null;
  private lastArmory = "";
  /** The ARMORY: pick a wearer, forge the next tier per slot, dye the tabard, pick a helmet and plume. */
  /** A banner row's rank: its average tier, how many are ready, PROMOTE READY and the branch its Pikemen/Bowmen/Footmen take. */
  private bannerRank(r: Regiment): string {
    const s = this.scene, ready = r.members.filter((v) => s.promoteEarned(v));
    const fork = ready.find((v) => v.tier === 2);
    const line = fork?.line ?? null;
    return `<span class="rk" title="average tier">T${r.avgTier.toFixed(1)}${ready.length ? ` · <b>${ready.length} ready</b>` : ''}</span>`
      + (fork && line ? `<button class="btn tiny" data-act="branch" title="the branch its tier-2 soldiers take: ${esc(PERK_TEXT[`${line}-${r.branch}`])}">→ ${UNIT_NAMES[line][r.branch].toUpperCase()}</button>` : '')
      + (ready.length ? `<button class="btn tiny ok" data-act="promote" title="promote everyone ready, cheapest first, while the wood and scrap last">PROMOTE READY</button>` : '');
  }

  /** The armory's RANK row for a soldier: name and pips, experience to the next tier, PROMOTE or the fork's two branches. */
  private rankRow(v: Villager): string {
    const s = this.scene, next = v.tier + 1;
    if (next > UNIT.maxTier) return `<div class="rankrow"><div class="aname">${esc(v.unitName)} ${rankPips(v.tier)}</div><div class="d">Elite: the top of the ladder · ${Math.floor(v.xp)} experience</div></div>`;
    const need = UNIT.xp[next], pct = Math.min(100, Math.round(v.xp / need * 100)), c = s.promoteCost(next);
    const price = `${c.wood} wood${c.scrap ? ` + ${c.scrap} scrap` : ''}`;
    const button = (branch?: UnitBranch) => {
      const why = s.promoteProblem(v, branch), label = branch ? unitName(3, v.line ?? v.weapon, branch).toUpperCase() : `PROMOTE TO ${unitName(next, v.line ?? v.weapon, v.branch).toUpperCase()}`;
      const perk = branch ? `<small>${esc(PERK_TEXT[`${v.line ?? v.weapon}-${branch}`])}</small>` : '';
      return `<button class="btn small ${why ? '' : 'ok'} promote" data-promote="${branch ?? ''}" ${why ? `disabled title="${esc(why)}"` : ''}>${label} · ${price}${perk}</button>`;
    };
    const why = s.promoteProblem(v, next === 3 ? 'a' : undefined);
    return `<div class="rankrow"><div class="aname">${esc(v.unitName)} ${rankPips(v.tier)}</div>
      <div class="acur">${Math.floor(v.xp)} / ${need} experience<div class="bar xp"><i style="width:${pct}%"></i></div></div>
      <div class="promotes">${next === 3 ? button('a') + button('b') : button()}</div>
      <div class="d">${why ? `<em class="warn">${esc(why)}</em>` : next === 2 ? `takes the ${v.weapon} line for good` : `+${Math.round(UNIT.hpPerTier * 100)}% HP · +${Math.round(UNIT.dmgPerTier * 100)}% damage`}</div></div>`;
  }

  renderArmory(): void {
    if(this.inventory.dragging)return;
    const s = this.scene;
    const who = s.armoryFor;
    if (!who) { this.armoryEl?.remove(); this.armoryEl = null; return; }
    const wearers = s.wearers();
    const name = (m: Mover) => (m instanceof Player ? 'You' : (m as Villager).name);
    const look = lookFor(who)!;
    const st = armorStats(who.armor);
    const list = wearers.map((m) => `<button class="wearer ${m === who ? 'on' : ''}" data-wearer="${m.id}"><img class="art" src="${charImg(lookFor(m)!)}" alt=""><span>${esc(name(m))}</span></button>`).join('');
    // a soldier's FETCH buttons: what lies in the chests for each slot, best first; the soldier walks over and takes it
    const fetchList: { b: Building; gear: Gear }[] = [];
    const withFetch = (html: string, slot: EquipmentSlot | 'kit') => {
      if (!(who instanceof Villager)) return html;
      const opts = s.fetchOptions(who, slot).slice(0, 3);
      if (!opts.length) return html;
      const many = s.gearChests().length > 1;
      const btns = opts.map((o) => {
        const i = fetchList.push(o) - 1, why = s.fetchProblem(who, o.b, o.gear);
        return `<button class="btn small ${why ? '' : 'ok'} fetch" data-fetch="${i}" ${why ? `disabled title="${esc(why)}"` : ''}>FETCH ${esc(slotName(o.gear).toUpperCase())}${many ? ` · ${esc(BUILDINGS[o.b.kind].name.toLowerCase())}` : ''}</button>`;
      }).join('');
      return html.replace(/<\/div>\s*$/, `<div class="fetches">${btns}</div></div>`);
    };
    const kitRow = who instanceof Villager && who.pouch
      ? withFetch(`<div class="aslot"><div class="aname">Bandages</div><div class="acur">${who.pouch.slots.filter((g) => g?.kind === 'kit').length} in the pouch <small>used below ${Math.round(BANDAGE.selfAt * 100)}% HP</small></div></div>`, 'kit') : '';
    const slots = ARMOR_SLOTS.map((slot) => {
      const tier = who.armor[slot], cur = ARMOR[slot].tiers[tier], next = ARMOR[slot].tiers[tier + 1];
      const why = s.craftProblem(who, slot);
      const stat = (t: typeof cur) => [t.hp ? `+${t.hp} HP` : '', t.reduce ? `-${Math.round(t.reduce * 100)}% damage` : '', t.speed ? `+${Math.round(t.speed * 100)}% speed` : '', t.block ? `${Math.round(t.block * 100)}% block` : ''].filter(Boolean).join(' · ') || '—';
      return `<div class="aslot"><div class="aname">${ARMOR[slot].name} <span class="tier">${pips(tier)}</span></div>
        <div class="acur">${cur.name} <small>${stat(cur)}</small></div>
        ${next ? `<button class="btn small ${why ? '' : 'ok'} forge" data-slot="${slot}" ${why ? 'disabled' : ''}>${s.isReforge(tier + 1) ? 'REFORGE TO' : 'FORGE'} ${next.name.toUpperCase()} · ${s.forgeCost(next).wood} wood${s.forgeCost(next).scrap ? ` + ${s.forgeCost(next).scrap} scrap` : ''}</button><div class="d">${why ? `<em class="warn">${esc(why)}</em>` : stat(next)}</div>` : '<div class="d">the best there is</div>'}</div>`;
    }).map((html, i) => withFetch(html, ARMOR_SLOTS[i])).join('') + kitRow;
    // weapons: the crude club and hunting bow everyone starts with, forged up like armor
    const weapons = WEAPON_SLOTS.map((slot) => {
      const tier = who.weapons[slot], cur = WEAPONS[slot].tiers[tier], next = WEAPONS[slot].tiers[tier + 1];
      const why = s.weaponProblem(who, slot);
      return `<div class="aslot"><div class="aname">${WEAPONS[slot].name} <span class="tier">${pips(tier)}</span></div>
        <div class="acur">${cur?.name ?? 'Empty'} <small>×${cur?.mul ?? 0} damage</small></div>
        ${next ? `<button class="btn small ${why ? '' : 'ok'} forge" data-weapon-slot="${slot}" ${why ? 'disabled' : ''}>${s.isReforge(tier + 1) ? 'REFORGE TO' : 'FORGE'} ${next.name.toUpperCase()} · ${s.forgeCost(next).wood} wood${s.forgeCost(next).scrap ? ` + ${s.forgeCost(next).scrap} scrap` : ''}</button><div class="d">${why ? `<em class="warn">${esc(why)}</em>` : `×${next.mul} damage`}</div>` : '<div class="d">the best there is</div>'}</div>`;
    }).map((html, i) => withFetch(html, WEAPON_SLOTS[i])).join('');
    const dyes = DYES.map((c, i) => `<button class="swatch ${who.dye === i ? 'on' : ''}" data-dye="${i}" style="background:${c}" title="${DYE_NAMES[i]}"></button>`).join('');
    const helms = ['CAP', 'KETTLE', 'GREAT HELM'].map((n, i) => `<button class="btn small ${who.helmetStyle === i ? 'on' : ''}" data-helm="${i}">${n}</button>`).join('');
    const plumes = PLUMES.map((c, i) => `<button class="swatch ${who.plume === i ? 'on' : ''}" data-plume="${i}" style="background:${c === 'none' ? 'transparent' : c}" title="${c === 'none' ? 'no plume' : 'plume'}">${c === 'none' ? '×' : ''}</button>`).join('');
    // the chest this armory was opened from: its tower arrows, restocked here for wood
    const chest = s.armoryChest;
    let chestHtml = '';
    if (chest && chest.kind !== 'barracks') chestHtml = `<div class="chest"><div class="aname">GEAR CHEST <span class="tier">${esc(BUILDINGS[chest.kind].name)}</span></div><div class="d">Stow loot here; soldiers FETCH from any chest in the village.</div></div>`;
    else if (chest) {
      const ammo = chest.ammo ?? 0, cap = s.towerCap(chest), why = s.restockProblem(chest);
      chestHtml = `<div class="chest ${ammo ? (ammo / cap <= 0.25 ? 'low' : '') : 'dry'}">
        <div class="aname">TOWER CHEST <span class="tier">Barracks Lv${chest.level} · range ${s.towerRange(chest)} px</span></div>
        <div class="acur">${ammo ? `${ammo} / ${cap} arrows` : `<em class="warn">OUT OF ARROWS</em> · 0 / ${cap}`}<div class="bar ammo ${ammo / cap <= 0.25 ? 'low' : ''}"><i style="width:${Math.round(100 * ammo / cap)}%"></i></div></div>
        <button class="btn small ${why ? '' : 'ok'} restock" ${why ? 'disabled' : ''}>RESTOCK ${TOWER.restockArrows} ARROWS · ${TOWER.restockWood} WOOD</button>
        <button class="btn small fletch" ${s.wood < 2 ? 'disabled' : ''}>SHARED QUIVER +10 · 2 WOOD</button>
        <div class="d">${why ? `<em class="warn">${esc(why)}</em>` : 'The tower fires these at raiders inside its ring; soldiers and your bow draw from the shared quiver instead.'}</div>
      </div>`;
    }
    const html = `<div class="armory panel">
      <div class="ph"><h2>Armory</h2><span class="cap">${s.wood | 0} wood · ${s.scrap} scrap · barracks Lv${s.world.barracksLevel}</span><button class="btn small close">CLOSE</button></div>
      <div class="inventory-host" data-with-stash="1"></div>
      ${chestHtml}
      <div class="acols">
        <div class="wearers">${list}</div>
        <div class="afit">
          <div class="portrait-big"><img class="art" src="${charImg(look)}" alt=""><div class="d">${esc(name(who))} · ${WEAPONS.melee.tiers[who.weapons.melee]?.name.toLowerCase() ?? 'no melee weapon'} ×${weaponMul(who.weapons, 'melee')} · ${WEAPONS.bow.tiers[who.weapons.bow]?.name.toLowerCase() ?? 'no bow'} ×${weaponMul(who.weapons, 'bow')} · ${st.hp ? `+${st.hp} HP · ` : ''}${Math.round((1 - st.dmgMul) * 100)}% less damage · ${Math.round(st.block * 100)}% block</div></div>
          ${who instanceof Villager && who.role === 'soldier' ? `<div class="cap">RANK</div>${this.rankRow(who)}` : ''}
          <div class="cap">WEAPONS</div>
          <div class="aslots">${weapons}</div>
          <div class="cap">ARMOR</div>
          <div class="aslots">${slots}</div>
          <div class="custom"><div class="cap">TABARD DYE</div><div class="swatches">${dyes}</div>
            <div class="cap">HELMET</div><div class="seg">${helms}</div>
            <div class="cap">PLUME</div><div class="swatches">${plumes}</div></div>
        </div>
      </div>
      <p class="sub small">Everyone starts with a wooden club and a hunting bow that hit for half. The forge makes bronze and leather for wood; iron and steel are looted from camps, ruins and the fallen (a found iron piece reforges to steel at a Lv3 barracks), and the tower shield, warhammer and crossbow are only ever found. Stow loot in a chest, then send each soldier to FETCH what they should wear. A bow needs both hands, so archers can't carry a shield.</p>
    </div>`;
    if (!this.armoryEl) this.armoryEl = h('<div class="screen armory-screen"></div>');
    if(!this.armoryEl.isConnected){this.screens.append(this.armoryEl);this.lastArmory='';}
    if(this.lastArmory===html)return;
    this.lastArmory=html;this.armoryEl.innerHTML=html;
    this.inventory.mount(this.armoryEl.querySelector('.inventory-host')!);
    const el = this.armoryEl;
    el.querySelector('.close')!.addEventListener('click', () => s.openArmory(null));
    el.querySelector('.chest .restock')?.addEventListener('click', () => { if (chest) s.restockTower(chest); this.renderArmory(); });
    el.querySelector('.chest .fletch')?.addEventListener('click', () => { s.craftArrows(); this.renderArmory(); });
    el.querySelectorAll<HTMLElement>('[data-wearer]').forEach((b) => b.addEventListener('click', () => { const m = wearers.find((w) => w.id === Number(b.dataset.wearer)); if (m) s.openArmory(m); }));
    el.querySelectorAll<HTMLElement>('[data-slot]').forEach((b) => b.addEventListener('click', () => { s.craftArmor(who, b.dataset.slot as ArmorSlot); this.renderArmory(); }));
    el.querySelectorAll<HTMLElement>('[data-promote]').forEach((b) => b.addEventListener('click', () => { if (who instanceof Villager) s.promote(who, (b.dataset.promote || undefined) as UnitBranch | undefined); this.renderArmory(); }));
    el.querySelectorAll<HTMLElement>('[data-fetch]').forEach((b) => b.addEventListener('click', () => { const o = fetchList[Number(b.dataset.fetch)]; if (o && who instanceof Villager) s.orderFetch(who, o.b, o.gear); this.renderArmory(); }));
    el.querySelectorAll<HTMLElement>('[data-weapon-slot]').forEach((b) => b.addEventListener('click', () => { s.craftWeapon(who, b.dataset.weaponSlot as WeaponSlot); this.renderArmory(); }));
    el.querySelectorAll<HTMLElement>('[data-dye]').forEach((b) => b.addEventListener('click', () => { s.setDye(who, Number(b.dataset.dye)); this.renderArmory(); }));
    el.querySelectorAll<HTMLElement>('[data-helm]').forEach((b) => b.addEventListener('click', () => { s.setHelmetStyle(who, Number(b.dataset.helm)); this.renderArmory(); }));
    el.querySelectorAll<HTMLElement>('[data-plume]').forEach((b) => b.addEventListener('click', () => { s.setPlume(who, Number(b.dataset.plume)); this.renderArmory(); }));
  }

  private lastOrders = '';
  /**
   * The command bar (F1-F4, or the wand in hand): a card a formation group — its number, name, banners,
   * strength and what it is doing, lit when picked — and the open menu's items with their F-keys.
   */
  private renderOrders(): void {
    const s = this.scene, el = this.hotbar.querySelector<HTMLElement>('.orders')!, open = s.commandOpen();
    if (el.hidden === open) el.hidden = !open;
    if (!open) { this.lastOrders = ''; return; }
    const picked = new Set(s.pickedRegiments()), menu = s.commandMenu();
    let cards = '';
    for (let g = 1; g <= GROUPS; g++) {
      const regs = s.regiments.filter((r) => r.group === g);
      if (!regs.length) continue;
      const n = regs.reduce((a, r) => a + r.members.length, 0), sel = regs.some((r) => picked.has(r)), r0 = regs[0];
      const out = s.foragers(regs).length; // a party out in the wild is invisible in the line: say so on the card
      cards += `<button class="fcard${sel ? ' sel' : ''}" data-group="${g}" title="${g}: pick · Shift+${g}: add · Alt+${g}: move the picked banners here"><b>${g}</b><span class="gname">${GROUP_NAME[g]}</span>${regs.map((r) => `<i class="sw" style="background:${r.colour}"></i>`).join('')}<span class="gn">${n}</span><small>${SHAPE_NAME[r0.shape]} · ${r0.stance}${r0.holdFire ? ' · hold fire' : ''} · T${(regs.reduce((a, r) => a + r.avgTier * r.members.length, 0) / Math.max(1, n)).toFixed(1)}${out ? ` · ${out} foraging` : ''}</small></button>`;
    }
    const items = menu === 0
      ? ORDER_MENUS.map((m, i) => `<button class="oitem" data-menu="${i + 1}"><kbd>F${i + 1}</kbd>${m.name}</button>`).join('') + `<span class="ohint">${picked.size ? '' : 'all formations · '}1-8 pick · 0 all · right-drag places</span>`
      : `<span class="otitle">${ORDER_MENUS[menu - 1].name}</span>` + ORDER_MENUS[menu - 1].items.map((it, i) => `<button class="oitem" data-item="${i + 1}"><kbd>F${i + 1}</kbd>${it}</button>`).join('') + '<button class="oitem back" data-back="1"><kbd>Esc</kbd>back</button>';
    const html = `<div class="fcards">${cards}</div><div class="omenu">${items}</div>`;
    if (html === this.lastOrders) return;
    this.lastOrders = html;
    el.innerHTML = html;
  }

  private pouchEl: HTMLElement | null = null;
  private lastPouch = '';
  /** A gnome’s little backpack, open beside your own pack: drag food and gear either way. */
  renderPouch(): void {
    const s = this.scene, v = s.pouchOf;
    if (!v || !v.pouch || v.dead) { this.pouchEl?.remove(); this.pouchEl = null; this.lastPouch = ''; return; }
    if (this.inventory.dragging) return;
    const held = v.pouch.slots.filter(Boolean).length;
    const key = `${v.id}|${held}/${v.pouch.slots.length}|${v.task}|${v.followingPlayer}`;
    const html = `<div class="cooking panel">
      <div class="ph"><img class="art" src="${charImg(lookFor(v)!)}" alt=""><h2>${esc(v.name)}’s pouch</h2><span class="cap">${held}/${v.pouch.slots.length} full · ${esc(v.task)}</span><button class="btn small close">CLOSE</button></div>
      <div class="inventory-host" data-with-pouch="1"></div>
      <p class="sub small">Gnomes forage into these while they trail you — only what grows within ${GNOME_PACK.leash} tiles of where you stand. Drag anything either way. Send them back to work (H) and whatever food is still in the pouch goes to the granary on their next trip; anything else stays with them.</p>
    </div>`;
    if (!this.pouchEl) this.pouchEl = h('<div class="screen cooking-screen"></div>');
    if (!this.pouchEl.isConnected) { this.screens.append(this.pouchEl); this.lastPouch = ''; } // showScreen() empties #screens without asking
    if (key === this.lastPouch) return; // rebuilding under the pointer would swallow every click and drag
    this.lastPouch = key;
    this.pouchEl.innerHTML = html;
    this.inventory.mount(this.pouchEl.querySelector('.inventory-host')!);
    this.pouchEl.querySelector('.close')!.addEventListener('click', () => s.openPouch(null));
  }

  private cookEl: HTMLElement | null = null;
  private lastCooking = '';
  /**
   * THE GREAT POT, as a card standing at the pot rather than a page over the world: it tracks the
   * cauldron's own screen position every frame, so you can see what you are cooking over, and whoever
   * is stood round it waiting for a bowl.
   */
  renderCooking(): void {
    const s = this.scene, b = s.cookingAt;
    if (!b) { this.cookEl?.remove(); this.cookEl = null; this.lastCooking = ''; return; }
    const stock = s.potStock(b), made = s.potServings(b), packed = s.packMeals();
    const inPot = (Object.entries(stock) as [FoodKind, number][]).filter(([, n]) => n >= 0.05)
      .map(([k, n]) => `<span style="color:${FOODS[k].colour}">${foodCount(Math.round(n * 10) / 10, k)}</span>`).join(' · ');
    const why = s.servingProblem();
    // one row per recipe, the ones you can cook first: what it is, what it does (to a gnome, and to you),
    // every ingredient with how many you have of how many it needs, where a missing one comes from, and COOK
    const rows = [...DISHES].sort((x, y) => Number(!!s.cookProblem(RECIPES[x])) - Number(!!s.cookProblem(RECIPES[y]))).map((d) => {
      const r = RECIPES[d], no = s.cookProblem(r), m = MOODS[d];
      const chips = (Object.entries(r.needs) as [FoodKind, number][]).map(([k, n]) => {
        const have = s.ingredientHave(k, b), ok = have.total >= n;
        const from = [have.pot >= 0.05 ? `${Math.floor(have.pot)} in the pot` : '', have.pack >= 1 ? `${Math.floor(have.pack)} in your pack` : '', have.granary >= 1 ? `${Math.floor(have.granary)} in the granary` : ''].filter(Boolean).join(', ') || 'none anywhere';
        return `<span class="ing ${ok ? 'got' : 'short'}" title="${esc(`${FOODS[k].name}: ${from}${ok ? '' : ' — ' + s.ingredientSource(k)}`)}">`
          + `${this.tilePortrait({ key: 'flora', frame: FLORA.pile[k][2] })}<i>${Math.floor(have.total)}/${n}</i> ${esc(FOODS[k].one)}</span>`;
      }).join('');
      const short = (Object.entries(r.needs) as [FoodKind, number][]).filter(([k, n]) => s.ingredientHave(k, b).total < n)
        .map(([k]) => `<div class="potsrc">${esc(FOODS[k].name)}: ${esc(s.ingredientSource(k))}</div>`).join('');
      const stat = FOODS[d].stat as keyof typeof DIET_STAT_NAME;
      return `<div class="potrow ${no ? '' : 'can'}">
        ${this.tilePortrait({ key: 'flora', frame: FLORA.pile[d][2] })}
        <div class="potmain">
          <b style="color:${m.colour}">${esc(FOODS[d].name)}</b> <span class="potmakes">makes ${r.makes}</span>
          <div class="poteff"><span>Gnomes: <b style="color:${m.colour}">${esc(m.name)}</b> — ${esc(m.blurb)}</span><span>You: +${r.heal} HP, +${Math.round(r.buffAdd * 100)}% ${esc(DIET_STAT_NAME[stat])} for ${r.buffSecs}s</span></div>
          <div class="potneeds">${chips}</div>${short}
        </div>
        <button class="btn cook ${no ? '' : 'ok'}" data-cook="${d}" ${no ? 'disabled' : ''}>COOK</button>
      </div>`;
    }).join('');
    const mine = DISHES.filter((d) => (packed[d] ?? 0) >= 1).map((d) => `<span style="color:${FOODS[d].colour}">${esc(FOODS[d].name)} ×${Math.floor(packed[d] ?? 0)}</span>`).join(' · ');
    const standing = DISHES.filter((d) => (made[d] ?? 0) >= 1).map((d) => `${esc(FOODS[d].name)} ×${Math.floor(made[d] ?? 0)}`).join(' · ');
    const edible = DISHES.filter((d) => (made[d] ?? 0) >= 1 || (packed[d] ?? 0) >= 1);
    const bowls = edible.map((d) => `<button class="btn small eat" data-eat="${d}" title="Eat one yourself: +${RECIPES[d].heal} HP and a while of ${DIET_STAT_NAME[FOODS[d].stat as keyof typeof DIET_STAT_NAME]}">EAT ${esc(FOODS[d].one)}</button>`).join('');
    const servings = DISHES.reduce((n, d) => n + Math.floor(made[d] ?? 0) + Math.floor(packed[d] ?? 0), 0);
    const key = `${b.tx},${b.ty}|${b.ruined}|${FOOD_KINDS.map((k) => Math.round(s.ingredientHave(k as FoodKind, b).total * 10)).join(',')}|${DISHES.map((d) => `${Math.floor(made[d] ?? 0)}/${Math.floor(packed[d] ?? 0)}`).join(',')}|${why ?? ''}`;
    const html = `<div class="pothead"><b>The Great Pot</b><span>ingredients come from your pack and the granary${inPot ? ` · thrown in: ${inPot}` : ''}</span><button class="btn small close">×</button></div>
      <div class="potrows">${rows}</div>
      <div class="potfoot">
        <div class="potmine">${mine ? `In your pack: ${mine} — <b>hold R</b> to lob one into a crowd, <b>T</b> to eat` : 'Cooked meals go into your pack.'}${standing ? ` · standing in the pot: ${standing}` : ''}</div>
        ${servings ? `<div class="potact"><button class="btn serve ${why ? '' : 'ok'}" ${why ? 'disabled' : ''}>DISH OUT TO GNOMES</button>${bowls}</div>
          <div class="potwhy">${esc(why ?? `a bowl each to every grown gnome within ${SERVE_RANGE} tiles of the pot`)}</div>` : ''}
      </div>`;
    if (!this.cookEl) this.cookEl = h('<div class="potcard panel"></div>');
    if (!this.cookEl.isConnected) { this.overlay.append(this.cookEl); this.lastCooking = ''; }
    const el = this.cookEl;
    // rebuilt only when something in it changed: replacing the DOM every frame would swallow every click
    if (key !== this.lastCooking) {
      this.lastCooking = key;
      el.innerHTML = html;
      el.querySelector('.close')!.addEventListener('click', () => s.openCooking(null));
      el.querySelectorAll<HTMLElement>('[data-cook]').forEach((btn) => btn.addEventListener('click', () => { s.cook(RECIPES[btn.dataset.cook as DishKind]); this.renderCooking(); }));
      el.querySelectorAll<HTMLElement>('[data-eat]').forEach((btn) => btn.addEventListener('click', () => { s.eatFromPot(btn.dataset.eat as DishKind); this.renderCooking(); }));
      el.querySelector('.serve')?.addEventListener('click', () => { s.serveGnomes(); this.renderCooking(); });
    }
    this.placeAtWorld(el, (b.tx + BUILDINGS[b.kind].w / 2) * TILE, (b.ty + BUILDINGS[b.kind].h / 2) * TILE);
  }

  /**
   * Pin a card to a spot in the world: the camera moves, the card goes with it. Client pixels and
   * `position: fixed`, so nothing depends on where the overlay happens to sit.
   */
  private placeAtWorld(el: HTMLElement, wx: number, wy: number): void {
    // through the 3D camera: the spot sits a little above the ground, at the pot's rim
    const at = this.scene.view?.projectWorld(wx, wy, 1.6);
    if (!at) return;
    const { x, y } = at;
    const w = el.offsetWidth || 240, h2 = el.offsetHeight || 120;
    // kept on screen, and above the pot where it does not cover what it is about
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2));
    // the top bar owns the first stretch of the screen; the card never climbs under it
    const ceiling = (this.top.getBoundingClientRect().bottom || 8) + 6;
    const top = Math.max(ceiling, Math.min(window.innerHeight - h2 - 8, y - h2 - 10));
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }
  // ---- screens ---------------------------------------------------------------

  showScreen(kind: 'title' | 'pause' | 'over' | 'won' | null): void {
    this.inventory.cancel();
    const s = this.scene;
    this.screens.innerHTML = '';
    if (!kind) return;
    let card: HTMLElement;
    const cast = `<div class="cast">${spr('dungeon', DUNGEON.hero, 48)}${spr('farm', FARM.farmerHat, 48)}${spr('dungeon', DUNGEON.villager, 48)}${spr('dungeon', DUNGEON.knight, 48)}${spr('dungeon', DUNGEON.orc, 48, 'flip')}</div>`;
    if (kind === 'title') {
      card = h(`<div class="title-wrap">
        <div class="card panel">
          <h1>VILLAGE</h1>
          ${cast}
          <p class="sub">The last village here is gone. Farm the dark soil, raise a family behind thin walls, and teach the children to hold a blade, because something walks out of the trees every few nights.<br>
          Survive ${p.bossDay} days of raids and <b>beat the Warlord</b>.</p>
          <div class="controls">
            <kbd>hold LMB</kbd><span>move the mouse to wind your weapon · release to strike · hold RMB to guard</span>
            <kbd>W A S D</kbd><span>move · Shift to run · Space to dodge · Q to kick</span><kbd>hold R</kbd><span>aim a meal, let go to lob it</span>
            <kbd>G</kbd><span>throw the largest supply stack</span>
            <kbd>T</kbd><span>eat one meal. Your pack is eaten before the granary, and raw food before cooked so a dish's warmth is never spent on a routine meal. Meat and honey fill twice as much per unit, a cooked dish three or four times.</span>
            <kbd>click / C</kbd><span>walk over and use the tool you hold there</span>
            <kbd>X</kbd><span>check a villager</span><kbd>1-9 · Tab</kbd><span>pick a tool</span>
            <kbd>mouse</kbd><span>look around · middle mouse to look while winding or guarding</span><kbd>Alt</kbd><span>release the cursor for menus</span>
            <kbd>wheel · Z</kbd><span>camera distance</span><kbd>Esc</kbd><span>menu</span><kbd>- / =</kbd><span>game speed</span>
          </div>
          <div class="row"><label class="sub">seed <input class="seed" value="${s.seed}"></label></div>
          <div class="row"><button class="btn ok start">NEW VILLAGE</button><button class="btn howto">HOW TO PLAY</button></div>
          <p class="credit">art: <a href="https://kenney.nl" target="_blank" rel="noopener">Kenney</a> (CC0)</p>
        </div>
        <div class="card panel legacy"></div>
      </div>`);
      const input = card.querySelector<HTMLInputElement>('.seed')!;
      const start = () => s.startGame(Number(input.value) || undefined);
      card.querySelector('.start')!.addEventListener('click', start);
      card.querySelector('.howto')!.addEventListener('click', () => this.showHelp());
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); e.stopPropagation(); });
      this.renderLegacy(card.querySelector('.legacy')!);
    } else if (kind === 'pause') {
      card = h(`<div class="card panel">
        <h1>PAUSED</h1>
        <p class="sub">Day ${s.day} of ${p.bossDay} · ${s.villagers().length} villagers · ${s.villagers().filter((v) => v.role === 'soldier').length} soldiers</p>
        ${this.loadoutLine()}
        <div class="row"><button class="btn ok resume">RESUME</button><button class="btn howto">HOW TO PLAY</button><button class="btn restart">RESTART</button><button class="btn title">TITLE</button></div>
        <div class="row"><span class="sub">speed</span>${[1, 4, 16].map((v) => `<button class="btn small ${s.speed === v ? 'on' : ''}" data-speed="${v}">${v}x</button>`).join('')}<button class="btn small sound">${s.muted ? 'SOUND: OFF' : 'SOUND: ON'}</button></div>
        <div class="row"><button class="btn small open-controls">CONTROLS (K)</button><button class="btn small open-journal">JOURNAL (J)</button><button class="btn small open-army">ARMY (L)</button></div>
      </div>`);
      card.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => b.addEventListener('click', () => { s.speed = Number(b.dataset.speed); card.querySelectorAll('[data-speed]').forEach((o) => o.classList.toggle('on', o === b)); }));
      card.querySelector('.sound')!.addEventListener('click', (e) => { s.toggleMute(); (e.target as HTMLElement).textContent = s.muted ? 'SOUND: OFF' : 'SOUND: ON'; });
      const openThen = (name: 'controls' | 'journal' | 'army') => () => { s.togglePause(); this.togglePanel(name, true); };
      card.querySelector('.open-controls')!.addEventListener('click', openThen('controls'));
      card.querySelector('.open-journal')!.addEventListener('click', openThen('journal'));
      card.querySelector('.open-army')!.addEventListener('click', openThen('army'));
      card.querySelector('.resume')!.addEventListener('click', () => s.togglePause());
      card.querySelector('.howto')!.addEventListener('click', () => this.showHelp());
      card.querySelector('.restart')!.addEventListener('click', () => s.startGame(s.seed));
      card.querySelector('.title')!.addEventListener('click', () => s.goTitle());
    } else {
      const won = kind === 'won';
      const st = s.stats;
      const r = s.result?.renown;
      const meta = s.meta.state;
      card = h(`<div class="card panel ${won ? 'tan' : 'grey'}">
        <h1 class="${won ? 'gold' : 'blood'}">${won ? 'THE WARLORD FALLS' : 'THE VILLAGE FELL'}</h1>
        <p>${won ? `Your village stands. Day ${s.day}, and the raiders are broken.` : `You died on day ${s.day}.`}</p>
        <div class="stats">
          <div><b>${s.day}</b>days</div><div><b>${st.peakPop}</b>peak population</div>
          <div><b>${st.childrenRaised}</b>children raised</div><div><b>${st.childrenRaised ? (st.starsTotal / st.childrenRaised).toFixed(1) : '—'}</b>avg stars</div><div><b>${st.raidersKilled}</b>raiders slain</div>${st.bossesSlain ? `<div><b>${st.bossesSlain}</b>bosses slain</div>` : ''}${st.boarsHunted ? `<div><b>${st.boarsHunted}</b>boars hunted</div>` : ''}${st.buildingsLost ? `<div><b>${st.buildingsLost}</b>buildings lost</div>` : ''}
        </div>
        ${r ? `<div class="renown"><div class="lbl">RENOWN EARNED</div>
          <div class="parts"><span>days ${r.days}</span><span>kills ${r.kills}</span><span>children ${r.children}</span>${r.bosses ? `<span>bosses ${r.bosses}</span>` : ''}${r.victory ? `<span>victory ${r.victory}</span>` : ''}</div>
          <div class="total">+${r.total} <small>· ${meta.renown} banked</small></div>
          ${won && meta.wins === 1 ? '<div class="unlock">First victory: a third boon slot is yours.</div>' : ''}
        </div>` : ''}
        <div class="row"><button class="btn ok restart">NEW RUN</button><button class="btn title">LEGACY</button></div>
      </div>`);
      card.querySelector('.restart')!.addEventListener('click', () => s.startGame());
      card.querySelector('.title')!.addEventListener('click', () => s.goTitle());
    }
    const screen = h(`<div class="screen ${kind}"></div>`);
    screen.append(card);
    this.screens.append(screen);
  }

  /** The legend / how-to-play overlay. Pauses the game while open. */
  showHelp(): void {
    const s = this.scene;
    if (this.screens.querySelector('.help-screen')) return;
    const wasPlaying = s.screen === 'playing';
    if (wasPlaying) s.togglePause();
    const who = (key: string, frame: number, cls: string, name: string, does: string) =>
      `<div class="who">${spr(key, frame, 32)}<div><span class="badge ${cls}">${name}</span><div class="d">${does}</div></div></div>`;
    // a building drawn from its own art at each level, with what the level gives and how it looks
    const building = (kind: BuildingKind, name: string, does: string) => {
      const levels = [1, 2, 3].map((lv) => `<div class="lv"><img class="art" src="${frameDataUrl(s, BUILDING_TEXTURE[kind], lv - 1)}" alt=""><b>Lv${lv}</b><span>${LEVEL_PERKS[kind][lv]}</span><i>${LEVEL_LOOKS[kind][lv]}</i></div>`).join('');
      return `<div class="bld"><div class="bld-head"><span class="badge farmer">${name}</span><span class="d">${does}</span></div><div class="lvls">${levels}</div></div>`;
    };
    const card = h(`<div class="card panel help-card">
      <div class="ph">${spr('town', TOWN.sign, 24)}<h2>How to play</h2><button class="btn small close">CLOSE</button></div>
      <div class="help-cols">
        <section>
          <h3>THE GOAL</h3>
          <p><b>Wilderness:</b> the world is 240 × 160 tiles. Most seeds have dense forest regions; others are open meadow and scattered groves. Follow the woodland trails.</p>
          <p><b>Fortify:</b> scroll the tool belt for WALL, GATE and STAIRS. Each takes one ground tile and wood for construction. Join walls into a perimeter and connect stairs. Right click or X on stairs to climb or descend. Walk along connected wall tops. Gates admit allies automatically; X opens them to enemies too. Hammer repairs damage. Brutes breach walls fast; Wreckers hammer them slowly — a closed perimeter is how your buildings stay standing.</p>
          <p><b>Archers:</b> select a soldier, equip BOW, then SET WALL POST and click a battlement top connected to stairs. RETURN TO PATROL recalls them. Player bow is key 9. Everyone uses the shared quiver; craft 10 arrows for 2 wood at the barracks or its supply button. Arrows hit bodies and cover; wall archers shoot over ramparts.</p>
          <p><b>Towers:</b> every barracks shoots raiders inside its ring (shown while placing it or when it's selected) from its own chest of arrows — the bar over its roof is the stock. When it runs dry the bar flashes red and the tower falls silent: restock 10 arrows for 2 wood at the chest inside (which also holds the armor), or from the barracks card.</p>
          <p><b>Come inside:</b> walk up into a house, barracks or tavern door. Right-click the floor to walk; click a bed, the hearth or a rack to go and use it. The barracks rack makes quiver arrows and its chest restocks the tower and forges armor; tavern meals heal more with upgrades. Walk through the bottom doorway or choose EXIT. Raids continue outside.</p>
          <p>Survive <b>${p.bossDay} days</b>. Raiders first come on day ${p.firstRaidDay} and every ${p.raidEvery} days after, in big bands — and every wave brings more of them and new kinds. On day ${p.bossDay} the <b>Warlord</b> comes — beat him to win. If <b>you</b> die, the run ends (you keep the renown).</p>
          <h3>THE TRICK</h3>
          <p>You can't recruit anyone. <b>Every adult was a child you raised.</b> See RAISING CHILDREN below.</p>
          <h3>EACH DAY</h3>
          <p>Every villager eats 1 food. Wild plants regrow after they are picked, and the ox caravans bring grain up the south road. Couples with a free crib have children. Everyone heals overnight.</p>
          <p><b>Nothing counts until it's carried in.</b> Chopped wood and picked food ride on the arms of whoever took them: woodcutters haul ${HAUL.villager.wood} wood to the woodyard per trip, farmers ${HAUL.villager.food} food to the granary. Your pack holds mixed supplies and equipment. Food unloads at the granary; wood and scrap unload at the woodyard. Full stores leave the remainder in your pack. Drag pack items to move, equip or drop them. Recover missing basic tools and weapons from either supply building. Long walks are wasted work — keep the woodyard by the grove and the granary by the field.</p>
        </section>
        <section>
          <h3>WHO'S WHO</h3>
          ${who('dungeon', DUNGEON.hero, 'player', 'You', 'Equip a tool, then left click: axe chops, sword fights, hammer upgrades. Your hands need no tool — right click picks, climbs, works a gate and opens the pot.')}
          ${who('farm', FARM.farmerHat, 'farmer', 'Forager', 'Picks what grows wild and brings it to the granary.')}
          ${who('dungeon', DUNGEON.man, 'woodcutter', 'Woodcutter', 'Fells trees for wood — old growth first, thinning a grove from its edge so the core keeps spreading. Leaves the last ' + TREE_RESERVE + ' standing. Helps in the field when the woodyard is full.')}
          ${who('dungeon', DUNGEON.villager, 'kid', 'Child', 'Born into the cottage nursery; walks out into the yard and learns the trade the village had a place for, eating only what you toss in.')}
          ${who('dungeon', DUNGEON.knight, 'soldier', 'Warrior', 'Falls in under a banner by weapon (pikes, bows, swords) and fights where the banner is sent.')}
          <p><b>The shaman wand.</b> Pick it from the belt and the fighters answer like an army: <b>left click</b> a soldier (shift adds), or <b>drag a box</b> over several; then <b>right click</b> open ground to send them there — they <b>hold</b> that spot, fighting whatever comes within ${ORDER.leash} tiles and drifting back after — a <b>raider</b> to hunt it down (they hold where it fell), or a <b>wall top</b> to man the battlements (it hands them a bow). <b>F</b> makes the squad follow you; F again and they hold where they stand. With nobody picked, an order goes to every soldier. RETURN TO PATROL on a fighter's card cancels their order.</p>
          ${who('dungeon', DUNGEON.orc, 'raider', 'Hollow raider', 'Hooded, red-eyed, never speaks. Walks at the nearest person and hits them.')}
          ${who('dungeon', 123, 'raider', 'Rat swarm', 'At least 10 arrive together and spread round the granary, gnawing its stores. Foragers halves how fast they gnaw. Scare them with equipped weapons or stop them with gates.')}
          ${who('dungeon', DUNGEON.imp, 'raider', 'Snatcher', 'Grabs a child and runs for the map edge. Kill it to free them; kids indoors are safe.')}
          ${who('dungeon', DUNGEON.orc, 'raider', 'Butcher', '180 base HP, 24 damage, twice the speed, reach and attack rate, half the knockback. The axe winds up and swings even when you dodge. Devastates fortifications.')}
          ${who('dungeon', DUNGEON.orc, 'raider', 'Wrecker', 'Ignores people and goes for the nearest cottage or warren it can reach, then any other building. A Lv1 cottage falls in about 12 seconds. Walled off, it batters the wall — slowly. A ruin keeps its footprint but does nothing until the hammer rebuilds it.')}
          ${who('dungeon', DUNGEON.wizard, 'raider', 'Bone shaman', 'Keeps its distance and casts bolts. Close in on it.')}
          ${who('farm', FARM.cow, 'woodcutter', 'Boar', `Not a raider: grazes in sounders out in the woods. Leave it be and it leaves you be; strike one and the whole sounder charges whoever did it (${p.boarDmg} a blow) until it calms. Soldiers and towers ignore calm boars but fight provoked ones, and the wand can send soldiers hunting. A sounder of two or more breeds. Drops ${BOAR.meat} meat where it falls — gnomes carry it to the granary, or pick it up by hand. In long grass it is <b>hidden</b>: you'll see the grass stir as it moves, or tread on it and find out. Mow the grass along your lanes.`)}
          <h3>HEARTHS</h3>
          <p>Cottages, warrens and the barracks each keep a <b>woodpile</b> that burns one night's wood at dawn (a cottage ${HEARTH_WOOD.gnomehouse[1]}, the barracks ${HEARTH_WOOD.barracks[1]}; more at higher levels). <b>Woodcutters</b> fill the piles before they haul to the woodyard, so every armful spent on warmth is one the woodyard doesn't get — and the card can stock a night from the village pile in a pinch. A building with an empty pile spends the day <b>cold</b>: no births, no drill, no soldier regen, no meals, and its children lose care. Your own axe only clears ground (${p.playerTreeYield} wood a tree); the real wood comes in on woodcutters' backs.</p>
          <h3>BUILDINGS</h3>
          <p>Every building can be wrecked. The <b>HAMMER</b> mends a damaged one (1 wood = 60 HP) and raises a ruin again for half its build cost; on a sound building, 3 hits upgrade it for wood. Every building has three levels — the brass studs on the sign by the door count them, and each level changes the building itself:</p>
          ${building('gnomehouse', 'Toadstool Cottage · ' + COST.gnomehouse + ' wood', 'Comes with a gnome couple — one for the wild, one for the axe — who raise a family (cribs, a hearth, food to spare). Gnome children are raised in the cottage yard, eating only what you throw within a few tiles of it (BASKET), and take a calling like anyone else, out of the same places your buildings keep in work. A gnome <b>forager</b> fills a granary place: the wild is their field, so they walk to the nearest ripe plant, pick one unit and carry it in. A gnome <b>woodcutter</b> fells trees like any other. A gnome <b>warrior</b> fills a barracks place and fights — though it is a little person, with a little person’s HP, whatever armor you forge it. Workers still run home from raiders. <b>You start without the craft:</b> one cottage stands out in the woods, ringed by mushrooms, with a glade of warm motes drifting over it. Walk into the glade and keep going until the cottage itself comes into sight — the family is yours, and they teach you to raise more.')}
          ${building('warren', 'Gnome Warren · ' + COST.warren + ' wood', WARREN_TITLE() + '. It comes in one size — dig another for more.')}
          ${building('barracks', 'Barracks · ' + COST.barracks + ' wood', 'Keeps ' + p.soldierCap + ' warriors under arms (' + SOLDIER_CAP_PER_LEVEL + ' more at each level above the first) and drills the children promised a sword; its tower shoots raiders. Gnome warriors fall in under banners of ' + REGIMENT_SIZE + ' — see Regiments in the roster.')}
          ${building('granary', 'Granary', 'Holds your food and keeps ' + p.farmerCap + ' farmers in work. The crate stack beside it climbs as the store fills.')}
          ${building('woodyard', 'Woodyard', 'Holds your wood and keeps ' + p.woodcutterCap + ' woodcutters in work. The log stack beside the cabin climbs as it fills.')}
          <h3>FOOD & DIET</h3>
          <p><b>Grain, roots and tomatoes</b> are nobody's crop any more: there are no fields. The <b>ox caravans</b> bring them up the south road every few days, and chests hold some.</p>
          <p><b>Foraging.</b> Five wild plants regrow after picking: <b>berry bushes</b> at the forest edge, <b>mushrooms</b> in the shade of old growth, <b>hazels</b> where the trees thin out, <b>wild garlic</b> dotted over the meadow and <b>burdock</b> along the trails (hazelnuts +HP, garlic +work, burdock +speed). Grown <b>gnomes forage for you</b>: one unit at a time, carried to the granary, so a gnome house by the woods is a slow but steady larder. You can also pick by hand: <b>Berry bushes</b> grow at the forest edge and <b>mushrooms</b> in the shade of old growth. Pick them with <b>HANDS</b> (${FOODS.berry.yield} berries, ${FOODS.mushroom.yield} mushrooms); they grow back in ${s.regrowDays('berry')} / ${s.regrowDays('mushroom')} days, and old trees seed new patches now and then. Berries make <b>fierce</b> children (+damage); a mushroom meal is worth a <b>care point</b>. <b>Boar meat</b> is the hunter's food: it does nothing for grown-ups, but children raised on it come of age with twice the damage bonus berries give.</p>
          <p><b>What they eat is who they become.</b> The granary keeps each kind apart. The <b>BASKET</b> takes one kind (F to choose) and what lands in a home's yard is what its children eat. Every unit of a food moves that child toward its bonus — ${p.dietFull} units of one kind for the full ${Math.round(DIET_CAP.hp * p.dietMul * 100)}% HP (wheat), ${Math.round(DIET_CAP.speed * p.dietMul * 100)}% speed (carrots), ${Math.round(DIET_CAP.work * p.dietMul * 100)}% work speed (tomatoes) or ${Math.round(DIET_CAP.dmg * p.dietMul * 100)}% damage (berries) — and a mixed diet gives a little of each. The bonuses <b>lock in at coming of age</b> and last for life; the child's card shows the diet as it builds. Adults eat whatever is in store and it changes nothing.</p>
          <h3>RAISING CHILDREN</h3>
          <p><b>Life.</b> Everyone is born an <b>infant</b> in the house nursery (${p.infantDays} days), walks out a <b>child</b> into the yard until age ${s.adultAge.toFixed(1)}, works as an <b>adult</b> for ${p.adultDays} days, then grows <b>old</b> — slower and grey — and passes away about ${p.elderDays} days later. The sliders (backtick) under <b>lifecycle</b> set every one of these.</p>
          <p><b>Births.</b> Every ${p.birthEvery} seconds a couple in a warm house with a free <b>crib</b> (${p.cribs} in a Lv1 nursery, +1 per level) has a ${Math.round(100 * p.birthChance)}% chance of a child (needs food to spare). A house can raise at most cribs ÷ infantDays children a day, so more houses and bigger nurseries mean more children. The <b>Baby Fever</b> legacy boon adds ${Math.round(100 * p.feverBonus)}% while the larder holds <b>${p.feverDays}+ days of food</b> for everyone — the FOOD tile shows the days, and a FEVER badge glows while it holds. More mouths shrink the surplus, so it only lasts if the fields keep up.</p>
          <p><b>The trades, and what they cost you.</b> <b>Your buildings decide what your village is.</b> Each one keeps a fixed number of people in work — a granary ${p.farmerCap} farmers, a woodyard ${p.woodcutterCap} woodcutters, a barracks ${p.soldierCap} warriors — and that counts per building, so a <b>second barracks</b> makes room for ${p.soldierCap} more. Every newborn is promised the trade with the most places open, and holds that place while it grows, so the village fills out on its own about ${p.farmerCap}:${p.woodcutterCap}:${p.soldierCap} — want an army, build barracks. ${Villager.drillNeeded(s)} fed days at home make a child <b>skilled</b>: faster work, bigger harvests and loads, tougher warriors. A child promised a sword also needs a <b>warm barracks</b> standing to learn it.</p>
          <p><b>No room, no child.</b> When every trade in the village is full, <b>no child is born at all</b> — the village raises nobody it cannot put to work. A house card says so when it happens, and the FARM / WOOD / ARMY tiles at the top show how full each trade is. Build (or lose) a building and the places change with it: a ruined granary closes its farmers' places until the hammer raises it again. The <b>callings</b> sliders (backtick) set all three caps, to trial different village shapes.</p>
          <p><b>Every child can starve.</b> Nobody young eats from the granary. Infants are nursed: they eat only when a fed grown-up lives at home, so an empty larder or an empty house starves the nursery. Children eat only what lies within ${YARD} tiles of the home they live in. ${p.kidStarveDays} hungry days are fatal.</p>
          <p><b>Feeding the yard.</b> Children eat nothing from the granary — only what you throw down for them. Take the <b>BASKET</b>, walk up to the granary to fill it (${STACK.food} food), point anywhere within ${p.tossRange} tiles and throw: ${p.tossSize} food flies there, bounces off walls and trees, rolls and stops wherever it stops. Children eat only what lies <b>within ${YARD} tiles of the home they live in</b> (${p.kidFood} a day each) — a throw that rolls short is wasted until you walk over it, and what lies in a yard is the children's: you will not pick it up by walking past, and no foraging gnome will take it. A child that misses a day stops training; after ${p.kidStarveDays} hungry days they starve. The basket's hint tells you how many children a yard holds and how much food is lying in it.</p>
          <p><b>Care.</b> Each dawn a child earns care for the day before: fed · <b>well fed</b> (ate from the yard that day) · both parents alive · another child at home · a Lv2+ house · your <b>encouragement</b>. Running from raiders, going hungry or losing a parent costs care. It averages into <b>stars</b> (★ to ★★★★★) that are fixed at coming of age and last for life: each star is +6% HP and work speed; five stars make a <b>gifted</b> adult with a trait (Hardy, Quick, Brave, Green Thumb, Tireless); a neglected child grows up frail.</p>
          <p><b>Encourage.</b> Walk up to a child and press X (or click them, or the button on their card): a moment together, once a day, worth a care point and a day of apprenticeship. During a raid it also sends them inside.</p>
          <p><b>Children go to bed at dusk</b> and sleep indoors until dawn, and they <b>run for the nearest door</b> when raiders are near. Snatchers take children caught in the open.</p>
          <p><b>Renown</b> comes from children raised: 20 each, plus 8 per star.</p>
          <h3>WEAPONS</h3>
          <p>Everyone starts with a <b>wooden club</b> and a <b>hunting bow</b> that hit for half damage. At the barracks chest forge a <b>bronze</b> sword or yew bow for wood, then <b>iron</b> and <b>steel</b> for wood plus scrap iron (Lv2 / Lv3 barracks) — steel hits for ×1.3. Each fighter carries their own; forge for your soldiers too.</p>
          <h3>ARMOR</h3>
          <p>You and your soldiers have four armor slots — <b>helmet</b> (HP), <b>chest</b> (less damage taken), <b>legs</b> (speed) and <b>shield</b> (a chance to block melee hits outright; archers can't carry one). Each has three tiers: <b>leather</b> for wood, <b>iron</b> and <b>steel</b> for wood plus <b>scrap iron</b> dropped by slain raiders — walk over it (needs a Lv2 / Lv3 barracks). Open the ARMORY with <kbd>V</kbd>, from the barracks card, or from a soldier's card; dye tabards and pick helmets and plumes there too — what they wear is what you see.</p>
          <h3>SOLDIERS</h3>
          <p><b>Build barracks.</b> Each one standing makes room for ${p.soldierCap} warriors, and children are promised the trade with the most places open — so barracks are how you raise an army, and a village with none raises none. A child promised a sword drills at home and comes of age <b>skilled</b> after ${Villager.drillNeeded(s)} fed days, but only while a <b>warm barracks</b> stands to teach them. Every child's outlook is shown in the inspector and the villagers list — no surprises.</p>
          <h3>FOG & THE OGRE</h3>
          <p>The world is dark until someone sees it. You see 10 tiles, buildings light 8, soldiers 6 and other villagers 4; what you've seen stays on the map, dimmed, but raiders in the dark are invisible until they step into sight — walls with people on them are your eyes. The minimap shows how much you've explored.</p>
          <p>Somewhere 50–85 tiles out in the woods is <b>the Ogre's lair</b>. On day 2 the woodcutters give you a direction. The Ogre is huge — far bigger than any raider — sleeps in his lair by day and prowls the woods around it at night, hunting anyone within ${OGRE.hunt} tiles. He has three telegraphed attacks — a wide swing (${OGRE.swing.dmg}), a ground smash (${OGRE.smash.dmg}, cracks walls and buildings) and a charge (${OGRE.charge.dmg}, batters whatever stops it) — shrugs off knockback and heals a quarter of his ${OGRE.hp} HP each day he sleeps. Once he has your scent he never sleeps again and will follow you home, so don't rouse him until you can finish him: iron mail, a shield, a few archers. Slaying him is worth ${OGRE.scrap} scrap and ${OGRE.renown} renown.</p>
          <h3>GROVES</h3>
          <p>Trees spread onto neighbouring grass — but a lone tree barely does (about 1% a day) while a tree inside a grove seeds fast (up to 11%). A sapling with two or more trees beside it grows in ${SHELTERED_SAPLING_DAYS} days instead of ${SAPLING_DAYS}. So plant trees <b>together</b>, near the woodyard, and let the grove do the work.</p>
          <p>Trees age: after ${OLD_GROWTH_DAYS} days they become <b>old growth</b> — taller, and worth ${p.oldYield} wood instead of ${p.treeYield}. Woodcutters take old growth first and thin a grove from its edge.</p>
          <p>Beyond the village clearing the wilderness is <b>long grass</b>: anyone wading through it — you, your villagers, raiders — crawls at a fraction of their pace. Trails stay short and make fast lanes. A <b>SWORD</b> swing mows every tile in its arc (the spin finisher clears a ring), and mown grass never grows back — so the lanes you cut are yours to keep, and the raiders' too. Things <b>hide</b> in it: a boar in long grass is unseen until it moves (the grass stirs) or someone treads on it.</p>
          <p><b>Thicket</b> is worse: bramble that tears at anyone in it (${p.thicketDps} HP a second) and drags them to ${Math.round(p.thicketSlow * 100)}% pace — raiders and your own villagers alike, though they will walk a long way round rather than through it. It <b>creeps every night</b> over grass, fields and forage, swallowing crops and wild food as it comes, and nothing can be built on it. The <b>AXE</b> clears a tile in one blow and gives you a little wood; the <b>SWORD</b> takes two swings, but it is what you will be holding when you need to cut your way out.</p>
          <p>Groves seed themselves onto grass, never next to buildings. Clear stumps and saplings with the <b>AXE</b>. Buildings can go on grass or stumps — not on trees or other buildings. With a mouse, tools hit the tile you <b>point at</b> when it's next to you, otherwise the tile you face (the gold box). A building goes <b>where you point</b> (within 6 tiles; the pointer marks the door); otherwise straight ahead of you. Anyone standing in the footprint, you included, is stepped out onto the doorstep.</p>
        </section>
        <section>
          <h3>CONTROLS</h3>
          <div class="controls">
            <kbd>W A S D</kbd><span>walk relative to the camera, with weight on starts, stops and changes of direction. Shift runs and spends stamina.</span>
            <kbd>hold LMB</kbd><span>wind your weapon with the mouse: left or right to slash, up for an overhead, down to thrust with a blade. Release to strike. A settled wind-up hits harder. With a bow, hold to draw and release to shoot.</span>
            <kbd>hold RMB · Q</kbd><span>hold a directional guard with the mouse · kick to break an enemy guard</span>
            <kbd>Space</kbd><span>roll: a committed tumble in your movement direction, or forward when still. It goes clean through bodies but not through walls, and you cannot steer or swing until it lands. A raider's blow checks its reach at the moment it strikes, so rolling out of a wind-up beats it.</span>
            <kbd>hold R</kbd><span>meal: a reticle shows the throw's reach and where it will land; let go to lob a cooked meal from your pack there (a left-click throws too, a right-click puts it away). Every gnome, villager — and you — inside the splash eats it: gnomes take its mood (Sporeburst, Emboldened…), you its heal and buff. The wheel, or clicking the R button, picks which meal. Cook meals at the Great Pot.</span>
            <kbd>G</kbd><span>throw the largest wood, food or scrap stack toward the cursor. Drag any pack item onto the world to drop it. Walk away from your dropped items before returning to pick them up.</span>
            <kbd>click / C</kbd><span>use the tool you hold on the clicked tile: you walk into reach first, and the axe keeps chopping until the tree is down. The bottom bar says what the tool will do. With the sword or bow in hand, a click looks the thing over instead.</span>
            <kbd>X</kbd><span>check a villager (opens the inspector)</span>
            <kbd>1-6 · Tab</kbd><span>pick a tool — sword, bow, axe, hammer, basket, wand. The hammer opens the build row.</span>
            <kbd>mouse · MMB</kbd><span>look around; while winding or guarding, hold middle mouse to turn the camera as well</span>
            <kbd>Alt</kbd><span>release the mouse to use menus; click the view to return to combat</span>
            <kbd>wheel · Z</kbd><span>camera distance — the wheel eases in and out, Z steps through presets</span>
            <kbd>Esc</kbd><span>menu (pause, restart, how to play)</span>
            <kbd>- / =</kbd><span>game speed 1x / 4x / 16x</span>
            <kbd>\`</kbd><span>tuning sliders (debug)</span>
          </div>
          <h3>TOP BAR</h3>
          <p><b>DAY</b> of ${p.bossDay} and the hour · <b>WOOD</b> / <b>FOOD</b> stockpiles and their caps (upgrade the woodyard / granary) · <b>VILLAGERS</b> by role · <b>NEXT RAID</b> countdown · <b>BELLY</b> your own hunger · <b>YOUR HP</b>.</p>
        </section>
      </div>
    </div>`);
    const close = () => { screen.remove(); if (wasPlaying && s.screen === 'paused') s.togglePause(); };
    card.querySelector('.close')!.addEventListener('click', close);
    const screen = h('<div class="screen help-screen"></div>');
    screen.addEventListener('click', (e) => { if (e.target === screen) close(); });
    screen.append(card);
    this.screens.append(screen);
  }

  /** Equipped paths as a one-liner (pause screen). */
  private loadoutLine(): string {
    const ids = this.scene.meta.state.loadout;
    if (!ids.length) return '<p class="sub">no boons equipped</p>';
    const names = ids.map((id) => {
      const n = nodeById(id);
      return n ? `${BRANCHES.find((b) => b.id === n.branch)!.name} › ${n.name}` : id;
    });
    return `<p class="sub">${names.join(' · ')}</p>`;
  }

  /** The Legacy panel: renown, record, and the four boon trees. Re-renders itself on click. */
  private renderLegacy(el: HTMLElement): void {
    const meta = this.scene.meta;
    const st = meta.state;

    const card = (n: Node | undefined): string => {
      if (!n) return ''; // a branch with fewer boons (the Larder) leaves its places empty
      const owned = meta.isUnlocked(n.id);
      const equipped = meta.isEquipped(n.id);
      const onPath = meta.isOnEquippedPath(n.id);
      const state = equipped ? 'equipped' : onPath ? 'onpath' : owned ? 'owned' : meta.isBuyable(n.id) ? 'buyable' : 'locked';
      const req = n.requires ? nodeById(n.requires)! : null;
      const action = equipped ? 'unequip' : owned ? (onPath ? 'equip here' : 'equip') : req && !meta.isUnlocked(req.id) ? `needs ${req.name}` : `${n.cost} renown`;
      const tip = `${n.name} — ${n.blurb}${req ? ` (requires ${req.name})` : ''}`;
      return `<div class="node ${state} t${n.tier}" data-id="${n.id}" title="${esc(tip)}">${spr(n.icon.key, n.icon.frame, 24)}<div class="nn">${esc(n.name)}</div><div class="nb">${esc(n.blurb)}</div><div class="na">${esc(action)}</div></div>`;
    };
    const tree = (branch: Branch): string => {
      const ns = nodesOf(branch);
      const at = (tier: number, side?: string) => ns.find((n) => n.tier === tier && (tier === 1 || n.side === side));
      const eq = meta.equippedIn(branch);
      const b = BRANCHES.find((x) => x.id === branch)!;
      return `<div class="branch ${eq ? 'active' : ''}">
        <div class="bh"><span class="bname">${b.name}</span><span class="bblurb">${eq ? `› ${esc(eq.name)}` : b.blurb}</span></div>
        <div class="tier">${card(at(1))}</div>
        <div class="fork"><div class="path">${card(at(2, 'a'))}${card(at(3, 'a'))}</div><div class="path">${card(at(2, 'b'))}${card(at(3, 'b'))}</div></div>
      </div>`;
    };

    el.innerHTML = `<h2>Legacy</h2>
      <div class="legacy-stats"><span><b>${st.renown}</b> renown</span><span><b>${st.runs}</b> runs</span><span><b>${st.wins}</b> wins</span><span>best day <b>${st.bestDay}</b></span></div>
      ${LEGACY_TEST_MODE ? '<p class="testmode">TEST MODE — every path is unlocked and there is a slot per branch. Equip what you want to try.</p>' : ''}
      <h3>paths equipped · ${st.loadout.length}/${meta.slots}</h3>
      <div class="trees">${BRANCHES.map((b) => tree(b.id)).join('')}</div>
      <p class="sub small">Each branch forks. Buy down a path, then equip its deepest node — a whole path takes one slot (${meta.slots} slots${st.wins ? '' : ', a third after your first win'}).</p>`;

    el.querySelectorAll<HTMLElement>('.node').forEach((c) => c.addEventListener('click', () => {
      const id = c.dataset.id!;
      const ok = meta.isUnlocked(id) ? meta.toggleLoadout(id) : meta.unlock(id);
      if (!ok) { c.classList.add('shake'); setTimeout(() => c.classList.remove('shake'), 400); return; }
      this.renderLegacy(el);
    }));
  }
}

export type { GameEvent };
