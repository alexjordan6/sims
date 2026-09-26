import { PackUI } from './pack-ui';
import { slotName, slotKey } from '../pack';
import { gearUrl } from '../gear-art';
import { STACK, type BulkKind } from '../config';
import { getGui } from '@shared/index';
import { Villager, Raider, Player, Mover, type Tool } from '../agents';
import { Boar } from '../wildlife';
import { CHAR, TOWN, FARM, DUNGEON, framePos } from '../atlas';
import { OGRE, BOAR, HAUL, COST, ORDER, GNOME_YARD, p, TOWER, HEARTH_WOOD, WEAPONS, WEAPON_SLOTS, type WeaponSlot, LEGACY_TEST_MODE, LEVEL_PERKS, TRAITS, ARMOR, ARMOR_SLOTS, DYES, DYE_NAMES, PLUMES, type Calling, type ArmorSlot, UPGRADE_COST, PEN_NAME, FOODS, FOOD_KINDS, RAW_KINDS, DISHES, RECIPES, isDish, foodCount, hasInterior, type DishKind, CROP_KINDS, CALLINGS, DISMANTLE, DIET_CAP, DIET_STAT_NAME, type FoodKind, LEVEL_LOOKS, SAPLING_DAYS, SHELTERED_SAPLING_DAYS, TREE_RESERVE, OLD_GROWTH_DAYS } from '../config';
import { BRANCHES, nodeById, nodesOf, type Branch, type Node } from '../meta';
import type { VillageScene, EventKind, GameEvent } from '../main';
import { Minimap } from './minimap';
import { skyAt } from '../night';
import { frameDataUrl, BUILDING_TEXTURE, FLORA } from '../pixelart';
import { charImg, armorStats, weaponMul } from '../characters';
import { lookFor, tileArt } from '../render';
import { BUILDINGS, MAX_LEVEL, hasHearth, hearthCost, WILD_FOOD, type BuildingKind, type TilePos } from '../world';
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
const GNOME_LOOK = { body: 'gnome', skin: 0, hair: 0, hairStyle: 0, outfit: 'gnome', held: 'club', armor: { helmet: 0, chest: 0, legs: 0, shield: 0 }, dye: 0, helmetStyle: 0, plume: 0 } as const;
/** the GNOME HOUSE slot's tooltip once the craft is learned (locked, it says how to learn it) */
const GNOME_TITLE = 'A toadstool cottage: a gnome couple moves in and raises a family like any house. Gnomes take no pen or calling; the grown ones forage wild plants for the granary, one find at a time';

const ENEMY_LABEL: Record<string, string> = { raider: 'Raider', warlord: 'Warlord', rat: 'Rat — eats crops', snatcher: 'Snatcher — steals children', brute: 'Brute — heavy', shaman: 'Shaman — ranged', wrecker: 'Wrecker — tears down buildings', boar: 'Boar — wild game, fights back', troll: 'Troll — prowls the wild', skulk: 'Skulk — creeps from long grass, hunts gnomes' };

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
  private side = document.getElementById('side')!;
  private screens = document.getElementById('screens')!;
  private stage = document.getElementById('stage')!;

  private top!: HTMLElement;
  private hotbar!: HTMLElement;
  private feed!: HTMLElement;
  private toasts!: HTMLElement;
  private inspector!: HTMLElement;
  private roster!: HTMLElement;
  private minimap!: Minimap;
  private exploredEl!: HTMLElement;
  private tooltipEl!: HTMLElement;

  private lastTop = '';
  private lastRoster = '';
  private inspT = 0;
  private lastInspector = '';
  private rosterT = 0;
  private topT = 0;
  private feedSeen = 0;
  /** coarse pointer (phone/tablet) or ?touch=1 for testing */
  readonly touch = document.body.classList.contains('touch');
  private lastSelected: Mover | null = null;
  private lastBuilding: import('../world').Building | null = null;
  /** the building whose DEMOLISH button has been pressed once (the second press does it) */
  private confirmDemolish: import('../world').Building | null = null;

  readonly inventory: PackUI;
  constructor(private scene: VillageScene) { this.inventory = new PackUI(scene); }

  mount(): void {
    const s = this.scene;

    // --- top bar: labelled stat tiles
    const tile = (cls: string, cap: string, inner: string, title = '') => `<div class="stat ${cls}" title="${esc(title)}"><span class="cap">${cap}</span><span class="val">${inner}</span></div>`;
    this.top = h(`<div class="topbar panel">
      ${tile('t-day', 'DAY', `<span class="sun"></span><span class="day"></span><span class="hour"></span>`, 'Survive to day 21 and beat the Warlord')}
      ${tile('t-wood', 'WOOD', `${spr('town', TOWN.iconWood, 24)}<span class="num wood"></span>`, 'Woodcutters bring it in (your own axe only clears ground). Houses cost 20, barracks 30, and every hearth burns wood each night. The woodyard sets the cap')}
      ${tile('t-food', 'FOOD', `${spr('farm', FARM.iconTomato, 24)}<span class="num food"></span>`, 'Each villager eats 1 a day; the small number is how many days the larder would last. Harvest ripe crops. The granary sets the cap')}
      <div class="stat t-scrap" title="Scrap iron — raiders drop it where they fall; walk over it. Forges iron and steel armor at the barracks"><span class="cap">SCRAP</span><span class="val"><span class="scrap-ico"></span><span class="num scrap"></span></span></div>
      <div class="stat t-pop" title="Your villagers by role"><span class="cap">VILLAGERS</span><span class="val pop"></span></div>
      <div class="spacer"></div>
      <div class="stat t-raid" title="Raiders attack every few days; the Warlord comes on day 21"><span class="cap">NEXT RAID</span><span class="val raid"></span></div>
      <div class="stat t-buff" title="The dish you last ate, and how long it keeps working"><span class="cap">MEAL</span><span class="val buff"></span></div>
      <div class="stat t-hunger" title="Your own belly, in food units. It empties as the day passes; empty, you lose HP and stop mending. T eats one meal — out of your pack first, the granary second. Meat and honey fill double, a cooked dish three or four times. Click to eat"><span class="cap">BELLY</span><span class="val"><span class="belly-num"></span><span class="bar belly"><i></i></span></span></div>
      ${tile('t-hp', 'YOUR HP', `<span class="hearts"></span>`, 'You heal overnight — but not on an empty belly. If you die the run ends')}
      <div class="stat t-speed" title="Game speed"><span class="cap">SPEED</span><span class="val speed">
        <button class="btn small" data-speed="1">1x</button><button class="btn small" data-speed="4">4x</button><button class="btn small" data-speed="16">16x</button>
        <button class="btn small pause" title="Menu (E / Esc)">II</button>
      </span></div>
      <button class="btn small summon-gnomes" title="H: gnomes trail you by default — send them off foraging; press again to call the ones within 20 tiles back to your heels">SEND FORAGING</button>
      <button class="btn small help" title="How to play">?</button>
    </div>`);
    this.top.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => b.addEventListener('click', () => (s.speed = Number(b.dataset.speed))));
    this.top.querySelector('.pause')!.addEventListener('click', () => s.togglePause());
    this.top.querySelector('.help')!.addEventListener('click', () => this.showHelp());
    this.top.querySelector('.summon-gnomes')!.addEventListener('click', () => s.summonGnomes());

    // --- tool belt: the equipped tool decides what E does
    const slot = (tool: Tool, key: string, frame: number, label: string, title: string, cost?: number) =>
      `<div class="slot" data-tool="${tool}" title="${esc(title)}">${spr(key, frame, 32)}<span class="lbl">${label}</span>${cost ? `<span class="cost">${cost}${spr('town', TOWN.iconWood, 16)}</span>` : ''}</div>`;
    this.hotbar = h(`<div class="hotbar">
      <div class="slots panel">
        <span class="cap slots-cap">TOOLS <kbd>1-9</kbd></span>
        ${slot('hands', 'farm', FARM.iconHand, 'HANDS', 'Harvest ripe crops; pick berries and mushrooms in the woods')}
        ${slot('hoe', 'town', TOWN.iconHoe, 'HOE', 'Till grass into soil; clears stumps; three hits on soil flatten it back to grass')}
        ${slot('seeds', 'farm', FARM.grassTuft, 'SEEDS', 'Sow the chosen crop on tilled soil (F cycles wheat / carrots / tomatoes), trees on grass. What a child eats decides the adult')}
        ${slot('axe', 'town', TOWN.iconAxe, 'AXE', 'Chop trees for wood (3 hits); clears stumps and saplings')}
        ${slot('sword', 'dungeon', DUNGEON.sword, 'SWORD', 'Swing at raiders in front of you. You start with a club — forge a real blade at the barracks chest')}
        ${slot('house', 'town', TOWN.wallWoodDoor, 'HOUSE', 'A family of 4 lives here and has children', COST.house)}
        ${slot('barracks', 'town', TOWN.wallStoneDoor, 'BARRACKS', 'Drills the drill yard: children in one become soldiers while a warm barracks stands. Its tower shoots arrows at raiders in range; restock the chest inside with wood', COST.barracks)}
        ${slot('hammer', 'town', TOWN.iconHammer, 'HAMMER', 'Upgrade the building in front of you (3 hits)')}
        ${slot('bow', 'dungeon', DUNGEON.sword, 'BOW', 'Fire physical arrows. Shared ammunition is made at the barracks; a better bow is forged at its chest')}
        ${slot('wall', 'town', TOWN.wallStoneDoor, 'WALL', 'Build a connected stone perimeter. 4 wood per segment', 4)}
        ${slot('gate', 'town', TOWN.wallWoodDoor, 'GATE', 'Friendly villagers pass; X toggles opening to everyone', 12)}
        ${slot('stairs', 'town', TOWN.iconHammer, 'STAIRS', 'Connect stairs to your walls. Use hands or X to climb and descend', 10)}
        ${slot('tavern', 'town', TOWN.wallWoodDoor, 'TAVERN', 'A cozy place to eat, rest and gather', COST.tavern)}
        ${slot('pen', 'farm', FARM.grassTuft, 'PEN', 'Paint a training pen on open ground: children leave the nursery for it and train there until they come of age. F cycles farm / wood / drill; painting the same kind again erases')}
        ${slot('gnomehouse', 'town', TOWN.wallWoodDoor, 'GNOME HOUSE', GNOME_TITLE, COST.gnomehouse)}
        ${slot('wand', 'dungeon', DUNGEON.wizard, 'WAND', 'Shaman wand: left click or drag a box to pick soldiers, right click to send them — open ground = go there and hold, a raider = attack it, a wall top = take that archer post. F = follow me (again to stop). With no one picked, orders go to everyone')}
        ${slot('basket', 'farm', FARM.crate, 'BASKET', 'F picks a kind of food; walk up to the granary to fill the basket with it, then throw toward a pen. It flies where you point, bounces and rolls; children only eat what lies inside their pen, and what they eat is who they become')}
      </div>
      <div class="inventory-host panel"></div>
      <div class="hint"><kbd>click / C</kbd><span class="hint-text"></span></div>
    </div>`);
    this.hotbar.querySelectorAll<HTMLElement>('.slot').forEach((el) => el.addEventListener('click', () => s.setTool(el.dataset.tool as Tool)));

    this.feed = h('<div class="feed"></div>');
    this.toasts = h('<div class="toasts"></div>');
    this.overlay.append(this.top, this.hotbar, this.feed, this.toasts);
    this.inventory.mount(this.hotbar.querySelector('.inventory-host')!);
    this.top.querySelector('.t-hunger')!.addEventListener('click', () => this.scene.eat());
    // the feed sits above the belt, whatever height the belt turns out to be (its hint line wraps)
    const belt = () => this.overlay.style.setProperty('--hotbar-h', this.hotbar.offsetHeight + 'px');
    new ResizeObserver(belt).observe(this.hotbar); belt();

    // --- side
    this.inspector = h('<div class="inspector panel"></div>');
    this.roster = h(`<div class="roster panel"><div class="ph">${spr('dungeon', DUNGEON.villager, 24)}<h2>Villagers</h2><span class="cap">pick one to inspect</span></div><div class="legend-row">
      <span class="rl farmer">${spr('farm', FARM.farmerHat, 16)} farmer</span><span class="rl woodcutter">${spr('dungeon', DUNGEON.man, 16)} cutter</span><span class="rl kid">${spr('dungeon', DUNGEON.villager, 16)} child</span><span class="rl soldier">${spr('dungeon', DUNGEON.knight, 16)} soldier</span>
    </div><div class="list"></div></div>`);
    // --- minimap: top of the side panel (the drawer on phones) so it never covers the world
    this.minimap = new Minimap(s, 2);
    const box = h('<div class="minimap-panel panel"><span class="cap">MAP</span><span class="cap explored" style="float:right"></span></div>');
    box.append(this.minimap.el);
    this.exploredEl = box.querySelector('.explored')!;
    this.side.append(box);
    this.side.append(this.inspector, this.roster);
    const supply = h('<div class="quiver panel"><span class="quiver-count"></span><span class="tower-count" title="Arrows in every barracks chest. Restock inside the barracks, or from its card."></span><span class="hearth-count" title="Hearths with wood for tonight. Woodcutters stock the piles; a cold building stalls births, drill, regen and meals."></span><button class="btn small fletch">+10 ARROWS · 2 WOOD</button><button class="btn small leave-room" hidden>EXIT BUILDING</button></div>');
    supply.querySelector('.fletch')!.addEventListener('click', () => s.craftArrows());
    supply.querySelector('.leave-room')!.addEventListener('click', () => s.interior.leave());
    this.side.prepend(supply);
    this.roster.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.row');
      if (!row) return;
      const v = s.villagers().find((x) => x.id === Number(row.dataset.id));
      if (v) s.select(v);
    });

    this.tooltipEl = h('<div class="tooltip" hidden></div>');
    this.overlay.append(this.tooltipEl);

    if (this.touch) this.mountTouch();
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
    const rows: [string, string][] = this.touch
      ? [
          ['MOVE stick', 'walk'],
          ['ROLL', 'dodge roll — through bodies, not walls'],
          ['TOSS', 'throw the largest supply stack'],
          ['USE', 'use the tool you hold (the button says what)'],
          ['TOOL', 'next tool — or tap a slot'],
          ['tap a villager', 'inspect them'],
          ['FOLK', 'villagers list'],
          ['ZOOM', 'camera 1× / 1.5× / 2× / 3×'],
          ['PAUSE', 'menu'],
          ['HELP', 'how to play'],
        ]
      : [
          ['W A S D', 'move'],
          ['Space', 'dodge roll — through bodies, not walls'],
          ['G', 'throw the largest supply stack'],
          ['T', 'eat a meal — your pack first, then the granary'],
          ['click · C', 'use the held tool, toward the cursor'],
          ['right click · X', 'check a villager'],
          ['1 – 9', 'pick a tool'],
          ['Tab · wheel', 'next / previous tool'],
          ['Z', 'camera zoom'],
          ['H', 'call the gnomes to your heels / send them foraging'],
          ['E · Esc', 'menu'],
          ['- · =', 'game speed'],
          ['K', 'this panel'],
          ['M', 'sound on / off'],
          ['?', 'how to play'],
        ];
    const panel = h(`<div class="ctrl-panel">
      <button class="ctrl-tab" title="Controls (K)">${spr('town', TOWN.iconKey, 16)} CONTROLS <span class="arrow">▴</span></button>
      <div class="ctrl-card panel">
        <div class="ph">${spr('town', TOWN.iconKey, 24)}<h2>Controls</h2><button class="btn small ctrl-close">×</button></div>
        <div class="ctrl-rows">${rows.map(([k, d]) => `<kbd>${esc(k)}</kbd><span>${esc(d)}</span>`).join('')}</div>
        ${this.touch ? '' : '<div class="ctrl-foot">Hold a tool, face something, click. The bar above the belt tells you what will happen.</div>'}
        <div class="ctrl-foot"><button class="btn small mute">SOUND</button></div>
      </div>
    </div>`);
    let open = true;
    try { open = localStorage.getItem('village.controls') !== 'closed'; } catch { /* ignore */ }
    const set = (v: boolean) => {
      open = v;
      panel.classList.toggle('open', open);
      try { localStorage.setItem('village.controls', open ? 'open' : 'closed'); } catch { /* ignore */ }
    };
    panel.querySelector('.ctrl-tab')!.addEventListener('click', () => set(!open));
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
      if (e.key === '?') this.showHelp(); // the row below has always advertised it
    });
    (this.touch ? document.getElementById('game')! : this.overlay).append(panel);
    set(open);
  }

  // ---- touch controls ----------------------------------------------------------

  private mountTouch(): void {
    const s = this.scene;
    document.body.classList.add('touch');
    this.blockBrowserZoom();

    // the side panel becomes a bottom drawer with tabs
    const tabs = h(`<div class="tabs"><button class="btn small on" data-tab="inspector">INSPECT</button><button class="btn small" data-tab="roster">VILLAGERS</button><button class="btn small close-drawer">CLOSE</button></div>`);
    this.side.prepend(tabs);
    tabs.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => this.showTab(b.dataset.tab as 'inspector' | 'roster')));
    tabs.querySelector('.close-drawer')!.addEventListener('click', () => this.side.classList.remove('open'));
    this.showTab('inspector');

    // joystick + buttons
    const ctl = h(`<div class="mobile">
      <div class="stick"><div class="knob"></div><span class="mlbl">MOVE</span></div>
      <div class="mid">
        <button class="mbtn small zoombtn">⌕<span class="mlbl">ZOOM</span></button>
        <button class="mbtn small helpbtn">?<span class="mlbl">HELP</span></button>
        <button class="mbtn small armorybtn">⛨<span class="mlbl">ARMOR</span></button>
      </div>
      <div class="cluster">
        <button class="mbtn small drawerbtn">${spr('dungeon', DUNGEON.villager, 24)}<span class="mlbl">FOLK</span></button>
        <button class="mbtn small pausebtn">II<span class="mlbl">PAUSE</span></button>
        <button class="mbtn small buildbtn">${spr('town', TOWN.iconHammer, 24)}<span class="mlbl">TOOL</span></button>
        <button class="mbtn small rollbtn">↻<span class="mlbl">ROLL</span></button>
        <button class="mbtn small tossbtn">✵<span class="mlbl">TOSS</span></button>
        <button class="mbtn act"><span class="verb">USE</span></button>
      </div>
    </div>`);
    // The world gets its own uncovered area: top bar above it, a control deck below it.
    const deck = h('<div class="deck"></div>');
    this.stage.prepend(this.top);
    deck.append(this.feed, this.hotbar, ctl);
    this.stage.append(deck);
    // the world area just shrank; make sure Phaser sees the final size
    setTimeout(() => s.scale.refresh(), 60);
    window.addEventListener('orientationchange', () => setTimeout(() => s.scale.refresh(), 300));
    const press = (sel: string, fn: () => void) => {
      ctl.querySelector<HTMLElement>(sel)!.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
    };
    press('.act', () => s.interact());
    press('.rollbtn', () => s.dodge());
    press('.tossbtn', () => s.tossLoad());
    press('.buildbtn', () => s.player.cycleTool());
    press('.pausebtn', () => s.togglePause());
    press('.drawerbtn', () => { this.showTab('roster'); this.side.classList.toggle('open'); });
    press('.zoombtn', () => s.cycleZoom());
    press('.helpbtn', () => this.showHelp());
    press('.armorybtn', () => s.openArmory(s.armoryFor ? null : s.player));

    const stick = ctl.querySelector<HTMLElement>('.stick')!;
    const knob = ctl.querySelector<HTMLElement>('.knob')!;
    const R = 40, dead = 0.18;
    let active: number | null = null;
    const set = (dx: number, dy: number) => {
      const d = Math.hypot(dx, dy);
      const k = d > R ? R / d : 1;
      dx *= k; dy *= k;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const ax = dx / R, ay = dy / R;
      s.player.touch = Math.hypot(ax, ay) < dead ? { x: 0, y: 0 } : { x: ax, y: ay };
    };
    const fromEvent = (e: PointerEvent) => {
      const r = stick.getBoundingClientRect();
      set(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    };
    stick.addEventListener('pointerdown', (e) => { active = e.pointerId; stick.setPointerCapture(e.pointerId); fromEvent(e); e.preventDefault(); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === active) fromEvent(e); });
    const release = (e: PointerEvent) => { if (e.pointerId !== active) return; active = null; set(0, 0); };
    stick.addEventListener('pointerup', release);
    stick.addEventListener('pointercancel', release);
  }

  /**
   * Phones ignore `user-scalable=no` (Safari especially), and `touch-action` alone doesn't cover
   * every element: a stray pinch that starts over a bit of UI can still trigger the browser's own
   * page zoom, which pans the fixed-layout controls off screen. Block what we can — but never
   * block a *shrinking* pinch, so a stuck player can always pinch back out themselves — and if the
   * page still ends up zoomed, try to force it back to 1x in place (no reload, run kept), falling
   * back to a banner (positioned to the visible slice of the page, wherever that's panned to) and
   * finally a reload only if nothing else worked.
   */
  private blockBrowserZoom(): void {
    const stop = (e: Event) => e.preventDefault();
    // Safari pinch
    document.addEventListener('gesturestart', stop, { passive: false });
    document.addEventListener('gesturechange', stop, { passive: false });
    // other browsers: multi-finger pinch reported via touchmove. Block it from growing (zooming
    // in) but always let it shrink (zooming back out) — that's the one native gesture a stuck
    // player can fall back on, so it must never be the thing we're blocking.
    let pinchStart = 0;
    const pinchDist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    document.addEventListener('touchstart', (e) => { if (e.touches.length === 2) pinchStart = pinchDist(e.touches); }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (e.touches.length < 2) return;
      if (pinchDist(e.touches) > pinchStart + 4) e.preventDefault();
    }, { passive: false });
    // double-tap zoom: eat the second tap of a quick double tap outside form fields
    let lastTap = 0;
    document.addEventListener('touchend', (e) => {
      const now = Date.now();
      if (now - lastTap < 300 && !(e.target as HTMLElement).closest('input')) e.preventDefault();
      lastTap = now;
    }, { passive: false });

    const vv = window.visualViewport;
    if (!vv) return;

    // re-applying the viewport meta tag forces most mobile browsers to drop a manual pinch-zoom,
    // without a reload — this is the trick, there's no direct API for it
    const meta = document.querySelector('meta[name="viewport"]');
    const metaContent = meta?.getAttribute('content') ?? '';
    const forceReset = (): void => {
      if (!meta) return;
      meta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
      meta.remove();
      document.head.appendChild(meta);
      requestAnimationFrame(() => meta.setAttribute('content', metaContent));
    };

    let banner: HTMLElement | null = null;
    let attempted = false;
    const positionBanner = (): void => {
      // pin it to the visible slice of the page — while zoomed, that may not be the layout
      // viewport's top edge, which is where a plain `position: fixed; top: 0` would sit
      if (banner) { banner.style.left = `${vv.offsetLeft}px`; banner.style.top = `${vv.offsetTop}px`; banner.style.width = `${vv.width}px`; }
    };
    const check = (): void => {
      const zoomed = vv.scale > 1.08;
      if (!zoomed) {
        attempted = false;
        if (banner) { banner.remove(); banner = null; }
        return;
      }
      if (!attempted) { attempted = true; forceReset(); setTimeout(check, 260); return; }
      if (!banner) {
        banner = h(`<div class="zoomed-banner"><span>The page got zoomed in.</span><button class="btn ok">RESET VIEW</button></div>`);
        banner.querySelector('button')!.addEventListener('click', () => {
          forceReset();
          setTimeout(() => { if ((vv.scale ?? 1) > 1.08) location.reload(); }, 260);
        });
        document.body.append(banner);
      }
      positionBanner();
    };
    vv.addEventListener('resize', check);
    vv.addEventListener('scroll', positionBanner);
    check();
  }

  private showTab(tab: 'inspector' | 'roster'): void {
    this.side.dataset.tab = tab;
    this.side.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  }

  // ---- per-frame -------------------------------------------------------------

  render(dt: number): void {
    const s = this.scene;
    const followers = s.villagers().filter(v => v.role === 'gnome' && v.followingPlayer && !v.dead).length;
    const call = this.top.querySelector<HTMLButtonElement>('.summon-gnomes')!;
    const label = followers ? `SEND FORAGING (${followers})` : 'CALL GNOMES';
    if (call.textContent !== label) call.textContent = label;
    this.stage.classList.toggle('raid', s.raidActive);
    if (s.selectedBuilding !== this.lastBuilding) { this.lastBuilding = s.selectedBuilding; this.confirmDemolish = null; this.renderInspector(true); if (this.touch && s.selectedBuilding) { this.showTab('inspector'); this.side.classList.add('open'); } }
    if (this.touch && s.selected !== this.lastSelected) {
      this.lastSelected = s.selected;
      if (s.selected) { this.showTab('inspector'); this.side.classList.add('open'); }
    }
    const pickKey = s.selectedItem ? `item${s.selectedItem.id}` : s.selectedTile ? `tile${s.selectedTile.tx},${s.selectedTile.ty}` : '';
    if (pickKey !== this.lastPick) { this.lastPick = pickKey; this.confirmErase = null; this.renderInspector(true); if (this.touch && pickKey) { this.showTab('inspector'); this.side.classList.add('open'); } }
    this.topT += dt; this.rosterT += dt;
    this.minimap.render(dt, s.tilesChanged);
    if (this.topT > 0.1) {
      if (s.fog) { const pct = `${Math.round(s.fog.exploredShare * 100)}% explored`; if (this.exploredEl.textContent !== pct) this.exploredEl.textContent = pct; }
      this.topT = 0; this.renderTop(); this.renderHotbar();
      this.inspT += 0.1; if (this.inspT >= 0.25) { this.inspT = 0; this.renderInspector(); } // cards rebuild their DOM: a few times a second is plenty
    }
    if (this.rosterT > 0.5) { this.rosterT = 0; this.renderRoster(); }
    this.renderFeed();
    this.inventory.render();
    if(this.scene.armoryFor)this.renderArmory();
    if (this.scene.cookingAt) this.renderCooking();
  }

  private renderTop(): void {
    const s = this.scene;
    const quiver = this.side.querySelector('.quiver-count'); if (quiver) quiver.textContent = `SHARED QUIVER · ${s.arrows} arrows`;
    const hearths = this.side.querySelector<HTMLElement>('.hearth-count');
    if (hearths) { const r = s.hearthReport(); const cold = r.total - r.stocked; hearths.textContent = r.total ? `HEARTHS · ${r.stocked} / ${r.total} stocked · ${r.nightly} wood a night${cold ? ` · ${cold} COLD TONIGHT` : ''}` : ''; hearths.classList.toggle('dry', cold > 0); }
    const tower = this.side.querySelector<HTMLElement>('.tower-count');
    if (tower) { const t = s.towerAmmo(); tower.textContent = s.world.barracks.length ? `TOWER CHESTS · ${t.ammo} / ${t.cap} arrows${t.ammo ? '' : ' · EMPTY'}` : ''; tower.classList.toggle('dry', !t.ammo); tower.classList.toggle('low', t.ammo > 0 && t.ammo / Math.max(1, t.cap) <= 0.25); }
    const exit = this.side.querySelector<HTMLButtonElement>('.leave-room'); if (exit) exit.hidden = !s.interior.active;
    const vs = s.villagers();
    const count = (r: string) => r === 'elder' ? vs.filter((v) => v.elder).length : vs.filter((v) => v.role === r).length;
    const hour = Math.floor(s.dayTime * 24);
    const night = s.dayTime < 0.22 || s.dayTime > 0.8;
    const raidIn = s.nextRaidDay - s.day;
    const held = s.player.pack.slots.map(slotKey).join('|');
    const key = `${s.day}|${hour}|${held}|${s.food | 0}/${s.foodCap}|${s.surplusDays().toFixed(1)}|${s.feverActive()}|${s.wood | 0}/${s.woodCap}|${s.scrap}|${count('farmer')}|${count('woodcutter')}|${count('infant')}|${count('kid')}|${count('soldier')}|${count('gnome')}|${count('elder')}|${Math.round(s.player.hp / Math.max(1, s.player.maxHp) * 12)}|${p.hunger ? Math.ceil(s.player.hunger * 2) / 2 : 'off'}/${p.hungerMax}|${s.raidActive}|${s.boss?.hp ?? ''}|${raidIn}|${s.speed}|${s.paused}|${night}|${s.buff?.dish ?? ''}${Math.ceil(s.buffLeft())}`;
    if (key === this.lastTop) return;
    this.lastTop = key;

    const q = (sel: string) => this.top.querySelector<HTMLElement>(sel)!;
    q('.sun').classList.toggle('moon', night);
    // the day chip takes on the sky's colour: peach at dawn, blue at night
    const sky = skyAt(s.dayTime);
    this.top.style.setProperty('--sky', `rgba(${sky.r}, ${sky.g}, ${sky.b}, ${Math.min(0.85, sky.alpha * 1.3).toFixed(2)})`);
    q('.day').textContent = p.peaceful ? `DAY ${s.day}` : `DAY ${s.day}/${p.bossDay}`;
    q('.hour').textContent = `${String(hour).padStart(2, '0')}:00`;
    const inHand = (kind: BulkKind) => s.player.carriedOf(kind) ? `<em class="hand">+${Number(s.player.carriedOf(kind).toFixed(1))} in pack</em>` : ''; 
    q('.wood').innerHTML = `${s.wood | 0}<small>/${s.woodCap}</small>${inHand('wood')}`;
    const days = s.surplusDays(), fever = s.feverActive();
    const feverBadge = s.mods.babyFever ? `<span class="badge fever ${fever ? 'on' : ''}" title="${fever ? `Baby fever: births ${Math.round(100 * p.feverBonus)}% more likely while the larder holds ${p.feverDays}+ days of food` : `Baby fever needs ${p.feverDays} days of food in store — ${Math.ceil(p.feverDays * s.dailyRation() - s.food)} more`}">FEVER</span>` : '';
    q('.food').innerHTML = `${s.food | 0}<small>/${s.foodCap} · ${Number.isFinite(days) ? `${days.toFixed(days < 10 ? 1 : 0)} days` : '∞'}</small>${feverBadge}${inHand('food')}`;
    q('.t-food').title = `${FOOD_KINDS.filter((k) => s.pantry[k] >= 1).map((k) => `${s.pantry[k] | 0} ${FOODS[k].one}`).join(' · ') || 'empty'} — each grown villager eats ${p.foodPerDay} a day${s.headRation() ? `, and you eat ${s.headRation()} on top when you eat from the granary` : ''}; the small number is how many days the larder would last for the villagers. Pen children eat only what the basket tosses in.`;
    q('.scrap').textContent = String(s.scrap);
    q('.pop').innerHTML = ([
      ['farmer', CHAR.farmer, 'FARM'], ['woodcutter', CHAR.woodcutter, 'WOOD'], ['infant', CHAR.kid, 'CRIBS'], ['kid', CHAR.kid, 'KIDS'], ['soldier', CHAR.soldier, 'ARMY'], ['gnome', CHAR.gnome, 'GNOMES'], ['elder', CHAR.woodcutter, 'OLD'],
    ] as [string, { key: string; frame: number }, string][]).map(([r, c, lbl]) => `<span class="chip ${r}" title="${r === 'elder' ? 'Elders' : ROLE_LABEL[r] + 's'} · ${vs.length} villagers in all">${spr(c.key, c.frame, 24)}<b>${count(r)}</b><i>${lbl}</i></span>`).join('');
    const raid = q('.raid');
    const bossNext = s.nextRaidDay === p.bossDay;
    const orc = spr('dungeon', DUNGEON.orc, 24, 'flip');
    if (s.raidActive && s.boss && !s.boss.dead) {
      const pct = Math.max(0, (s.boss.hp / s.boss.maxHp) * 100);
      raid.innerHTML = `${orc}<span>WARLORD</span><div class="bar boss"><i style="width:${pct}%"></i></div>`;
      raid.className = 'val raid now';
    } else if (s.raidActive) { raid.innerHTML = `${orc}<span>UNDER ATTACK!</span>`; raid.className = 'val raid now'; }
    else if (!Number.isFinite(raidIn)) { raid.innerHTML = `${orc}<span>PEACE</span>`; raid.className = 'val raid'; } // p.peaceful: nobody is marching
    else if (raidIn <= 1) { raid.innerHTML = `${orc}<span>${bossNext ? 'WARLORD TOMORROW' : 'TOMORROW'}</span>`; raid.className = 'val raid soon'; }
    else { raid.innerHTML = `${orc}<span>${bossNext ? 'Warlord' : 'in'} ${raidIn} days</span>`; raid.className = bossNext ? 'val raid soon' : 'val raid'; }
    const meal = this.top.querySelector<HTMLElement>('.t-buff')!;
    meal.hidden = !s.buff || s.buffLeft() <= 0;
    if (!meal.hidden && s.buff) q('.buff').innerHTML = `<span style="color:${FOODS[s.buff.dish].colour}">+${Math.round((s.buff.mul - 1) * 100)}% ${DIET_STAT_NAME[s.buff.stat]}</span><small>${Math.ceil(s.buffLeft())}s</small>`;
    const belly = this.top.querySelector<HTMLElement>('.t-hunger')!;
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
    const hearts = q('.hearts');
    const full = s.player.hp / s.player.maxHp * 6;
    hearts.innerHTML = Array.from({ length: 6 }, (_, i) => `<span class="heart ${i + 1 <= full ? '' : i < full ? 'half' : 'off'}"></span>`).join('');
    this.top.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === s.speed && !s.paused));
    q('.pause').classList.toggle('on', s.paused);
  }

  private renderHotbar(): void {
    const s = this.scene;
    this.hotbar.querySelectorAll<HTMLElement>('.slot').forEach((el) => {
      const tool = el.dataset.tool as Tool;
      el.classList.toggle('on', s.player.tool === tool);
      el.classList.toggle('off', !!s.toolLocked(tool) || ((tool === 'house' || tool === 'barracks') && s.wood < COST[tool]));
      if (tool === 'gnomehouse') { const want = s.toolLocked(tool) ? 'Somewhere in these woods a gnome family keeps house. Warm motes drift over their glade — walk into it and they will teach you the craft.' : GNOME_TITLE; if (el.title !== want) el.title = want; }
      if (tool === 'pen') { const lbl = el.querySelector('.lbl')!, want = s.player.penKind === 'farmer' ? 'FARM PEN' : s.player.penKind === 'woodcutter' ? 'WOOD PEN' : 'DRILL PEN'; if (lbl.textContent !== want) lbl.textContent = want; }
      if (tool === 'basket') { const lbl = el.querySelector('.lbl')!, want = `BASKET · ${s.player.carriedOf('food',s.player.basketKind)} ${FOODS[s.player.basketKind].name.toUpperCase()}`; if (lbl.textContent !== want) lbl.textContent = want; }
      if (tool === 'seeds') { const lbl = el.querySelector('.lbl')!, want = FOODS[s.player.cropKind].name.toUpperCase(); if (lbl.textContent !== want) lbl.textContent = want; }
    });
    const hint = this.hotbar.querySelector('.hint-text')!;
    const carry = s.carryHint();
    const raw = s.hint();
    const text = (carry && !raw.startsWith('E:') && !/full|first/.test(raw) ? carry : raw).replace(/^E: /, '');
    if (hint.textContent !== text) hint.textContent = text;
    // the touch action button shows the verb it would perform
    const verb = this.stage.querySelector('.act .verb');
    if (verb) {
      const v = this.verbFor(s.hint());
      if (verb.textContent !== v) verb.textContent = v;
      verb.parentElement!.classList.toggle('idle', v === '…');
    }
  }

  /** "E: harvest" → "HARVEST"; things E can't do right now → "…" */
  private verbFor(hint: string): string {
    if (!hint.startsWith('E:')) return '…';
    const w = hint.slice(2).trim().split(/[ !(]/)[0].toUpperCase();
    return { TILL: 'TILL', PLANT: 'PLANT', HARVEST: 'HARVEST', CHOP: 'CHOP', ATTACK: 'FIGHT', SWING: 'SWING', BUILD: 'BUILD', UPGRADE: 'UPGRADE', CLEAR: 'CLEAR', DIG: 'DIG', FLATTEN: 'FLATTEN', CUT: 'CUT' }[w] ?? 'USE';
  }

  private lastPick = '';
  private confirmErase: string | null = null;
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
    const q = { tx: Math.floor(it.x / 16), ty: Math.floor(it.y / 16) }, t = s.world.get(q.tx, q.ty);
    const where = !it.rest ? 'in the air' : t?.pen ? `in the ${PEN_NAME[t.pen]}` : t?.kind === 'crop' || t?.kind === 'tilled' ? 'on the field' : 'on open ground';
    const eaters = it.kind === 'food' ? s.villagers().filter((v) => v.eatingFrom === it && !v.dead).length : 0;
    let html = `${head}<div class="head">${art}<div><div class="name">${amount} ${name.toLowerCase()}</div><span class="badge ${it.kind === 'scrap' ? 'soldier' : 'farmer'}">${it.kind === 'scrap' ? 'loot' : it.kind === 'wood' ? 'supplies' : it.kind === 'gear' ? 'equipment' : 'food on the ground'}</span></div><button class="btn small close">x</button></div><div class="rows">`;
    html += `<b>Where</b><span>${where} · tile ${q.tx}, ${q.ty}${it.rest ? '' : ' <em>· still moving</em>'}</span>`;
    if (it.kind === 'food') html += `<b>Feeds</b><span>${FOODS[it.food ?? 'wheat'].blurb}${t?.pen ? ` · ${eaters ? `${eaters} eating from it now` : 'children here will eat it'}` : ' · <em class="warn">not in a pen — children only eat inside their pen</em>'}</span>`;
    html += `<b>Pick up</b><span>${it.kind === 'scrap' ? 'walk over it' : 'approach to collect into your pack when space is available'}</span></div>`;
    html += `<p class="d">Thrown things fly where you point, bounce off walls and trees, and lie where they stop.</p>`;
    this.inspector.innerHTML = html;
    this.inspector.querySelector('.close')?.addEventListener('click', () => s.selectItem(null));
  }
  /** A card for a tile: crop, soil, tree, wild food, pen, wall, gate, stairs, or plain grass. */
  private renderTileCard(q: TilePos, head: string): void {
    const s = this.scene, w = s.world, t = w.get(q.tx, q.ty);
    if (!t) { s.selectTile(null); return; }
    const art = this.tilePortrait(tileArt(t, s));
    const close = `<button class="btn small close">x</button>`;
    const lying = w.itemsOn(q.tx, q.ty);
    const lyingRow = lying.length ? `<b>Lying here</b><span>${lying.map((it) => `<a href="#" class="pick-item" data-id="${it.id}">${it.n % 1 ? it.n.toFixed(1) : it.n} ${it.kind === 'gear' && it.gear ? slotName(it.gear) : it.kind === 'scrap' ? 'scrap' : it.kind === 'wood' ? 'wood' : FOODS[it.food ?? 'wheat'].one}</a>`).join(', ')}</span>` : '';
    const plan = (kind: FoodKind | undefined, cap: string) => `<div class="raise"><div class="cap">${cap}</div><div class="seg">${CROP_KINDS.map((k) => `<button class="btn small ${kind === k ? 'on' : ''}" data-plan="${k}">${FOODS[k].name.toUpperCase()}</button>`).join('')}</div><div class="d">Farmers replant what the soil remembers; pick what this tile should grow next. ${kind ? FOODS[kind].blurb : ''}</div></div>`;
    let title = '', badge = '', badgeCls = 'farmer', rows = '', extra = '';
    if (t.defense) {
      const d = t.defense, pct = Math.round(100 * d.hp / d.maxHp);
      title = d.kind === 'wall' ? 'Wall' : d.kind === 'gate' ? 'Gate' : 'Stairs'; badge = d.kind === 'gate' ? (d.open ? 'open to everyone' : 'guarded — allies pass') : d.kind === 'stairs' ? 'up to the battlements' : 'stone rampart'; badgeCls = 'soldier';
      rows += `<b>Structure</b><span>${Math.ceil(d.hp)} / ${d.maxHp} HP${d.hp < d.maxHp ? ` <em>· hammer mends ${p.wallRepair} per wood</em>` : ''}<div class="bar hp ${pct <= 40 ? 'low' : ''}"><i style="width:${pct}%"></i></div></span>`;
      if (d.kind === 'stairs') { const reach = s.stairsReach(q); rows += `<b>Serves</b><span>${reach} connected battlement${reach === 1 ? '' : 's'} · ${s.villagers().filter((v) => v.post && Math.abs(v.post.tx - q.tx) + Math.abs(v.post.ty - q.ty) <= 12).length} soldiers posted along it</span>`; }
      if (d.kind === 'gate') extra = `<div class="raise"><div class="cap">GATE</div><div class="seg"><button class="btn small ${d.open ? '' : 'on'}" data-gate="closed">GUARDED</button><button class="btn small ${d.open ? 'on' : ''}" data-gate="open">OPEN</button></div><div class="d">Guarded: allies pass, enemies must break it. Open: everyone walks through.</div></div>`;
      rows += `<b>Take down</b><span>${DISMANTLE.hits} hammer hits for half the wood back</span>`;
    } else if (t.pen) {
      const pc = s.penCard(q)!;
      title = `Training pen · ${PEN_NAME[pc.kind]}`; badge = `${pc.tiles.length} tile${pc.tiles.length === 1 ? '' : 's'}`; badgeCls = pc.kind === 'soldier' ? 'soldier' : 'farmer';
      rows += `<b>Children</b><span>${pc.kids.length} training here${pc.hungry ? ` · <em class="warn">${pc.hungry} hungry</em>` : ''}</span>`;
      rows += `<b>Food lying</b><span>${pc.piles || '<em class="warn">nothing — throw some in with the BASKET</em>'}</span>`;
      rows += `<b>Barracks</b><span>${pc.kind === 'soldier' ? (s.world.barracks.some((b) => b.warm) ? 'a warm barracks drills them' : '<em class="warn">needs a warm barracks to drill anyone</em>') : 'not needed'}</span>`;
      rows += `<b>Teaches</b><span>${pc.kind === 'soldier' ? 'soldiering — a skilled soldier after' : pc.kind === 'farmer' ? 'farming — a skilled farmer after' : 'the axe — a skilled woodcutter after'} ${Villager.drillNeeded(s)} fed days</span>`;
      const arming = this.confirmErase === `${q.tx},${q.ty}`;
      extra = `<div class="raise"><div class="cap">REPAINT AS</div><div class="seg">${CALLINGS.map((c) => `<button class="btn small ${pc.kind === c ? 'on' : ''}" data-repaint="${c}">${PEN_NAME[c].toUpperCase()}</button>`).join('')}</div><div class="d">Repaints the whole pen; its children switch with it.</div></div>
        <div class="raise"><button class="btn small ${arming ? 'danger' : ''} erase-pen">${arming ? 'ERASE — SURE?' : 'ERASE PEN'}</button><div class="d">Removes every tile of this pen; the children look for another.</div></div>`;
    } else if (t.kind === 'crop' || t.kind === 'tilled') {
      const fk = t.food ?? 'wheat', days = s.cropDaysOf(t), ripe = s.isRipe(t);
      title = t.kind === 'crop' ? `${ripe ? 'Ripe' : 'Growing'} ${FOODS[fk].name.toLowerCase()}` : 'Tilled soil'; badge = t.kind === 'crop' ? (ripe ? 'harvest with hands' : `ripens in ${Math.max(0, days - t.stage)} day${days - t.stage === 1 ? '' : 's'}`) : t.food ? `farmers will sow ${FOODS[t.food].name.toLowerCase()}` : 'sow with seeds';
      if (t.kind === 'crop') rows += `<b>Growth</b><span>${Math.min(t.stage, days)} / ${days} days<div class="bar grow"><i style="width:${Math.round(100 * Math.min(1, t.stage / days))}%"></i></div></span><b>Yield</b><span>${s.cropYieldOf(fk)} ${FOODS[fk].one} · ${FOODS[fk].blurb}</span>`;
      else rows += `<b>Soil</b><span>${t.work ? `${t.work}/3 flattened` : 'ready for seed'}</span>`;
      extra = plan(t.food, 'REPLANT AS');
    } else if (t.kind === 'tree' || t.kind === 'sapling') {
      if (t.kind === 'tree') {
        const old = s.isOldGrowth(t), grove = w.groveSize(q.tx, q.ty), left = s.oldGrowthDays - t.stage;
        title = old ? 'Old growth' : 'Tree'; badge = old ? `yields ${s.treeYield(t)} wood` : `old growth in ${left} day${left === 1 ? '' : 's'}`;
        rows += `<b>Wood</b><span>${s.treeYield(t)} to a woodcutter · ${p.playerTreeYield} to your own axe${t.work ? ` · ${t.work}/3 chopped` : ''}</span><b>Grove</b><span>${grove}${grove >= 200 ? '+' : ''} trees together · spreads ${Math.round(s.seedChance(q.tx, q.ty) * 100)}% a day</span><b>Shelters</b><span>${old ? 'berries and mushrooms may sprout beside it' : 'nothing yet — old growth seeds wild food'}</span>`;
      } else {
        const days = s.saplingDays(q.tx, q.ty) - t.stage;
        title = t.stage < 2 ? 'Stump' : 'Sapling'; badge = `a tree in ${days} day${days === 1 ? '' : 's'}`;
        rows += `<b>Growth</b><span>${t.stage} / ${s.saplingDays(q.tx, q.ty)} days${w.treeNeighbours(q.tx, q.ty) >= 2 ? ' · sheltered by the grove' : ''}</span><b>Clear</b><span>the hoe or axe removes it</span>`;
      }
    } else if (WILD_FOOD[t.kind]) {
      const fk = WILD_FOOD[t.kind]!, ripe = s.wildRipe(t), left = s.regrowDays(fk) - t.stage;
      title = FOODS[fk].name; badge = ripe ? `${s.wildLeft(t)} left — pick with hands, or a gnome will` : `back in ${left} day${left === 1 ? '' : 's'}`;
      rows += `<b>Yield</b><span>${FOODS[fk].yield} ${FOODS[fk].one} when regrown · ${FOODS[fk].blurb}</span><b>Regrows</b><span>every ${s.regrowDays(fk)} days${ripe ? '' : ` · ${t.stage} so far`}</span>`;
    } else {
      title = t.trail ? 'Trail' : t.tall ? 'Long grass' : 'Grass'; badge = t.biome === 'deepwood' ? 'deep woodland' : t.biome === 'woodland' ? 'woodland' : 'meadow';
      rows += `<b>Ground</b><span>${t.trail ? 'a woodland trail — trees never grow over it' : t.tall ? `slows anyone wading through it to ${Math.round(p.grassSlow * 100)}% — raiders too · things hide in it · the sword mows an arc per swing; it never grows back` : 'open ground'}</span><b>Could be</b><span>tilled with the hoe · a tree with seeds · a pen with the PEN tool · a building</span>`;
    }
    let html = `${head}<div class="head">${art}<div><div class="name">${title}</div><span class="badge ${badgeCls}">${badge}</span></div>${close}</div><div class="rows">${rows}${lyingRow}<b>Tile</b><span>${q.tx}, ${q.ty}</span></div>${extra}`;
    this.inspector.innerHTML = html;
    this.inspector.querySelector('.close')?.addEventListener('click', () => s.selectTile(null));
    this.inspector.querySelectorAll<HTMLElement>('.pick-item').forEach((el) => el.addEventListener('click', (e) => { e.preventDefault(); const it = w.items.find((i) => i.id === Number(el.dataset.id)); if (it) s.selectItem(it); }));
    this.inspector.querySelectorAll<HTMLButtonElement>('[data-plan]').forEach((el) => el.addEventListener('click', () => { s.setFieldPlan(q, el.dataset.plan as FoodKind); this.renderInspector(true); }));
    this.inspector.querySelectorAll<HTMLButtonElement>('[data-gate]').forEach((el) => el.addEventListener('click', () => { if (t.defense) w.setGateOpen(t.defense, el.dataset.gate === 'open'); this.renderInspector(true); }));
    this.inspector.querySelectorAll<HTMLButtonElement>('[data-repaint]').forEach((el) => el.addEventListener('click', () => { const pc = s.penCard(q); if (pc) s.repaintPen(pc.tiles, el.dataset.repaint as Calling); this.renderInspector(true); }));
    this.inspector.querySelector('.erase-pen')?.addEventListener('click', () => {
      const key = `${q.tx},${q.ty}`;
      if (this.confirmErase !== key) { this.confirmErase = key; this.renderInspector(true); return; }
      this.confirmErase = null; const pc = s.penCard(q); if (pc) s.erasePen(pc.tiles); s.selectTile(null);
    });
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
      if (b.kind === 'house' || b.kind === 'gnomehouse') {
        const infants = s.infantsOf(b).length, why = s.birthProblem(b);
        html += `<b>Beds</b><span>${s.bedsTaken(b)} / ${s.beds(b)}${s.bedsTaken(b) > s.beds(b) ? ' <em class="warn">· crowded</em>' : ''}</span>`;
        html += `<b>Nursery</b><span>${infants} / ${s.cribs(b)} cribs${b.ruined ? '' : why ? ` · <em class="warn">no births: ${esc(why)}</em>` : ` · ${Math.round(100 * s.birthChance(b))}% every ${p.birthEvery}s · next roll in ${Math.ceil(s.birthIn(b))}s${s.feverActive() ? ' <em class="fever-txt">· baby fever</em>' : ''}`}<em class="d"> infants walk out to a pen after ${p.infantDays} days</em></span>`;
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
      html += `<b>Next</b><span>${b.level < MAX_LEVEL ? `Lv${b.level + 1}: ${LEVEL_PERKS[b.kind][b.level + 1]} <em>· ${cost} wood with the hammer</em>` : 'max level'}</span></div>`;
      if (b.kind === 'gnomehouse') html += `<p class="d">A gnome couple raises children here; grown gnomes potter about it and fight whatever comes.</p>`;
      if (hasInterior(b.kind)) {
        const onStep = s.doorAt() === b;
        html += `<p class="d">${onStep ? '<b>Walk up into the door</b> to go inside.' : 'To go inside, stand on the doorstep and walk up into the door.'}</p>`;
      }
      if (b.kind === 'barracks') {
        const why = s.restockProblem(b);
        html += `<p>The tower shoots raiders inside the ring while the chest has arrows.</p><button class="btn small ${why ? '' : 'ok'} restock" ${why ? 'disabled' : ''} title="${why ? esc(why) : ''}">RESTOCK ${TOWER.restockArrows} ARROWS · ${TOWER.restockWood} WOOD</button>${why ? `<span class="d"> ${esc(why)}</span>` : ''}`;
        html += `<p>Equip soldiers with bows in their cards. SET WALL POST, then tap a connected battlement. Stairs are required.</p><button class="btn small craft-arrows">FLETCH 10 ARROWS · 2 WOOD</button> <button class="btn small ok open-armory" title="The chest inside: armor and tower arrows">ARMOR CHEST</button><p class="d">Forges leather now, iron at Lv2, steel at Lv3. Scrap iron drops where a raider falls — walk over it.</p>`;
      }
      if (b.kind === 'house' || b.kind === 'barracks' || b.kind === 'tavern' || b.kind === 'gnomehouse') {
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
        this.inspector.querySelector('.open-armory')?.addEventListener('click', () => { s.openArmory(s.player, b); this.side.classList.remove('open'); });
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
      const html = `${head}<p class="empty">Click or tap anything: a villager, a building, a crop, a tree, a pen, a wall, or something lying on the ground.<br>Children are the point: pick each house's <b>calling</b>, feed them well, keep them safe, and <b>encourage</b> them — how they're raised is who they become.</p>`;
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
        : m.role === 'kid' ? ` <em>· child, comes of age in ${Math.max(0, s.adultAge - m.age).toFixed(1)} days${m.gnome ? ' by the gnome house' : m.pen ? ` at the ${PEN_NAME[m.pen]}` : ' — no pen to train in'}</em>`
        : m.elder ? ` <em>· elder</em>` : ` <em>· grows old at ${Math.round(s.elderAge)}</em>`;
      html += `<b>Age</b><span>${m.age.toFixed(1)} days${stage}</span>`;
      html += `<b>Home</b><span>${s.bedsTaken(m.home)} of ${s.beds(m.home)} beds</span>`;
      html += `<b>Fed</b><span>${m.role === 'infant' ? (m.hungerDays ? `<em class="warn">hungry for ${m.hungerDays} days — nobody at home was fed; ${p.kidStarveDays} days starve an infant</em>` : 'nursed — a fed grown-up at home feeds the nursery') : m.role === 'kid' ? (m.ateDay >= s.day ? (m.gnome ? 'ate today from food by the gnome house' : 'ate today from a pen pile') : m.hungerDays ? `<em class="warn">hungry for ${m.hungerDays} days — ${m.gnome ? 'throw food by the gnome house' : m.pen ? `throw food into the ${PEN_NAME[m.pen]}` : 'paint a pen and throw food in'}</em>` : 'not yet today') : m.hungerDays === 0 ? 'yes' : `<em class="warn">hungry for ${m.hungerDays} days</em>`}</span>`;
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
      const line = !m.pen ? `no pen to train in — they stay a child until one is painted · ${need} fed days in a pen to be skilled`
        : `training at the ${PEN_NAME[m.pen]} · ${m.trained.toFixed(1)}/${need} days`;
      const list = s.careToday(m).map((c) => `<li class="${c.ok ? 'ok' : ''}">${c.ok ? '✓' : '✗'} ${c.label}${!c.ok && c.note ? ` <small>· ${esc(c.note)}</small>` : ''}</li>`).join('');
      const why = s.encourageProblem(m);
      html += `<div class="upbring"><div class="cap">UPBRINGING</div>
        <div class="stars">${'★'.repeat(stars)}<span class="dim">${'☆'.repeat(5 - stars)}</span> <small>${stars === 5 ? 'gifted' : stars >= 3 ? 'well raised' : stars >= 2 ? 'getting by' : m.careDays ? 'neglected' : 'a fresh start'}</small></div>
        <div class="lean ${o.role === 'soldier' ? 'm' : 'c'}">${o.role ? `will be ${o.skilled ? 'a skilled' : 'a plain'} ${o.role.toUpperCase()} at age ${s.adultAge.toFixed(1)}` : 'the pen they train in decides what they become'}</div><div class="d">${line}</div>
        <ul class="care">${list}</ul>
        <button class="btn small ok encourage" ${why ? 'disabled' : ''}>ENCOURAGE${why ? ` · ${esc(why)}` : ''}</button></div>`;
      const d = s.dietReport(m);
      html += `<div class="upbring diet"><div class="cap">DIET</div>
        ${d.kinds.filter((k) => k.n > 0 || !isDish(k.kind)).map((k) => `<div class="lbl"><span>${FOODS[k.kind].name}</span><span>${k.n % 1 ? k.n.toFixed(1) : k.n} · ${FOODS[k.kind].stat === 'care' ? 'care' : `+${Math.round(DIET_CAP[FOODS[k.kind].stat as keyof typeof DIET_CAP] * (FOODS[k.kind].power ?? 1) * p.dietMul * k.share * 100)}% ${DIET_STAT_NAME[FOODS[k.kind].stat]}`}</span></div><div class="bar diet"><i style="width:${Math.round(k.share * 100)}%;background:${FOODS[k.kind].colour}"></i></div>`).join('')}
        <div class="d">${d.bonuses ? `growing up: ${d.bonuses}` : `nothing eaten from the pen yet — ${p.dietFull} of one food for its full bonus`}</div></div>`;
    } else if (m instanceof Villager) {
      const d = s.dietReport(m);
      html += `<div class="upbring"><div class="cap">RAISED</div><div class="stars">${'★'.repeat(m.stars)}<span class="dim">${'☆'.repeat(5 - m.stars)}</span> <small>${m.skilled ? 'skilled' : 'plain'}${m.trait ? ` · ${TRAITS[m.trait].name} — ${TRAITS[m.trait].blurb}` : ''}</small></div>${d.bonuses ? `<div class="d">fed on ${d.kinds.filter((k) => k.n > 0).sort((a, b) => b.n - a.n).slice(0, 2).map((k) => FOODS[k.kind].name.toLowerCase()).join(' and ')}: ${d.bonuses}</div>` : ''}</div>`;
    }
    if (m instanceof Player || (m instanceof Villager && m.role === 'soldier')) {
      const st = armorStats(m.armor);
      const pips = ARMOR_SLOTS.map((slot) => `<span class="pip t${m.armor[slot]}" title="${ARMOR[slot].tiers[m.armor[slot]].name}">${ARMOR[slot].name[0]}${m.armor[slot] ? '·'.repeat(m.armor[slot]) : ''}</span>`).join('');
      html += `<div class="raise"><div class="cap">ARMOR</div><div class="pips">${pips}</div><div class="d">${st.hp ? `+${st.hp} HP · ` : ''}${Math.round((1 - st.dmgMul) * 100)}% less damage · ${Math.round(st.block * 100)}% block${st.speedMul > 1 ? ` · +${Math.round((st.speedMul - 1) * 100)}% speed` : ''}</div><button class="btn small open-armory">ARMORY</button></div>`;
    }
    if (m instanceof Villager && m.role === 'soldier') html += `<div class="raise"><div class="cap">EQUIPMENT & ORDERS</div><div class="seg"><button class="btn small ${m.weapon === 'sword' ? 'on' : ''}" data-weapon="sword">SWORD</button><button class="btn small ${m.weapon === 'bow' ? 'on' : ''}" data-weapon="bow">BOW</button></div><p>Carries a ${WEAPONS.melee.tiers[m.weapons.melee].name.toLowerCase()} and a ${WEAPONS.bow.tiers[m.weapons.bow].name.toLowerCase()} — forge better in the ARMORY. Arrows in shared quiver: ${s.arrows}. ${m.post ? `Post: ${m.post.tx}, ${m.post.ty}.` : m.order?.kind === 'hold' ? `Holding at ${m.order.tx}, ${m.order.ty} (wand).` : m.order?.kind === 'attack' ? `Hunting ${(m.order.target as Raider).name ?? 'a raider'} (wand).` : m.order?.kind === 'follow' ? 'Following you (wand).' : 'Patrolling on the ground.'}</p><button class="btn small post-soldier">${s.posting === m ? 'CANCEL PLACEMENT' : 'SET WALL POST'}</button><button class="btn small recall-soldier">RETURN TO PATROL</button></div>`;
    if (html !== this.lastInspector) {
      this.inspector.innerHTML = html;
      this.lastInspector = html;
      this.inspector.querySelector('.close')?.addEventListener('click', () => s.select(null));
      this.inspector.querySelector('.encourage')?.addEventListener('click', () => { if (m instanceof Villager) s.encourage(m); this.renderInspector(true); });
      this.inspector.querySelector('.open-armory')?.addEventListener('click', () => { s.openArmory(m); this.side.classList.remove('open'); });
      this.inspector.querySelectorAll<HTMLElement>('[data-weapon]').forEach(el => el.addEventListener('click', () => { if (m instanceof Villager) s.equipSoldier(m, el.dataset.weapon as 'bow' | 'sword'); this.renderInspector(true); }));
      this.inspector.querySelector('.post-soldier')?.addEventListener('click', () => { if (m instanceof Villager) s.posting = s.posting === m ? null : m; this.side.classList.remove('open'); this.renderInspector(true); });
      this.inspector.querySelector('.recall-soldier')?.addEventListener('click', () => { if (m instanceof Villager) { m.post = null; m.order = null; m.clearGoal(); s.posting = null; } this.renderInspector(true); });
    }
  }

  private renderRoster(): void {
    const s = this.scene;
    const vs = s.villagers();
    const groups: [string, string, Villager[]][] = [
      ['Infants', 'kid', vs.filter((v) => v.role === 'infant').sort((a, b) => b.age - a.age)],
      ['Children', 'kid', vs.filter((v) => v.role === 'kid').sort((a, b) => b.age - a.age)],
      ['Soldiers', 'soldier', vs.filter((v) => v.role === 'soldier')],
      ['Gnomes', 'gnome', vs.filter((v) => v.role === 'gnome')],
      ['Workers', 'farmer', vs.filter((v) => v.role === 'farmer' || v.role === 'woodcutter')],
    ];
    let html = '';
    for (const [label, cls, list] of groups) {
      if (!list.length) continue;
      html += `<div class="grp ${cls}">${label} <b>${list.length}</b>${cls === 'kid' ? '<span class="grp-note">pen · care stars</span>' : ''}</div>`;
      for (const v of list) {
        const c = CHAR[v.role];
        let bar = '';
        if (v.role === 'kid') {
          const o = v.outlook(s);
          const icon = o.role === 'soldier' ? spr('dungeon', DUNGEON.sword, 16) : o.role === 'woodcutter' ? spr('town', TOWN.iconAxe, 16) : o.role === 'farmer' ? spr('town', TOWN.iconHoe, 16) : o.role === 'gnome' ? `<img class="art" src="${charImg(GNOME_LOOK)}" alt="" style="height:16px">` : '?';
          bar = `<span class="outlook ${o.role === 'soldier' ? 'm' : 'c'}">${icon}${v.apprenticeAt(s) ? ` ${v.trained.toFixed(1)}/${Villager.drillNeeded(s)}` : ''} <span class="rstars">${'★'.repeat(v.starsNow())}</span></span>`;
        } else {
          const pct = Math.max(0, v.hp / v.maxHp * 100);
          bar = `<div class="bar hp ${pct < 40 ? 'low' : ''}"><i style="width:${pct}%"></i></div>`;
        }
        const lk = lookFor(v);
        html += `<div class="row ${s.selected === v ? 'sel' : ''}" data-id="${v.id}">${lk ? `<img class="art row-portrait" src="${charImg(lk)}" alt="">` : spr(c.key, c.frame, 24)}<span class="n">${esc(v.name)}</span><span class="a">${v.age.toFixed(1)}d${v.elder ? ' · old' : ''}</span>${bar}</div>`;
      }
    }
    if (!vs.length) html = '<p class="empty">Nobody lives here yet.</p>';
    // health changes every tick in a fight: patch the bars in place rather than rebuilding the list
    const structure = html.replace(/width:[\d.]+%/g, 'width:%').replace(/ low"/g, '"');
    const list = this.roster.querySelector('.list')!;
    if (structure !== this.lastRoster) { list.innerHTML = html; this.lastRoster = structure; return; }
    for (const row of list.querySelectorAll<HTMLElement>('.row[data-id]')) {
      const v = vs.find((x) => String(x.id) === row.dataset.id);
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
      this.feed.prepend(h(`<div class="ev ${ev.kind}">${spr(ic.key, ic.frame, 24)}<span>${esc(ev.text)}</span></div>`));
      if (ev.toast) this.toast(ev.text, ev.kind);
    }
    while (this.feed.children.length > 6) this.feed.lastElementChild!.remove();
    Array.from(this.feed.children).forEach((el, i) => el.classList.toggle('old', i >= 4));
  }

  /**
   * Toasts are capped and deduplicated. The feed has always trimmed itself to six; this stack never
   * did, so a burst — the same dawn warning at 16x speed, a raid's worth of deaths — could grow a
   * column tall enough to bury the screen. Nothing is lost by dropping one: every toast is already
   * in the journal beside it.
   */
  private static readonly MAX_TOASTS = 4;
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
    const el = h(`<div class="toast panel ${kind === 'raid' ? 'red raid' : kind === 'soldier' ? 'grey' : 'tan'}">${esc(text)}</div>`);
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
    const slots = ARMOR_SLOTS.map((slot) => {
      const tier = who.armor[slot], cur = ARMOR[slot].tiers[tier], next = ARMOR[slot].tiers[tier + 1];
      const why = s.craftProblem(who, slot);
      const stat = (t: typeof cur) => [t.hp ? `+${t.hp} HP` : '', t.reduce ? `-${Math.round(t.reduce * 100)}% damage` : '', t.speed ? `+${Math.round(t.speed * 100)}% speed` : '', t.block ? `${Math.round(t.block * 100)}% block` : ''].filter(Boolean).join(' · ') || '—';
      return `<div class="aslot"><div class="aname">${ARMOR[slot].name} <span class="tier">${'●'.repeat(Math.max(0,tier))}${'○'.repeat(3 - Math.max(0,tier))}</span></div>
        <div class="acur">${cur.name} <small>${stat(cur)}</small></div>
        ${next ? `<button class="btn small ${why ? '' : 'ok'} forge" data-slot="${slot}" ${why ? 'disabled' : ''}>FORGE ${next.name.toUpperCase()} · ${s.forgeCost(next).wood} wood${s.forgeCost(next).scrap ? ` + ${s.forgeCost(next).scrap} scrap` : ''}</button><div class="d">${why ? `<em class="warn">${esc(why)}</em>` : stat(next)}</div>` : '<div class="d">the best there is</div>'}</div>`;
    }).join('');
    // weapons: the crude club and hunting bow everyone starts with, forged up like armor
    const weapons = WEAPON_SLOTS.map((slot) => {
      const tier = who.weapons[slot], cur = WEAPONS[slot].tiers[tier], next = WEAPONS[slot].tiers[tier + 1];
      const why = s.weaponProblem(who, slot);
      return `<div class="aslot"><div class="aname">${WEAPONS[slot].name} <span class="tier">${'●'.repeat(Math.max(0,tier))}${'○'.repeat(3 - Math.max(0,tier))}</span></div>
        <div class="acur">${cur?.name ?? 'Empty'} <small>×${cur?.mul ?? 0} damage</small></div>
        ${next ? `<button class="btn small ${why ? '' : 'ok'} forge" data-weapon-slot="${slot}" ${why ? 'disabled' : ''}>FORGE ${next.name.toUpperCase()} · ${s.forgeCost(next).wood} wood${s.forgeCost(next).scrap ? ` + ${s.forgeCost(next).scrap} scrap` : ''}</button><div class="d">${why ? `<em class="warn">${esc(why)}</em>` : `×${next.mul} damage`}</div>` : '<div class="d">the best there is</div>'}</div>`;
    }).join('');
    const dyes = DYES.map((c, i) => `<button class="swatch ${who.dye === i ? 'on' : ''}" data-dye="${i}" style="background:${c}" title="${DYE_NAMES[i]}"></button>`).join('');
    const helms = ['CAP', 'KETTLE', 'GREAT HELM'].map((n, i) => `<button class="btn small ${who.helmetStyle === i ? 'on' : ''}" data-helm="${i}">${n}</button>`).join('');
    const plumes = PLUMES.map((c, i) => `<button class="swatch ${who.plume === i ? 'on' : ''}" data-plume="${i}" style="background:${c === 'none' ? 'transparent' : c}" title="${c === 'none' ? 'no plume' : 'plume'}">${c === 'none' ? '×' : ''}</button>`).join('');
    // the chest this armory was opened from: its tower arrows, restocked here for wood
    const chest = s.armoryChest;
    let chestHtml = '';
    if (chest) {
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
          <div class="cap">WEAPONS</div>
          <div class="aslots">${weapons}</div>
          <div class="cap">ARMOR</div>
          <div class="aslots">${slots}</div>
          <div class="custom"><div class="cap">TABARD DYE</div><div class="swatches">${dyes}</div>
            <div class="cap">HELMET</div><div class="seg">${helms}</div>
            <div class="cap">PLUME</div><div class="swatches">${plumes}</div></div>
        </div>
      </div>
      <p class="sub small">Everyone starts with a wooden club and a hunting bow that hit for half. Bronze and leather cost wood; iron and steel need scrap iron from slain raiders and a Lv2 / Lv3 barracks. A bow needs both hands, so archers can't carry a shield.</p>
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
    el.querySelectorAll<HTMLElement>('[data-weapon-slot]').forEach((b) => b.addEventListener('click', () => { s.craftWeapon(who, b.dataset.weaponSlot as WeaponSlot); this.renderArmory(); }));
    el.querySelectorAll<HTMLElement>('[data-dye]').forEach((b) => b.addEventListener('click', () => { s.setDye(who, Number(b.dataset.dye)); this.renderArmory(); }));
    el.querySelectorAll<HTMLElement>('[data-helm]').forEach((b) => b.addEventListener('click', () => { s.setHelmetStyle(who, Number(b.dataset.helm)); this.renderArmory(); }));
    el.querySelectorAll<HTMLElement>('[data-plume]').forEach((b) => b.addEventListener('click', () => { s.setPlume(who, Number(b.dataset.plume)); this.renderArmory(); }));
  }

  private cookEl: HTMLElement | null = null;
  private lastCooking = '';
  /** The COOKING POT: what the gnomes can make from the granary, and what one serving does for the head. */
  renderCooking(): void {
    const s = this.scene, b = s.cookingAt;
    if (!b) { this.cookEl?.remove(); this.cookEl = null; this.lastCooking = ''; return; }
    const rows = DISHES.map((d) => {
      const r = RECIPES[d], why = s.cookProblem(r), have = s.pantry[d] | 0, food = FOODS[d];
      const needs = (Object.entries(r.needs) as [FoodKind, number][]).map(([k, n]) => `<span style="color:${FOODS[k].colour}">${foodCount(n, k)}</span> <small>(${Math.floor(s.pantry[k])})</small>`).join(' + ');
      const eat = `+${r.heal} HP · +${Math.round(r.buffAdd * 100)}% ${DIET_STAT_NAME[food.stat]} for ${r.buffSecs}s`;
      return `<div class="aslot">
        <div class="aname">${this.tilePortrait({ key: 'flora', frame: FLORA.pile[d][2] })} ${food.name} <span class="tier">×${have}</span></div>
        <div class="acur">${needs} <small>→ ${r.makes} servings</small></div>
        <button class="btn small ${why ? '' : 'ok'} cook" data-cook="${d}" ${why ? 'disabled' : ''}>COOK · ${foodCount(r.makes, d)}</button>
        <div class="d">${why ? `<em class="warn">${esc(why)}</em>` : `raised on it, a child gains up to +${Math.round(DIET_CAP[food.stat as keyof typeof DIET_CAP] * (food.power ?? 1) * p.dietMul * 100)}% ${DIET_STAT_NAME[food.stat]} for life`}</div>
        <button class="btn small ${have < 1 ? '' : 'ok'} eat" data-eat="${d}" ${have < 1 ? 'disabled' : ''}>EAT ONE · ${eat}</button></div>`;
    }).join('');
    const warm = b.warm ? `the fire is lit · ${b.firewood} night${b.firewood === 1 ? '' : 's'} of wood` : '<em class="warn">COLD HEARTH</em>';
    const on = s.buff && s.buffLeft() > 0 ? `<p class="sub small">Still warming you: <b>${FOODS[s.buff.dish].name}</b>, +${Math.round((s.buff.mul - 1) * 100)}% ${DIET_STAT_NAME[s.buff.stat]} for <span class="warmleft">${Math.ceil(s.buffLeft())}</span>s more.</p>` : '';
    const key = `${b.tx},${b.ty}|${b.warm}|${b.ruined}|${b.firewood}|${s.food | 0}/${s.foodCap}|${FOOD_KINDS.map((k) => s.pantry[k] | 0).join(',')}|${s.buff && s.buffLeft() > 0 ? s.buff.dish : ''}`;
    const html = `<div class="cooking panel">
      <div class="ph"><h2>Cooking pot</h2><span class="cap">${warm} · ${s.food | 0}/${s.foodCap} in store</span><button class="btn small close">CLOSE</button></div>
      <div class="aslots">${rows}</div>
      ${on}
      <p class="sub small">Dishes are food like any other: the granary holds them, the basket carries them (F), and a child fed on them grows far past one raised on raw. Cooking needs a lit hearth — woodcutters keep the pile stocked.</p>
    </div>`;
    if (!this.cookEl) this.cookEl = h('<div class="screen cooking-screen"></div>');
    if (!this.cookEl.isConnected) { this.screens.append(this.cookEl); this.lastCooking = ''; } // showScreen() empties #screens without asking
    const el = this.cookEl;
    // The panel is redrawn every frame. Replacing its DOM that often would swallow every click —
    // a click needs the button it went down on to still be there when the mouse comes up — so the
    // markup is rebuilt only when something in it actually changed, and the countdown is retexted.
    if (key !== this.lastCooking) {
      this.lastCooking = key;
      el.innerHTML = html;
      el.querySelector('.close')!.addEventListener('click', () => s.openCooking(null));
      el.querySelectorAll<HTMLElement>('[data-cook]').forEach((btn) => btn.addEventListener('click', () => { s.cook(RECIPES[btn.dataset.cook as DishKind]); this.renderCooking(); }));
      el.querySelectorAll<HTMLElement>('[data-eat]').forEach((btn) => btn.addEventListener('click', () => { s.eatDish(btn.dataset.eat as FoodKind); this.renderCooking(); }));
    }
    const left = el.querySelector('.warmleft');
    if (left) left.textContent = String(Math.ceil(s.buffLeft()));
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
          <p class="sub">Farm. Raise a family. Plan their upbringing. Train the next generation to defend your town.<br>
          Survive ${p.bossDay} days of raids and <b>beat the Warlord</b>.</p>
          <div class="controls">
            <kbd>WASD</kbd><span>move</span><kbd>Space</kbd><span>dodge roll</span>
            <kbd>G</kbd><span>throw the largest supply stack</span>
            <kbd>T</kbd><span>eat one meal. Your pack is eaten before the granary, and raw food before cooked so a dish's warmth is never spent on a routine meal. Meat and honey fill twice as much per unit, a cooked dish three or four times.</span>
            <kbd>click / C</kbd><span>use the tool you hold, toward the cursor</span>
            <kbd>right click / X</kbd><span>check a villager</span><kbd>1-9 · Tab · wheel</kbd><span>pick a tool</span>
            <kbd>E / Esc</kbd><span>menu</span><kbd>- / =</kbd><span>game speed</span>
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
      </div>`);
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
          <p><b>Fortify:</b> scroll the tool belt for WALL, GATE and STAIRS. Each takes one ground tile and wood for construction. Join walls into a perimeter and connect stairs. With hands equipped, use stairs to climb or descend. Walk along connected wall tops. Gates admit allies automatically; X opens them to enemies too. Hammer repairs damage. Brutes breach walls fast; Wreckers hammer them slowly — a closed perimeter is how your buildings stay standing.</p>
          <p><b>Archers:</b> select a soldier, equip BOW, then SET WALL POST and click a battlement top connected to stairs. RETURN TO PATROL recalls them. Player bow is key 9. Everyone uses the shared quiver; craft 10 arrows for 2 wood at the barracks or its supply button. Arrows hit bodies and cover; wall archers shoot over ramparts.</p>
          <p><b>Towers:</b> every barracks shoots raiders inside its ring (shown while placing it or when it's selected) from its own chest of arrows — the bar over its roof is the stock. When it runs dry the bar flashes red and the tower falls silent: restock 10 arrows for 2 wood at the chest inside (which also holds the armor), or from the barracks card.</p>
          <p><b>Come inside:</b> walk to a house, barracks or tavern door and use hands or X. WASD / joystick moves indoors; tapping the floor also walks there. Use nearby furnishings. The barracks rack makes quiver arrows and its chest restocks the tower and forges armor; tavern meals heal more with upgrades. Walk through the bottom doorway or choose EXIT. Raids continue outside.</p>
          <p>Survive <b>${p.bossDay} days</b>. Raiders first come on day ${p.firstRaidDay} and every ${p.raidEvery} days after, in big bands — and every wave brings more of them and new kinds. On day ${p.bossDay} the <b>Warlord</b> comes — beat him to win. If <b>you</b> die, the run ends (you keep the renown).</p>
          <h3>THE TRICK</h3>
          <p>You can't recruit anyone. <b>Every adult was a child you raised.</b> See RAISING CHILDREN below.</p>
          <h3>EACH DAY</h3>
          <p>Every villager eats 1 food. Crops ripen in ${s.cropDays}–${s.cropDays + 1} days. Couples with a free crib have children. Everyone heals overnight.</p>
          <p><b>Nothing counts until it's carried in.</b> Chopped wood and picked crops ride on the arms of whoever took them: woodcutters haul ${HAUL.villager.wood} wood to the woodyard per trip, farmers ${HAUL.villager.food} food to the granary. Your pack holds mixed supplies and equipment. Food unloads at the granary; wood and scrap unload at the woodyard. Full stores leave the remainder in your pack. Drag pack items to move, equip or drop them. Recover missing basic tools and weapons from either supply building. Long walks are wasted work — keep the woodyard by the grove and the granary by the field.</p>
        </section>
        <section>
          <h3>WHO'S WHO</h3>
          ${who('dungeon', DUNGEON.hero, 'player', 'You', 'Equip a tool, then click: hoe tills, seeds plant, hands harvest, axe chops, sword fights, hammer upgrades.')}
          ${who('farm', FARM.farmerHat, 'farmer', 'Farmer', 'Plants and harvests the fields on their own.')}
          ${who('dungeon', DUNGEON.man, 'woodcutter', 'Woodcutter', 'Fells trees for wood — old growth first, thinning a grove from its edge so the core keeps spreading. Leaves the last ' + TREE_RESERVE + ' standing. Helps in the field when the woodyard is full.')}
          ${who('dungeon', DUNGEON.villager, 'kid', 'Child', 'Born into the house nursery; walks out to a painted pen and trains there, eating only what you toss in. Comes of age as what the pen teaches.')}
          ${who('dungeon', DUNGEON.knight, 'soldier', 'Soldier', 'Guards the barracks and fights raiders.')}
          <p><b>The shaman wand.</b> Pick it from the belt and the fighters answer like an army: <b>left click</b> a soldier (shift adds), or <b>drag a box</b> over several; then <b>right click</b> open ground to send them there — they <b>hold</b> that spot, fighting whatever comes within ${ORDER.leash} tiles and drifting back after — a <b>raider</b> to hunt it down (they hold where it fell), or a <b>wall top</b> to man the battlements (it hands them a bow). <b>F</b> makes the squad follow you; F again and they hold where they stand. With nobody picked, an order goes to every soldier. RETURN TO PATROL on a fighter's card cancels their order.</p>
          ${who('dungeon', DUNGEON.orc, 'raider', 'Raider', 'Walks at the nearest person and hits them. Tramples crops.')}
          ${who('dungeon', 123, 'raider', 'Rat swarm', 'At least 10 arrive together and spread across the field. Foragers doubles their eating time, but crops are never immune. Scare them with equipped weapons or stop them with gates.')}
          ${who('dungeon', DUNGEON.imp, 'raider', 'Snatcher', 'Grabs a child and runs for the map edge. Kill it to free them; kids indoors are safe.')}
          ${who('dungeon', DUNGEON.orc, 'raider', 'Brute', '180 base HP, 24 damage, twice the speed, reach and attack rate, half the knockback. The axe winds up and swings even when you dodge. Devastates fortifications.')}
          ${who('dungeon', DUNGEON.orc, 'raider', 'Wrecker', 'Ignores people and goes for the nearest house it can reach, then any other building. A Lv1 house falls in about 16 seconds. Walled off, it batters the wall — slowly. A ruin keeps its footprint but does nothing until the hammer rebuilds it.')}
          ${who('dungeon', DUNGEON.wizard, 'raider', 'Shaman', 'Keeps its distance and casts bolts. Close in on it.')}
          ${who('farm', FARM.cow, 'woodcutter', 'Boar', `Not a raider: grazes in sounders out in the woods. Leave it be and it leaves you be; strike one and the whole sounder charges whoever did it (${p.boarDmg} a blow) until it calms. Soldiers and towers ignore calm boars but fight provoked ones, and the wand can send soldiers hunting. A sounder of two or more breeds. Drops ${BOAR.meat} meat where it falls — gnomes carry it to the granary, or pick it up by hand. In long grass it is <b>hidden</b>: you'll see the grass stir as it moves, or tread on it and find out. Mow the grass along your lanes.`)}
          <h3>HEARTHS</h3>
          <p>Houses, the barracks and the tavern each keep a <b>woodpile</b> that burns one night's wood at dawn (a house ${HEARTH_WOOD.house[1]}, the barracks ${HEARTH_WOOD.barracks[1]}; more at higher levels). <b>Woodcutters</b> fill the piles before they haul to the woodyard, so every armful spent on warmth is one the woodyard doesn't get — and the card can stock a night from the village pile in a pinch. A building with an empty pile spends the day <b>cold</b>: no births, no drill, no soldier regen, no meals, and its children lose care. Your own axe only clears ground (${p.playerTreeYield} wood a tree); the real wood comes in on woodcutters' backs.</p>
          <h3>BUILDINGS</h3>
          <p>Every building can be wrecked. The <b>HAMMER</b> mends a damaged one (1 wood = 60 HP) and raises a ruin again for half its build cost; on a sound building, 3 hits upgrade it for wood. Every building has three levels — the brass studs on the sign by the door count them, and each level changes the building itself:</p>
          ${building('house', 'House · ' + COST.house + ' wood', 'A couple here has children.')}
          ${building('gnomehouse', 'Gnome House · ' + COST.gnomehouse + ' wood', 'Comes with a gnome couple, who raise a family like any house (cribs, a hearth, food to spare). Gnome children need no pen: they play by the cottage, eat only what you throw within a few tiles of it (BASKET), and grow into gnomes. Grown gnomes forage: they walk to the nearest ripe wild plant, pick one unit, carry it to the granary and go again. They never fight — raiders send them running home like anyone else. <b>You start without the craft:</b> one cottage stands out in the woods, ringed by mushrooms, with a glade of warm motes drifting over it. Walk into the glade and keep going until the cottage itself comes into sight — the family is yours, and they teach you to raise more.')}
          ${building('barracks', 'Barracks · ' + COST.barracks + ' wood', 'Drills the drill yard; its tower shoots raiders.')}
          ${building('granary', 'Granary', 'Holds your food; the harvest is carried here. The crate stack beside it climbs as the store fills.')}
          ${building('woodyard', 'Woodyard', 'Holds your wood; chopped logs are carried here. The log stack beside the cabin climbs as it fills.')}
          <h3>FOOD & DIET</h3>
          <p><b>Three crops.</b> Take <b>SEEDS</b> and press <b>F</b> to choose: ${CROP_KINDS.map((k) => `<b>${FOODS[k].name.toLowerCase()}</b> (${FOODS[k].blurb})`).join(', ')}. Sow on tilled soil; farmers harvest what is ripe and <b>replant the same crop</b>, so the field stays what you made it. The starting field has a row of each.</p>
          <p><b>Foraging.</b> Five wild plants regrow after picking: <b>berry bushes</b> at the forest edge, <b>mushrooms</b> in the shade of old growth, <b>hazels</b> where the trees thin out, <b>wild garlic</b> dotted over the meadow and <b>burdock</b> along the trails (hazelnuts +HP, garlic +work, burdock +speed). Grown <b>gnomes forage for you</b>: one unit at a time, carried to the granary, so a gnome house by the woods is a slow but steady larder. You can also pick by hand: <b>Berry bushes</b> grow at the forest edge and <b>mushrooms</b> in the shade of old growth. Pick them with <b>HANDS</b> (${FOODS.berry.yield} berries, ${FOODS.mushroom.yield} mushrooms); they grow back in ${s.regrowDays('berry')} / ${s.regrowDays('mushroom')} days, and old trees seed new patches now and then. Berries make <b>fierce</b> children (+damage); a mushroom meal is worth a <b>care point</b>. <b>Boar meat</b> is the hunter's food: it does nothing for grown-ups, but children raised on it come of age with twice the damage bonus berries give.</p>
          <p><b>What they eat is who they become.</b> The granary keeps each kind apart. The <b>BASKET</b> takes one kind (F to choose) and what lands in a pen is what its children eat. Every unit of a food moves that child toward its bonus — ${p.dietFull} units of one kind for the full ${Math.round(DIET_CAP.hp * p.dietMul * 100)}% HP (wheat), ${Math.round(DIET_CAP.speed * p.dietMul * 100)}% speed (carrots), ${Math.round(DIET_CAP.work * p.dietMul * 100)}% work speed (tomatoes) or ${Math.round(DIET_CAP.dmg * p.dietMul * 100)}% damage (berries) — and a mixed diet gives a little of each. The bonuses <b>lock in at coming of age</b> and last for life; the child's card shows the diet as it builds. Adults eat whatever is in store and it changes nothing.</p>
          <h3>RAISING CHILDREN</h3>
          <p><b>Life.</b> Everyone is born an <b>infant</b> in the house nursery (${p.infantDays} days), walks out a <b>child</b> to a training pen until age ${s.adultAge.toFixed(1)}, works as an <b>adult</b> for ${p.adultDays} days, then grows <b>old</b> — slower and grey — and passes away about ${p.elderDays} days later. The sliders (backtick) under <b>lifecycle</b> set every one of these.</p>
          <p><b>Births.</b> Every ${p.birthEvery} seconds a couple in a warm house with a free <b>crib</b> (${p.cribs} in a Lv1 nursery, +1 per level) has a ${Math.round(100 * p.birthChance)}% chance of a child (needs food to spare). A house can raise at most cribs ÷ infantDays children a day, so more houses and bigger nurseries mean more children. The <b>Baby Fever</b> legacy boon adds ${Math.round(100 * p.feverBonus)}% while the larder holds <b>${p.feverDays}+ days of food</b> for everyone — the FOOD tile shows the days, and a FEVER badge glows while it holds. More mouths shrink the surplus, so it only lasts if the fields keep up.</p>
          <p><b>Pens.</b> Take the <b>PEN</b> tool (F picks the kind: <b>training field</b>, <b>wood lot</b> or <b>drill yard</b>) and paint it over open grass; painting the same kind again erases it. A child leaving the nursery walks to the <b>nearest pen</b> and lives there day and night. <b>The pen decides what they become</b> — a field makes farmers, a wood lot woodcutters, a drill yard soldiers (while a warm barracks stands) — and ${Villager.drillNeeded(s)} fed days there make them <b>skilled</b>: faster work, bigger harvests and loads, tougher soldiers. A child with no pen stays a child until one is painted.</p>
          <p><b>Every child can starve.</b> Nobody young eats from the granary. Infants are nursed: they eat only when a fed grown-up lives at home, so an empty larder or an empty house starves the nursery. Children eat only what lies in their pen — or, for gnome children, what lies within ${GNOME_YARD} tiles of their cottage. ${p.kidStarveDays} hungry days are fatal.</p>
          <p><b>Feeding the pens.</b> Pen children eat nothing from the granary — only what you throw in. Take the <b>BASKET</b>, walk up to the granary to fill it (${STACK.food} food), point anywhere within ${p.tossRange} tiles and throw: ${p.tossSize} food flies there, bounces off walls and trees, rolls and stops wherever it stops. Children eat only what lies <b>inside their pen</b> (${p.kidFood} a day each) — a throw that rolls out is wasted until you walk over it. A child that misses a day stops training; after ${p.kidStarveDays} hungry days they starve. The basket's hint and the pen's hover tell you how many are there and how much food is left.</p>
          <p><b>Care.</b> Each dawn a child earns care for the day before: fed · <b>well fed</b> (ate from the pen that day) · both parents alive · another child at home · a Lv2+ house · your <b>encouragement</b>. Running from raiders, going hungry or losing a parent costs care. It averages into <b>stars</b> (★ to ★★★★★) that are fixed at coming of age and last for life: each star is +6% HP and work speed; five stars make a <b>gifted</b> adult with a trait (Hardy, Quick, Brave, Green Thumb, Tireless); a neglected child grows up frail.</p>
          <p><b>Encourage.</b> Walk up to a child and press X (or tap them, or the button on their card): a moment together, once a day, worth a care point and a day of apprenticeship. During a raid it also sends them inside.</p>
          <p><b>Children go to bed at dusk</b> and sleep indoors until dawn, and they <b>run for the nearest door</b> when raiders are near. Snatchers take children caught in the open.</p>
          <p><b>Renown</b> comes from children raised: 20 each, plus 8 per star.</p>
          <h3>WEAPONS</h3>
          <p>Everyone starts with a <b>wooden club</b> and a <b>hunting bow</b> that hit for half damage. At the barracks chest forge a <b>bronze</b> sword or yew bow for wood, then <b>iron</b> and <b>steel</b> for wood plus scrap iron (Lv2 / Lv3 barracks) — steel hits for ×1.3. Each fighter carries their own; forge for your soldiers too.</p>
          <h3>ARMOR</h3>
          <p>You and your soldiers have four armor slots — <b>helmet</b> (HP), <b>chest</b> (less damage taken), <b>legs</b> (speed) and <b>shield</b> (a chance to block melee hits outright; archers can't carry one). Each has three tiers: <b>leather</b> for wood, <b>iron</b> and <b>steel</b> for wood plus <b>scrap iron</b> dropped by slain raiders — walk over it (needs a Lv2 / Lv3 barracks). Open the ARMORY with <kbd>V</kbd>, from the barracks card, or from a soldier's card; dye tabards and pick helmets and plumes there too — what they wear is what you see.</p>
          <h3>SOLDIERS</h3>
          <p>Paint a <b>drill yard</b> (PEN tool, F until it says drill yard) and throw food into it: every child who lives there comes of age a <b>soldier</b>, skilled after ${Villager.drillNeeded(s)} fed days of drill. A warm barracks is needed to drill anyone. Every child's outlook is shown in the inspector and the villagers list — no surprises.</p>
          <h3>FOG & THE OGRE</h3>
          <p>The world is dark until someone sees it. You see 10 tiles, buildings light 8, soldiers 6 and other villagers 4; what you've seen stays on the map, dimmed, but raiders in the dark are invisible until they step into sight — walls with people on them are your eyes. The minimap shows how much you've explored.</p>
          <p>Somewhere 50–85 tiles out in the woods is <b>the Ogre's lair</b>. On day 2 the woodcutters give you a direction. The Ogre is huge — far bigger than any raider — sleeps in his lair by day and prowls the woods around it at night, hunting anyone within ${OGRE.hunt} tiles. He has three telegraphed attacks — a wide swing (${OGRE.swing.dmg}), a ground smash (${OGRE.smash.dmg}, cracks walls and buildings) and a charge (${OGRE.charge.dmg}, batters whatever stops it) — shrugs off knockback and heals a quarter of his ${OGRE.hp} HP each day he sleeps. Once he has your scent he never sleeps again and will follow you home, so don't rouse him until you can finish him: iron mail, a shield, a few archers. Slaying him is worth ${OGRE.scrap} scrap and ${OGRE.renown} renown.</p>
          <h3>GROVES</h3>
          <p>Trees spread onto neighbouring grass — but a lone tree barely does (about 1% a day) while a tree inside a grove seeds fast (up to 11%). A sapling with two or more trees beside it grows in ${SHELTERED_SAPLING_DAYS} days instead of ${SAPLING_DAYS}. So plant trees <b>together</b>, near the woodyard, and let the grove do the work.</p>
          <p>Trees age: after ${OLD_GROWTH_DAYS} days they become <b>old growth</b> — taller, and worth ${p.oldYield} wood instead of ${p.treeYield}. Woodcutters take old growth first and thin a grove from its edge.</p>
          <p>Beyond the village clearing the wilderness is <b>long grass</b>: anyone wading through it — you, your villagers, raiders — crawls at a fraction of their pace. Trails stay short and make fast lanes. A <b>SWORD</b> swing mows every tile in its arc (the spin finisher clears a ring), and mown grass never grows back — so the lanes you cut are yours to keep, and the raiders' too. Things <b>hide</b> in it: a boar in long grass is unseen until it moves (the grass stirs) or someone treads on it.</p>
          <p>Seeds only land on grass, never next to buildings — a ring of tilled soil is a firebreak that stops a grove spreading. <b>SEEDS</b> on grass plants a tree; clear stumps and saplings with the <b>AXE</b> or <b>HOE</b> (the hoe also flattens soil back to grass). Buildings can go on grass, stumps or soil — not on trees, crops or other buildings. With a mouse, tools hit the tile you <b>point at</b> when it's next to you, otherwise the tile you face (the gold box). A building goes <b>where you point</b> (within 6 tiles; the pointer marks the door); otherwise straight ahead of you. Anyone standing in the footprint, you included, is stepped out onto the doorstep.</p>
        </section>
        <section>
          <h3>CONTROLS</h3>
          <div class="controls">
            <kbd>WASD</kbd><span>move (joystick on phone)</span>
            <kbd>Space</kbd><span>dodge roll — a committed tumble the way you are moving (or facing). It goes clean through bodies but not through walls, and you cannot steer or swing until it lands. A raider's blow checks its reach at the moment it strikes, so rolling out of a wind-up beats it.</span>
            <kbd>G</kbd><span>throw the largest wood, food or scrap stack toward the cursor. Drag any pack item onto the world to drop it. Walk away from your dropped items before returning to pick them up.</span>
            <kbd>click / C</kbd><span>use the tool you hold. A click also turns you toward the cursor. The bottom bar says what the tool will do. The sword swings an arc; it only hits what it reaches.</span>
            <kbd>right click / X</kbd><span>check a villager (opens the inspector)</span>
            <kbd>1-9 · Tab · wheel</kbd><span>pick a tool — hands, hoe, seeds, axe, sword, house, barracks, hammer</span>
            <kbd>Z</kbd><span>camera zoom 1× / 1.5× / 2× / 3× — 1× shows most of the map</span>
            <kbd>E / Esc</kbd><span>menu (pause, restart, how to play)</span>
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

    const card = (n: Node): string => {
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
      const at = (tier: number, side?: string) => ns.find((n) => n.tier === tier && (tier === 1 || n.side === side))!;
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
