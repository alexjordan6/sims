import { Pack, IMPLEMENTS, isBulk, slotKey } from './pack';
import { STACK, p, TILE, ITEM, GNOME_YARD, ARMOR } from './config';
import { Villager } from './agents';
import { World, buildingCenter } from './world';
import type { VillageScene } from './main';

/** Data and simulation regressions; mouse/capture behavior is exercised separately in the browser. */
export function runPackChecks(s: VillageScene, assert: (ok:unknown,msg:string)=>void): void {
  const pack=new Pack(2);
  assert(pack.slots.length===5,'pack enforces minimum five slots');
  assert(pack.add('wood',STACK.wood+3)===STACK.wood+3,'bulk insertion spans stacks');
  assert(pack.add('food',5,'berry')===5 && pack.add('food',7,'carrot')===7,'mixed food stays separate');
  pack.put({kind:'weapon',slot:'melee',tier:0});
  assert(pack.full && pack.add('scrap',1)===0,'gear takes one slot and full pack rejects new kinds');
  assert(pack.add('wood',1000)===STACK.wood-3,'matching stacks still accept only their remaining capacity');
  assert(pack.take('wood',3)===3,'bulk removal reports exact amount');
  pack.slots[0]={kind:'wood',n:10};pack.slots[1]={kind:'wood',n:STACK.wood-2};pack.move(0,1);
  assert(pack.at(0)?.kind==='wood' && (pack.at(0) as {n:number}).n===8 && (pack.at(1) as {n:number}).n===STACK.wood,'merge overflow remains in source');
  assert(pack.take('wood',8)===8 && pack.at(0)===null,'smallest stack drains first');
  const before=pack.slots.map(slotKey).join();assert(!pack.move(-1,1)&&pack.slots.map(slotKey).join()===before,'invalid pack moves preserve data');
  const saved={range:p.pickupRange,pull:p.pickupPull,slots:p.packSlots,start:p.gnomeStart};
  const fresh=()=>{
    s.reset(42);s.screen='playing';s.paused=true;s.agents=[s.player];s.world.items.length=0;s.meatClaims.clear();
    for(let y=90;y<110;y++)for(let x=115;x<140;x++)s.world.set(x,y,'grass');
    Object.assign(s.player,World.center(124,100));s.hoverPoint=null;s.hoverTile=null;
  };
  try {
    p.packSlots=12;p.gnomeStart=false;fresh();
    assert(s.player.pack.emptySlots===7 && IMPLEMENTS.every(t=>s.player.pack.hasTool(t)),'starting pack has five implements and seven free slots');
    assert(s.player.weapons.melee===0&&s.player.weapons.bow===0&&s.player.load===null,'club and bow start equipped outside pack; player load stays null');
    p.packSlots=5;assert(s.player.pack.slots.length===12,'pack size changes apply only on a new run');p.packSlots=12;
    s.player.pickUp('wood',20);s.player.pickUp('food',12,'berry');s.player.pickUp('scrap',9);
    s.wood=s.woodCap-3;s.food=s.foodCap-2;const scrap=s.scrap;
    s.deposit(s.player,s.world.woodyard);
    assert(s.player.carriedOf('wood')===17&&s.wood===s.woodCap&&s.player.carriedOf('food','berry')===12,'partial woodyard deposit keeps overflow and food');
    assert(s.scrap===scrap+9&&s.player.carriedOf('scrap')===0,'scrap banks only at the woodyard');
    s.deposit(s.player,s.world.granary);
    assert(s.player.carriedOf('food','berry')===10&&s.food===s.foodCap,'full granary retains excess food in pack');
    const v=new Villager(s.player.x,s.player.y,s.world.houses[0],'woodcutter',20,'Pack test',s.mods);v.pickUp('wood',8);s.wood=s.woodCap-2;s.deposit(v);
    assert(v.load?.n===6&&s.wood===s.woodCap,'villager partial deposit retains original armful');
    s.wood=0;s.deposit(v);assert(v.load===null&&s.wood===6,'villager remainder deposits normally');
    fresh();s.player.tool='axe';const axe=s.player.pack.findSlot(g=>g.kind==='tool'&&g.tool==='axe');s.player.pack.removeAt(axe);s.validateTool();
    assert(String(s.player.tool)==='hands'&&!!s.toolLocked('axe')&&!s.toolLocked('seeds'),'missing implement falls back to hands; free modes remain free');
    assert(s.recoverBasicKit()&&s.player.pack.hasTool('axe')&&s.player.pack.emptySlots===7,'recovery supplies only missing items');
    assert(s.recoverBasicKit()&&s.player.pack.emptySlots===7,'recovery does not duplicate kit');
    const empty=s.player.pack.slots.indexOf(null);s.swapEquipment(empty,'melee');
    assert(s.player.weapons.melee===-1&&s.player.pack.at(empty)?.kind==='weapon'&&!!s.toolLocked('sword')&&s.player.pressAttack()===-1,'tier-zero weapon can be unequipped; empty slot cannot attack');
    assert(s.recoverBasicKit()&&s.player.pack.emptySlots===6,'recovery detects packed weapon');
    s.swapEquipment(empty,'melee');assert(s.player.weapons.melee===0&&s.player.pack.at(empty)===null,'tier-zero weapon equips from pack');
    const i=s.player.pack.put({kind:'armor',slot:'helmet',tier:1}),hp=s.player.maxHp;
    const snapshot=s.player.pack.slots.map(slotKey).join();
    assert(!s.swapEquipment(i,'bow')&&s.player.pack.slots.map(slotKey).join()===snapshot,'invalid equipment swap changes nothing');
    assert(s.swapEquipment(i,'helmet')&&s.player.maxHp===hp+ARMOR.helmet.tiers[1].hp,'armor equip recalculates health');
    s.swapEquipment(i,'helmet');assert(s.player.maxHp===hp&&s.player.armor.helmet===0,'armor unequip restores base health');
    s.player.pack.removeAt(i);s.player.pack.removeAt(0);while(!s.player.pack.full)s.player.pack.put({kind:'tool',tool:'wand'});
    const noRoom=s.player.pack.slots.map(slotKey).join();assert(!s.recoverBasicKit()&&s.player.pack.slots.map(slotKey).join()===noRoom&&s.world.items.length===0,'insufficient recovery space is atomic and creates no drops');
    fresh();s.wood=999;s.scrap=999;assert(s.craftWeapon(s.player,'melee')&&s.player.pack.findSlot(g=>g.kind==='weapon'&&g.slot==='melee'&&g.tier===0)>=0,'forging preserves the starting club');
    while(!s.player.pack.full)s.player.pack.put({kind:'tool',tool:'wand'});
    assert(s.craftWeapon(s.player,'bow')&&s.world.items.some(it=>it.gear?.kind==='weapon'&&it.gear.slot==='bow'&&it.gear.tier===0&&it.playerDropPending),'full-pack forging drops the old tier-zero bow with pickup protection');
    fresh();s.player.tool='basket';s.player.basketKind='berry';s.pantry.berry=100;s.player.pickUp('food',5,'berry');s.fillBasket();
    assert(s.player.carriedOf('food','berry')===STACK.food&&s.pantry.berry===100-(STACK.food-5),'basket tops selected food up to one stack');
    s.fillBasket();assert(s.player.carriedOf('food','berry')===STACK.food,'repeated fill does not exceed one stack');
    s.player.pickUp('food',2,'carrot');s.player.cycleBasket(s.pantry);assert(s.player.basketKind!=='berry','basket cycles with carried or stored foods');
    fresh();p.pickupRange=2.5;p.pickupPull=90;
    let it=s.world.dropItem('wood',5,s.player.x+32,s.player.y),x=it.x;
    s.pickUpItems(.1);assert(Math.abs(it.x-(x-9))<1e-6&&it.rest&&it.vx===0&&it.vy===0&&it.vz===0,'attraction moves at configured speed without changing physics');
    s.pickUpItems(.2);assert(s.player.carriedOf('wood')===5&&!s.world.items.includes(it),'resting loot reaches the pack');
    it=s.world.dropItem('wood',5,s.player.x+41,s.player.y);x=it.x;s.pickUpItems(1);assert(it.x===x,'items outside pickup radius stay put');
    p.pickupRange=3;s.pickUpItems(.1);assert(it.x<x,'pickup range updates live');s.world.items.length=0;
    it=s.world.dropItem('wood',5,s.player.x+32,s.player.y);it.rest=false;it.z=4;x=it.x;s.pickUpItems(1);assert(it.x===x&&!it.rest&&it.z===4,'airborne items are not attracted');s.world.items.length=0;
    s.world.set(125,100,'tree');it=s.world.dropItem('wood',5,s.player.x+32,s.player.y);s.pickUpItems(1);assert(it.x>=126*TILE,'attraction cannot cross a blocking tree');s.world.set(125,100,'grass');s.world.items.length=0;
    const protectedItem=(label:string,protect:(it:ReturnType<typeof s.world.dropItem>)=>void,unprotect:()=>void)=>{
      const it=s.world.dropItem('food',2,s.player.x+32,s.player.y,'meat'),x=it.x;protect(it);s.pickUpItems(1);assert(it.x===x,label+' excludes attraction');
      Object.assign(s.player,{x:it.x,y:it.y});s.pickUpItems(0);assert(!s.world.items.includes(it),label+' still allows walk-over pickup');unprotect();Object.assign(s.player,World.center(124,100));
    };
    protectedItem('pen items',()=>s.world.paintPen(126,100,'farmer'),()=>s.world.paintPen(126,100,null));
    protectedItem('claimed meat',it=>s.meatClaims.add(it.id),()=>s.meatClaims.clear());
    s.agents.push(v);protectedItem('food being eaten',it=>v.eatingFrom=it,()=>v.eatingFrom=null);s.agents=[s.player];
    const house=s.world.place('gnomehouse',120,94)!,c=buildingCenter(house);Object.assign(s.player,{x:c.tx*TILE+GNOME_YARD*TILE-33,y:c.ty*TILE});
    it=s.world.dropItem('food',2,s.player.x+32,s.player.y,'berry');x=it.x;s.pickUpItems(1);assert(it.x===x,'gnome yard food is not attracted');s.world.items.length=0;
    Object.assign(s.player,World.center(124,100));while(!s.player.pack.full)s.player.pack.put({kind:'tool',tool:'axe'});
    it=s.world.dropItem('scrap',10,s.player.x+32,s.player.y);x=it.x;s.pickUpItems(1);assert(it.x===x,'no attraction without room');s.world.items.length=0;
    fresh();const wood=s.player.pickUp('wood',STACK.wood-2);while(!s.player.pack.full)s.player.pack.put({kind:'tool',tool:'axe'});
    it=s.world.dropItem('wood',5,s.player.x,s.player.y);s.pickUpItems(0);assert(s.player.carriedOf('wood')===wood+2&&it.n===3,'partial pickup leaves excess loot on ground');
    fresh();s.player.pickUp('wood',10);s.player.pickUp('food',10,'berry');s.hoverPoint={x:s.player.x,y:s.player.y};it=s.tossLoad()!;
    assert(it.kind==='wood'&&it.playerDropPending,'G breaks size ties by slot order and protects its drop');
    it.rest=true;it.z=0;it.x=s.player.x;it.y=s.player.y;s.pickUpItems(1);assert(s.world.items.includes(it),'deliberate drop cannot immediately return');
    s.player.x+=p.pickupRange*TILE+ITEM.reach+1;s.pickUpItems(0);assert(!it.playerDropPending,'leaving pickup radius clears protection');
    Object.assign(s.player,{x:it.x,y:it.y});s.pickUpItems(0);assert(!s.world.items.includes(it),'returning collects deliberate drop normally');
    const tools=s.player.pack.slots.filter(g=>g&&!isBulk(g)).length;assert(tools===5&&s.player.load===null,'pack operations never use player armful');
    for(const start of [false,true]){p.gnomeStart=start;fresh();assert(s.player.pack.emptySlots===7&&s.player.weapons.melee===0,'starting kit works for '+(start?'gnome':'normal')+' start');}
  } finally {p.pickupRange=saved.range;p.pickupPull=saved.pull;p.packSlots=saved.slots;p.gnomeStart=saved.start;s.reset(42);}
}
