// Frame indices into the three Kenney 16x16 "Tiny" spritesheets (12 columns x 11 rows, no spacing).
// Texture keys: 'town', 'farm', 'dungeon'. See assets/CREDITS.md.

export const SHEET_COLS = 12;

export const TOWN = {
  grass: [0, 0, 0, 0, 0, 0, 1, 2, 43] as const, // weighted: mostly plain, some detail/flowers/stones
  trees: [4, 16, 28, 5] as const,
  mushrooms: 29,
  dirtPatch: { tl: 12, t: 13, tr: 14, l: 24, c: 25, r: 26, bl: 36, b: 37, br: 38 },
  pathH: [40, 41] as const,
  roofRed: 53,
  roofRedPeak: 63,
  roofGrey: 49,
  roofGreyPeak: 67,
  chimneyRed: 55,
  wallWoodDoor: 85,
  wallStoneDoor: 89,
  wallStone: 77,
  fenceH: 81,
  sign: 83,
  iconWood: 92,
  iconGrain: 93,
  iconBeehive: 94,
  iconTarget: 95,
  iconAxe: 129,
  iconHoe: 127,
  iconHammer: 128,
  iconPickaxe: 115,
  iconKey: 117,
} as const;

export const FARM = {
  tilled: 49,
  tilledEnds: { l: 48, m: 49, r: 50 },
  /** tomato: sprout → small → bushy → ripe */
  crop: [40, 41, 42, 43] as const,
  iconTomato: 44,
  iconWheat: 68,
  iconCarrot: 8,
  stump: 14,
  bareTree: 2,
  bush: 39,
  rock: 77,
  sunflower: 83,
  grassTuft: 80,
  hayBale: 96,
  barrel: 72,
  crate: 75,
  farmerHat: 109,
  farmerWoman: 108,
  iconHand: 84,
  iconHammer: 86,
  iconHoe: 87,
  iconQuestion: 88,
  sheep: 120,
  cow: 121,
  chicken: 122,
} as const;

export const DUNGEON = {
  hero: 112, // green-hooded ranger — the player
  villager: 85,
  villagerBald: 86,
  elder: 87,
  villagerWoman: 88,
  wizard: 84,
  knight: 96,
  knightVisor: 97,
  man: 98,
  woman: 99,
  oldWoman: 100,
  orc: 109,
  imp: 110,
  skeleton: 111,
  slime: 108,
  ghost: 121,
  shield: 102,
  sword: 105,
  axe: 118,
  potionRed: 116,
  potionGreen: 115,
  chest: 89,
} as const;

/** Sprite per agent kind — texture key + frame. */
export const CHAR = {
  player: { key: 'dungeon', frame: DUNGEON.hero },
  farmer: { key: 'farm', frame: FARM.farmerHat },
  woodcutter: { key: 'dungeon', frame: DUNGEON.man },
  kid: { key: 'dungeon', frame: DUNGEON.villager },
  infant: { key: 'dungeon', frame: DUNGEON.villager },
  soldier: { key: 'dungeon', frame: DUNGEON.knight },
  raider: { key: 'dungeon', frame: DUNGEON.orc },
  warlord: { key: 'dungeon', frame: DUNGEON.orc },
  rat: { key: 'dungeon', frame: 123 },
  snatcher: { key: 'dungeon', frame: DUNGEON.imp },
  brute: { key: 'dungeon', frame: DUNGEON.orc },
  ogre: { key: 'dungeon', frame: DUNGEON.orc },
  shaman: { key: 'dungeon', frame: DUNGEON.wizard },
  wrecker: { key: 'dungeon', frame: DUNGEON.orc },
} as const;

/** CSS background-position for a frame in a 12-col sheet, at a given scale. */
export function framePos(frame: number, scale = 2): string {
  const col = frame % SHEET_COLS, row = Math.floor(frame / SHEET_COLS);
  return `${-col * 16 * scale}px ${-row * 16 * scale}px`;
}
