import type { VillageScene } from '../main';
import { EQUIPMENT, isBulk, slotKey, slotName, type EquipmentSlot, type Slot } from '../pack';
import { gearUrl } from '../gear-art';
import { FLORA, frameDataUrl } from '../pixelart';

type Source = number | EquipmentSlot;
type Drag = { source: Source; key: string; item: Slot; player: VillageScene['player']; host: HTMLElement; pointer: number; ghost: HTMLElement; x:number; y:number; moved:boolean };
export class PackUI {
  private drag: Drag | null = null;
  private hosts = new Map<HTMLElement,string>();
  get dragging(): boolean { return !!this.drag; }
  constructor(private s: VillageScene) {
    window.addEventListener('blur',()=>this.cancel());
    window.addEventListener('keydown',e=>{if(this.drag && e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();this.cancel();}},true);
  }
  mount(host: HTMLElement): void {
    if(this.hosts.has(host))return;
    this.hosts.set(host,'');
    host.addEventListener('pointerdown', e=>this.down(e,host));
    host.addEventListener('pointermove', e=>this.move(e));
    host.addEventListener('pointerup', e=>this.up(e));
    host.addEventListener('pointercancel',()=>this.cancel());
    host.addEventListener('lostpointercapture',()=>this.cancel());
    host.addEventListener('click',e=>e.stopPropagation());
    host.addEventListener('dragstart',e=>e.preventDefault());
    this.render();
  }
  private source(el: HTMLElement): Source { return el.dataset.packIndex!==undefined?Number(el.dataset.packIndex):el.dataset.equipment as EquipmentSlot; }
  private item(source: Source): Slot|null { return typeof source==='number'?this.s.player.pack.at(source):this.s.equipped(source); }
  private image(item: Slot): string {
    return isBulk(item) ? frameDataUrl(this.s,item.kind==='wood'?'carry-wood':'flora',item.kind==='wood'?0:item.kind==='scrap'?FLORA.scrap:FLORA.pile[item.food][1]) : gearUrl(item);
  }
  render(): void {
    if(this.drag){if(this.drag.player!==this.s.player || this.s.screen!=='playing' || !this.drag.host.isConnected)this.cancel();else return;}
    const pack=this.s.player.pack;
    // Quantity-only changes update text without replacing buttons under the pointer.
    const shape=(item: Slot|null)=>slotKey(item && isBulk(item)?{...item,n:0}:item);
    const key=pack.slots.map(shape).join('|')+';'+EQUIPMENT.map(e=>slotKey(this.s.equipped(e))).join('|');
    const cell=(item: Slot|null,attrs:string,label:string)=>`<button class="pack-cell" ${attrs} title="${item?slotName(item):label}" aria-label="${label}${item?': '+slotName(item):': empty'}">${item?`<img draggable="false" src="${this.image(item)}" alt="">${isBulk(item)?`<b>${Number(item.n.toFixed(1))}</b>`:''}`:`<span>${label}</span>`}</button>`;
    for(const [host,old] of this.hosts){
      if(!host.isConnected){this.hosts.delete(host);continue;}
      if(old===key){
        host.querySelectorAll<HTMLElement>('[data-pack-index]').forEach(cell=>{
          const item=pack.at(Number(cell.dataset.packIndex)),count=cell.querySelector('b');
          if(item && isBulk(item) && count){const text=String(Number(item.n.toFixed(1)));if(count.textContent!==text)count.textContent=text;}
        });
        continue;
      }
      host.innerHTML=`<div><div class="cap">PACK · ${pack.slots.length-pack.emptySlots}/${pack.slots.length}</div><div class="pack-grid">${pack.slots.map((item,i)=>cell(item,`data-pack-index="${i}"`,`${i+1}`)).join('')}</div></div><div><div class="cap">EQUIPMENT</div><div class="equipment-grid">${EQUIPMENT.map(e=>cell(this.s.equipped(e),`data-equipment="${e}"`,e)).join('')}</div></div><small class="pack-help">Drag to move, equip or drop · G throws largest supply stack</small>`;
      this.hosts.set(host,key);
    }
  }
  cancel(): void {
    const d=this.drag;if(!d)return;this.drag=null;d.ghost.remove();
    if(d.host.hasPointerCapture(d.pointer))d.host.releasePointerCapture(d.pointer);
    this.render();
  }
  private down(e: PointerEvent,host: HTMLElement): void {
    if(e.pointerType==='touch'||e.button!==0||this.s.screen!=='playing')return;
    const el=(e.target as Element).closest<HTMLElement>('.pack-cell');if(!el)return;
    e.preventDefault();e.stopPropagation();
    const source=this.source(el),item=this.item(source);if(!item)return;
    const ghost=el.cloneNode(true) as HTMLElement;ghost.className='pack-cell pack-ghost';document.body.append(ghost);
    this.drag={source,key:slotKey(item),item,player:this.s.player,host,pointer:e.pointerId,ghost,x:e.clientX,y:e.clientY,moved:false};
    try{host.setPointerCapture(e.pointerId);}catch{/* the pointer went away between the event and here: the drag still tracks, and blur/Escape still cancel it */}this.move(e);
  }
  private move(e: PointerEvent): void {
    const d=this.drag;if(!d||e.pointerId!==d.pointer)return;
    e.preventDefault();e.stopPropagation();
    if(Math.hypot(e.clientX-d.x,e.clientY-d.y)>4)d.moved=true;
    d.ghost.style.left=e.clientX+12+'px';d.ghost.style.top=e.clientY+12+'px';
  }
  private up(e: PointerEvent): void {
    const d=this.drag;if(!d||e.pointerId!==d.pointer)return;
    e.preventDefault();e.stopPropagation();
    const current=this.item(d.source);
    const same=slotKey(current)===d.key && (typeof d.source!=='number'||current===d.item);
    if(d.moved && same && d.player===this.s.player && this.s.screen==='playing'){
      const target=document.elementFromPoint(e.clientX,e.clientY), cell=target?.closest<HTMLElement>('.pack-cell');
      if(cell){
        const dest=this.source(cell);
        if(typeof d.source==='number' && typeof dest==='number')this.s.player.pack.move(d.source,dest);
        else if(typeof d.source==='number' && typeof dest==='string')this.s.swapEquipment(d.source,dest);
        else if(typeof d.source==='string' && typeof dest==='number')this.s.swapEquipment(dest,d.source);
      }else if(target===this.s.game.canvas && !this.s.interior.active){
        const rect=this.s.game.canvas.getBoundingClientRect();
        const point=this.s.cameras.main.getWorldPoint((e.clientX-rect.left)*this.s.scale.width/rect.width,(e.clientY-rect.top)*this.s.scale.height/rect.height);
        this.s.dropPackItem(d.source,point);
      }
      this.s.validateTool();
    }
    this.cancel();
  }
}
