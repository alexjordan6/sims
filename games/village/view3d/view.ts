import * as THREE from 'three';
import { Raider, type Mover } from '../agents';
import type { VillageScene, Ptr } from '../main';
import { BUILDINGS, doorstep, type Defense, type TilePos } from '../world';
import { TILE, p } from '../config';
import { Terrain, groundHeight } from './terrain';
import { Structures } from './structures';
import { Actors, standHeight } from './actors';
import { Crowd } from './crowd';
import { Overlay } from './overlay';
import { Fx3d } from './fx3d';
import { skyAt } from './sky';
import { updateFow, setFowOn } from './fow';
import { Room3d } from './room';
import { Dome } from './dome';
import { MODELS, loadModels } from './assets';
import { propKeys, characterKeys } from './registry';
import { KIT_PIECES, KIT_PROPS } from './kit';
import { U, WALL_UNITS } from './models';

// The 3D view of the village. Phaser still runs the sim loop, the keyboard and the debug sliders,
// but draws nothing: its canvas is hidden and this one sits in its place. Each frame the view reads
// the scene's state and the fx queue; it never changes the sim except through the same pointer
// handlers the 2D canvas used to call.
//
// The camera rides behind the head on a mouse-look, the way a third-person brawler's does: click to
// take the pointer, the mouse turns the camera, and WASD walks relative to wherever it has swung to.
// (It was a MOBA's camera - fixed high angle, north up, edge-panned - which is what main still has.)

/** how close behind the head the camera sits, in tiles: a duelling range, not a battle map's */
const DIST_MIN = 2, DIST_MAX = 7;
/** how far the look may swing up and down, in radians, where 0 is level with the ground */
const PITCH_MIN = 0.06, PITCH_MAX = 1.15;
/** how far above the head's feet the camera looks */
const EYE = 1.0;
/** how far to one side the whole view slides, so the head stands clear of its own crosshair */
const SHOULDER = 0.6;

export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly world = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 140);
  readonly fx: Fx3d;
  private terrain: Terrain;
  private structures: Structures;
  private actors: Actors;
  private overlay: Overlay;
  readonly crowd: Crowd;
  private hemi = new THREE.HemisphereLight(0x8090a0, 0x2a2018, 0.6);
  private sun = new THREE.DirectionalLight(0xffffff, 0.9);
  private torch = new THREE.PointLight(0xffa860, 0, 9, 1.4);
  /** a few lamps lent to whichever hearths, pots and fires are nearest the camera */
  private lamps: THREE.PointLight[] = [];
  private room: Room3d;
  private dome = new Dome();
  private fowRevision = -1;
  private fowEnabled: boolean | null = null;
  /** the model revision the world was last built with, and when it last changed (rebuilds wait for a quiet moment) */
  private modelsBuilt = 0; private modelsSeen = 0; private modelsQuiet = 0;
  private arrows: HTMLCanvasElement;
  private actx: CanvasRenderingContext2D;
  /** set on frames where tiles were repainted (the minimap redraws its terrain then) */
  tilesChanged = false;

  // the camera: where the mouse has turned it to, and how far back it sits
  yaw = 0;
  pitch = 0.42;
  dist = 5.5;
  /** where the camera wants to look (the head, always, in third person) */
  private pan = new THREE.Vector3();
  private focus = new THREE.Vector3();
  /** the camera's view this frame, for the crowd to skip what it cannot see */
  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  private shadowFrame = 0;
  private shakeAmt = 0;
  private bumpAmt = 0; private bumpT = 0; private bumpMs = 1;
  /** the last pointer position over the canvas, in client pixels; the crosshair's while the pointer is locked */
  private mouse: { x: number; y: number } | null = null;
  private t = 0;

  constructor(private scene: VillageScene) {
    const host = document.getElementById('game')!;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; // the post pass used to do this by hand
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // (three r186 removed PCFSoftShadowMap and silently falls back to this)
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
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24; sc.near = 1; sc.far = 90;
    this.sun.shadow.bias = -0.002;
    this.world.add(this.hemi, this.sun, this.sun.target, this.torch, this.dome.mesh);
    for (let i = 0; i < 6; i++) { const l = new THREE.PointLight(0xff9a50, 0, 10, 1.3); this.lamps.push(l); this.world.add(l); }
    this.terrain = new Terrain(scene);
    this.room = new Room3d(scene);
    this.structures = new Structures(scene);
    this.actors = new Actors(scene);
    this.overlay = new Overlay(scene);
    this.crowd = new Crowd(scene, this.actors.kicks);
    this.actors.crowdDrawn = this.crowd.drawn;
    this.fx = new Fx3d(scene, this.actors, {
      project: (v) => this.project(v),
      shake: (a) => { this.shakeAmt = Math.max(this.shakeAmt, a); },
      bump: (z, ms) => { this.bumpAmt = z; this.bumpT = 0; this.bumpMs = ms; },
    });
    this.world.add(this.terrain.group, this.structures.group, this.crowd.group, this.actors.group, this.overlay.group, this.fx.group);

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.bindInput(canvas);
    // the packs load in the background; the placeholders stand in until they land
    void loadModels([...propKeys(), ...KIT_PROPS].map((key) => ({ key, centre: true })).concat(KIT_PIECES.map((key) => ({ key, centre: false }))), characterKeys());
  }

  private resize(): void {
    const host = document.getElementById('game')!;
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    // the device's pixel ratio is read again here, not just at startup: it changes when the window is
    // dragged to a screen of another density (and reads 1 while the page is still off screen)
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setSize(w, h, false);
    this.room?.resize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.arrows.width = w; this.arrows.height = h;
  }

  /** Everything from scratch (a new run). */
  rebuild(): void {
    this.structures.clear();
    this.actors.clear();
    this.crowd.clear();
    this.fx.clear();
    this.terrain.rebuildAll();
    this.snapCamera();
  }

  /** Put the camera straight onto the head, no easing (a new run, a teleport). */
  snapCamera(): void {
    const pl = this.scene.player;
    if (pl) { this.focus.set(pl.x * U, groundHeight(pl.x * U, pl.y * U) + standHeight(pl) + 0.8, pl.y * U); this.pan.copy(this.focus); }
  }

  cycleZoom(): void { this.dist = this.dist >= DIST_MAX - 0.01 ? DIST_MIN : Math.min(DIST_MAX, this.dist + 1.5); }

  /**
   * Is the mouse turning the camera? Normally that means the pointer is locked to the canvas. Some
   * documents are not allowed to take the pointer at all (an iframe without allow="pointer-lock", and
   * the editor's own preview pane), so when the request is refused we fall back to turning while a
   * button is held and dragged — the same look, one button busier.
   */
  get looking(): boolean { return document.pointerLockElement === this.renderer.domElement || this.dragLook; }
  /** true once a lock request has been refused: this document will never get the pointer */
  private noLock = false;
  private dragLook = false;

  /** Take the pointer, or learn that we cannot. */
  private grabPointer(): void {
    if (this.noLock) return;
    const r = this.renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined;
    void r?.catch?.(() => { this.noLock = true; console.info('[village] the page may not lock the pointer here: hold a mouse button to look round'); });
  }

  /** Turn the camera by a mouse movement, in raw device pixels. */
  private turn(dx: number, dy: number): void {
    // a blow held back, or a guard held up, reads the same mouse: whichever way it travels picks the side
    this.scene.player?.aimWind(dx, dy);
    this.scene.player?.aimGuard(dx, dy);
    const k = p.lookSpeed * 0.0022;
    // the camera sits at +sin(yaw), +cos(yaw) and looks inward, so a rightward push wants yaw to fall
    this.yaw -= dx * k;
    this.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, this.pitch + dy * k * (p.lookInvert ? -1 : 1)));
  }

  /**
   * With the pointer locked there is no cursor to hover with, so the middle of the screen becomes one:
   * a ray down the crosshair every frame feeds the same hoverPoint and hoverTile that the tools, the bow
   * and the roll already read, and nothing downstream has to know the difference.
   */
  private aimCrosshair(): void {
    const s = this.scene;
    if (!this.looking || s.interior.active) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    this.mouse = { x: cx, y: cy };
    s.onPointerMove(this.crosshairPtr());
  }

  /**
   * Pull the camera in until nothing stands between it and the head. A third-person camera that keeps
   * its distance spends half a village watching the fight through the back of a house.
   */
  private back = new THREE.Vector3();
  private aimAt_ = new THREE.Vector3();
  private unblock(dist: number): void {
    this.back.copy(this.camera.position).sub(this.focus);
    const len = this.back.length();
    if (len < 0.01) return;
    this.back.divideScalar(len);
    this.ray.set(this.focus, this.back);
    this.ray.far = len;
    const walls = [...this.structures.buildingGroups, ...this.structures.pickable, ...this.terrain.propsAround(this.focus.x, this.focus.z)];
    const hit = this.ray.intersectObjects(walls, true).find((h) => h.distance > 0.2);
    this.ray.far = Infinity;
    if (!hit) return;
    const want = Math.max(0.9, Math.min(dist, hit.distance - 0.25));
    this.camera.position.copy(this.focus).addScaledVector(this.back, want);
    const floor = groundHeight(this.camera.position.x, this.camera.position.z) + 0.35;
    if (this.camera.position.y < floor) this.camera.position.y = floor;
  }

  /** The pick down the crosshair, as the pointer the scene expects. */
  private crosshairPtr(right = false): Ptr {
    const r = this.renderer.domElement.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const hit = this.pickAt(cx, cy);
    return {
      worldX: hit.x * TILE, worldY: hit.z * TILE, agent: hit.agent,
      wallTile: hit.defense ? { tx: hit.defense.tx, ty: hit.defense.ty } : null,
      event: new MouseEvent('mousemove', { clientX: cx, clientY: cy }),
      rightButtonDown: () => right,
    };
  }

  // ---- input ---------------------------------------------------------------------------

  private bindInput(canvas: HTMLCanvasElement): void {
    const s = this.scene;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointermove', (e) => {
      if (this.looking) { this.turn(e.movementX, e.movementY); return; } // the mouse is the camera now
      this.mouse = { x: e.clientX, y: e.clientY };
      s.onPointerMove(this.ptrAt(e));
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (s.interior.active) { const q = this.room.floorAt(e.clientX, e.clientY, canvas); if (q) s.interior.tap(q.x, q.y, false); return; }
      // the first click takes the pointer; after that the mouse is the look and the clicks are the fight
      if (!this.looking) { this.grabPointer(); if (!this.noLock) return; }
      if (this.noLock) { this.dragLook = true; try { canvas.setPointerCapture(e.pointerId); } catch { /* already gone */ } }
      if (e.button === 2) { s.raiseGuard(); return; } // the right button holds the guard up
      if (e.button === 0 && s.beginAttack()) return; // a blade winds up, a bow draws
      s.onPointerDown(this.crosshairPtr());
    });
    canvas.addEventListener('pointerup', (e) => {
      if (e.button === 2) { s.dropGuard(); this.dragLook = false; return; }
      if (e.button === 0 && s.releaseAttack()) { this.dragLook = false; return; } // the blow goes
      if (this.looking && e.button !== 2) s.wandUp(this.crosshairPtr());
      this.dragLook = false;
    });
    canvas.addEventListener('pointerleave', () => { if (!this.looking) { this.mouse = null; s.onPointerOut(); } });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (s.mealAim) { s.cycleMeal(e.deltaY > 0 ? 1 : -1); return; } // aiming a meal: the wheel picks which
      this.dist = Math.max(DIST_MIN, Math.min(DIST_MAX, this.dist * (e.deltaY > 0 ? 1.1 : 1 / 1.1)));
    }, { passive: false });
    // Alt gives the cursor back without leaving the game, for the armory and the build menus
    window.addEventListener('keydown', (e) => { if (e.key === 'Alt' && this.looking) { e.preventDefault(); this.dragLook = false; document.exitPointerLock(); } });
  }

  private ray = new THREE.Raycaster();
  /** What lies under a client-pixel point: an agent, a wall, and always a spot on the ground. */
  pickAt(cx: number, cy: number): { x: number; z: number; agent: Mover | null; defense: Defense | null } {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    // a crowd body (an instance of a pose) or a full actor, whichever is nearer
    const hitActor = this.ray.intersectObjects(this.actors.pickable, true).find((h) => h.object.visible && (h.object.userData.agent as Mover | undefined) && isShown(h.object));
    const hitCrowd = this.ray.intersectObjects(this.crowd.meshes, false).find((h) => h.instanceId !== undefined && this.crowd.moverAt(h.object, h.instanceId));
    const hitAgent = hitCrowd && (!hitActor || hitCrowd.distance < hitActor.distance) ? hitCrowd : hitActor;
    const agent = (hitAgent === hitCrowd && hitCrowd ? this.crowd.moverAt(hitCrowd.object, hitCrowd.instanceId!) : (hitAgent?.object.userData.agent as Mover | undefined)) ?? null;
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
    const pl = s.player;
    // WASD walks relative to the camera, wherever the mouse has swung it round to
    if (pl) pl.camYaw = this.yaw;
    if (pl) this.pan.set(pl.x * U, groundHeight(pl.x * U, pl.y * U) + standHeight(pl) + EYE, pl.y * U);
    // tight: at this range a slow follow reads as the world swimming under the head
    this.focus.lerp(this.pan, Math.min(1, dt * 18));
    this.bumpT += dt * 1000;
    const bump = this.bumpT < this.bumpMs ? this.bumpAmt * Math.sin((this.bumpT / this.bumpMs) * Math.PI) : 0;
    // a jolt pulls the camera in by a fixed amount rather than scaling the distance: at duelling range
    // a multiplier would yank it through the back of the head
    const dist = Math.max(1.2, this.dist * p.cameraZoom / 2 - bump * 2.2);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.camera.position.set(this.focus.x + Math.sin(this.yaw) * cp * dist, this.focus.y + sp * dist, this.focus.z + Math.cos(this.yaw) * cp * dist);
    // over the shoulder: the camera and what it looks at both slide sideways, so the view stays parallel
    // and the head sits off to one side of its own crosshair instead of standing in front of it
    const rx = Math.cos(this.yaw) * SHOULDER, rz = -Math.sin(this.yaw) * SHOULDER;
    this.camera.position.x += rx; this.camera.position.z += rz;
    this.aimAt_.copy(this.focus); this.aimAt_.x += rx; this.aimAt_.z += rz;
    // and never below the ground it is looking over
    const floor = groundHeight(this.camera.position.x, this.camera.position.z) + 0.35;
    if (this.camera.position.y < floor) this.camera.position.y = floor;
    this.unblock(dist);
    if (this.shakeAmt > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmt;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmt;
      this.shakeAmt *= Math.max(0, 1 - dt * 9);
    }
    this.camera.lookAt(this.aimAt_);
    // light: the hour sets the sky, the sun and how far the dark lets you see
    const sky = skyAt(s.dayTime);
    // how far the eye reaches is the hour's business, not the zoom's: close behind the head the old
    // dist-relative fog shut the world down to six tiles, and closed it further the more you zoomed in
    const fog = this.world.fog as THREE.Fog;
    fog.color.setHex(sky.sky); fog.near = sky.fogD * 0.5; fog.far = sky.fogD + 6;
    // nothing past the fog is drawn at all
    if (Math.abs(this.camera.far - (fog.far + 4)) > 0.5) { this.camera.far = fog.far + 4; this.camera.updateProjectionMatrix(); }
    this.renderer.setClearColor(sky.sky);
    this.dome.sync(this.camera, sky.sky, this.camera.far);
    this.hemi.color.setHex(sky.amb); this.hemi.intensity = sky.ambI * 2.2;
    this.sun.color.setHex(sky.sun); this.sun.intensity = sky.sunI * 1.6;
    const arc = sky.arc;
    this.sun.position.set(this.focus.x + Math.cos(arc) * 30, this.focus.y + Math.max(8, Math.sin(arc) * 40), this.focus.z - 12);
    this.sun.target.position.copy(this.focus);
    this.sun.castShadow = p.shadows && sky.sunI > 0.3;
    this.placeLamps(sky.night);
    // carried off to one side rather than hung straight overhead: a light directly above a figure
    // blows out the flat top of its head and lights nothing else
    if (pl) this.torch.position.set(pl.x * U + 0.5, groundHeight(pl.x * U, pl.y * U) + standHeight(pl) + 1.1, pl.y * U + 0.5);
    this.torch.intensity = (pl && !pl.hidden ? 3.2 : 0) * (0.35 + 0.65 * sky.night) * (0.93 + 0.07 * Math.sin(this.t * 13) * Math.sin(this.t * 7.3));
    // models landing: once they stop arriving for a moment, the ground and its flora are rebuilt with them
    if (MODELS.revision !== this.modelsSeen) { this.modelsSeen = MODELS.revision; this.modelsQuiet = 0; }
    else if (this.modelsBuilt !== this.modelsSeen && (this.modelsQuiet += dt) > 0.3) { this.modelsBuilt = this.modelsSeen; this.terrain.rebuildAll(); }
    // the world
    s.fog?.update(dt);
    this.syncFow();
    this.tilesChanged = this.terrain.sync();
    this.structures.sync(sky.night, this.t);
    // only what the camera can reach is posed. A low view looks down a long wedge rather than at a disc
    // under it, so the circle is sized by how far the eye actually sees and pushed out ahead of the head -
    // otherwise an army you walk toward pops into being halfway there
    const reach = fog.far * 0.8 + 16, ahead = reach * 0.35;
    const cullX = this.focus.x - Math.sin(this.yaw) * ahead, cullZ = this.focus.z - Math.cos(this.yaw) * ahead;
    this.camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.projView.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    this.crowd.cull(cullX, cullZ, reach, this.frustum);
    this.actors.cull(cullX, cullZ, reach);
    this.crowd.sync(dt);
    this.actors.sync(dt);
    for (const ev of s.fx) this.fx.handle(ev);
    s.fx.length = 0;
    this.fx.update(dt);
    this.overlay.sync(dt);
    this.room.sync(dt);
    if (s.interior.active) {
      // indoors: the room's diorama, with no fog of war (its floor is not the map)
      setFowOn(false);
      this.renderer.shadowMap.autoUpdate = true;
      this.renderer.render(this.room.scene, this.room.camera);
      setFowOn(true);
    } else {
      // above 90 fps the shadows are redrawn every other frame: half the shadow pass, a lag nobody can see
      const sm = this.renderer.shadowMap;
      sm.autoUpdate = false;
      sm.needsUpdate = dt > 1 / 90 || (this.shadowFrame++ & 1) === 0;
      this.renderer.render(this.world, this.camera);
    }
    this.drawRaidArrows();
    this.aimCrosshair();
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
  /** which frame the edge arrows were last drawn on (they are redrawn every third frame), and scratch for the projection */
  private arrowFrame = 0;
  private arrowV = new THREE.Vector3();
  private arrowBins = new Int32Array(36);
  private arrowBoss = new Uint8Array(36);
  /**
   * Red arrows at the screen edge pointing at raiders out of sight. A host is hundreds strong, so they
   * are gathered into 36 directions: one arrow each, bigger the more stand that way (gold for the
   * Warlord), redrawn every third frame.
   */
  private drawRaidArrows(): void {
    const g = this.actx, s = this.scene, W = this.arrows.width, H = this.arrows.height;
    if (!s.raidActive || s.interior.active) { if (this.arrowFrame !== -1) { g.clearRect(0, 0, W, H); this.arrowFrame = -1; } return; }
    if (this.arrowFrame !== -1 && this.arrowFrame++ % 3 !== 0) return;
    if (this.arrowFrame === -1) this.arrowFrame = 1;
    g.clearRect(0, 0, W, H);
    const bins = this.arrowBins, boss = this.arrowBoss, v = this.arrowV, n = bins.length;
    bins.fill(0); boss.fill(0);
    for (const a of s.agents) {
      if (!(a instanceof Raider) || a.dead || a.lairBound) continue;
      v.set(a.x * U, 0.6, a.y * U).project(this.camera);
      const behind = v.z > 1, nx = behind ? -v.x : v.x, ny = behind ? -v.y : v.y;
      if (!behind && nx > -1 && nx < 1 && ny > -1 && ny < 1) continue;
      const b = Math.floor(((Math.atan2(ny, nx) / (Math.PI * 2)) + 1) % 1 * n) % n;
      bins[b]++; if (a.boss) boss[b] = 1;
    }
    const pad = 18, hw = W / 2 - pad, hh = H / 2 - pad;
    for (let b = 0; b < n; b++) {
      if (!bins[b]) continue;
      const ang0 = ((b + 0.5) / n) * Math.PI * 2, nx = Math.cos(ang0), ny = Math.sin(ang0);
      const t = Math.min(hw / Math.abs(nx || 1e-6), hh / Math.abs(ny || 1e-6));
      const px = W / 2 + nx * t, py = H / 2 - ny * t, ang = Math.atan2(-ny, nx), size = boss[b] ? 14 : Math.min(16, 8 + Math.log2(bins[b]) * 1.5);
      g.fillStyle = boss[b] ? '#ffcc33' : '#ff4a3d';
      g.beginPath();
      g.moveTo(px + Math.cos(ang) * size, py + Math.sin(ang) * size);
      g.lineTo(px + Math.cos(ang + 2.4) * size, py + Math.sin(ang + 2.4) * size);
      g.lineTo(px + Math.cos(ang - 2.4) * size, py + Math.sin(ang - 2.4) * size);
      g.fill();
    }
  }
}

/** Is every ancestor of this object shown? (a hidden actor's parts are still in the pick list) */
function isShown(o: THREE.Object3D | null): boolean {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}

export { WALL_UNITS };
