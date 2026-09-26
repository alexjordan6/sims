const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {spawn}=require('node:child_process');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..'),url='http://127.0.0.1:5188/games/village/test.html';
 const server=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','5188','--strictPort'],{cwd:root,windowsHide:true,stdio:'ignore'});
 let browser;
 try {
  for(let i=0;i<80;i++){try{if((await fetch(url)).ok)break;}catch{} await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(()=>window.game?.scene?.scenes?.[0]?.ui);
  const result=await page.evaluate(async()=>{
   const {Villager,Raider}=await import('/games/village/agents.ts');
   const {World,doorstep}=await import('/games/village/world.ts');
   const {p}=await import('/games/village/config.ts');
   const s=window.game.scene.scenes[0],checks=[];
   const check=(ok,msg)=>{if(!ok)throw Error(msg);checks.push(msg);};
   p.adaptiveSpawns=false;p.gnomeStart=false;
   s.reset(42);s.screen='playing';s.paused=true;s.raidActive=false;
   s.dayTime=0.4;s.food=150;s.world.hives.clear();
   const home=s.world.houses[0],pos=World.center(124,100);
   const worker=new Villager(pos.x,pos.y,home,'woodcutter',20,'Flee test',s.mods);
   const enemy=new Raider(pos.x+89,pos.y); enemy.speed=0;
   s.agents=[s.player,worker,enemy];
   for(let y=90;y<=110;y++)for(let x=110;x<=140;x++)s.world.set(x,y,'grass');
   // Hold position to reproduce the exact danger-boundary oscillation.
   const originalHome=worker.goHome; worker.goHome=()=>{};
   worker.goal={tx:130,ty:100};worker.workTimer=2;
   const update=dt=>{s.grid.rebuild(s.agents);worker.update(dt,s);};
   update(0.1);check(worker.task==='fleeing','worker flees at 89 pixels');
   check(worker.workTimer===0&&!worker.goal,'fleeing clears interrupted work');
   check(worker.unreachable.get(100*s.world.cols+130)>s.simTime,'dangerous job temporarily excluded');
   for(let i=0;i<80;i++){enemy.x=worker.x+(i%2?91:89);update(0.1);check(worker.task==='fleeing','no flee/work flip at boundary');}
   enemy.x=worker.x+141;
   for(let i=0;i<29;i++)update(0.1);
   check(worker.workerSafety.fleeing,'worker waits for sustained clearance');
   update(0.2);check(!worker.workerSafety.fleeing,'worker resumes after clear interval');
   // Actual hidden-worker branch, with a roaming enemy at its door and no raid.
   worker.goHome=originalHome;worker.hidden=true;worker.indoors=home;
   const d=doorstep(home),exit=World.center(d.tx,d.ty);
   enemy.x=exit.x+100;enemy.y=exit.y;
   for(let i=0;i<50;i++)update(0.1);
   check(worker.hidden,'roaming enemy keeps worker sheltered without raidActive');
   enemy.dead=true;
   for(let i=0;i<29;i++)update(0.1);
   check(worker.hidden,'door stays closed during calm countdown');
   update(0.2);check(!worker.hidden,'worker exits after danger is gone');
   return checks.length;
  });
  console.log(result+' worker integration assertions passed');
  await page.click('#run-checks');
  await page.waitForFunction(()=>/passed|FAILED/.test(document.querySelector('#test-summary').textContent),null,{timeout:60000});
  const summary=await page.locator('#test-summary').textContent();
  assert.match(summary,/checks passed/,await page.locator('#test-results').textContent());
  assert.deepEqual(errors,[]);
  console.log(summary);
 } finally {if(browser)await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
