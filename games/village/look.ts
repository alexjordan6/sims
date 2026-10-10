// The pixel art the DOM UI still shows: inspector portraits, tile icons, the look of a person.
// (The world itself is drawn in 3D: see view3d/.)
import Phaser from 'phaser';
import type { Tile } from './world';
import { Mover, Villager, Raider, Player, type EnemyKind } from './agents';
import { TOWN } from './atlas';
import { seedLook, type Look } from './characters';
import { OGRE } from './config';
import type { VillageScene } from './main';
import { FLORA } from './pixelart';

import townUrl from './assets/town.png';
import farmUrl from './assets/farm.png';
import dungeonUrl from './assets/dungeon.png';

// Tileset first-gids inside the one tilemap (0 is reserved for "no tile" by using 1-based gids).
const GID = { town: 1, farm: 1 + 132, dungeon: 1 + 264, flora: 1 + 396 } as const;
const EMPTY = -1;


/** Load the three spritesheets. Call from the scene's preload(). */
export function preloadArt(scene: Phaser.Scene): void {
  scene.load.spritesheet('town', townUrl, { frameWidth: 16, frameHeight: 16 });
  scene.load.spritesheet('farm', farmUrl, { frameWidth: 16, frameHeight: 16 });
  scene.load.spritesheet('dungeon', dungeonUrl, { frameWidth: 16, frameHeight: 16 });
}


/** Ground + object gids for a tile (and the crown-top for the tile above, for tall trees). */
/** The picture the map draws for a tile, for the inspector's portrait: a flora frame (object over ground), the fort sheet for defences, or a town grass frame. */
export function tileArt(t: Tile, s: VillageScene): { key: string; frame: number } {
  if (t.defense) return { key: 'fort', frame: t.defense.kind === 'stairs' ? 3 : t.defense.kind === 'gate' ? (t.defense.open ? 2 : 1) : 0 };
  const f = tileFrames(t, s.oldGrowthDays, s.wildRipe(t));
  const pick = f.object !== EMPTY ? f.object : f.ground;
  if (pick >= GID.flora) return { key: 'flora', frame: pick - GID.flora };
  return { key: 'town', frame: pick - GID.town };
}
function tileFrames(t: Tile, oldDays: number, wildRipe = false): { ground: number; object: number; canopy?: number } {
  const grass = GID.town + TOWN.grass[t.v % TOWN.grass.length];
  const F = GID.flora;
  switch (t.kind) {
    case 'grass': return { ground: t.tall ? F + FLORA.tallGrass[t.v % 3] : grass, object: EMPTY };
    case 'tree': {
      if (t.work >= 2) return { ground: grass, object: F + FLORA.bare };
      const old = t.stage >= oldDays;
      if (!old) return { ground: grass, object: F + (t.work === 1 ? FLORA.youngChopped : FLORA.young[t.v % 3]) };
      const pine = t.v % 3 === 1;
      return { ground: grass, object: F + (t.work === 1 ? FLORA.oakChopped : pine ? FLORA.pineTrunk : FLORA.oakTrunk), canopy: F + (pine ? FLORA.pineTop : FLORA.oakTop) };
    }
    case 'thicket': return { ground: grass, object: F + FLORA.thicket[(t.v + t.work) % 3] }; // a hacked-at tile looks hacked at
    case 'bush': return { ground: grass, object: F + FLORA.bush[wildRipe ? 1 : 0] };
    case 'mushroom': return { ground: grass, object: F + FLORA.mushroom[wildRipe ? 1 : 0] };
    case 'hazel': return { ground: grass, object: F + FLORA.hazel[wildRipe ? 1 : 0] };
    case 'garlic': return { ground: grass, object: F + FLORA.garlic[wildRipe ? 1 : 0] };
    case 'burdock': return { ground: grass, object: F + FLORA.burdock[wildRipe ? 1 : 0] };
    case 'sapling': return { ground: grass, object: F + (t.stage < 2 ? FLORA.stump : t.stage === 2 ? FLORA.sprout : FLORA.sapling) };
    case 'barracks':
    case 'granary':
    case 'woodyard': case 'lair': case 'gnomehouse': case 'warren': case 'cookpot': case 'wall': case 'gate': case 'stairs': return { ground: grass, object: EMPTY }; // the building sprite sits on top
  }
}

export const ENEMY_SCALE: Record<EnemyKind, number> = { raider: 1, warlord: 1.5, rat: 0.8, snatcher: 0.9, brute: 1.3, shaman: 1, ogre: OGRE.scale, wrecker: 1.1, boar: 1, troll: 1.15, skulk: 0.7 };

/** The layered look for an agent — role outfit, held tool, worn armor, dye — or null for things that aren't people. */
export function lookFor(m: Mover): Look | null {
  const seed = seedLook(m.id);
  const base = { ...seed, armor: m.armor, dye: m.dye, helmetStyle: m.helmetStyle, plume: m.plume };
  // a crude blade shows as a club until the chest forges a real sword
  const blade = m.weapons.melee < 0 ? 'none' : m.weapons.melee > 0 ? 'sword' : 'club';
  if (m instanceof Player) return { ...base, skin: 1, hair: 0, hairStyle: 0, body: 'adult', outfit: 'head', held: m.tool === 'sword' ? blade : m.tool === 'bow' && m.weapons.bow >= 0 ? 'bow' : m.tool === 'axe' ? 'axe' : m.tool === 'wand' ? 'wand' : 'none' };
  if (m instanceof Villager) {
    // every villager is a gnome: a little person in a red cap, whatever its calling
    const held = !m.isAdult ? 'none' : m.role === 'soldier' ? (m.weapon === 'pike' ? 'pike' : m.weapon === 'bow' ? 'bow' : blade) : m.role === 'woodcutter' ? 'axe' : 'none';
    return { ...base, body: m.isChild ? 'gnomekid' : 'gnome', outfit: 'gnome', held };
  }
  if (m instanceof Raider) {
    const body = m.boss ? 'boss' : m.kind === 'ogre' ? 'ogre' : m.kind === 'brute' ? 'brute' : m.kind === 'rat' ? 'rat' : m.kind === 'boar' ? 'boar' : m.kind === 'troll' ? 'troll' : m.kind === 'skulk' ? 'skulk' : m.kind === 'snatcher' ? 'imp' : m.kind === 'shaman' ? 'shaman' : 'orc';
    // the shield is real -- it turns blows and it breaks -- so it is drawn. The rest of the slots stay
    // bare: a raider wears no mail, and the art should not promise armour the body does not have.
    return { ...base, body, outfit: 'none', held: body === 'orc' || body === 'boss' ? 'sword' : body === 'brute' ? 'axe' : 'none', armor: { helmet: 0, chest: 0, legs: 0, shield: m.armor.shield } };
  }
  return null;
}

