// __GAMES__ is injected by vite.config.ts from the games/ folder listing.
declare const __GAMES__: string[];

const ul = document.getElementById('games')!;
for (const name of __GAMES__) {
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.href = `games/${name}/`;
  a.textContent = name;
  li.append(a);
  ul.append(li);
}
if (__GAMES__.length === 0) ul.innerHTML = '<li>No games yet — run <code>npm run new my-idea</code></li>';
