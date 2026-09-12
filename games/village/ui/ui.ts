import { getGui } from '@shared/index';
import { Villager, Raider, Player, Mover, type BuildItem } from '../agents';
import { CHAR, TOWN, FARM, DUNGEON, framePos } from '../atlas';
import { COST, HOUSE_CAP, p } from '../config';
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
  if (m instanceof Raider) return CHAR.raider;
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

  constructor(private scene: VillageScene) {}

  mount(): void {
    const s = this.scene;

    // --- top bar
    this.top = h(`<div class="topbar panel">
      <div class="group"><span class="sun"></span><span class="day"></span><span class="hour"></span></div>
      <div class="group">${spr('town', TOWN.iconWood, 24)}<span class="num wood"></span>${spr('farm', FARM.iconTomato, 24)}<span class="num food"></span></div>
      <div class="group pop"></div>
      <div class="spacer"></div>
      <div class="group raid"></div>
      <div class="group hearts"></div>
      <div class="group speed">
        <button class="btn small" data-speed="1">1x</button><button class="btn small" data-speed="4">4x</button><button class="btn small" data-speed="16">16x</button>
        <button class="btn small pause" title="Pause (Esc)">II</button>
      </div>
    </div>`);
    this.top.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => b.addEventListener('click', () => (s.speed = Number(b.dataset.speed))));
    this.top.querySelector('.pause')!.addEventListener('click', () => s.togglePause());

    // --- hotbar
    const slot = (item: BuildItem, key: string, frame: number, label: string, cost?: number) =>
      `<div class="slot" data-build="${item}" title="${label}">${spr(key, frame, 32)}<span class="key">Q</span>${cost ? `<span class="cost">${cost}${spr('town', TOWN.iconWood, 16)}</span>` : ''}</div>`;
    this.hotbar = h(`<div class="hotbar">
      <div class="slots panel">
        ${slot('none', 'farm', FARM.iconHand, 'Hand — till, plant, harvest, chop, fight')}
        ${slot('house', 'town', TOWN.wallWoodDoor, 'House — a family of 4 lives here', COST.house)}
        ${slot('barracks', 'town', TOWN.wallStoneDoor, 'Barracks — kids raised nearby become soldiers', COST.barracks)}
      </div>
      <div class="hint"></div>
    </div>`);
    this.hotbar.querySelectorAll<HTMLElement>('.slot').forEach((el) => el.addEventListener('click', () => s.setBuild(el.dataset.build as BuildItem)));

    this.feed = h('<div class="feed"></div>');
    this.toasts = h('<div class="toasts"></div>');
    this.overlay.append(this.top, this.hotbar, this.feed, this.toasts);

    // --- side
    this.inspector = h('<div class="inspector panel"></div>');
    this.roster = h('<div class="roster panel"><h2>Villagers</h2><div class="list"></div></div>');
    this.side.append(this.inspector, this.roster);
    this.roster.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.row');
      if (!row) return;
      const v = s.villagers().find((x) => x.id === Number(row.dataset.id));
      if (v) s.select(v);
    });

    this.tooltipEl = h('<div class="tooltip" hidden></div>');
    document.body.append(this.tooltipEl);

    // debug sliders hidden until backtick
    getGui().hide();
    window.addEventListener('keydown', (e) => {
      if (e.key === '`') { const g = getGui(); g._hidden ? g.show() : g.hide(); }
    });

    this.renderInspector(true);
  }

  // ---- per-frame -------------------------------------------------------------

  render(dt: number): void {
    const s = this.scene;
    this.stage.classList.toggle('raid', s.raidActive);
    this.topT += dt; this.rosterT += dt;
    if (this.topT > 0.1) { this.topT = 0; this.renderTop(); this.renderHotbar(); this.renderInspector(); }
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
    const key = `${s.day}|${hour}|${s.food | 0}|${s.wood | 0}|${count('farmer')}|${count('woodcutter')}|${count('kid')}|${count('soldier')}|${s.player.hp}|${s.raidActive}|${raidIn}|${s.speed}|${s.paused}|${night}`;
    if (key === this.lastTop) return;
    this.lastTop = key;

    const q = (sel: string) => this.top.querySelector<HTMLElement>(sel)!;
    q('.sun').classList.toggle('moon', night);
    q('.day').textContent = `DAY ${s.day}`;
    q('.hour').textContent = `${String(hour).padStart(2, '0')}:00`;
    q('.wood').textContent = String(s.wood | 0);
    q('.food').textContent = String(s.food | 0);
    q('.pop').innerHTML = [
      ['farmer', CHAR.farmer], ['woodcutter', CHAR.woodcutter], ['kid', CHAR.kid], ['soldier', CHAR.soldier],
    ].map(([r, c]) => `<span class="chip" title="${ROLE_LABEL[r as string]}s">${spr((c as { key: string }).key, (c as { frame: number }).frame, 24)}${count(r as string)}</span>`).join('');
    const raid = q('.raid');
    if (s.raidActive) { raid.textContent = 'RAID!'; raid.className = 'group raid now'; }
    else if (raidIn <= 1) { raid.textContent = 'RAID TOMORROW'; raid.className = 'group raid soon'; }
    else { raid.textContent = `raid in ${raidIn} days`; raid.className = 'group raid'; }
    const hearts = q('.hearts');
    const full = s.player.hp / s.player.maxHp * 6;
    hearts.innerHTML = Array.from({ length: 6 }, (_, i) => `<span class="heart ${i + 1 <= full ? '' : i < full ? 'half' : 'off'}"></span>`).join('');
    this.top.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === s.speed && !s.paused));
    q('.pause').classList.toggle('on', s.paused);
  }

  private renderHotbar(): void {
    const s = this.scene;
    this.hotbar.querySelectorAll<HTMLElement>('.slot').forEach((el) => {
      const item = el.dataset.build as BuildItem;
      el.classList.toggle('on', s.player.build === item);
      el.classList.toggle('off', item !== 'none' && s.wood < COST[item]);
    });
    const hint = this.hotbar.querySelector('.hint')!;
    const text = s.hint();
    if (hint.textContent !== text) hint.textContent = text;
  }

  private renderInspector(force = false): void {
    const s = this.scene;
    const m = s.selected;
    if (!m || m.dead) {
      const html = `<h2>Inspector</h2><p class="empty">Click a villager to inspect them.<br>Kids become <span style="color:var(--martial)">soldiers</span> or <span style="color:var(--civil)">workers</span> depending on what they grow up around.</p>`;
      if (force || this.lastInspector !== html) { this.inspector.innerHTML = html; this.lastInspector = html; }
      return;
    }
    const c = charOf(m);
    let html = `<div class="head">${spr(c.key, c.frame, 48)}<div><div class="name">${m instanceof Villager ? esc(m.name) : m instanceof Player ? 'You' : 'Raider'}</div><div class="role">${m instanceof Villager ? ROLE_LABEL[m.role] : m instanceof Player ? 'Village head' : 'Raider'}</div></div><button class="btn small close">x</button></div>`;
    const hpPct = Math.max(0, m.hp / m.maxHp * 100);
    html += `<div class="rows">`;
    html += `<b>HP</b><div class="bar hp ${hpPct < 40 ? 'low' : ''}"><i style="width:${hpPct}%"></i></div>`;
    if (m instanceof Villager) {
      html += `<b>Age</b><span>${m.age} days${m.role === 'kid' ? ` — adult in ${Math.max(0, p.adultAge - m.age)}` : ''}</span>`;
      html += `<b>Home</b><span>house at ${m.home.tx},${m.home.ty} (${m.home.residents}/${HOUSE_CAP})</span>`;
      html += `<b>Fed</b><span>${m.hungerDays === 0 ? 'yes' : `hungry ${m.hungerDays}d`}</span>`;
    }
    html += `<b>Doing</b><span>${esc(m.task || '—')}</span></div>`;
    if (m instanceof Villager && m.role === 'kid') {
      const tot = m.martial + m.civil || 1;
      const mp = (m.martial / tot) * 100;
      const lean = m.martial > m.civil ? 'm' : 'c';
      html += `<div class="upbring"><div class="lbl"><span>martial ${m.martial | 0}</span><span>civil ${m.civil | 0}</span></div>
        <div class="bar up"><i class="m" style="width:${mp}%"></i><i class="c" style="width:${100 - mp}%"></i></div>
        <div class="lean ${lean}">leaning ${lean === 'm' ? 'soldier' : 'worker'}</div></div>`;
    } else if (m instanceof Villager) {
      html += `<div class="upbring"><div class="lbl"><span>raised martial ${m.martial | 0}</span><span>civil ${m.civil | 0}</span></div></div>`;
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
    const groups: [string, Villager[]][] = [
      ['Children', vs.filter((v) => v.role === 'kid').sort((a, b) => b.age - a.age)],
      ['Soldiers', vs.filter((v) => v.role === 'soldier')],
      ['Workers', vs.filter((v) => v.role === 'farmer' || v.role === 'woodcutter')],
    ];
    let html = '';
    for (const [label, list] of groups) {
      if (!list.length) continue;
      html += `<div class="grp">${label} (${list.length})</div>`;
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
    if (!vs.length) html = '<p class="empty">Nobody lives here.</p>';
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

  showScreen(kind: 'title' | 'pause' | 'over' | null): void {
    const s = this.scene;
    this.screens.innerHTML = '';
    if (!kind) return;
    let card: HTMLElement;
    const cast = `<div class="cast">${spr('dungeon', DUNGEON.hero, 48)}${spr('farm', FARM.farmerHat, 48)}${spr('dungeon', DUNGEON.villager, 48)}${spr('dungeon', DUNGEON.knight, 48)}${spr('dungeon', DUNGEON.orc, 48, 'flip')}</div>`;
    if (kind === 'title') {
      card = h(`<div class="card panel">
        <h1>VILLAGE</h1>
        ${cast}
        <p class="sub">Farm. Raise a family. The children you raise beside the barracks become your army.</p>
        <div class="controls">
          <kbd>WASD</kbd><span>move</span><kbd>E</kbd><span>till · plant · harvest · chop · fight · build</span>
          <kbd>Q</kbd><span>choose what to build</span><kbd>Esc</kbd><span>pause</span>
          <kbd>1 2 3</kbd><span>game speed</span><kbd>click</kbd><span>inspect a villager</span>
        </div>
        <div class="row"><label class="sub">seed <input class="seed" value="${s.seed}"></label></div>
        <div class="row"><button class="btn ok start">NEW VILLAGE</button></div>
        <p class="credit">art: <a href="https://kenney.nl" target="_blank" rel="noopener">Kenney</a> (CC0)</p>
      </div>`);
      const input = card.querySelector<HTMLInputElement>('.seed')!;
      const start = () => s.startGame(Number(input.value) || undefined);
      card.querySelector('.start')!.addEventListener('click', start);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); e.stopPropagation(); });
    } else if (kind === 'pause') {
      card = h(`<div class="card panel">
        <h1>PAUSED</h1>
        <p class="sub">Day ${s.day} · ${s.villagers().length} villagers · ${s.villagers().filter((v) => v.role === 'soldier').length} soldiers</p>
        <div class="row"><button class="btn ok resume">RESUME</button><button class="btn restart">RESTART</button><button class="btn title">TITLE</button></div>
      </div>`);
      card.querySelector('.resume')!.addEventListener('click', () => s.togglePause());
      card.querySelector('.restart')!.addEventListener('click', () => s.startGame(s.seed));
      card.querySelector('.title')!.addEventListener('click', () => s.goTitle());
    } else {
      const st = s.stats;
      card = h(`<div class="card panel red">
        <h1>THE VILLAGE FELL</h1>
        <p>You died on day ${s.day}.</p>
        <div class="stats">
          <div><b>${s.day}</b>days survived</div><div><b>${st.peakPop}</b>peak population</div>
          <div><b>${st.soldiersRaised}</b>soldiers raised</div><div><b>${st.raidsRepelled}</b>raids repelled</div>
        </div>
        <div class="row"><button class="btn ok restart">TRY AGAIN</button><button class="btn title">TITLE</button></div>
      </div>`);
      card.querySelector('.restart')!.addEventListener('click', () => s.startGame());
      card.querySelector('.title')!.addEventListener('click', () => s.goTitle());
    }
    const screen = h(`<div class="screen ${kind}"></div>`);
    screen.append(card);
    this.screens.append(screen);
  }
}

export type { GameEvent };
