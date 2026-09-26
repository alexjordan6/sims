import type { VillageScene } from '../main';
import { EQUIPMENT, isBulk, slotKey, slotName, type EquipmentSlot, type Slot } from '../pack';
import { gearUrl } from '../gear-art';
import { FLORA, frameDataUrl } from '../pixelart';
import { STASH_SLOTS } from '../config';

/** Where a dragged thing came from, and where it may go. */
type Source = { k: 'pack'; i: number } | { k: 'equip'; slot: EquipmentSlot } | { k: 'stash'; i: number } | { k: 'pouch'; i: number };
const sameSource = (a: Source, b: Source): boolean =>
  a.k === b.k && (a.k === 'equip' ? a.slot === (b as typeof a).slot : a.i === (b as { i: number }).i);

type Drag = { source: Source; key: string; item: Slot; player: VillageScene['player']; host: HTMLElement; pointer: number; ghost: HTMLElement; x: number; y: number; moved: boolean };

export class PackUI {
  private drag: Drag | null = null;
  private hosts = new Map<HTMLElement, string>();
  get dragging(): boolean { return !!this.drag; }
  constructor(private s: VillageScene) {
    window.addEventListener('blur', () => this.cancel());
    window.addEventListener('keydown', e => { if (this.drag && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.cancel(); } }, true);
  }
  mount(host: HTMLElement): void {
    if (this.hosts.has(host)) return;
    this.hosts.set(host, '');
    host.addEventListener('pointerdown', e => this.down(e, host));
    host.addEventListener('pointermove', e => this.move(e));
    host.addEventListener('pointerup', e => this.up(e));
    host.addEventListener('pointercancel', () => this.cancel());
    host.addEventListener('lostpointercapture', () => this.cancel());
    host.addEventListener('click', e => e.stopPropagation());
    host.addEventListener('dragstart', e => e.preventDefault());
    this.render();
  }
  /** The chest a host may reach: only the armory view, and only while one is open. */
  private chestFor(host: HTMLElement) { return host.dataset.withStash ? this.s.armoryChest : null; }
  /** The gnome pouch a host may reach: only the pouch view, and only while one is open. */
  private pouchFor(host: HTMLElement) { return host.dataset.withPouch ? this.s.pouchOf?.pouch ?? null : null; }
  private source(el: HTMLElement): Source {
    if (el.dataset.packIndex !== undefined) return { k: 'pack', i: Number(el.dataset.packIndex) };
    if (el.dataset.stashIndex !== undefined) return { k: 'stash', i: Number(el.dataset.stashIndex) };
    if (el.dataset.pouchIndex !== undefined) return { k: 'pouch', i: Number(el.dataset.pouchIndex) };
    return { k: 'equip', slot: el.dataset.equipment as EquipmentSlot };
  }
  private item(source: Source, host: HTMLElement): Slot | null {
    if (source.k === 'pack') return this.s.player.pack.at(source.i);
    if (source.k === 'equip') return this.s.equipped(source.slot);
    if (source.k === 'pouch') return this.pouchFor(host)?.at(source.i) ?? null;
    const chest = this.chestFor(host);
    return chest ? this.s.stashOf(chest)[source.i] ?? null : null;
  }
  private image(item: Slot): string {
    return isBulk(item) ? frameDataUrl(this.s, item.kind === 'wood' ? 'carry-wood' : 'flora', item.kind === 'wood' ? 0 : item.kind === 'scrap' ? FLORA.scrap : FLORA.pile[item.food][1]) : gearUrl(item);
  }
  render(): void {
    if (this.drag) { if (this.drag.player !== this.s.player || this.s.screen !== 'playing' || !this.drag.host.isConnected) this.cancel(); else return; }
    const pack = this.s.player.pack;
    // Quantity-only changes update text without replacing buttons under the pointer.
    const shape = (item: Slot | null) => slotKey(item && isBulk(item) ? { ...item, n: 0 } : item);
    const cell = (item: Slot | null, attrs: string, label: string) =>
      `<button class="pack-cell" ${attrs} title="${item ? slotName(item) : label}" aria-label="${label}${item ? ': ' + slotName(item) : ': empty'}">${item ? `<img draggable="false" src="${this.image(item)}" alt="">${isBulk(item) ? `<b>${Number(item.n.toFixed(1))}</b>` : ''}` : `<span>${label}</span>`}</button>`;
    for (const [host, old] of this.hosts) {
      if (!host.isConnected) { this.hosts.delete(host); continue; }
      const chest = this.chestFor(host);
      const stash = chest ? this.s.stashOf(chest) : null;
      const pouch = this.pouchFor(host);
      const key = pack.slots.map(shape).join('|') + ';' + EQUIPMENT.map(e => slotKey(this.s.equipped(e))).join('|')
        + (stash ? ';' + stash.map(slotKey).join('|') + '/' + stash.length : '')
        + (pouch ? ';' + pouch.slots.map(shape).join('|') : '');
      if (old === key) {
        const retext = (sel: string, from: { at(i: number): Slot | null }, attr: string) => host.querySelectorAll<HTMLElement>(sel).forEach(c => {
          const item = from.at(Number(c.dataset[attr])), count = c.querySelector('b');
          if (item && isBulk(item) && count) { const text = String(Number(item.n.toFixed(1))); if (count.textContent !== text) count.textContent = text; }
        });
        retext('[data-pack-index]', pack, 'packIndex');
        if (pouch) retext('[data-pouch-index]', pouch, 'pouchIndex');
        continue;
      }
      const clubs = stash ? stash.filter(g => g.kind === 'weapon' && g.tier <= 0).length : 0;
      const stashHtml = stash
        ? `<div><div class="cap">CHEST &middot; ${stash.length}/${STASH_SLOTS}</div><div class="pack-grid">${
            Array.from({ length: STASH_SLOTS }, (_, i) => cell(stash[i] ?? null, `data-stash-index="${i}"`, `${i + 1}`)).join('')
          }</div><button class="btn small break-clubs" ${clubs ? '' : 'disabled'}>BREAK DOWN ${clubs || ''} CLUBS</button></div>`
        : '';
      const pouchHtml = pouch
        ? `<div><div class="cap">POUCH &middot; ${pouch.slots.length - pouch.emptySlots}/${pouch.slots.length}</div><div class="pack-grid">${
            pouch.slots.map((item, i) => cell(item, `data-pouch-index="${i}"`, `${i + 1}`)).join('')
          }</div></div>`
        : '';
      host.innerHTML = `<div><div class="cap">PACK &middot; ${pack.slots.length - pack.emptySlots}/${pack.slots.length}</div><div class="pack-grid">${pack.slots.map((item, i) => cell(item, `data-pack-index="${i}"`, `${i + 1}`)).join('')}</div></div>`
        + pouchHtml
        + `<div><div class="cap">EQUIPMENT</div><div class="equipment-grid">${EQUIPMENT.map(e => cell(this.s.equipped(e), `data-equipment="${e}"`, e)).join('')}</div></div>`
        + stashHtml
        + `<small class="pack-help">Drag to move, equip${stash ? ', stow' : ''} or drop &middot; G throws largest supply stack</small>`;
      if (chest) host.querySelector('.break-clubs')?.addEventListener('click', () => { this.s.salvageClubs(chest); this.render(); });
      this.hosts.set(host, key);
    }
  }
  cancel(): void {
    const d = this.drag; if (!d) return; this.drag = null; d.ghost.remove();
    if (d.host.hasPointerCapture(d.pointer)) d.host.releasePointerCapture(d.pointer);
    this.render();
  }
  private down(e: PointerEvent, host: HTMLElement): void {
    if (e.pointerType === 'touch' || e.button !== 0 || this.s.screen !== 'playing') return;
    const el = (e.target as Element).closest<HTMLElement>('.pack-cell'); if (!el) return;
    e.preventDefault(); e.stopPropagation();
    const source = this.source(el), item = this.item(source, host); if (!item) return;
    const ghost = el.cloneNode(true) as HTMLElement; ghost.className = 'pack-cell pack-ghost'; document.body.append(ghost);
    this.drag = { source, key: slotKey(item), item, player: this.s.player, host, pointer: e.pointerId, ghost, x: e.clientX, y: e.clientY, moved: false };
    try { host.setPointerCapture(e.pointerId); } catch { /* the pointer went away between the event and here: the drag still tracks, and blur/Escape still cancel it */ }
    this.move(e);
  }
  private move(e: PointerEvent): void {
    const d = this.drag; if (!d || e.pointerId !== d.pointer) return;
    e.preventDefault(); e.stopPropagation();
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true;
    d.ghost.style.left = e.clientX + 12 + 'px'; d.ghost.style.top = e.clientY + 12 + 'px';
  }
  private up(e: PointerEvent): void {
    const d = this.drag; if (!d || e.pointerId !== d.pointer) return;
    e.preventDefault(); e.stopPropagation();
    const current = this.item(d.source, d.host);
    // the pack may have moved under the drag (a pickup, a deposit): only act if the source is untouched
    const same = slotKey(current) === d.key && (d.source.k !== 'pack' || current === d.item);
    if (d.moved && same && d.player === this.s.player && this.s.screen === 'playing') {
      const target = document.elementFromPoint(e.clientX, e.clientY), cellEl = target?.closest<HTMLElement>('.pack-cell');
      const chest = this.chestFor(d.host);
      if (cellEl) {
        const dest = this.source(cellEl);
        const pouch = this.pouchFor(d.host);
        if (d.source.k === 'pack' && dest.k === 'pack') this.s.player.pack.move(d.source.i, dest.i);
        else if (pouch && d.source.k === 'pack' && dest.k === 'pouch') this.s.movePackSlot(this.s.player.pack, d.source.i, pouch, dest.i);
        else if (pouch && d.source.k === 'pouch' && dest.k === 'pack') this.s.movePackSlot(pouch, d.source.i, this.s.player.pack, dest.i);
        else if (pouch && d.source.k === 'pouch' && dest.k === 'pouch') pouch.move(d.source.i, dest.i);
        else if (d.source.k === 'pack' && dest.k === 'equip') this.s.swapEquipment(d.source.i, dest.slot);
        else if (d.source.k === 'equip' && dest.k === 'pack') this.s.swapEquipment(dest.i, d.source.slot);
        else if (d.source.k === 'pack' && dest.k === 'stash' && chest) this.s.storeGear(d.source.i, chest);
        else if (d.source.k === 'stash' && dest.k === 'pack' && chest) this.s.takeGear(d.source.i, chest);
        else if (d.source.k === 'stash' && dest.k === 'stash' && chest && !sameSource(d.source, dest)) {
          const stash = this.s.stashOf(chest), [g] = stash.splice(d.source.i, 1);
          stash.splice(Math.min(dest.i, stash.length), 0, g);
        }
      } else if (target === this.s.game.canvas && !this.s.interior.active && (d.source.k === 'pack' || d.source.k === 'equip')) {
        const rect = this.s.game.canvas.getBoundingClientRect();
        const point = this.s.cameras.main.getWorldPoint((e.clientX - rect.left) * this.s.scale.width / rect.width, (e.clientY - rect.top) * this.s.scale.height / rect.height);
        this.s.dropPackItem(d.source.k === 'pack' ? d.source.i : d.source.slot, point);
      }
      this.s.validateTool();
    }
    this.cancel();
  }
}
