import { getGui } from '@shared/index';
import { Villager, Raider, Player, Mover, type Tool } from '../agents';
import { CHAR, TOWN, FARM, DUNGEON, framePos } from '../atlas';
import { OGRE, HAUL, COST, p, RUN, LEGACY_TEST_MODE, LEVEL_PERKS, CALLING_NAME, TRAITS, HEARTY_RATION, ARMOR, ARMOR_SLOTS, DYES, DYE_NAMES, PLUMES, type Calling, type ArmorSlot, UPGRADE_COST, CADET_AGE_BEFORE, LEVEL_LOOKS, SAPLING_DAYS, SHELTERED_SAPLING_DAYS, TREE_RESERVE, OLD_GROWTH_DAYS, TREE_YIELD, OLD_YIELD } from '../config';
import { BRANCHES, nodeById, nodesOf, type Branch, type Node } from '../meta';
import type { VillageScene, EventKind, GameEvent } from '../main';
import { Minimap } from './minimap';
import { skyAt } from '../night';
import { frameDataUrl, BUILDING_TEXTURE } from '../pixelart';
import { charImg, armorStats } from '../characters';
import { lookFor } from '../render';
import { BUILDINGS, MAX_LEVEL, type BuildingKind } from '../world';

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

const ROLE_LABEL: Record<string, string> = { kid: 'Child', farmer: 'Farmer', woodcutter: 'Woodcutter', soldier: 'Soldier' };
const ENEMY_LABEL: Record<string, string> = { raider: 'Raider', warlord: 'Warlord', rat: 'Rat — eats crops', snatcher: 'Snatcher — steals children', brute: 'Brute — heavy', shaman: 'Shaman — ranged' };

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

  constructor(private scene: VillageScene) {}

  mount(): void {
    const s = this.scene;

    // --- top bar: labelled stat tiles
    const tile = (cls: string, cap: string, inner: string, title = '') => `<div class="stat ${cls}" title="${esc(title)}"><span class="cap">${cap}</span><span class="val">${inner}</span></div>`;
    this.top = h(`<div class="topbar panel">
      ${tile('t-day', 'DAY', `<span class="sun"></span><span class="day"></span><span class="hour"></span>`, 'Survive to day 21 and beat the Warlord')}
      ${tile('t-wood', 'WOOD', `${spr('town', TOWN.iconWood, 24)}<span class="num wood"></span>`, 'Chop trees. Houses cost 20, barracks 30. The woodyard sets the cap')}
      ${tile('t-food', 'FOOD', `${spr('farm', FARM.iconTomato, 24)}<span class="num food"></span>`, 'Each villager eats 1 a day. Harvest ripe crops. The granary sets the cap')}
      <div class="stat t-scrap" title="Scrap iron looted from slain raiders — forges iron and steel armor at the barracks"><span class="cap">SCRAP</span><span class="val"><span class="scrap-ico"></span><span class="num scrap"></span></span></div>
      <div class="stat t-pop" title="Your villagers by role"><span class="cap">VILLAGERS</span><span class="val pop"></span></div>
      <div class="spacer"></div>
      <div class="stat t-raid" title="Raiders attack every few days; the Warlord comes on day 21"><span class="cap">NEXT RAID</span><span class="val raid"></span></div>
      ${tile('t-hp', 'YOUR HP', `<span class="hearts"></span>`, 'You heal overnight. If you die the run ends')}
      <div class="stat t-speed" title="Game speed"><span class="cap">SPEED</span><span class="val speed">
        <button class="btn small" data-speed="1">1x</button><button class="btn small" data-speed="4">4x</button><button class="btn small" data-speed="16">16x</button>
        <button class="btn small pause" title="Menu (E / Esc)">II</button>
      </span></div>
      <button class="btn small help" title="How to play">?</button>
    </div>`);
    this.top.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => b.addEventListener('click', () => (s.speed = Number(b.dataset.speed))));
    this.top.querySelector('.pause')!.addEventListener('click', () => s.togglePause());
    this.top.querySelector('.help')!.addEventListener('click', () => this.showHelp());

    // --- tool belt: the equipped tool decides what E does
    const slot = (tool: Tool, key: string, frame: number, label: string, title: string, cost?: number) =>
      `<div class="slot" data-tool="${tool}" title="${esc(title)}">${spr(key, frame, 32)}<span class="lbl">${label}</span>${cost ? `<span class="cost">${cost}${spr('town', TOWN.iconWood, 16)}</span>` : ''}</div>`;
    this.hotbar = h(`<div class="hotbar">
      <div class="slots panel">
        <span class="cap slots-cap">TOOLS <kbd>1-9</kbd></span>
        ${slot('hands', 'farm', FARM.iconHand, 'HANDS', 'Harvest ripe crops')}
        ${slot('hoe', 'town', TOWN.iconHoe, 'HOE', 'Till grass into soil; clears stumps; three hits on soil flatten it back to grass')}
        ${slot('seeds', 'farm', FARM.grassTuft, 'SEEDS', 'Crops on tilled soil, trees on grass')}
        ${slot('axe', 'town', TOWN.iconAxe, 'AXE', 'Chop trees for wood (3 hits); clears stumps and saplings')}
        ${slot('sword', 'dungeon', DUNGEON.sword, 'SWORD', 'Swing at raiders in front of you')}
        ${slot('house', 'town', TOWN.wallWoodDoor, 'HOUSE', 'A family of 4 lives here and has children', COST.house)}
        ${slot('barracks', 'town', TOWN.wallStoneDoor, 'BARRACKS', 'Sponsors sworn houses: their children drill here and become soldiers', COST.barracks)}
        ${slot('hammer', 'town', TOWN.iconHammer, 'HAMMER', 'Upgrade the building in front of you (3 hits)')}
        ${slot('bow', 'dungeon', DUNGEON.sword, 'BOW', 'Fire physical arrows. Shared ammunition is made at the barracks')}
        ${slot('wall', 'town', TOWN.wallStoneDoor, 'WALL', 'Build a connected stone perimeter. 4 wood per segment', 4)}
        ${slot('gate', 'town', TOWN.wallWoodDoor, 'GATE', 'Friendly villagers pass; X toggles opening to everyone', 12)}
        ${slot('stairs', 'town', TOWN.iconHammer, 'STAIRS', 'Connect stairs to your walls. Use hands or X to climb and descend', 10)}
        ${slot('tavern', 'town', TOWN.wallWoodDoor, 'TAVERN', 'A cozy place to eat, rest and gather', COST.tavern)}
      </div>
      <div class="hint"><kbd>click / C</kbd><span class="hint-text"></span></div>
    </div>`);
    this.hotbar.querySelectorAll<HTMLElement>('.slot').forEach((el) => el.addEventListener('click', () => s.setTool(el.dataset.tool as Tool)));

    this.feed = h('<div class="feed"></div>');
    this.toasts = h('<div class="toasts"></div>');
    this.overlay.append(this.top, this.hotbar, this.feed, this.toasts);

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
    const supply = h('<div class="quiver panel"><span class="quiver-count"></span><button class="btn small fletch">+10 ARROWS · 2 WOOD</button><button class="btn small leave-room" hidden>EXIT BUILDING</button></div>');
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
          ['click · C', 'use the held tool, toward the cursor'],
          ['right click · X', 'check a villager'],
          ['1 – 9', 'pick a tool'],
          ['Tab · wheel', 'next / previous tool'],
          ['Z', 'camera zoom'],
          ['E · Esc', 'menu'],
          ['- · =', 'game speed'],
          ['H', 'this panel'],
          ['M', 'sound on / off'],
          ['?', 'how to play'],
        ];
    const panel = h(`<div class="ctrl-panel">
      <button class="ctrl-tab" title="Controls (H)">${spr('town', TOWN.iconKey, 16)} CONTROLS <span class="arrow">▴</span></button>
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
      if ((e.key === 'h' || e.key === 'H') && !(e.target as HTMLElement).closest('input')) set(!open);
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
    this.stage.classList.toggle('raid', s.raidActive);
    if (s.selectedBuilding !== this.lastBuilding) { this.lastBuilding = s.selectedBuilding; this.renderInspector(true); if (this.touch && s.selectedBuilding) { this.showTab('inspector'); this.side.classList.add('open'); } }
    if (this.touch && s.selected !== this.lastSelected) {
      this.lastSelected = s.selected;
      if (s.selected) { this.showTab('inspector'); this.side.classList.add('open'); }
    }
    this.topT += dt; this.rosterT += dt;
    this.minimap.render(dt, s.tilesChanged);
    if (this.topT > 0.1) {
      if (s.fog) { const pct = `${Math.round(s.fog.exploredShare * 100)}% explored`; if (this.exploredEl.textContent !== pct) this.exploredEl.textContent = pct; }
      this.topT = 0; this.renderTop(); this.renderHotbar();
      this.inspT += 0.1; if (this.inspT >= 0.25) { this.inspT = 0; this.renderInspector(); } // cards rebuild their DOM: a few times a second is plenty
    }
    if (this.rosterT > 0.5) { this.rosterT = 0; this.renderRoster(); }
    this.renderFeed();
  }

  private renderTop(): void {
    const s = this.scene;
    const quiver = this.side.querySelector('.quiver-count'); if (quiver) quiver.textContent = `SHARED QUIVER · ${s.arrows} arrows`;
    const exit = this.side.querySelector<HTMLButtonElement>('.leave-room'); if (exit) exit.hidden = !s.interior.active;
    const vs = s.villagers();
    const count = (r: string) => vs.filter((v) => v.role === r).length;
    const hour = Math.floor(s.dayTime * 24);
    const night = s.dayTime < 0.22 || s.dayTime > 0.8;
    const raidIn = s.nextRaidDay - s.day;
    const held = s.player.load ? `${s.player.load.kind}${s.player.load.n}` : '';
    const key = `${s.day}|${hour}|${held}|${s.food | 0}/${s.foodCap}|${s.wood | 0}/${s.woodCap}|${s.scrap}|${count('farmer')}|${count('woodcutter')}|${count('kid')}|${count('soldier')}|${s.player.hp}|${s.raidActive}|${s.boss?.hp ?? ''}|${raidIn}|${s.speed}|${s.paused}|${night}`;
    if (key === this.lastTop) return;
    this.lastTop = key;

    const q = (sel: string) => this.top.querySelector<HTMLElement>(sel)!;
    q('.sun').classList.toggle('moon', night);
    // the day chip takes on the sky's colour: peach at dawn, blue at night
    const sky = skyAt(s.dayTime);
    this.top.style.setProperty('--sky', `rgba(${sky.r}, ${sky.g}, ${sky.b}, ${Math.min(0.85, sky.alpha * 1.3).toFixed(2)})`);
    q('.day').textContent = `DAY ${s.day}/${RUN.days}`;
    q('.hour').textContent = `${String(hour).padStart(2, '0')}:00`;
    const inHand = (kind: string) => s.player.load?.kind === kind ? `<em class="hand">+${s.player.load.n} in hand</em>` : '';
    q('.wood').innerHTML = `${s.wood | 0}<small>/${s.woodCap}</small>${inHand('wood')}`;
    q('.food').innerHTML = `${s.food | 0}<small>/${s.foodCap}</small>${inHand('food')}`;
    q('.scrap').textContent = String(s.scrap);
    q('.pop').innerHTML = ([
      ['farmer', CHAR.farmer, 'FARM'], ['woodcutter', CHAR.woodcutter, 'WOOD'], ['kid', CHAR.kid, 'KIDS'], ['soldier', CHAR.soldier, 'ARMY'],
    ] as [string, { key: string; frame: number }, string][]).map(([r, c, lbl]) => `<span class="chip ${r}" title="${ROLE_LABEL[r]}s">${spr(c.key, c.frame, 24)}<b>${count(r)}</b><i>${lbl}</i></span>`).join('');
    const raid = q('.raid');
    const bossNext = s.nextRaidDay === RUN.bossDay;
    const orc = spr('dungeon', DUNGEON.orc, 24, 'flip');
    if (s.raidActive && s.boss && !s.boss.dead) {
      const pct = Math.max(0, (s.boss.hp / s.boss.maxHp) * 100);
      raid.innerHTML = `${orc}<span>WARLORD</span><div class="bar boss"><i style="width:${pct}%"></i></div>`;
      raid.className = 'val raid now';
    } else if (s.raidActive) { raid.innerHTML = `${orc}<span>UNDER ATTACK!</span>`; raid.className = 'val raid now'; }
    else if (raidIn <= 1) { raid.innerHTML = `${orc}<span>${bossNext ? 'WARLORD TOMORROW' : 'TOMORROW'}</span>`; raid.className = 'val raid soon'; }
    else { raid.innerHTML = `${orc}<span>${bossNext ? 'Warlord' : 'in'} ${raidIn} days</span>`; raid.className = bossNext ? 'val raid soon' : 'val raid'; }
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
      el.classList.toggle('off', (tool === 'house' || tool === 'barracks') && s.wood < COST[tool]);
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

  private renderInspector(force = false): void {
    const s = this.scene;
    const m = s.selected;
    const head = `<div class="ph">${spr('town', TOWN.sign, 24)}<h2>Inspector</h2></div>`;
    const b = s.selectedBuilding;
    if (!m && b && b.kind === 'lair') {
      const dead = b.level >= 3;
      const html = `${head}<div class="head"><img class="art" src="${frameDataUrl(s, BUILDING_TEXTURE.lair, dead ? 2 : 0)}" alt=""><div><div class="name">${BUILDINGS.lair.name}</div><span class="badge ${dead ? 'farmer' : 'soldier'}">${dead ? 'silent — the fire is out' : 'the Ogre sleeps here by day'}</span></div><button class="btn small close">x</button></div>
        <p>${dead ? 'The Ogre is slain. Bones and cold ashes are all that remain.' : `A cave mouth banked with earth and bones. The Ogre sleeps inside from dawn to dusk and prowls the woods around it at night — he hunts anyone within ${OGRE.hunt} tiles. He hits for ${OGRE.dmg} with a slow, obvious swing: step back when he raises his club. He has ${OGRE.hp} HP and heals a quarter of it each day he sleeps.`}</p>`;
      this.inspector.innerHTML = html;
      this.inspector.querySelector('.close')?.addEventListener('click', () => s.selectBuilding(null));
      return;
    }
    if (!m && b) {
      // a building: what it does, what the next level adds, and for houses the RAISE toggle
      const cost = b.level < MAX_LEVEL ? UPGRADE_COST[b.kind][b.level] : 0;
      let html = `${head}<div class="head"><img class="art" src="${frameDataUrl(s, BUILDING_TEXTURE[b.kind], b.level - 1)}" alt=""><div><div class="name">${BUILDINGS[b.kind].name} <small>Lv${b.level}</small></div><span class="badge ${b.kind === 'barracks' ? 'soldier' : 'farmer'}">${LEVEL_PERKS[b.kind][b.level]}</span></div><button class="btn small close">x</button></div>`;
      html += `<div class="rows">`;
      if (b.kind === 'house') html += `<b>Beds</b><span>${b.residents} / ${s.beds(b)}</span>`;
      if (b.kind === 'barracks') html += `<b>Sponsors</b><span>${s.world.swornHouses.length} / ${s.world.sponsorship(s.mods.sponsorBonus)} houses sworn</span>`;
      html += `<b>Next</b><span>${b.level < MAX_LEVEL ? `Lv${b.level + 1}: ${LEVEL_PERKS[b.kind][b.level + 1]} <em>· ${cost} wood with the hammer</em>` : 'max level'}</span></div>`;
      if (['house', 'barracks', 'tavern'].includes(b.kind)) {
        const onStep = s.doorAt() === b;
        html += `<p class="d">${onStep ? '<b>Walk up into the door</b> to go inside.' : 'To go inside, stand on the doorstep and walk up into the door.'}</p>`;
      }
      if (b.kind === 'barracks') html += `<p>Equip soldiers with bows in their cards. SET WALL POST, then tap a connected battlement. Stairs are required.</p><button class="btn small craft-arrows">FLETCH 10 ARROWS · 2 WOOD</button> <button class="btn small ok open-armory">ARMORY</button><p class="d">Forges leather now, iron at Lv2, steel at Lv3. Scrap iron comes from slain raiders.</p>`;
      if (b.kind === 'house') {
        const calling = b.calling ?? 'farmer';
        const why = calling === 'soldier' ? null : s.swearProblem(b);
        const seg = (c: Calling, label: string, dis = false) => `<button class="btn small ${calling === c ? 'on' : ''}" data-raise="${c}" ${dis ? 'disabled' : ''}>${label}</button>`;
        html += `<div class="raise"><div class="cap">RAISE CHILDREN AS</div><div class="seg">${seg('farmer', 'FARMERS')}${seg('woodcutter', 'CUTTERS')}${seg('soldier', 'SOLDIERS', !!why)}</div>
          <div class="d">${calling === 'soldier' ? `Sworn to the barracks: children drill from age ${s.adultAge - CADET_AGE_BEFORE} and come of age as soldiers.` : `Children apprentice at ${calling === 'farmer' ? 'the field' : 'the woodyard'} from age ${s.adultAge - CADET_AGE_BEFORE} and come of age <b>skilled</b>.`}${why ? ` <em class="warn">Soldiers: ${esc(why)}</em>` : ''}</div></div>`;
        html += `<div class="raise"><div class="cap">CHILDREN'S RATIONS</div><div class="seg"><button class="btn small ${b.hearty ? '' : 'on'}" data-rations="plain">PLAIN</button><button class="btn small ${b.hearty ? 'on' : ''}" data-rations="hearty">HEARTY</button></div>
          <div class="d">${b.hearty ? `Each child eats ${HEARTY_RATION} food a day and grows up <b>well fed</b> — a care star's worth every day.` : 'Hearty rations cost double food per child but count toward their care.'}</div></div>`;
      }
      if (force || html !== this.lastInspector) {
        this.inspector.innerHTML = html; this.lastInspector = html;
        this.inspector.querySelector('.close')?.addEventListener('click', () => s.selectBuilding(null));
        this.inspector.querySelector('.craft-arrows')?.addEventListener('click', () => s.craftArrows());
        this.inspector.querySelector('.open-armory')?.addEventListener('click', () => { s.openArmory(s.player); this.side.classList.remove('open'); });
        this.inspector.querySelectorAll<HTMLButtonElement>('[data-raise]').forEach((el) => el.addEventListener('click', () => { s.setCalling(b, el.dataset.raise as Calling); this.renderInspector(true); }));
        this.inspector.querySelectorAll<HTMLButtonElement>('[data-rations]').forEach((el) => el.addEventListener('click', () => { s.setRations(b, el.dataset.rations === 'hearty'); this.renderInspector(true); }));
      }
      return;
    }
    if (!m || m.dead) {
      const html = `${head}<p class="empty">Click or tap a villager or a building.<br>Children are the point: pick each house's <b>calling</b>, feed them well, keep them safe, and <b>encourage</b> them — how they're raised is who they become.</p>`;
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
      html += `<b>Age</b><span>${m.age} days${m.role === 'kid' ? ` <em>· grows up in ${Math.max(0, p.adultAge + s.mods.adultAgeDelta - m.age)}</em>` : ''}</span>`;
      html += `<b>Home</b><span>${m.home.residents} of ${s.beds(m.home)} beds · raises ${CALLING_NAME[m.home.calling ?? 'farmer']}${m.home.hearty ? ' · hearty' : ''}</span>`;
      html += `<b>Fed</b><span>${m.hungerDays === 0 ? 'yes' : `<em class="warn">hungry for ${m.hungerDays} days</em>`}</span>`;
    }
    if (m.load) html += `<b>Carrying</b><span>${m.load.n} ${m.load.kind}</span>`;
    html += `<b>Doing</b><span>${esc(m.task || '—')}${m instanceof Villager && m.carriedBy ? ` <em class="warn">— kill the ${esc(m.carriedBy.name.toLowerCase())} to free them</em>` : ''}</span></div>`;
    if (m instanceof Villager && m.role === 'kid') {
      const o = m.outlook(s), need = Villager.drillNeeded(s), startAge = s.adultAge - CADET_AGE_BEFORE;
      const stars = m.starsNow();
      const line = m.age < startAge ? `apprentices from age ${startAge} · ${need} days to be skilled`
        : `apprentice · ${m.trained}/${need} days${m.calling === 'soldier' && o.role !== 'soldier' ? ' — <em class="warn">too late to finish drill</em>' : ''}`;
      const list = s.careToday(m).map((c) => `<li class="${c.ok ? 'ok' : ''}">${c.ok ? '✓' : '✗'} ${c.label}${!c.ok && c.note ? ` <small>· ${esc(c.note)}</small>` : ''}</li>`).join('');
      const why = s.encourageProblem(m);
      html += `<div class="upbring"><div class="cap">UPBRINGING</div>
        <div class="stars">${'★'.repeat(stars)}<span class="dim">${'☆'.repeat(5 - stars)}</span> <small>${stars === 5 ? 'gifted' : stars >= 3 ? 'well raised' : stars >= 2 ? 'getting by' : m.careDays ? 'neglected' : 'a fresh start'}</small></div>
        <div class="lean ${o.role === 'soldier' ? 'm' : 'c'}">will be ${o.skilled ? 'a skilled' : 'a plain'} ${o.role.toUpperCase()} at age ${s.adultAge}</div><div class="d">${line}</div>
        <ul class="care">${list}</ul>
        <button class="btn small ok encourage" ${why ? 'disabled' : ''}>ENCOURAGE${why ? ` · ${esc(why)}` : ''}</button></div>`;
    } else if (m instanceof Villager) {
      html += `<div class="upbring"><div class="cap">RAISED</div><div class="stars">${'★'.repeat(m.stars)}<span class="dim">${'☆'.repeat(5 - m.stars)}</span> <small>${m.skilled ? 'skilled' : 'plain'}${m.trait ? ` · ${TRAITS[m.trait].name} — ${TRAITS[m.trait].blurb}` : ''}</small></div></div>`;
    }
    if (m instanceof Player || (m instanceof Villager && m.role === 'soldier')) {
      const st = armorStats(m.armor);
      const pips = ARMOR_SLOTS.map((slot) => `<span class="pip t${m.armor[slot]}" title="${ARMOR[slot].tiers[m.armor[slot]].name}">${ARMOR[slot].name[0]}${m.armor[slot] ? '·'.repeat(m.armor[slot]) : ''}</span>`).join('');
      html += `<div class="raise"><div class="cap">ARMOR</div><div class="pips">${pips}</div><div class="d">${st.hp ? `+${st.hp} HP · ` : ''}${Math.round((1 - st.dmgMul) * 100)}% less damage · ${Math.round(st.block * 100)}% block${st.speedMul > 1 ? ` · +${Math.round((st.speedMul - 1) * 100)}% speed` : ''}</div><button class="btn small open-armory">ARMORY</button></div>`;
    }
    if (m instanceof Villager && m.role === 'soldier') html += `<div class="raise"><div class="cap">EQUIPMENT & ORDERS</div><div class="seg"><button class="btn small ${m.weapon === 'sword' ? 'on' : ''}" data-weapon="sword">SWORD</button><button class="btn small ${m.weapon === 'bow' ? 'on' : ''}" data-weapon="bow">BOW</button></div><p>Arrows in shared quiver: ${s.arrows}. ${m.post ? `Post: ${m.post.tx}, ${m.post.ty}.` : 'Patrolling on the ground.'}</p><button class="btn small post-soldier">${s.posting === m ? 'CANCEL PLACEMENT' : 'SET WALL POST'}</button><button class="btn small recall-soldier">RETURN TO PATROL</button></div>`;
    if (html !== this.lastInspector) {
      this.inspector.innerHTML = html;
      this.lastInspector = html;
      this.inspector.querySelector('.close')?.addEventListener('click', () => s.select(null));
      this.inspector.querySelector('.encourage')?.addEventListener('click', () => { if (m instanceof Villager) s.encourage(m); this.renderInspector(true); });
      this.inspector.querySelector('.open-armory')?.addEventListener('click', () => { s.openArmory(m); this.side.classList.remove('open'); });
      this.inspector.querySelectorAll<HTMLElement>('[data-weapon]').forEach(el => el.addEventListener('click', () => { if (m instanceof Villager) s.equipSoldier(m, el.dataset.weapon as 'bow' | 'sword'); this.renderInspector(true); }));
      this.inspector.querySelector('.post-soldier')?.addEventListener('click', () => { if (m instanceof Villager) s.posting = s.posting === m ? null : m; this.side.classList.remove('open'); this.renderInspector(true); });
      this.inspector.querySelector('.recall-soldier')?.addEventListener('click', () => { if (m instanceof Villager) { m.post = null; m.clearGoal(); s.posting = null; } this.renderInspector(true); });
    }
  }

  private renderRoster(): void {
    const s = this.scene;
    const vs = s.villagers();
    const groups: [string, string, Villager[]][] = [
      ['Children', 'kid', vs.filter((v) => v.role === 'kid').sort((a, b) => b.age - a.age)],
      ['Soldiers', 'soldier', vs.filter((v) => v.role === 'soldier')],
      ['Workers', 'farmer', vs.filter((v) => v.role === 'farmer' || v.role === 'woodcutter')],
    ];
    let html = '';
    for (const [label, cls, list] of groups) {
      if (!list.length) continue;
      html += `<div class="grp ${cls}">${label} <b>${list.length}</b>${cls === 'kid' ? '<span class="grp-note">calling · care stars</span>' : ''}</div>`;
      for (const v of list) {
        const c = CHAR[v.role];
        let bar = '';
        if (v.role === 'kid') {
          const o = v.outlook(s);
          const icon = o.role === 'soldier' ? spr('dungeon', DUNGEON.sword, 16) : o.role === 'woodcutter' ? spr('town', TOWN.iconAxe, 16) : spr('town', TOWN.iconHoe, 16);
          bar = `<span class="outlook ${o.role === 'soldier' ? 'm' : 'c'}">${icon}${v.apprenticeAt(s) ? ` ${v.trained}/${Villager.drillNeeded(s)}` : ''} <span class="rstars">${'★'.repeat(v.starsNow())}</span></span>`;
        } else {
          const pct = Math.max(0, v.hp / v.maxHp * 100);
          bar = `<div class="bar hp ${pct < 40 ? 'low' : ''}"><i style="width:${pct}%"></i></div>`;
        }
        const lk = lookFor(v);
        html += `<div class="row ${s.selected === v ? 'sel' : ''}" data-id="${v.id}">${lk ? `<img class="art row-portrait" src="${charImg(lk)}" alt="">` : spr(c.key, c.frame, 24)}<span class="n">${esc(v.name)}</span><span class="a">${v.age}d</span>${bar}</div>`;
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
    while (this.feed.children.length > 8) this.feed.lastElementChild!.remove();
    Array.from(this.feed.children).forEach((el, i) => el.classList.toggle('old', i >= 4));
  }

  toast(text: string, kind: EventKind): void {
    const el = h(`<div class="toast panel ${kind === 'raid' ? 'red raid' : kind === 'soldier' ? 'grey' : 'tan'}">${esc(text)}</div>`);
    this.toasts.append(el);
    setTimeout(() => el.remove(), 3300);
  }

  /** Reset transient DOM state after a scene reset. */
  clear(): void {
    this.minimap.invalidate();
    this.feed.innerHTML = '';
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
  /** The ARMORY: pick a wearer, forge the next tier per slot, dye the tabard, pick a helmet and plume. */
  renderArmory(): void {
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
      return `<div class="aslot"><div class="aname">${ARMOR[slot].name} <span class="tier">${'●'.repeat(tier)}${'○'.repeat(3 - tier)}</span></div>
        <div class="acur">${cur.name} <small>${stat(cur)}</small></div>
        ${next ? `<button class="btn small ${why ? '' : 'ok'} forge" data-slot="${slot}" ${why ? 'disabled' : ''}>FORGE ${next.name.toUpperCase()} · ${next.wood} wood${next.scrap ? ` + ${next.scrap} scrap` : ''}</button><div class="d">${why ? `<em class="warn">${esc(why)}</em>` : stat(next)}</div>` : '<div class="d">the best there is</div>'}</div>`;
    }).join('');
    const dyes = DYES.map((c, i) => `<button class="swatch ${who.dye === i ? 'on' : ''}" data-dye="${i}" style="background:${c}" title="${DYE_NAMES[i]}"></button>`).join('');
    const helms = ['CAP', 'KETTLE', 'GREAT HELM'].map((n, i) => `<button class="btn small ${who.helmetStyle === i ? 'on' : ''}" data-helm="${i}">${n}</button>`).join('');
    const plumes = PLUMES.map((c, i) => `<button class="swatch ${who.plume === i ? 'on' : ''}" data-plume="${i}" style="background:${c === 'none' ? 'transparent' : c}" title="${c === 'none' ? 'no plume' : 'plume'}">${c === 'none' ? '×' : ''}</button>`).join('');
    const html = `<div class="armory panel">
      <div class="ph"><h2>Armory</h2><span class="cap">${s.wood | 0} wood · ${s.scrap} scrap · barracks Lv${s.world.barracksLevel}</span><button class="btn small close">CLOSE</button></div>
      <div class="acols">
        <div class="wearers">${list}</div>
        <div class="afit">
          <div class="portrait-big"><img class="art" src="${charImg(look)}" alt=""><div class="d">${esc(name(who))} · ${st.hp ? `+${st.hp} HP · ` : ''}${Math.round((1 - st.dmgMul) * 100)}% less damage · ${Math.round(st.block * 100)}% block</div></div>
          <div class="aslots">${slots}</div>
          <div class="custom"><div class="cap">TABARD DYE</div><div class="swatches">${dyes}</div>
            <div class="cap">HELMET</div><div class="seg">${helms}</div>
            <div class="cap">PLUME</div><div class="swatches">${plumes}</div></div>
        </div>
      </div>
      <p class="sub small">Leather costs wood. Iron and steel need scrap iron from slain raiders and a Lv2 / Lv3 barracks. A bow needs both hands, so archers can't carry a shield.</p>
    </div>`;
    if (!this.armoryEl) { this.armoryEl = h('<div class="screen armory-screen"></div>'); this.screens.append(this.armoryEl); }
    this.armoryEl.innerHTML = html;
    const el = this.armoryEl;
    el.querySelector('.close')!.addEventListener('click', () => s.openArmory(null));
    el.querySelectorAll<HTMLElement>('[data-wearer]').forEach((b) => b.addEventListener('click', () => { const m = wearers.find((w) => w.id === Number(b.dataset.wearer)); if (m) s.openArmory(m); }));
    el.querySelectorAll<HTMLElement>('[data-slot]').forEach((b) => b.addEventListener('click', () => { s.craftArmor(who, b.dataset.slot as ArmorSlot); this.renderArmory(); }));
    el.querySelectorAll<HTMLElement>('[data-dye]').forEach((b) => b.addEventListener('click', () => { s.setDye(who, Number(b.dataset.dye)); this.renderArmory(); }));
    el.querySelectorAll<HTMLElement>('[data-helm]').forEach((b) => b.addEventListener('click', () => { s.setHelmetStyle(who, Number(b.dataset.helm)); this.renderArmory(); }));
    el.querySelectorAll<HTMLElement>('[data-plume]').forEach((b) => b.addEventListener('click', () => { s.setPlume(who, Number(b.dataset.plume)); this.renderArmory(); }));
  }

  // ---- screens ---------------------------------------------------------------

  showScreen(kind: 'title' | 'pause' | 'over' | 'won' | null): void {
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
          Survive ${RUN.days} days of raids and <b>beat the Warlord</b>.</p>
          <div class="controls">
            <kbd>WASD</kbd><span>move</span><kbd>click / C</kbd><span>use the tool you hold, toward the cursor</span>
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
        <p class="sub">Day ${s.day} of ${RUN.days} · ${s.villagers().length} villagers · ${s.villagers().filter((v) => v.role === 'soldier').length} soldiers</p>
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
          <div><b>${st.childrenRaised}</b>children raised</div><div><b>${st.childrenRaised ? (st.starsTotal / st.childrenRaised).toFixed(1) : '—'}</b>avg stars</div><div><b>${st.raidersKilled}</b>raiders slain</div>${st.bossesSlain ? `<div><b>${st.bossesSlain}</b>bosses slain</div>` : ''}
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
          <p><b>Fortify:</b> scroll the tool belt for WALL, GATE and STAIRS. Each takes one ground tile and wood for construction. Join walls into a perimeter and connect stairs. With hands equipped, use stairs to climb or descend. Walk along connected wall tops. Gates admit allies automatically; X opens them to enemies too. Hammer repairs damage. Brutes can breach walls; homes and supply buildings remain indestructible.</p>
          <p><b>Archers:</b> select a soldier, equip BOW, then SET WALL POST and click a battlement top connected to stairs. RETURN TO PATROL recalls them. Player bow is key 9. Everyone uses the shared quiver; craft 10 arrows for 2 wood at the barracks or its supply button. Arrows hit bodies and cover; wall archers shoot over ramparts.</p>
          <p><b>Come inside:</b> walk to a house, barracks or tavern door and use hands or X. WASD / joystick moves indoors; tapping the floor also walks there. Use nearby furnishings. The barracks rack makes arrows; tavern meals heal more with upgrades. Walk through the bottom doorway or choose EXIT. Raids continue outside.</p>
          <p>Survive <b>${RUN.days} days</b>. Raiders attack every ${p.raidEvery} days and get stronger. On day ${RUN.bossDay} the <b>Warlord</b> comes — beat him to win. If <b>you</b> die, the run ends (you keep the renown).</p>
          <h3>THE TRICK</h3>
          <p>You can't recruit anyone. <b>Every adult was a child you raised.</b> See RAISING CHILDREN below.</p>
          <h3>EACH DAY</h3>
          <p>Every villager eats 1 food. Crops ripen in ${s.cropDays} day${s.cropDays > 1 ? 's' : ''}. Couples with a spare bed have children. Everyone heals overnight.</p>
          <p><b>Nothing counts until it's carried in.</b> Chopped wood and picked crops ride on the arms of whoever took them: woodcutters haul ${HAUL.villager.wood} wood to the woodyard per trip, farmers ${HAUL.villager.food} food to the granary. You carry ${HAUL.player.wood} wood or ${HAUL.player.food} food and unload by walking up to the building. Long walks are wasted work — keep the woodyard by the grove and the granary by the field.</p>
        </section>
        <section>
          <h3>WHO'S WHO</h3>
          ${who('dungeon', DUNGEON.hero, 'player', 'You', 'Equip a tool, then click: hoe tills, seeds plant, hands harvest, axe chops, sword fights, hammer upgrades.')}
          ${who('farm', FARM.farmerHat, 'farmer', 'Farmer', 'Plants and harvests the fields on their own.')}
          ${who('dungeon', DUNGEON.man, 'woodcutter', 'Woodcutter', 'Fells trees for wood — old growth first, thinning a grove from its edge so the core keeps spreading. Leaves the last ' + TREE_RESERVE + ' standing. Helps in the field when the woodyard is full.')}
          ${who('dungeon', DUNGEON.villager, 'kid', 'Child', 'Plays near home. Becomes a worker — or a soldier, if their house is sworn and they finish drill.')}
          ${who('dungeon', DUNGEON.knight, 'soldier', 'Soldier', 'Guards the barracks and fights raiders.')}
          ${who('dungeon', DUNGEON.orc, 'raider', 'Raider', 'Walks at the nearest person and hits them. Tramples crops.')}
          ${who('dungeon', 123, 'raider', 'Rat swarm', 'At least 10 arrive together and spread across the field. Foragers doubles their eating time, but crops are never immune. Scare them with equipped weapons or stop them with gates.')}
          ${who('dungeon', DUNGEON.imp, 'raider', 'Snatcher', 'Grabs a child and runs for the map edge. Kill it to free them; kids indoors are safe.')}
          ${who('dungeon', DUNGEON.orc, 'raider', 'Brute', '180 base HP, 24 damage, twice the speed, reach and attack rate, half the knockback. The axe winds up and swings even when you dodge. Devastates fortifications.')}
          ${who('dungeon', DUNGEON.wizard, 'raider', 'Shaman', 'Keeps its distance and casts bolts. Close in on it.')}
          <h3>BUILDINGS</h3>
          <p>Buildings can't be damaged. Use the <b>HAMMER</b> on one (3 hits) to upgrade it for wood. Every building has three levels — the brass studs on the sign by the door count them, and each level changes the building itself:</p>
          ${building('house', 'House · ' + COST.house + ' wood', 'A couple here has children.')}
          ${building('barracks', 'Barracks · ' + COST.barracks + ' wood', 'Sponsors sworn houses; cadets drill in its yard.')}
          ${building('granary', 'Granary', 'Holds your food; the harvest is carried here. The crate stack beside it climbs as the store fills.')}
          ${building('woodyard', 'Woodyard', 'Holds your wood; chopped logs are carried here. The log stack beside the cabin climbs as it fills.')}
          <h3>RAISING CHILDREN</h3>
          <p><b>Callings.</b> Pick a house (right click / X, or tap it) and set RAISE CHILDREN AS: <b>FARMERS</b>, <b>CUTTERS</b> or <b>SOLDIERS</b>. From age ${s.adultAge - CADET_AGE_BEFORE} its children apprentice every working day — at the field, the woodyard or the barracks yard — and after ${Villager.drillNeeded(s)} days come of age <b>skilled</b>: faster work, bigger harvests and loads, tougher soldiers. Unfinished apprentices grow up plain.</p>
          <p><b>Care.</b> Each dawn a child earns care for the day before: fed · <b>well fed</b> (the house on HEARTY rations, ${HEARTY_RATION} food a day) · both parents alive · another child at home · a Lv2+ house · your <b>encouragement</b>. Running from raiders, going hungry or losing a parent costs care. It averages into <b>stars</b> (★ to ★★★★★) that are fixed at coming of age and last for life: each star is +6% HP and work speed; five stars make a <b>gifted</b> adult with a trait (Hardy, Quick, Brave, Green Thumb, Tireless); a neglected child grows up frail.</p>
          <p><b>Encourage.</b> Walk up to a child and press X (or tap them, or the button on their card): a moment together, once a day, worth a care point and a day of apprenticeship. During a raid it also sends them inside.</p>
          <p><b>Children go to bed at dusk</b> and sleep indoors until dawn, and they <b>run for the nearest door</b> when raiders are near. Snatchers take children caught in the open.</p>
          <p><b>Renown</b> comes from children raised: 20 each, plus 8 per star.</p>
          <h3>ARMOR</h3>
          <p>You and your soldiers have four armor slots — <b>helmet</b> (HP), <b>chest</b> (less damage taken), <b>legs</b> (speed) and <b>shield</b> (a chance to block melee hits outright; archers can't carry one). Each has three tiers: <b>leather</b> for wood, <b>iron</b> and <b>steel</b> for wood plus <b>scrap iron</b> looted from slain raiders (needs a Lv2 / Lv3 barracks). Open the ARMORY with <kbd>V</kbd>, from the barracks card, or from a soldier's card; dye tabards and pick helmets and plumes there too — what they wear is what you see.</p>
          <h3>SOLDIERS</h3>
          <p>Pick a house (right click / X, or tap it) and set <b>RAISE CHILDREN AS: SOLDIERS</b> to <b>swear</b> it to the barracks — it flies a banner. A barracks sponsors <b>one sworn house per level</b> (two barracks Lv2 = 4 houses). Children of a sworn house become <b>cadets</b> ${CADET_AGE_BEFORE} days before coming of age: each day they walk to the barracks yard and drill. ${Villager.drillNeeded(s)} days of drill make a soldier at age ${s.adultAge}; a child sworn too late comes of age a worker. Every child's outlook is shown in the inspector and the villagers list — no surprises.</p>
          <h3>FOG & THE OGRE</h3>
          <p>The world is dark until someone sees it. You see 10 tiles, buildings light 8, soldiers 6 and other villagers 4; what you've seen stays on the map, dimmed, but raiders in the dark are invisible until they step into sight — walls with people on them are your eyes. The minimap shows how much you've explored.</p>
          <p>Somewhere 50–85 tiles out in the woods is <b>the Ogre's lair</b>. On day 2 the woodcutters give you a direction. The Ogre is huge — far bigger than any raider — sleeps in his lair by day and prowls the woods around it at night, hunting anyone within ${OGRE.hunt} tiles. He hits for ${OGRE.dmg} after a slow, obvious wind-up (step back!), shrugs off knockback and heals a quarter of his ${OGRE.hp} HP each day he sleeps. He never joins a raid, so fight him on your terms: iron mail, a shield, a few archers, and the daylight to walk home. Slaying him is worth ${OGRE.scrap} scrap and ${OGRE.renown} renown.</p>
          <h3>GROVES</h3>
          <p>Trees spread onto neighbouring grass — but a lone tree barely does (about 1% a day) while a tree inside a grove seeds fast (up to 11%). A sapling with two or more trees beside it grows in ${SHELTERED_SAPLING_DAYS} days instead of ${SAPLING_DAYS}. So plant trees <b>together</b>, near the woodyard, and let the grove do the work.</p>
          <p>Trees age: after ${OLD_GROWTH_DAYS} days they become <b>old growth</b> — taller, and worth ${OLD_YIELD} wood instead of ${TREE_YIELD}. Woodcutters take old growth first and thin a grove from its edge.</p>
          <p>Seeds only land on grass, never next to buildings — a ring of tilled soil is a firebreak that stops a grove spreading. <b>SEEDS</b> on grass plants a tree; clear stumps and saplings with the <b>AXE</b> or <b>HOE</b> (the hoe also flattens soil back to grass). Buildings can go on grass, stumps or soil — not on trees, crops or other buildings. With a mouse, tools hit the tile you <b>point at</b> when it's next to you, otherwise the tile you face (the gold box). A building goes <b>where you point</b> (within 6 tiles; the pointer marks the door); otherwise straight ahead of you. Anyone standing in the footprint, you included, is stepped out onto the doorstep.</p>
        </section>
        <section>
          <h3>CONTROLS</h3>
          <div class="controls">
            <kbd>WASD</kbd><span>move (joystick on phone)</span>
            <kbd>click / C</kbd><span>use the tool you hold. A click also turns you toward the cursor. The bottom bar says what the tool will do. The sword swings an arc; it only hits what it reaches.</span>
            <kbd>right click / X</kbd><span>check a villager (opens the inspector)</span>
            <kbd>1-9 · Tab · wheel</kbd><span>pick a tool — hands, hoe, seeds, axe, sword, house, barracks, hammer</span>
            <kbd>Z</kbd><span>camera zoom 1× / 1.5× / 2× / 3× — 1× shows most of the map</span>
            <kbd>E / Esc</kbd><span>menu (pause, restart, how to play)</span>
            <kbd>- / =</kbd><span>game speed 1x / 4x / 16x</span>
            <kbd>\`</kbd><span>tuning sliders (debug)</span>
          </div>
          <h3>TOP BAR</h3>
          <p><b>DAY</b> of ${RUN.days} and the hour · <b>WOOD</b> / <b>FOOD</b> stockpiles and their caps (upgrade the woodyard / granary) · <b>VILLAGERS</b> by role · <b>NEXT RAID</b> countdown · <b>YOUR HP</b>.</p>
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
