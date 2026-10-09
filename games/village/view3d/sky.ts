// The day/night cycle as light: what colour the sky, the sun and the fog are at each time of day.
// dayTime runs 0 (midnight) → 0.5 (noon) → 1, and wraps. Days are bright and open, dusk burns orange,
// and the night is dark blue rather than black — enough to read a silhouette by, not enough to work in.

/** fogD: how many tiles past the head the dark lets you see */
interface Key { t: number; sky: number; sun: number; sunI: number; amb: number; ambI: number; fogD: number }
const KEYS: Key[] = [
  { t: 0.0, sky: 0x080e1c, sun: 0x46598c, sunI: 0.11, amb: 0x1e2a48, ambI: 0.15, fogD: 14 },
  { t: 0.22, sky: 0x080e1c, sun: 0x46598c, sunI: 0.11, amb: 0x1e2a48, ambI: 0.15, fogD: 14 },
  { t: 0.27, sky: 0xc08a66, sun: 0xffb482, sunI: 0.6, amb: 0x7a6258, ambI: 0.42, fogD: 26 },
  { t: 0.33, sky: 0x8fc2ea, sun: 0xfff3dc, sunI: 0.95, amb: 0x9dc0e0, ambI: 0.55, fogD: 44 },
  { t: 0.72, sky: 0x8fc2ea, sun: 0xfff3dc, sunI: 0.95, amb: 0x9dc0e0, ambI: 0.55, fogD: 44 },
  { t: 0.78, sky: 0xd4854a, sun: 0xff8f4e, sunI: 0.62, amb: 0x7e5244, ambI: 0.42, fogD: 30 },
  { t: 0.84, sky: 0x33264a, sun: 0x7a4e86, sunI: 0.26, amb: 0x362a4e, ambI: 0.26, fogD: 18 },
  { t: 0.88, sky: 0x080e1c, sun: 0x46598c, sunI: 0.11, amb: 0x1e2a48, ambI: 0.15, fogD: 14 },
  { t: 1.0, sky: 0x080e1c, sun: 0x46598c, sunI: 0.11, amb: 0x1e2a48, ambI: 0.15, fogD: 14 },
];

export interface Sky {
  sky: number; sun: number; sunI: number; amb: number; ambI: number; fogD: number;
  /** 0 by day → 1 at deepest night */
  night: number;
  /** the sun's angle over the sky, radians: rises in the east at dawn, sets in the west */
  arc: number;
}

function mix(a: number, b: number, f: number): number {
  const ch = (c: number, s: number) => (c >> s) & 255;
  const m = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * f) << s;
  return m(16) | m(8) | m(0);
}

export function skyAt(dayTime: number): Sky {
  const t = ((dayTime % 1) + 1) % 1;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].t <= t) i++;
  const a = KEYS[i], b = KEYS[i + 1], f = (t - a.t) / (b.t - a.t);
  const lerp = (x: number, y: number) => x + (y - x) * f;
  const sunI = lerp(a.sunI, b.sunI);
  return {
    sky: mix(a.sky, b.sky, f), sun: mix(a.sun, b.sun, f), sunI, amb: mix(a.amb, b.amb, f), ambI: lerp(a.ambI, b.ambI), fogD: lerp(a.fogD, b.fogD),
    night: Math.max(0, Math.min(1, (0.95 - sunI) / (0.95 - 0.12))),
    arc: (t - 0.25) * Math.PI * 2,
  };
}
