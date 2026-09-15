import { getGui } from '@shared/index';
import { Villager, Raider, Player, Mover, type Tool } from '../agents';
import { CHAR, TOWN, FARM, DUNGEON, framePos } from '../atlas';
import { COST, p, RUN, CAPS, HOUSE_BEDS, SAPLING_DAYS, TREE_RESERVE } from '../config';
import { BRANCHES, nodeById, nodesOf, type Branch, type Node } from '../meta';
import type { VillageScene, EventKind, GameEvent } from '../main';

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
  private tooltipEl!: HTMLElement;

  private lastTop = '';
  private lastRoster = '';
  private lastInspector = '';
  private rosterT = 0;
  private topT = 0;
  private feedSeen = 0;
  /** coarse pointer (phone/tablet) or ?touch=1 for testing */
  readonly touch = document.body.classList.contains('touch');
  private lastSelected: Mover | null = null;

  constructor(private scene: VillageScene) {}

  mount(): void {
    const s = this.scene;

    // --- top bar: labelled stat tiles
    const tile = (cls: string, cap: string, inner: string, title = '') => `<div class="stat ${cls}" title="${esc(title)}"><span class="cap">${cap}</span><span class="val">${inner}</span></div>`;
    this.top = h(`<div class="topbar panel">
      ${tile('t-day', 'DAY', `<span class="sun"></span><span class="day"></span><span class="hour"></span>`, 'Survive to day 21 and beat the Warlord')}
      ${tile('t-wood', 'WOOD', `${spr('town', TOWN.iconWood, 24)}<span class="num wood"></span>`, 'Chop trees. Houses cost 20, barracks 30. The woodyard sets the cap')}
      ${tile('t-food', 'FOOD', `${spr('farm', FARM.iconTomato, 24)}<span class="num food"></span>`, 'Each villager eats 1 a day. Harvest ripe crops. The granary sets the cap')}
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
        <span class="cap slots-cap">TOOLS <kbd>1-8</kbd></span>
        ${slot('hands', 'farm', FARM.iconHand, 'HANDS', 'Harvest ripe crops')}
        ${slot('hoe', 'town', TOWN.iconHoe, 'HOE', 'Till grass into soil')}
        ${slot('seeds', 'farm', FARM.grassTuft, 'SEEDS', 'Crops on tilled soil, trees on grass')}
        ${slot('axe', 'town', TOWN.iconAxe, 'AXE', 'Chop trees for wood (3 hits)')}
        ${slot('sword', 'dungeon', DUNGEON.sword, 'SWORD', 'Swing at raiders in front of you')}
        ${slot('house', 'town', TOWN.wallWoodDoor, 'HOUSE', 'A family of 4 lives here and has children', COST.house)}
        ${slot('barracks', 'town', TOWN.wallStoneDoor, 'BARRACKS', 'Kids raised near it grow into soldiers', COST.barracks)}
        ${slot('hammer', 'town', TOWN.iconHammer, 'HAMMER', 'Upgrade the building in front of you (3 hits)')}
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
    this.side.append(this.inspector, this.roster);
    this.roster.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.row');
      if (!row) return;
      const v = s.villagers().find((x) => x.id === Number(row.dataset.id));
      if (v) s.select(v);
    });

    this.tooltipEl = h('<div class="tooltip" hidden></div>');
    document.body.append(this.tooltipEl);

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
          ['ZOOM', 'camera 1× / 1.5× / 2×'],
          ['PAUSE', 'menu'],
          ['HELP', 'how to play'],
        ]
      : [
          ['W A S D', 'move'],
          ['click · C', 'use the held tool, toward the cursor'],
          ['right click · X', 'check a villager'],
          ['1 – 7', 'pick a tool'],
          ['Tab · wheel', 'next / previous tool'],
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
   * Phones ignore `user-scalable=no` (Safari especially): a stray pinch or double-tap zooms the
   * whole page and pushes the controls off-screen. Swallow those gestures, and if the page is
   * somehow zoomed anyway, offer a one-tap reload (there is no API to reset browser zoom).
   */
  private blockBrowserZoom(): void {
    const stop = (e: Event) => e.preventDefault();
    // Safari pinch
    document.addEventListener('gesturestart', stop, { passive: false });
    document.addEventListener('gesturechange', stop, { passive: false });
    // other browsers: multi-finger pinch reported via touchmove
    document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || (e as TouchEvent & { scale?: number }).scale! > 1) e.preventDefault(); }, { passive: false });
    // double-tap zoom: eat the second tap of a quick double tap outside form fields
    let lastTap = 0;
    document.addEventListener('touchend', (e) => {
      const now = Date.now();
      if (now - lastTap < 300 && !(e.target as HTMLElement).closest('input')) e.preventDefault();
      lastTap = now;
    }, { passive: false });

    const vv = window.visualViewport;
    if (!vv) return;
    let banner: HTMLElement | null = null;
    const check = () => {
      const zoomed = vv.scale > 1.08;
      if (zoomed && !banner) {
        banner = h(`<div class="zoomed-banner"><span>The page got zoomed in.</span><button class="btn ok">RESET VIEW</button></div>`);
        banner.querySelector('button')!.addEventListener('click', () => location.reload());
        document.body.append(banner);
      } else if (!zoomed && banner) { banner.remove(); banner = null; }
    };
    vv.addEventListener('resize', check);
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
    if (this.touch && s.selected !== this.lastSelected) {
      this.lastSelected = s.selected;
      if (s.selected) { this.showTab('inspector'); this.side.classList.add('open'); }
    }
    this.topT += dt; this.rosterT += dt;
    if (this.topT > 0.1) {
      this.topT = 0; this.renderTop(); this.renderHotbar(); this.renderInspector();
    }
    if (this.rosterT > 0.5) { this.rosterT = 0; this.renderRoster(); }
    this.renderFeed();
  }

  private renderTop(): void {
    const s = this.scene;
    const vs = s.villagers();
    const count = (r: string) => vs.filter((v) => v.role === r).length;
    const hour = Math.floor(s.dayTime * 24);
    const night = s.dayTime < 0.22 || s.dayTime > 0.8;
    const raidIn = s.nextRaidDay - s.day;
    const key = `${s.day}|${hour}|${s.food | 0}/${s.foodCap}|${s.wood | 0}/${s.woodCap}|${count('farmer')}|${count('woodcutter')}|${count('kid')}|${count('soldier')}|${s.player.hp}|${s.raidActive}|${s.boss?.hp ?? ''}|${raidIn}|${s.speed}|${s.paused}|${night}`;
    if (key === this.lastTop) return;
    this.lastTop = key;

    const q = (sel: string) => this.top.querySelector<HTMLElement>(sel)!;
    q('.sun').classList.toggle('moon', night);
    q('.day').textContent = `DAY ${s.day}/${RUN.days}`;
    q('.hour').textContent = `${String(hour).padStart(2, '0')}:00`;
    q('.wood').innerHTML = `${s.wood | 0}<small>/${s.woodCap}</small>`;
    q('.food').innerHTML = `${s.food | 0}<small>/${s.foodCap}</small>`;
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
    const text = s.hint().replace(/^E: /, '');
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
    return { TILL: 'TILL', PLANT: 'PLANT', HARVEST: 'HARVEST', CHOP: 'CHOP', ATTACK: 'FIGHT', SWING: 'SWING', BUILD: 'BUILD', UPGRADE: 'UPGRADE', CLEAR: 'CLEAR' }[w] ?? 'USE';
  }

  private renderInspector(force = false): void {
    const s = this.scene;
    const m = s.selected;
    const head = `<div class="ph">${spr('town', TOWN.sign, 24)}<h2>Inspector</h2></div>`;
    if (!m || m.dead) {
      const html = `${head}<p class="empty">Click or tap a villager to see who they are.<br>Children become <span class="rl soldier">soldiers</span> if they grow up near the barracks and soldiers, or <span class="rl farmer">workers</span> if they grow up near the fields.</p>`;
      if (force || this.lastInspector !== html) { this.inspector.innerHTML = html; this.lastInspector = html; }
      return;
    }
    const c = charOf(m);
    const roleKey = m instanceof Villager ? m.role : m instanceof Player ? 'player' : 'raider';
    const roleText = m instanceof Villager ? ROLE_LABEL[m.role] : m instanceof Player ? 'Village head (you)' : ENEMY_LABEL[(m as Raider).kind] ?? 'Raider';
    let html = `${head}<div class="head">${spr(c.key, c.frame, 48)}<div><div class="name">${m instanceof Villager ? esc(m.name) : m instanceof Player ? 'You' : (m as Raider).name}</div><span class="badge ${roleKey}">${roleText}</span></div><button class="btn small close">x</button></div>`;
    const hpPct = Math.max(0, m.hp / m.maxHp * 100);
    html += `<div class="rows">`;
    html += `<b>Health</b><div class="bar hp ${hpPct < 40 ? 'low' : ''}"><i style="width:${hpPct}%"></i><span class="bar-txt">${Math.max(0, m.hp | 0)} / ${m.maxHp}</span></div>`;
    if (m instanceof Villager) {
      html += `<b>Age</b><span>${m.age} days${m.role === 'kid' ? ` <em>· grows up in ${Math.max(0, p.adultAge + s.mods.adultAgeDelta - m.age)}</em>` : ''}</span>`;
      html += `<b>Home</b><span>${m.home.residents} of ${s.mods.houseCap} beds used</span>`;
      html += `<b>Fed</b><span>${m.hungerDays === 0 ? 'yes' : `<em class="warn">hungry for ${m.hungerDays} days</em>`}</span>`;
    }
    html += `<b>Doing</b><span>${esc(m.task || '—')}${m instanceof Villager && m.carriedBy ? ` <em class="warn">— kill the ${esc(m.carriedBy.name.toLowerCase())} to free them</em>` : ''}</span></div>`;
    if (m instanceof Villager && m.role === 'kid') {
      const tot = m.martial + m.civil || 1;
      const mp = (m.martial / tot) * 100;
      const lean = m.martial > m.civil ? 'm' : 'c';
      html += `<div class="upbring"><div class="cap">UPBRINGING · decides their job</div><div class="lbl"><span class="rl soldier">soldier ${m.martial | 0}</span><span class="rl farmer">worker ${m.civil | 0}</span></div>
        <div class="bar up"><i class="m" style="width:${mp}%"></i><i class="c" style="width:${100 - mp}%"></i></div>
        <div class="lean ${lean}">will become a ${lean === 'm' ? 'SOLDIER' : 'WORKER'}</div></div>`;
    } else if (m instanceof Villager) {
      html += `<div class="upbring"><div class="cap">RAISED</div><div class="lbl"><span class="rl soldier">soldier ${m.martial | 0}</span><span class="rl farmer">worker ${m.civil | 0}</span></div></div>`;
    }
    if (html !== this.lastInspector) {
      this.inspector.innerHTML = html;
      this.lastInspector = html;
      this.inspector.querySelector('.close')?.addEventListener('click', () => s.select(null));
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
      html += `<div class="grp ${cls}">${label} <b>${list.length}</b>${cls === 'kid' ? '<span class="grp-note">bar = soldier vs worker</span>' : ''}</div>`;
      for (const v of list) {
        const c = CHAR[v.role];
        let bar = '';
        if (v.role === 'kid') {
          const tot = v.martial + v.civil || 1;
          bar = `<div class="bar up"><i class="m" style="width:${(v.martial / tot) * 100}%"></i><i class="c" style="width:${(v.civil / tot) * 100}%"></i></div>`;
        } else {
          const pct = Math.max(0, v.hp / v.maxHp * 100);
          bar = `<div class="bar hp ${pct < 40 ? 'low' : ''}"><i style="width:${pct}%"></i></div>`;
        }
        html += `<div class="row ${s.selected === v ? 'sel' : ''}" data-id="${v.id}">${spr(c.key, c.frame, 24)}<span class="n">${esc(v.name)}</span><span class="a">${v.age}d</span>${bar}</div>`;
      }
    }
    if (!vs.length) html = '<p class="empty">Nobody lives here yet.</p>';
    if (html !== this.lastRoster) { this.roster.querySelector('.list')!.innerHTML = html; this.lastRoster = html; }
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
    this.feed.innerHTML = '';
    this.feedSeen = 0;
    this.lastTop = this.lastRoster = this.lastInspector = '';
    this.renderInspector(true);
  }

  // ---- tooltip ---------------------------------------------------------------

  tooltip(html: string | null, x = 0, y = 0): void {
    if (!html) { this.tooltipEl.hidden = true; return; }
    this.tooltipEl.hidden = false;
    if (this.tooltipEl.innerHTML !== html) this.tooltipEl.innerHTML = html;
    const r = this.tooltipEl.getBoundingClientRect();
    const px = Math.min(x, window.innerWidth - r.width - 16), py = Math.min(y, window.innerHeight - r.height - 16);
    this.tooltipEl.style.left = `${px}px`;
    this.tooltipEl.style.top = `${py}px`;
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
          <p class="sub">Farm. Raise a family. The children you raise beside the barracks become your army.<br>
          Survive ${RUN.days} days of raids and <b>beat the Warlord</b>.</p>
          <div class="controls">
            <kbd>WASD</kbd><span>move</span><kbd>click / C</kbd><span>use the tool you hold, toward the cursor</span>
            <kbd>right click / X</kbd><span>check a villager</span><kbd>1-8 · Tab · wheel</kbd><span>pick a tool</span>
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
          <div><b>${st.soldiersRaised}</b>soldiers raised</div><div><b>${st.raidersKilled}</b>raiders slain</div>
        </div>
        ${r ? `<div class="renown"><div class="lbl">RENOWN EARNED</div>
          <div class="parts"><span>days ${r.days}</span><span>kills ${r.kills}</span><span>soldiers ${r.soldiers}</span>${r.victory ? `<span>victory ${r.victory}</span>` : ''}</div>
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
    const card = h(`<div class="card panel help-card">
      <div class="ph">${spr('town', TOWN.sign, 24)}<h2>How to play</h2><button class="btn small close">CLOSE</button></div>
      <div class="help-cols">
        <section>
          <h3>THE GOAL</h3>
          <p>Survive <b>${RUN.days} days</b>. Raiders attack every ${p.raidEvery} days and get stronger. On day ${RUN.bossDay} the <b>Warlord</b> comes — beat him to win. If <b>you</b> die, the run ends (you keep the renown).</p>
          <h3>THE TRICK</h3>
          <p>You can't recruit soldiers. <b>Children become soldiers if they grow up near the barracks</b> (and near soldiers), or workers if they grow up near the fields. Build houses next to the barracks to raise an army; next to the farm to raise farmers.</p>
          <h3>EACH DAY</h3>
          <p>Every villager eats 1 food. Crops ripen in ${s.cropDays} day${s.cropDays > 1 ? 's' : ''}. Couples with a spare bed have children. Everyone heals overnight.</p>
        </section>
        <section>
          <h3>WHO'S WHO</h3>
          ${who('dungeon', DUNGEON.hero, 'player', 'You', 'Equip a tool, then click: hoe tills, seeds plant, hands harvest, axe chops, sword fights, hammer upgrades.')}
          ${who('farm', FARM.farmerHat, 'farmer', 'Farmer', 'Plants and harvests the fields on their own.')}
          ${who('dungeon', DUNGEON.man, 'woodcutter', 'Woodcutter', 'Chops trees for wood, but leaves the last ' + TREE_RESERVE + ' standing. Helps in the field when the woodyard is full.')}
          ${who('dungeon', DUNGEON.villager, 'kid', 'Child', 'Plays near home and soaks up what is around them.')}
          ${who('dungeon', DUNGEON.knight, 'soldier', 'Soldier', 'Guards the barracks and fights raiders.')}
          ${who('dungeon', DUNGEON.orc, 'raider', 'Raider', 'Walks at the nearest person and hits them. Tramples crops.')}
          ${who('dungeon', 123, 'raider', 'Rat', 'Harmless to people; eats your crops. Scatters from soldiers and you.')}
          ${who('dungeon', DUNGEON.imp, 'raider', 'Snatcher', 'Grabs a child and runs for the map edge. Kill it to free them; kids indoors are safe.')}
          ${who('dungeon', DUNGEON.orc, 'raider', 'Brute', 'Slow, huge, ignores knockback, hunts soldiers. Gang up.')}
          ${who('dungeon', DUNGEON.wizard, 'raider', 'Shaman', 'Keeps its distance and casts bolts. Close in on it.')}
          <h3>BUILDINGS</h3>
          ${who('town', TOWN.wallWoodDoor, 'farmer', 'House · ' + COST.house + ' wood', 'Beds for ' + HOUSE_BEDS[1] + ' (Lv2: 6, Lv3: 8 and more births). A couple here has children.')}
          ${who('town', TOWN.wallStoneDoor, 'soldier', 'Barracks · ' + COST.barracks + ' wood', 'Children raised nearby become soldiers. Lv2: tougher soldiers, wider reach. Lv3: stronger, regenerating soldiers.')}
          ${who('farm', 103, 'farmer', 'Granary', 'Holds your food: ' + CAPS[1] + ' / ' + CAPS[2] + ' / ' + CAPS[3] + ' by level. Its yard fills as the store does.')}
          ${who('town', 92, 'woodcutter', 'Woodyard', 'Holds your wood: ' + CAPS[1] + ' / ' + CAPS[2] + ' / ' + CAPS[3] + ' by level. Log piles show how full it is.')}
          <p>Buildings can't be damaged. Use the <b>HAMMER</b> on one (3 hits) to upgrade it for wood — every building has three levels, shown by a chimney (Lv2) and a gable (Lv3) on the roof.</p>
          <p>Trees grow back: a chopped tree leaves a sapling that regrows in ${SAPLING_DAYS} days, forests spread on their own, and <b>SEEDS</b> on grass plants a new tree.</p>
        </section>
        <section>
          <h3>CONTROLS</h3>
          <div class="controls">
            <kbd>WASD</kbd><span>move (joystick on phone)</span>
            <kbd>click / C</kbd><span>use the tool you hold. A click also turns you toward the cursor. The bottom bar says what the tool will do. The sword swings an arc; it only hits what it reaches.</span>
            <kbd>right click / X</kbd><span>check a villager (opens the inspector)</span>
            <kbd>1-8 · Tab · wheel</kbd><span>pick a tool — hands, hoe, seeds, axe, sword, house, barracks, hammer</span>
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
