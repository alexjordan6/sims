import * as THREE from 'three';
import { buildFigure, FIGURES } from './view3d/figure';
import { heldMesh, grip, PERSON } from './view3d/actors';
import { poseFigure } from './view3d/motion';
import { setFowOn } from './view3d/fow';
import { triangles } from './view3d/lowpoly';

// Uses the same geometry, grip and pose solver as the actual game, with deterministic controls.
setFowOn(false);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.16;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x192632);
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 30);
camera.position.set(3, 2, 5); camera.lookAt(0, 0.75, 0);
scene.add(new THREE.HemisphereLight(0xc6def5, 0x65634c, 2));
const sun = new THREE.DirectionalLight(0xffe0b0, 3.2); sun.position.set(-3,5,4); sun.castShadow = true; sun.shadow.mapSize.set(2048,2048); scene.add(sun);
const rim = new THREE.DirectionalLight(0x8fb5ff, 2); rim.position.set(3,3,-3); scene.add(rim);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40,40),new THREE.MeshStandardMaterial({color:0x283845,roughness:0.9}));
floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
const figures = ['head','gnome','raider'].map((name,i)=>{
  const rig=new THREE.Group(),spec=FIGURES[name];
  const height=buildFigure(rig,spec,{circlet:i===0,cap:i===1?3:0,kit:{helmet:0,chest:i===0?2:0,legs:i===0?2:0,shield:0}});
  const k=PERSON/height;rig.scale.setScalar(k);rig.position.x=(i-1)*1.45;
  const weapon=heldMesh('sword',2)!;weapon.name='held-weapon';weapon.scale.setScalar(1/k);grip(weapon,k,spec);
  rig.userData.held='sword';
  rig.getObjectByName('hand-right')!.add(weapon);rig.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;}});scene.add(rig);return rig;
});
let mode='idle',time=0,paused=false,last=performance.now();
const counts = figures.map(rig => { let n=0; rig.traverse(o=>{if(o instanceof THREE.Mesh)n+=triangles(o.geometry);}); return n; });
document.querySelector('header p')!.textContent='Faceted production meshes · human / gnome / raider · '+counts.join(' / ')+' triangles';
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b=>b.onclick=()=>{
  mode=b.dataset.mode!;time=0;document.getElementById('pose-label')!.textContent=b.textContent;
  for (const rig of figures) {
    const kind=mode==='bow'?'bow':'sword';
    if (rig.userData.held===kind) continue;
    const old=rig.getObjectByName('held-weapon');
    old?.removeFromParent();
    old?.traverse(o=>{if(o instanceof THREE.Mesh)(o.material as THREE.Material).dispose();});
    const weapon=heldMesh(kind,2)!;weapon.name='held-weapon';weapon.scale.setScalar(1/rig.scale.x);
    grip(weapon,rig.scale.x,rig.userData.spec);rig.getObjectByName('hand-right')!.add(weapon);rig.userData.held=kind;
  }
  document.querySelectorAll('[data-mode]').forEach(n=>n.setAttribute('aria-pressed',String(n===b)));
});
document.getElementById('pause')!.onclick=()=>{paused=!paused;document.getElementById('pause')!.textContent=paused?'Resume':'Pause';};
document.getElementById('check')!.onclick=()=>{
  if(mode==='bow'){document.getElementById('result')!.textContent='Select a sword pose to measure its tip travel.';return;}
  const rig=figures[0],tip=new THREE.Vector3(),positions:THREE.Vector3[]=[];
  for(const progress of [0,0.25,0.5,0.75,1]){
    poseFigure(rig,{phase:0,pace:0,time:0,strike:{dir:'right',progress,recovery:0}});
    rig.updateMatrixWorld(true);rig.getObjectByName('weapon-tip')!.getWorldPosition(tip);positions.push(tip.clone());
  }
  const travel=positions.slice(1).reduce((n,v,i)=>n+v.distanceTo(positions[i]),0);
  document.getElementById('result')!.textContent=travel>1?`PASS · weapon tip travels ${travel.toFixed(2)} m through slash`:`FAIL · weapon tip travel ${travel}`;
};
function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}
addEventListener('resize',resize);resize();
function frame(now:number){
  const dt=Math.min(0.05,(now-last)/1000);last=now;if(!paused)time+=dt;
  const strike=['left','right','up','down'].includes(mode),cycle=(time%1.6)/1.6;
  for(const rig of figures)poseFigure(rig,{phase:time*(mode==='run'?12:7),pace:mode==='walk'?0.65:mode==='run'?1:0,time,
    strike:strike?{dir:mode,progress:Math.max(0,Math.min(1,(cycle-0.15)/0.5)),recovery:Math.max(0,(cycle-0.65)/0.35)}:undefined,
    wind:mode==='guard'?{x:Math.sin(time)*0.5,y:0}:undefined,guard:mode==='guard',bow:mode==='bow'?1:undefined,death:mode==='die'?cycle:undefined});
  renderer.render(scene,camera);requestAnimationFrame(frame);
}requestAnimationFrame(frame);
