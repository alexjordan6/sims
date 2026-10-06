import * as THREE from 'three';
import { Raider, type Mover } from '../agents';
import type { VillageScene, Ptr } from '../main';
import { BUILDINGS, doorstep, type Defense, type TilePos } from '../world';
import { TILE, COLS, ROWS, p } from '../config';
import { Terrain, groundHeight } from './terrain';
import { Structures } from './structures';
import { Actors, standHeight } from './actors';
import { Overlay } from './overlay';
import { Fx3d } from './fx3d';
import { skyAt } from './sky';
import { Ps1Pass, updateFow, setFowOn } from './ps1';
import { Room3d } from './room';
import { MODELS, loadModels } from './assets';
import { propKeys, characterKeys } from './registry';
import { KIT_PIECES, KIT_PROPS } from './kit';
import { U, WALL_UNITS } from './models';

// The 3D view of the village. Phaser still runs the sim loop, the keyboard and the debug sliders,
// but draws nothing: its canvas is hidden and this one sits in its place. Each frame the view reads
// the scene's state and the fx queue; it never changes the sim except through the same pointer
// handlers the 2D canvas used to call.
//
// The camera is a MOBA's: a fixed high angle with north up, panned by pushing the mouse against a
// screen edge (or the arrow keys, or a middle-button drag), Space to snap back to the head, Y to lock
// it there, the wheel to zoom.

/** camera distances the Z key / zoom button steps through (in tiles) */
const DISTANCES = [8, 11, 14, 18, 23] as const;
/** how close to a screen edge the mouse pans the camera, px */
const EDGE = 14;

export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly world = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 140);
  readonly fx: Fx3d;
  private terrain: Terrain;
  private structures: Structures;
  private actors: Actors;
  private overlay: Overlay;
  private hemi = new THREE.HemisphereLight(0x8090a0, 0x2a2018, 0.6);
  private sun = new THREE.DirectionalLight(0xffffff, 0.9);
  private torch = new THREE.PointLight(0xffa860, 0, 9, 1.4);
  /** a few lamps lent to whichever hearths, pots and fires are nearest the camera */
  private lamps: THREE.PointLight[] = [];
  private ps1 = new Ps1Pass();
  private room: Room3d;
  private fowRevision = -1;
  private fowEnabled: boolean | null = null;
  /** the model revision the world was last built with, and when it last changed (rebuilds wait for a quiet moment) */
  private modelsBuilt = 0; private modelsSeen = 0; private modelsQuiet = 0;
  private arrows: HTMLCanvasElement;
  private actx: CanvasRenderingContext2D;
  /** set on frames where tiles were repainted (the minimap redraws its terrain then) */
  tilesChanged = false;

  // the camera: fixed yaw (north up) and pitch, distance out, and whether it is locked onto the head
  readonly yaw = 0;
  readonly pitch = 0.96;
  locked = false;
  dist: number = DISTANCES[2];
  /** where the camera looks when it is not following the head (edge-panned) */
  private pan = new THREE.Vector3();
  private focus = new THREE.Vector3();
  private shakeAmt = 0;
  private bumpAmt = 0; private bumpT = 0; private bumpMs = 1;
  private keys = new Set<string>();
  private dragging: { x: number; y: number } | null = null;
  /** the last pointer position over the canvas, in client pixels (null when it left) */
  private mouse: { x: number; y: number } | null = null;
  private t = 0;

  constructor(private scene: VillageScene) {
    const host = document.getElementById('game')!;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1); // the frame is drawn small and blown up anyway (see Ps1Pass)
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap; // hard-edged, pixel shadows
    const canvas = this.renderer.domElement;
    canvas.className = 'view3d';
    host.prepend(canvas);
    this.arrows = document.createElement('canvas');
    this.arrows.className = 'view3d-arrows';
    host.append(this.arrows);
    this.actx = this.arrows.getContext('2d')!;
    scene.game.canvas.style.display = 'none'; // Phaser keeps the loop and the keys; this canvas does the drawing

    this.world.fog = new THREE.Fog(0x05060c, 10, 40);
    this.sun.position.set(-20, 30, 10);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera; sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24; sc.near = 1; sc.far = 90;
    this.sun.shadow.bias = -0.002;
    this.world.add(this.hemi, this.sun, this.sun.target, this.torch);
    for (let i = 0; i < 6; i++) { const l = new THREE.PointLight(0xff9a50, 0, 10, 1.3); this.lamps.push(l); this.world.add(l); }
    this.terrain = new Terrain(scene);
    this.room = new Room3d(scene);
    this.structures = new Structures(scene);
    this.actors = new Actors(scene);
    this.overlay = new Overlay(scene);
    this.fx = new Fx3d(scene, this.actors, {
      project: (v) => this.project(v),
      shake: (a) => { this.shakeAmt = Math.max(this.shakeAmt, a); },
      bump: (z, ms) => { this.bumpAmt = z; this.bumpT = 0; this.bumpMs = ms; },
    });
    this.world.add(this.terrain.group, this.structures.group, this.actors.group, this.overlay.group, this.fx.group);

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.bindInput(canvas);
    // the packs load in the background; the placeholders stand in until they land
    void loadModels([...propKeys(), ...KIT_PROPS].map((key) => ({ key, centre: true })).concat(KIT_PIECES.map((key) => ({ key, centre: false }))), characterKeys());
  }

  private resize(): void {
    const host = document.getElementById('game')!;
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.ps1.size(w, h, p.ps1Height);
    this.room?.resize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.arrows.width = w; this.arrows.height = h;
  }

  /** Everything from scratch (a new run). */
  rebuild(): void {
    this.structures.clear();
    this.actors.clear();
    this.fx.clear();
    this.terrain.rebuildAll();
    this.snapCamera();
  }

  /** Put the camera straight onto the head, no easing (a new run, a teleport). */
  snapCamera(): void {
    const pl = this.scene.player;
    if (pl) { this.focus.set(pl.x * U, groundHeight(pl.x * U, pl.y * U) + standHeight(pl) + 0.8, pl.y * U); this.pan.copy(this.focus); }
  }

  /** Space: the camera jumps back onto the head (and stays while Space is held). */
  recentre(): void { this.snapCamera(); }
  /** Y: lock the camera onto the head, or free it to pan. */
  toggleLock(): void { this.locked = !this.locked; if (this.locked) this.snapCamera(); }

  cycleZoom(): void {
    const i = DISTANCES.findIndex((d) => d > this.dist + 0.01);
    this.dist = DISTANCES[i < 0 ? 0 : i];
  }

  // ---- input ---------------------------------------------------------------------------

  private bindInput(canvas: HTMLCanvasElement): void {
    const s = this.scene;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointermove', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY };
      if (this.dragging) {
        // grab the ground and drag it
        const k = this.dist * 0.0022;
        this.pan.x -= (e.clientX - this.dragging.x) * k; this.pan.z -= (e.clientY - this.dragging.y) * k * 1.3;
        this.dragging = { x: e.clientX, y: e.clientY };
        this.locked = false;
        return;
      }
      s.onPointerMove(this.ptrAt(e));
    });
    canvas.addEventListener('pointerdown', (e) => {
      try { canvas.setPointerCapture(e.pointerId); } catch { /* a synthetic or already-gone pointer */ }
      if (e.button === 1) { e.preventDefault(); this.dragging = { x: e.clientX, y: e.clientY }; return; }
      if (s.interior.active) { const q = this.room.floorAt(e.clientX, e.clientY, canvas); if (q) s.interior.tap(q.x, q.y, false); return; }
      s.onPointerDown(this.ptrAt(e));
    });
    canvas.addEventListener('pointerup', (e) => {
      if (this.dragging && e.button === 1) { this.dragging = null; return; }
      s.wandUp(this.ptrAt(e));
    });
    canvas.addEventListener('pointerleave', () => { this.mouse = null; s.onPointerOut(); });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.dist = Math.max(DISTANCES[0], Math.min(DISTANCES[DISTANCES.length - 1], this.dist * (e.deltaY > 0 ? 1.1 : 1 / 1.1)));
    }, { passive: false });
    window.addEventListener('keydown', (e) => { if (e.key.startsWith('Arrow') || e.key === ' ') { this.keys.add(e.key); if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); } });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private ray = new THREE.Raycaster();
  /** What lies under a client-pixel point: an agent, a wall, and always a spot on the ground. */
  pickAt(cx: number, cy: number): { x: number; z: number; agent: Mover | null; defense: Defense | null } {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hitAgent = this.ray.intersectObjects(this.actors.pickable, true).find((h) => h.object.visible && (h.object.userData.agent as Mover | undefined) && isShown(h.object));
    const agent = (hitAgent?.object.userData.agent as Mover | undefined) ?? null;
    const hitFort = this.ray.intersectObjects(this.structures.pickable, true)[0];
    const defense = (hitFort?.object.userData.defense as Defense | undefined) ?? null;
    // the ground: a plane at 0, nudged twice onto the rolling surface
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    let y = 0, x = o.x, z = o.z;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d.y) < 1e-4) break;
      const t = (y - o.y) / d.y;
      x = o.x + d.x * t; z = o.z + d.z * t;
      y = groundHeight(x, z);
    }
    // the nearest solid thing along the ray wins: a person, a wall, a building, a tree or a bush
    const props = this.ray.intersectObjects([...this.terrain.propsAround(x, z), ...this.structures.buildingGroups], true)[0];
    const best = [hitAgent && agent ? { d: hitAgent.distance, k: 'agent' as const } : null, hitFort ? { d: hitFort.distance, k: 'fort' as const } : null, props ? { d: props.distance, k: 'prop' as const } : null]
      .filter((h): h is { d: number; k: 'agent' | 'fort' | 'prop' } => !!h).sort((a, b) => a.d - b.d)[0];
    if (best?.k === 'agent') return { x: agent!.x * U, z: agent!.y * U, agent, defense: null };
    if (best?.k === 'fort') return { x: defense!.tx + 0.5, z: defense!.ty + 0.5, agent: null, defense };
    if (best?.k === 'prop' && props) {
      const b = props.object.userData.building as import('../world').Building | undefined;
      if (b) {
        // a building: the footprint tile nearest where the ray struck it
        const f = BUILDINGS[b.kind];
        return { x: Math.min(b.tx + f.w - 0.5, Math.max(b.tx + 0.5, props.point.x)), z: Math.min(b.ty + f.h - 0.5, Math.max(b.ty + 0.5, props.point.z)), agent: null, defense: null };
      }
      if (props.instanceId !== undefined && props.object instanceof THREE.InstancedMesh) {
        // a tree, a bush, a stalk of wheat: the tile it grows from
        const m = new THREE.Matrix4(); props.object.getMatrixAt(props.instanceId, m);
        const e = m.elements;
        return { x: Math.floor(e[12]) + 0.5, z: Math.floor(e[14]) + 0.5, agent: null, defense: null };
      }
    }
    return { x, z, agent: null, defense: null };
  }

  private ptrAt(e: PointerEvent): Ptr {
    const hit = this.pickAt(e.clientX, e.clientY);
    const button = e.button, buttons = e.buttons;
    const wallTile: TilePos | null = hit.defense ? { tx: hit.defense.tx, ty: hit.defense.ty } : null;
    return { worldX: hit.x * TILE, worldY: hit.z * TILE, agent: hit.agent, wallTile, event: e, rightButtonDown: () => button === 2 || (buttons & 2) !== 0 };
  }

  /** The ground point under the resting mouse, re-read each frame as the camera moves (bow aim). */
  aimPoint(): { x: number; y: number } | null {
    if (!this.mouse) return null;
    const hit = this.pickAt(this.mouse.x, this.mouse.y);
    return { x: hit.x * TILE, y: hit.z * TILE };
  }

  /** The four corners of the screen laid on the ground (tiles), nearest first; far corners stop at the fog. */
  groundFootprint(): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    const reach = (this.world.fog as THREE.Fog).far;
    for (const [nx, ny] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      this.ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
      const o = this.ray.ray.origin, d = this.ray.ray.direction;
      const t = d.y < -1e-3 ? Math.min(reach, -o.y / d.y) : reach;
      out.push({ x: o.x + d.x * t, z: o.z + d.z * t });
    }
    return out;
  }

  /** World units → client pixels, and whether it is in front of the camera and on screen. */
  project(v: THREE.Vector3): { x: number; y: number; on: boolean } {
    const r = this.renderer.domElement.getBoundingClientRect();
    const q = v.clone().project(this.camera);
    const on = q.z < 1 && q.x > -1.1 && q.x < 1.1 && q.y > -1.1 && q.y < 1.1;
    return { x: r.left + ((q.x + 1) / 2) * r.width, y: r.top + ((1 - q.y) / 2) * r.height, on };
  }
  /** Sim pixels (and a height in units) → client pixels. */
  projectWorld(x: number, y: number, h = 0): { x: number; y: number; on: boolean } {
    return this.project(new THREE.Vector3(x * U, groundHeight(x * U, y * U) + h, y * U));
  }

  // ---- per frame ---------------------------------------------------------------------------

  sync(dt: number): void {
    const s = this.scene;
    this.t += dt;
    // the camera: arrows turn it, the head is followed, a jolt or a punch-in when fx ask
    const k = this.keys, pl = s.player;
    if (pl) pl.camYaw = 0;
    // pan: arrow keys, or the mouse pushed against an edge of the view
    let px = (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0), pz = (k.has('ArrowDown') ? 1 : 0) - (k.has('ArrowUp') ? 1 : 0);
    const r = this.renderer.domElement.getBoundingClientRect(), m = this.mouse;
    if (m && s.screen === 'playing') {
      if (m.x < r.left + EDGE) px = -1; else if (m.x > r.right - EDGE) px = 1;
      if (m.y < r.top + EDGE) pz = -1; else if (m.y > r.bottom - EDGE) pz = 1;
    }
    const following = this.locked || k.has(' ') || s.screen !== 'playing';
    if (pl && following) {
      const want = new THREE.Vector3(pl.x * U, groundHeight(pl.x * U, pl.y * U) + standHeight(pl) + 0.8, pl.y * U);
      this.pan.copy(want);
    } else if (px || pz) {
      const sp = this.dist * 1.6 * dt;
      this.pan.x = Math.max(0, Math.min(COLS, this.pan.x + px * sp)); this.pan.z = Math.max(0, Math.min(ROWS, this.pan.z + pz * sp));
      this.pan.y = groundHeight(this.pan.x, this.pan.z) + 0.8;
    }
    this.focus.lerp(this.pan, Math.min(1, dt * (following ? 8 : 14)));
    this.bumpT += dt * 1000;
    const bump = this.bumpT < this.bumpMs ? this.bumpAmt * Math.sin((this.bumpT / this.bumpMs) * Math.PI) : 0;
    const dist = this.dist * (1 - bump * 3) * p.cameraZoom / 2;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.camera.position.set(this.focus.x + Math.sin(this.yaw) * cp * dist, this.focus.y + sp * dist, this.focus.z + Math.cos(this.yaw) * cp * dist);
    if (this.shakeAmt > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmt;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmt;
      this.shakeAmt *= Math.max(0, 1 - dt * 9);
    }
    this.camera.lookAt(this.focus);
    // light: the hour sets the sky, the sun and how far the dark lets you see
    const sky = skyAt(s.dayTime);
    // the fog starts just past the head, however far out the camera sits, and closes in at night
    const fog = this.world.fog as THREE.Fog;
    fog.color.setHex(sky.sky); fog.near = dist + 1; fog.far = dist + sky.fogD;
    // nothing past the fog is drawn at all
    if (Math.abs(this.camera.far - (fog.far + 4)) > 0.5) { this.camera.far = fog.far + 4; this.camera.updateProjectionMatrix(); }
    this.renderer.setClearColor(sky.sky);
    this.hemi.color.setHex(sky.amb); this.hemi.intensity = sky.ambI * 2.2;
    this.sun.color.setHex(sky.sun); this.sun.intensity = sky.sunI * 1.6;
    const arc = sky.arc;
    this.sun.position.set(this.focus.x + Math.cos(arc) * 30, this.focus.y + Math.max(8, Math.sin(arc) * 40), this.focus.z - 12);
    this.sun.target.position.copy(this.focus);
    this.sun.castShadow = p.shadows && sky.sunI > 0.3;
    this.placeLamps(sky.night);
    if (pl) this.torch.position.set(pl.x * U, groundHeight(pl.x * U, pl.y * U) + standHeight(pl) + 1.4, pl.y * U);
    this.torch.intensity = (pl && !pl.hidden ? 3.2 : 0) * (0.35 + 0.65 * sky.night) * (0.93 + 0.07 * Math.sin(this.t * 13) * Math.sin(this.t * 7.3));
    // models landing: once they stop arriving for a moment, the ground and its flora are rebuilt with them
    if (MODELS.revision !== this.modelsSeen) { this.modelsSeen = MODELS.revision; this.modelsQuiet = 0; }
    else if (this.modelsBuilt !== this.modelsSeen && (this.modelsQuiet += dt) > 0.3) { this.modelsBuilt = this.modelsSeen; this.terrain.rebuildAll(); }
    // the world
    s.fog?.update(dt);
    this.syncFow();
    this.tilesChanged = this.terrain.sync();
    this.structures.sync(sky.night, this.t);
    this.actors.sync(dt);
    for (const ev of s.fx) this.fx.handle(ev);
    s.fx.length = 0;
    this.fx.update(dt);
    this.overlay.sync(dt);
    const host = this.renderer.domElement;
    this.ps1.size(host.width, host.height, p.ps1Height);
    this.room.sync(dt);
    if (s.interior.active) {
      // indoors: the room's diorama, with no fog of war (its floor is not the map)
      setFowOn(false);
      this.ps1.render(this.renderer, this.room.scene, this.room.camera, dt, p.ps1Colours);
      setFowOn(true);
    } else this.ps1.render(this.renderer, this.world, this.camera, dt, p.ps1Colours);
    this.drawRaidArrows();
  }

  /** The fog of war, uploaded for the shaders whenever the sight pass has run. */
  private syncFow(): void {
    const fog = this.scene.fog, on = !!fog && fog.enabled;
    if (on === this.fowEnabled && (!on || fog!.revision === this.fowRevision)) return;
    this.fowEnabled = on; this.fowRevision = fog?.revision ?? -1;
    updateFow(on ? fog!.explored : null, on ? fog!.vis : null);
  }

  /**
   * Lend the lamps to the lights nearest the camera: a warm house's door glows as night falls, the great pot
   * smoulders always, and the lair's mouth breathes a dull red.
   */
  private placeLamps(night: number): void {
    const s = this.scene, fx = this.focus.x, fz = this.focus.z;
    const lights: { x: number; y: number; z: number; colour: number; power: number; d: number }[] = [];
    for (const b of s.world.buildings) {
      if (b.ruined) continue;
      const f = BUILDINGS[b.kind];
      let x: number, z: number, y = 1.1, colour = 0xff9a50, power = 0;
      if (b.kind === 'cookpot') { x = b.tx + f.w / 2; z = b.ty + f.h / 2; y = 1.8; colour = 0xff7a30; power = 2.2 + 1.2 * night; }
      else if (b.kind === 'lair') { const d = doorstep(b); x = d.tx + 0.5; z = d.ty; y = 0.8; colour = 0xff2a10; power = 1.6; }
      else { if (!b.warm || night < 0.05) continue; const d = doorstep(b); x = d.tx + 0.5; z = d.ty + 0.2; power = 2.6 * night; }
      const d = (x - fx) ** 2 + (z - fz) ** 2;
      if (d > 32 * 32) continue;
      lights.push({ x, y: groundHeight(x, z) + y, z, colour, power, d });
    }
    // a raider camp's fire, where anyone holds it
    for (const camp of s.camps) {
      if (!camp.members.some((m) => !m.dead)) continue;
      const x = camp.x * U, z = camp.y * U, d = (x - fx) ** 2 + (z - fz) ** 2;
      if (d <= 32 * 32) lights.push({ x, y: groundHeight(x, z) + 0.8, z, colour: 0xff7a30, power: 1.6 + 1.6 * night, d });
    }
    lights.sort((a, b) => a.d - b.d);
    this.lamps.forEach((l, i) => {
      const src = lights[i];
      if (!src) { l.intensity = 0; return; }
      l.position.set(src.x, src.y, src.z); l.color.setHex(src.colour);
      l.intensity = src.power * (0.9 + 0.1 * Math.sin(this.t * 11 + i * 2.3));
    });
  }

  /** During a raid, a red arrow on the screen's edge for every raider out of view (the boss's is big and gold). */
  private drawRaidArrows(): void {
    const g = this.actx, s = this.scene, W = this.arrows.width, H = this.arrows.height;
    g.clearRect(0, 0, W, H);
    if (!s.raidActive || s.interior.active) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    for (const a of s.agents) {
      if (!(a instanceof Raider) || a.dead || a.lairBound) continue;
      const v = new THREE.Vector3(a.x * U, 0.6, a.y * U).project(this.camera);
      const behind = v.z > 1;
      let nx = behind ? -v.x : v.x, ny = behind ? -v.y : v.y;
      if (!behind && nx > -1 && nx < 1 && ny > -1 && ny < 1) continue;
      const len = Math.hypot(nx, ny) || 1; nx /= len; ny /= len;
      const pad = 18, hw = W / 2 - pad, hh = H / 2 - pad;
      const t = Math.min(hw / Math.abs(nx || 1e-6), hh / Math.abs(ny || 1e-6));
      const px = W / 2 + nx * t, py = H / 2 - ny * t, ang = Math.atan2(-ny, nx), size = a.boss ? 14 : 9;
      g.fillStyle = a.boss ? '#ffcc33' : '#ff4a3d';
      g.beginPath();
      g.moveTo(px + Math.cos(ang) * size, py + Math.sin(ang) * size);
      g.lineTo(px + Math.cos(ang + 2.4) * size, py + Math.sin(ang + 2.4) * size);
      g.lineTo(px + Math.cos(ang - 2.4) * size, py + Math.sin(ang - 2.4) * size);
      g.fill();
    }
    void r;
  }
}

/** Is every ancestor of this object shown? (a hidden actor's parts are still in the pick list) */
function isShown(o: THREE.Object3D | null): boolean {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}

export { WALL_UNITS };
