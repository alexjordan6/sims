import GUI from 'lil-gui';

/**
 * [value, min, max, step?, tip?] => slider. boolean or [boolean, tip] => checkbox. string[] => dropdown (first is default).
 * A trailing string is shown on hover over the row.
 */
type Spec = [number, number, number, number?, string?] | [number, number, number, string] | boolean | [boolean, string] | readonly string[];

type Value<S> = S extends readonly string[] ? S[number] : S extends boolean | [boolean, string] ? boolean : number;
export type Params<T extends Record<string, Spec>> = { [K in keyof T]: Value<T[K]> };

let gui: GUI | null = null;

/** Shared panel; created lazily so sims that use no params get no panel. */
export function getGui(): GUI {
  if (!gui) {
    gui = new GUI({ title: 'params', width: 260 });
    gui.domElement.style.zIndex = '10';
  }
  return gui;
}

export function destroyGui(): void {
  gui?.destroy();
  gui = null;
}

/** Hover text on a controller's row (the label and the widget both carry it). */
function tipOf(c: { domElement: HTMLElement; $name?: HTMLElement }, tip: string | undefined): void {
  if (!tip) return;
  c.domElement.title = tip;
  if (c.$name) c.$name.title = tip;
}

/**
 * Declare tweakable sim params. Returns a live object: reading `p.speed` on each tick
 * always sees the current slider value.
 *
 *   const p = params({ speed: [2, 0, 10], count: [200, 10, 2000, 1, 'how many boids'], wrap: true, mode: ['flock', 'swarm'] });
 */
export function params<T extends Record<string, Spec>>(spec: T, folder?: string): Params<T> {
  const obj: Record<string, unknown> = {};
  const g = folder ? getGui().addFolder(folder) : getGui();
  for (const [name, s] of Object.entries(spec)) {
    if (Array.isArray(s) && typeof s[0] === 'number') {
      const nums = (s as unknown[]).filter((x): x is number => typeof x === 'number');
      const tip = (s as unknown[]).find((x): x is string => typeof x === 'string');
      const [v, min, max, step] = nums;
      obj[name] = v;
      tipOf(g.add(obj, name, min, max, step), tip);
    } else if (Array.isArray(s) && typeof s[0] === 'boolean') {
      obj[name] = s[0];
      tipOf(g.add(obj, name), s[1] as string);
    } else if (Array.isArray(s)) {
      obj[name] = s[0];
      g.add(obj, name, s as unknown as string[]);
    } else {
      obj[name] = s;
      g.add(obj, name);
    }
  }
  return obj as Params<T>;
}

/** Add a button to the panel (e.g. `button('respawn', () => scene.reset(), 'start over with a new seed')`). */
export function button(label: string, fn: () => void, tip?: string): void {
  tipOf(getGui().add({ [label]: fn }, label), tip);
}
