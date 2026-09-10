import GUI from 'lil-gui';

/** [value, min, max, step?] => slider. boolean => checkbox. string[] => dropdown (first is default). */
type Spec = [number, number, number, number?] | boolean | readonly string[];

type Value<S> = S extends readonly string[] ? S[number] : S extends boolean ? boolean : number;
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

/**
 * Declare tweakable sim params. Returns a live object: reading `p.speed` on each tick
 * always sees the current slider value.
 *
 *   const p = params({ speed: [2, 0, 10], count: [200, 10, 2000, 1], wrap: true, mode: ['flock', 'swarm'] });
 */
export function params<T extends Record<string, Spec>>(spec: T, folder?: string): Params<T> {
  const obj: Record<string, unknown> = {};
  const g = folder ? getGui().addFolder(folder) : getGui();
  for (const [name, s] of Object.entries(spec)) {
    if (Array.isArray(s) && typeof s[0] === 'number') {
      const [v, min, max, step] = s as [number, number, number, number?];
      obj[name] = v;
      g.add(obj, name, min, max, step);
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

/** Add a button to the panel (e.g. `button('respawn', () => scene.reset())`). */
export function button(label: string, fn: () => void): void {
  getGui().add({ [label]: fn }, label);
}
