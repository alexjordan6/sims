// Usage: npm run new <name>   (kebab-case, e.g. predator-prey)
import { cpSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const name = process.argv[2];
if (!name || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
  console.error('Usage: npm run new <kebab-case-name>');
  process.exit(1);
}
const dest = join('games', name);
if (existsSync(dest)) {
  console.error(`games/${name} already exists`);
  process.exit(1);
}

const title = name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const cls = title.replace(/\s+/g, '');

cpSync('templates/game', dest, { recursive: true });
for (const f of readdirSync(dest)) {
  const path = join(dest, f);
  const src = readFileSync(path, 'utf8').replaceAll('__TITLE__', title).replaceAll('__CLASS__', cls);
  writeFileSync(path, src);
}
console.log(`created games/${name}/  →  edit games/${name}/main.ts, then: npm run dev  →  http://localhost:5173/games/${name}/`);
