import type Phaser from 'phaser';
import { type Gear, slotKey } from './pack';

const icons = new Map<string, HTMLCanvasElement>();
const urls = new Map<string, string>();
/** The same tiny procedural drawing is used in the pack and on the ground. */
function canvas(g: Gear): HTMLCanvasElement {
  const key = slotKey(g), cached = icons.get(key); if (cached) return cached;
  const el = document.createElement('canvas'); el.width = el.height = 16;
  const c = el.getContext('2d')!;
  const tier = g.kind === 'tool' ? 0 : g.tier;
  const metal = ['#b58a54', '#ca9b56', '#a7b8be', '#e0e8ee'][tier] ?? '#e0e8ee';
  const r = (x:number,y:number,w:number,h:number,color=metal) => { c.fillStyle=color;c.fillRect(x,y,w,h); };
  const shape = g.kind === 'tool' ? g.tool : g.kind === 'weapon' ? (g.slot==='bow'?'bow':tier===0?'club':'sword') : g.slot;
  switch(shape) {
    case 'axe': r(7,3,2,12,'#805532');r(3,3,5,5,'#b6c4cb');r(2,4,2,3,'#e0e8ee');break;
    case 'hoe': r(7,3,2,12,'#805532');r(3,3,8,2,'#b6c4cb');r(3,4,2,3,'#b6c4cb');break;
    case 'hammer': r(7,6,2,9,'#805532');r(3,3,10,4,'#b6c4cb');break;
    case 'wand': r(7,6,2,9,'#805532');r(6,2,4,4,'#8ce6e5');r(5,3,6,2,'#b2ffff');break;
    case 'basket': r(3,8,10,6,'#ba8b4d');r(4,4,1,4);r(11,4,1,4);r(5,3,6,1);r(4,10,8,1,'#775132');r(4,12,8,1,'#775132');break;
    case 'club': r(7,8,2,7,'#805532');r(5,2,5,7);r(6,2,2,5,'#d3ae73');break;
    case 'sword': r(7,1,2,10);r(5,10,6,2,'#ac7a38');r(7,12,2,3,'#805532');break;
    case 'bow': r(5,2,2,2);r(7,4,2,2);r(9,6,2,4);r(7,10,2,2);r(5,12,2,2);r(5,3,1,10,'#e0dac3');break;
    case 'helmet': r(4,4,8,7);r(5,2,6,3);r(3,10,10,2);r(6,7,4,2,'#383b42');break;
    case 'chest': r(4,4,8,9);r(2,4,3,4);r(11,4,3,4);r(6,3,4,2,'#383b42');r(7,6,2,6,'#f1d5a0');break;
    case 'legs': r(4,3,8,4);r(4,7,3,7);r(9,7,3,7);r(4,13,3,2,'#664631');r(9,13,3,2,'#664631');break;
    case 'shield': r(3,3,10,7);r(4,10,8,2);r(6,12,4,2);r(7,5,2,7,'#e9d6a4');break;
  }
  icons.set(key,el);return el;
}
export function gearUrl(g: Gear): string { const key=slotKey(g);if(!urls.has(key))urls.set(key,canvas(g).toDataURL());return urls.get(key)!; }
export function gearTexture(scene: Phaser.Scene,g: Gear): string {
  const key='gear-'+slotKey(g);if(!scene.textures.exists(key))scene.textures.addCanvas(key,canvas(g));return key;
}
