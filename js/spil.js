import { MetalAudio } from './spil-audio.js';

const $ = id => document.getElementById(id);
const canvas = $('game'), ctx = canvas.getContext('2d', { alpha: false });
let W = 1280;
const H = 700, TAU = Math.PI * 2;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const audio = new MetalAudio();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
let state = 'intro', time = 0, stage = 0, camera = 0, shake = 0, freeze = 0;
let player, platforms = [], enemies = [], particles = [], words = [], projectiles = [];
let score = 0, totalKills = 0, combo = 0, comboTimer = 0, elapsed = 0, stageStartScore = 0, stageStartKills = 0;
let kills = 0, stageLength = 3600, toastTimer = 0, lastFrame = 0, accumulator = 0, best = 0;
let keys = new Set(), pressed = new Set(), attackSerial = 0, hudCache = '';
try { best = Number(localStorage.getItem('blue-ruin-best') || 0); } catch {}
if (best > 0) $('best-intro').textContent = `PERSONAL BEST / ${best.toLocaleString()}`;

const stages = [
  { name: 'THE COLD GRILL', subtitle: 'SIDE A / STAGE 01', length: 3600,
    platforms: [[0,582,1300,150],[1450,582,850,150],[2470,582,1130,150],[470,442,270,26],[880,350,240,26],[1600,440,270,26],[1980,350,230,26],[2680,437,300,26]],
    enemies: [[640,442],[980,350],[1120,582],[1750,440],[2090,350],[2150,582],[2810,437],[3140,582]] },
  { name: 'THE DEEP FREEZE', subtitle: 'SIDE B / STAGE 02', length: 3900,
    platforms: [[0,582,900,150],[1080,582,850,150],[2110,582,800,150],[3100,582,800,150],[400,450,230,26],[760,350,230,26],[1170,430,240,26],[1580,330,250,26],[2180,445,220,26],[2510,345,250,26],[2950,445,240,26],[3400,400,240,26]],
    enemies: [[520,450],[850,350],[1300,430],[1710,330],[2290,445],[2650,345],[3080,445],[3530,400]] },
  { name: 'THE FINAL SERVING', subtitle: 'THE ENCORE / STAGE 03', length: 3500,
    platforms: [[0,582,1100,150],[1270,582,850,150],[2290,582,1210,150],[460,435,250,26],[880,335,230,26],[1390,425,250,26],[1790,330,260,26],[2350,435,220,26]],
    enemies: [[600,435],[990,335],[1490,425],[1640,582],[1910,330],[2460,435],[2700,582],[3050,582,'boss']] }
];

function resetStage(full = false) {
  if (full) { stage = 0; score = 0; totalKills = 0; elapsed = 0; stageStartScore = 0; stageStartKills = 0; }
  else { score = stageStartScore; totalKills = stageStartKills; }
  const s = stages[stage]; stageLength = s.length;
  platforms = s.platforms.map(([x,y,w,h]) => ({x,y,w,h}));
  enemies = s.enemies.map(([x,y,type], i) => ({ x, y: y - (type === 'boss' ? 67 : 26), w: type === 'boss' ? 142 : 64, h: type === 'boss' ? 130 : 50,
    baseY:y, origin:x, hp:type === 'boss' ? 16 : stage === 0 ? 2 : 3, maxHp:type === 'boss' ? 16 : stage === 0 ? 2 : 3,
    type:type || 'burger', dir:i % 2 ? -1 : 1, phase:i * 1.9, hurt:0, lastHit:0, attack:2.5, dead:false }));
  player = {x:120,y:520,vx:0,vy:0,w:32,h:58,dir:1,hp:5,ground:false,jumps:0,coyote:0,jumpBuffer:0,attack:0,attackCooldown:0,dash:0,dashCooldown:0,hurt:0,land:0};
  camera = 0; kills = 0; combo = 0; comboTimer = 0; particles = []; words = []; projectiles = []; freeze = 0; shake = 0;
  keys.clear(); pressed.clear(); hudCache = ''; updateHud();
  $('toast-number').textContent = s.subtitle; $('toast-title').textContent = s.name;
  $('stage-toast').hidden = false; toastTimer = 2.5;
}

async function startGame() {
  if (state !== 'intro') return;
  state = 'playing'; resetStage(true);
  $('intro').hidden = true; $('hud').hidden = false; $('pause').hidden = false;
  $('touch-controls').hidden = !coarse; $('game-shell').classList.add('playing');
  document.body.classList.add('is-playing'); canvas.focus({preventScroll:true});
  try { await audio.init(); if (state === 'playing') audio.start(); } catch { /* The game remains playable without an audio device. */ }
}

function showMenu(kind) {
  state = kind; audio.stop(); keys.clear(); pressed.clear(); document.body.classList.remove('is-playing');
  $('menu').hidden = false; $('stage-toast').hidden = true; $('touch-controls').hidden = true;
  $('results').hidden = kind === 'paused'; $('restart').hidden = kind === 'won';
  $('pause').setAttribute('aria-label', 'Resume game');
  const copy = {
    paused:['TAKE A BREATHER','ON HOLD.','Even metal needs a rest.','BACK TO THE RIFF'],
    dead:['CRUSHED, BUT NOT FINISHED','WELL DONE.','That was you getting grilled. Take another swing.','TRY AGAIN'],
    won:['ALL BURGERS HAVE BEEN SERVED','ABSOLUTE RUIN.','Three stages. One tiny legend. The grill is officially closed.','ONE MORE ENCORE']
  }[kind];
  $('menu-eyebrow').textContent = copy[0]; $('menu-title').textContent = copy[1]; $('menu-description').textContent = copy[2];
  $('resume').replaceChildren(document.createTextNode(copy[3] + ' ')); const arrow = document.createElement('span'); arrow.textContent = '↗'; $('resume').append(arrow);
  if (kind !== 'paused') $('results').innerHTML = `<span><strong>${score.toLocaleString()}</strong>SCORE</span><span><strong>${totalKills}</strong>SMASHED</span><span><strong>${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2,'0')}</strong>TIME</span>`;
  $('resume').focus({preventScroll:true});
}

function resumeGame() {
  if (state === 'dead') resetStage();
  if (state === 'won') resetStage(true);
  state = 'playing'; $('menu').hidden = true; $('touch-controls').hidden = !coarse;
  $('pause').setAttribute('aria-label','Pause game');
  document.body.classList.add('is-playing'); audio.start(); canvas.focus({preventScroll:true});
}

function pauseGame() { if (state === 'playing') showMenu('paused'); else if (state === 'paused') resumeGame(); }
function toggleSound() { const enabled = audio.toggle(); $('sound').classList.toggle('muted',!enabled); $('sound').setAttribute('aria-label',enabled ? 'Turn sound off' : 'Turn sound on'); }
$('start').addEventListener('click', startGame); $('resume').addEventListener('click',resumeGame);
$('restart').addEventListener('click',() => { resetStage(); resumeGame(); });
$('pause').addEventListener('click',pauseGame); $('sound').addEventListener('click',toggleSound);
$('fullscreen').addEventListener('click',async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else if ($('game-shell').requestFullscreen) await $('game-shell').requestFullscreen(); }
  catch { /* Fullscreen can be unavailable in embedded browsers. */ }
});
if (!document.fullscreenEnabled) $('fullscreen').hidden = true;
document.addEventListener('fullscreenchange',() => $('fullscreen').setAttribute('aria-label',document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'));
const bindings = {ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',ArrowUp:'jump',KeyW:'jump',Space:'attack',KeyJ:'attack',KeyX:'attack',ShiftLeft:'dash',ShiftRight:'dash'};
window.addEventListener('keydown', e => {
  if (e.code === 'Escape' || e.code === 'KeyP') { if (!e.repeat) pauseGame(); return; }
  if (e.code === 'KeyM') { if (!e.repeat) toggleSound(); return; }
  const action = bindings[e.code];
  if (action && state === 'playing') { e.preventDefault(); if (!keys.has(action) && !e.repeat) pressed.add(action); keys.add(action); }
});
window.addEventListener('keyup',e => { if (bindings[e.code]) keys.delete(bindings[e.code]); });
window.addEventListener('blur',() => { if (state === 'playing') showMenu('paused'); keys.clear(); });
document.addEventListener('visibilitychange',() => { if (document.hidden && state === 'playing') showMenu('paused'); });
document.querySelectorAll('[data-control]').forEach(button => {
  const action = button.dataset.control;
  button.addEventListener('pointerdown',e => { e.preventDefault(); button.setPointerCapture(e.pointerId); keys.add(action); pressed.add(action); button.classList.add('pressed'); });
  const release = () => { keys.delete(action); button.classList.remove('pressed'); };
  button.addEventListener('pointerup',release); button.addEventListener('pointercancel',release); button.addEventListener('lostpointercapture',release);
});

function burst(x,y,count=16,color='#76c6ff',power=1) {
  for(let i=0;i<count;i++) particles.push({x,y,vx:rand(-260,260)*power,vy:rand(-350,80)*power,life:rand(.25,.7),max:.7,size:rand(2,7)*power,color,gravity:600});
  if(particles.length>400) particles.splice(0,particles.length-400);
}
function textPop(x,y,text,color='#b4e3ff',size=24) { words.push({x,y,text,color,size,life:1}); }
function hurtPlayer(amount=1,dir=0) {
  if (player.hurt>0 || player.dash>0 || state!=='playing') return;
  player.hp-=amount; player.hurt=1.3; player.vx=dir*310; player.vy=-260; shake=10; combo=0;
  burst(player.x,player.y-25,18,'#3f8eff'); audio.effect('hurt'); updateHud();
  if(player.hp<=0) showMenu('dead');
}
function updateHud() {
  const key = `${player.hp}-${kills}-${stage}`; if (hudCache === key) return; hudCache=key;
  $('health').innerHTML=Array.from({length:5},(_,i)=>`<i${i>=player.hp?' class="empty"':''}></i>`).join('');
  $('health').setAttribute('aria-label',`${player.hp} of 5 health`);
  $('kills').innerHTML=`${String(kills).padStart(2,'0')}<span> / 08</span>`;
  $('stage-name').textContent=`0${stage+1} / ${stages[stage].name}`;
}

function update(dt) {
  time+=dt;
  if(state!=='playing') return;
  elapsed+=dt;
  if(freeze>0){freeze-=dt;return;}
  const p=player;
  for(const key of ['attackCooldown','dashCooldown','hurt','land','coyote']) p[key]=Math.max(0,p[key]-dt);
  p.attack=Math.max(0,p.attack-dt); p.dash=Math.max(0,p.dash-dt);
  if(toastTimer>0){toastTimer-=dt;if(toastTimer<=0)$('stage-toast').hidden=true;}
  comboTimer-=dt;if(comboTimer<=0)combo=0;
  const input=(keys.has('right')?1:0)-(keys.has('left')?1:0);
  if(input && p.dash<=0){p.dir=input;p.vx=lerp(p.vx,input*330,Math.min(1,dt*13));}
  else if(p.dash<=0)p.vx=lerp(p.vx,0,Math.min(1,dt*(p.ground?17:5)));
  if(pressed.has('jump'))p.jumpBuffer=.14;else p.jumpBuffer=Math.max(0,p.jumpBuffer-dt);
  if(p.jumpBuffer>0 && (p.ground||p.coyote>0||p.jumps<2)) {
    const double=!(p.ground||p.coyote>0);p.vy=double?-635:-680;p.jumps=double?2:1;p.ground=false;p.coyote=0;p.jumpBuffer=0;
    burst(p.x,p.y, double?14:8,'#5eacff',.55);audio.effect('jump');
    if(double)particles.push({x:p.x,y:p.y,vx:0,vy:0,life:.35,max:.35,size:8,ring:true,color:'#77caff',gravity:0});
  }
  if(pressed.has('dash')&&p.dashCooldown<=0){p.dash=.17;p.dashCooldown=.85;p.vx=p.dir*940;p.vy=-35;audio.effect('dash');}
  if((pressed.has('attack')||keys.has('attack'))&&p.attackCooldown<=0){p.attack=.32;p.attackCooldown=.43;attackSerial++;audio.effect('swing');}
  pressed.clear();
  const previousY=p.y;
  if(p.dash<=0)p.vy+=1750*dt;else {p.vy=0;if(Math.random()<.7)burst(p.x-p.dir*16,p.y-25,2,'#2b73d8',.25);}
  p.x=clamp(p.x+p.vx*dt,22,stageLength-35);p.y+=p.vy*dt;p.ground=false;
  for(const platform of platforms){
    if(p.x+p.w/2>platform.x&&p.x-p.w/2<platform.x+platform.w&&previousY<=platform.y+3&&p.y>=platform.y&&p.vy>=0){
      if(p.vy>400){burst(p.x,platform.y,8,'#5f9bd7',.4);p.land=.12;}
      p.y=platform.y;p.vy=0;p.ground=true;p.jumps=0;p.coyote=.1;
    }
  }
  if(p.y>H+100){p.hp=0;updateHud();audio.effect('hurt');showMenu('dead');return;}
  if(p.ground&&Math.abs(p.vx)>150&&Math.random()<.3)burst(p.x-p.dir*12,p.y,1,'#4b7aa7',.16);
  for(const e of enemies){
    if(e.dead)continue;e.hurt=Math.max(0,e.hurt-dt);e.phase+=dt;
    const patrol=e.type==='boss'?75:65,speed=e.type==='boss'?25:34+stage*9;
    if(e.hurt<=0)e.x+=e.dir*speed*dt;
    if(e.x>e.origin+patrol)e.dir=-1;if(e.x<e.origin-patrol)e.dir=1;
    if(e.type==='boss'&&Math.abs(e.x-p.x)<750){
      e.attack-=dt;
      if(e.attack<=0){e.attack=2.3;const direction=p.x<e.x?-1:1;projectiles.push({x:e.x,y:565,vx:direction*310,life:3});burst(e.x,e.baseY,18,'#448cff',.7);}
    }
    const dx=e.x-p.x,dy=e.y-(p.y-30);
    if(p.attack>.03&&p.attack<.27&&e.lastHit!==attackSerial&&Math.abs(dx)<(e.type==='boss'?160:118)&&Math.abs(dy)<(e.type==='boss'?120:91)&&dx*p.dir>-38){
      e.lastHit=attackSerial;e.hp--;e.hurt=.21;shake=e.type==='boss'?10:7;freeze=.045;e.x=clamp(e.x+p.dir*15,e.origin-patrol,e.origin+patrol);
      burst(e.x,e.y,18,'#95d7ff');audio.effect(e.hp<=0?'kill':'hit');
      if(e.hp<=0){e.dead=true;kills++;totalKills++;combo++;comboTimer=3;const points=(e.type==='boss'?1000:100)*Math.min(combo,5);score+=points;
        burst(e.x,e.y,35,'#6bb8ff',1.4);textPop(e.x,e.y-45,`+${points}`);if(combo>1)textPop(p.x,p.y-110,`${combo}× COMBO`,'#619fff',19);
        if(e.type==='boss'){shake=20;freeze=.12;}updateHud();
      }
    }
    if(!e.dead&&Math.abs(dx)<(e.w/2+12)&&Math.abs(dy)<(e.h/2+22))hurtPlayer(1,dx>0?-1:1);
  }
  for(const b of projectiles){b.x+=b.vx*dt;b.life-=dt;if(Math.abs(b.x-p.x)<30&&p.y>535){hurtPlayer(1,Math.sign(b.vx));b.life=0;}}
  projectiles=projectiles.filter(b=>b.life>0);
  for(const f of particles){f.life-=dt;f.x+=f.vx*dt;f.y+=f.vy*dt;f.vy+=f.gravity*dt;}
  particles=particles.filter(f=>f.life>0);
  for(const f of words){f.life-=dt;f.y-=36*dt;}words=words.filter(f=>f.life>0);
  camera=lerp(camera,clamp(p.x-W*.36,0,stageLength-W),1-Math.exp(-dt*6));
  $('stage-progress').firstElementChild.style.width=`${100*p.x/stageLength}%`;
  shake=Math.max(0,shake-dt*35);
  if(p.x>stageLength-150&&kills===enemies.length){
    audio.effect('win');score+=500;
    if(stage<2){stage++;stageStartScore=score;stageStartKills=totalKills;resetStage();}
    else {if(score>best){best=score;try{localStorage.setItem('blue-ruin-best',String(best));}catch{}}showMenu('won');}
  }
}

// All artwork is drawn in shades of blue, at the display's native pixel ratio.
function rect(x,y,w,h,color){ctx.fillStyle=color;ctx.fillRect(x,y,w,h);}
function line(x1,y1,x2,y2,color,width=1){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}
function poly(points,color){ctx.fillStyle=color;ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();}
function ellipse(x,y,rx,ry,color){ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,TAU);ctx.fill();}
function roundRect(x,y,w,h,r,color){ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
function label(text,x,y,size=12,color='#6f9fd1',align='left',font='DM Sans'){ctx.fillStyle=color;ctx.font=`700 ${size}px "${font}", sans-serif`;ctx.textAlign=align;ctx.fillText(text,x,y);}
function glow(x,y,r,color){const g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,color);g.addColorStop(1,'#1d6bff00');ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2);}

function background(cam, intro=false){
  const sky=ctx.createLinearGradient(0,0,0,H);sky.addColorStop(0,'#07162e');sky.addColorStop(.55,stage===1?'#13385a':'#123256');sky.addColorStop(1,'#0a1d37');ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);
  glow(850-cam*.08,200,400,'#1c66b42a');
  // Orbital halo, horizon and distant mountains.
  ctx.strokeStyle='#24517b55';ctx.lineWidth=1;ctx.beginPath();ctx.arc(920-cam*.05,205,151,0,TAU);ctx.stroke();
  ctx.beginPath();ctx.arc(920-cam*.05,205,161,-.4,2.7);ctx.stroke();
  ellipse(920-cam*.05,205,114,114,'#1a3d60');ellipse(946-cam*.05,181,111,110,'#122e4d');
  for(let layer=0;layer<3;layer++){
    const off=cam*(.07+layer*.075),base=440+layer*48;
    const points=[[-100,700]];
    for(let i=-2;i<15;i++){const x=i*180-off%180,y=base-80-Math.sin(i*4.7+layer*6)*66;points.push([x,y],[x+68,y-85],[x+116,y-13]);}
    points.push([1500,700]);poly(points,['#102c4b','#123251','#143759'][layer]);
  }
  // Cathedral-like factory arches and suspended chains.
  const offset=cam*.25;
  for(let i=-1;i<7;i++){
    const x=i*360-offset%360;
    rect(x,50,25,520,'#0a213b');rect(x+8,50,5,520,'#1b3b5b');
    ctx.strokeStyle='#0a213b';ctx.lineWidth=23;ctx.beginPath();ctx.moveTo(x+12,320);ctx.bezierCurveTo(x+12,80,x+360,80,x+372,320);ctx.stroke();
    ctx.strokeStyle='#22476766';ctx.lineWidth=2;ctx.stroke();
    line(x-30,500,x+390,500,'#26507455');
    for(let j=0;j<3;j++){rect(x+110+j*24,284,7,86,'#29609622');}
  }
  const chainOffset=cam*.45;
  for(let c=0;c<5;c++){
    const x=c*335+120-chainOffset%335,len=130+(c%3)*52;
    line(x,0,x,len,'#244c70',2);
    for(let y=0;y<len;y+=15){ctx.strokeStyle='#315b7e';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(x,y,3,7,0,0,TAU);ctx.stroke();}
    poly([[x-7,len],[x+7,len],[x+11,len+18],[x-11,len+18]],'#1c4569');rect(x-7,len+18,14,4,'#67bdff');glow(x,len+20,65,'#3296ff20');
  }
  for(let i=0;i<42;i++){
    const x=((i*197.13-cam*.14+time*(i%2?3:-3))%W+W)%W,y=(i*83.7+Math.sin(time*.5+i)*15)%540;
    ellipse(x,y,i%7===0?2:1,i%7===0?2:1,`rgba(100,175,242,${.12+(Math.sin(i+time)+1)*.1})`);
  }
  // Low drifting fog, drawn as wide transparent blue bands.
  for(let i=0;i<3;i++){const g=ctx.createLinearGradient(0,470+i*50,0,600+i*30);g.addColorStop(0,'#347ac000');g.addColorStop(.5,'#347ac00b');g.addColorStop(1,'#347ac000');ctx.fillStyle=g;ctx.fillRect(0,470+i*50,W,140);}
  if(intro){label('SECTOR 01',1120,386,10,'#416e9c');label('THE COLD GRILL',1120,404,8,'#345f8c');}
}

function platformDraw(p){
  if(p.x+p.w<camera-50||p.x>camera+W+50)return;
  const {x,y,w,h}=p;
  const g=ctx.createLinearGradient(0,y,0,y+Math.min(h,120));g.addColorStop(0,'#275582');g.addColorStop(1,'#102840');ctx.fillStyle=g;ctx.fillRect(x,y,w,h);
  rect(x,y,w,4,'#80c4fc');rect(x,y+4,w,5,'#3c87c9');rect(x,y+9,w,2,'#153758');
  if(h>30){
    rect(x,y+22,w,4,'#0a2039');rect(x,y+29,w,2,'#3b658a');
    for(let i=12;i<w;i+=84){rect(x+i,y+42,64,46,'#112e49');line(x+i,y+42,x+i+64,y+88,'#214867',3);line(x+i+64,y+42,x+i,y+88,'#214867',3);ellipse(x+i+4,y+47,2,2,'#48769c');ellipse(x+i+60,y+83,2,2,'#48769c');}
    for(let i=10;i<w;i+=180){rect(x+i,y+13,30,3,'#548db9');rect(x+i+45,y+13,18,3,'#548db9');}
  }else{
    rect(x+8,y+h-5,w-16,5,'#091c34');
    for(let i=15;i<w-15;i+=36){poly([[x+i,y+11],[x+i+10,y+11],[x+i+1,y+21],[x+i-9,y+21]],'#346c9b');}
    poly([[x+15,y+h],[x+50,y+h],[x+37,y+h+21]],'#163b5a');poly([[x+w-15,y+h],[x+w-50,y+h],[x+w-37,y+h+21]],'#163b5a');
    line(x+10,y+5,x+w-10,y+5,'#a1dbff',1);
  }
  // Little sharp, crystalline growths at the edges.
  for(const [offset,height] of [[12,11],[w-19,18]])poly([[x+offset,y],[x+offset+4,y-height],[x+offset+9,y]],'#5f9acb');
}

function hammer(x,y,angle,scale=1){
  ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.scale(scale,scale);
  roundRect(-5,-82,10,102,3,'#193d66');rect(-3,-76,3,88,'#79b7e5');
  for(let i=-50;i<10;i+=10){line(-5,i,5,i+5,'#0a213c',3);}
  roundRect(-39,-115,78,43,5,'#12375f');
  poly([[-39,-115],[29,-115],[39,-107],[-29,-107]],'#88c9fa');
  poly([[29,-115],[39,-107],[39,-77],[29,-72]],'#346fa6');
  rect(-35,-106,63,30,'#3d83c4');rect(-28,-104,49,25,'#215384');
  rect(-39,-109,8,33,'#a0d8ff');rect(21,-109,8,33,'#73baff');
  rect(-18,-101,30,3,'#3f7eb7');
  poly([[-2,-103],[-13,-89],[-4,-89],[-9,-78],[8,-94],[-1,-94],[5,-103]],'#a7e1ff');
  rect(-36,-113,63,2,'#c1e9ff');
  ctx.restore();
}

function dude(x,y,scale=1,dir=1,attack=0,moving=0,ground=true,ghost=false){
  ctx.save();ctx.translate(x,y);ctx.scale(scale*dir,scale);
  if(ghost)ctx.globalAlpha=.2;
  const walk=Math.sin(time*17)*Math.min(Math.abs(moving)/330,1),bob=ground?Math.abs(walk)*2:0;
  ctx.translate(0,-bob);
  // Trailing blue scarf.
  poly([[-8,-39],[-26,-39+Math.sin(time*6)*3],[-43,-30+Math.sin(time*6-1)*5],[-30,-28],[-13,-32]],'#397cda');
  line(-12,-38,-32,-33,'#72b6ff',2);
  roundRect(-15+walk*5,-17,13,18,4,'#173963');roundRect(3-walk*5,-17,13,18,4,'#245484');
  roundRect(-18+walk*5,-7,17,8,3,'#0b2546');roundRect(3-walk*5,-7,18,8,3,'#16446d');
  rect(-15+walk*5,-2,14,3,'#527ea9');rect(6-walk*5,-2,14,3,'#86bce2');
  roundRect(-17,-38,33,26,7,'#2b639d');poly([[-16,-35],[-7,-39],[4,-27],[-4,-16],[-17,-18]],'#4a8bc2');
  rect(-12,-18,27,5,'#102e53');rect(-1,-18,7,5,'#82b9e4');
  // Helmet and tiny, determined face.
  roundRect(-19,-67,37,32,10,'#234d7d');poly([[-18,-59],[-11,-68],[8,-69],[17,-61],[17,-53],[-19,-53]],'#78b9e9');
  poly([[-11,-67],[-4,-73],[4,-72],[8,-66],[8,-54],[-1,-54]],'#a3d6f6');
  roundRect(-12,-54,32,13,4,'#061c37');rect(1,-51,6,4,'#a9e5ff');rect(13,-51,5,4,'#a9e5ff');
  rect(-16,-46,6,12,'#4d92c8');rect(-12,-38,30,5,'#6cacdf');
  const swing=attack>0?Math.sin((.32-attack)/.32*Math.PI):0;
  const angle=attack>0?-.9+swing*2.7:-.42+Math.sin(time*2)*.035;
  hammer(13,-29,angle,1);
  roundRect(8,-37,15,14,5,'#80bcea');rect(13,-36,6,9,'#b2dfff');
  if(attack>.04&&attack<.27){
    ctx.strokeStyle='#9bdcffaa';ctx.lineWidth=5;ctx.beginPath();ctx.arc(13,-29,103,-1.2,.7);ctx.stroke();
    ctx.strokeStyle='#4b9aff66';ctx.lineWidth=15;ctx.beginPath();ctx.arc(13,-29,92,-1.1,.65);ctx.stroke();
  }
  ctx.restore();
}

function burger(e,intro=false){
  const boss=e.type==='boss',s=boss?2.2:1;
  const bob=Math.sin(time*5+e.phase)*(boss?2:3);
  ctx.save();ctx.translate(e.x,e.y+bob);ctx.scale(s,s);
  if(e.hurt>0)ctx.filter='brightness(1.7)';
  ellipse(0,27,31,6,'#04152d70');
  // Squat little legs.
  roundRect(-23,17,11,11,3,'#2b65a1');roundRect(11,17,11,11,3,'#2b65a1');
  const bun=ctx.createLinearGradient(0,-26,0,0);bun.addColorStop(0,'#73b3ed');bun.addColorStop(1,'#3976b5');
  ctx.fillStyle=bun;ctx.beginPath();ctx.moveTo(-32,-2);ctx.bezierCurveTo(-33,-35,33,-35,32,-2);ctx.closePath();ctx.fill();
  line(-28,-3,28,-3,'#aedbff',2);
  for(const [x,y,a] of [[-17,-14,-.5],[-6,-22,.3],[8,-19,-.5],[20,-12,.4],[0,-10,.8]]){ctx.save();ctx.translate(x,y);ctx.rotate(a);roundRect(-2,-1,5,2,1,'#b0ddff');ctx.restore();}
  roundRect(-34,0,68,9,4,'#17385f');
  poly([[-34,0],[-25,3],[-17,-1],[-8,3],[1,-1],[11,4],[22,0],[34,2],[32,8],[24,7],[14,11],[4,7],[-7,10],[-17,6],[-28,9],[-34,6]],'#7ac7e9');
  roundRect(-32,9,64,9,3,'#102d51');rect(-28,11,56,2,'#2e5c88');
  poly([[-30,8],[27,8],[16,17],[7,12],[-8,17],[-19,12]],'#3f91e4');
  roundRect(-30,18,60,9,4,'#66a1d5');line(-24,24,24,24,'#8bc3e9',1);
  // Angry eyes and luminous eyebrows keep the silhouette readable.
  roundRect(-18,-10,13,8,2,'#092546');roundRect(7,-10,13,8,2,'#092546');
  rect(-13,-8,6,4,'#bdeaff');rect(9,-8,6,4,'#bdeaff');line(-19,-13,-5,-9,'#0d2c50',3);line(7,-9,21,-13,'#0d2c50',3);
  if(boss){poly([[-21,-27],[-26,-43],[-10,-35],[0,-48],[11,-35],[25,-43],[21,-27]],'#77b6e9');rect(-21,-29,42,5,'#badfff');}
  ctx.restore();
  if(e.hp<e.maxHp||boss&&!intro){const width=boss?130:46;rect(e.x-width/2,e.y-(boss?115:42),width,4,'#102d4d');rect(e.x-width/2,e.y-(boss?115:42),width*e.hp/e.maxHp,4,'#80c7ff');}
  if(boss&&!intro)label('THE BEEF OVERLORD',e.x,e.y-126,10,'#80b8ed','center');
}

function gate(){
  const x=stageLength-120,y=582,open=kills===enemies.length;
  glow(x,y-75,140,open?'#3f9dff30':'#2763ac12');
  rect(x-49,y-142,98,142,'#0b213c');rect(x-55,y-150,12,150,'#326397');rect(x+43,y-150,12,150,'#326397');rect(x-55,y-154,110,12,'#518fc3');
  rect(x-40,y-140,3,138,open?'#8cdbff':'#28527d');rect(x+37,y-140,3,138,open?'#8cdbff':'#28527d');
  if(open){for(let i=0;i<6;i++)rect(x-34,y-133+i*23+Math.sin(time*2+i)*5,68,2,'#5eaeff33');label('→',x,y-61,50,'#9edbff','center');}
  else{for(let i=0;i<5;i++)rect(x-33+i*15,y-140,5,140,'#26496d');label(`${8-kills} LEFT`,x,y-168,12,'#76a7d8','center');}
  label(open?'NEXT SERVING':'SMASH EVERY BURGER',x,y-181,9,'#6a9bd0','center');
}

function drawIntro(){
  background(0,true);
  // Oversized character vignette uses the same in-game artwork.
  ctx.save();
  ctx.translate(W > 700 ? W - 1280 : W - 1150,0);
  const py=563;
  platformDraw({x:580,y:py,w:700,h:160});
  platformDraw({x:1040,y:395,w:230,h:25});
  glow(876,436,210,'#3178d433');ellipse(871,py+1,100,15,'#06152e99');
  dude(870,py,2.35,1,0,0,true);
  burger({x:1145,y:369,phase:1,hp:2,maxHp:2,type:'burger',hurt:0},true);
  burger({x:1090,y:py-26,phase:3,hp:2,maxHp:2,type:'burger',hurt:0},true);
  // Blue sparks and scratched foreground stones.
  poly([[699,py],[713,py-27],[723,py-11],[735,py-36],[741,py]],'#2f6293');
  poly([[977,py],[985,py-12],[994,py-7],[1007,py-24],[1012,py]],'#4989bd');
  ctx.restore();
}

function drawGame(){
  background(camera);
  ctx.save();
  if(shake>0&&!reducedMotion)ctx.translate(rand(-shake,shake)*.6,rand(-shake,shake)*.5);
  ctx.translate(-camera,0);
  // Glowing machinery below the pits.
  for(let i=0;i<stageLength;i+=110){rect(i,677,60,6,'#214b7b');poly([[i,700],[i+30,657],[i+60,700]],'#15375c');}
  for(const p of platforms)platformDraw(p);
  gate();
  // World-space tutorial signs disappear into the level as you move.
  if(stage===0){label('A / D   TO MOVE',160,470,11,'#6d9bc8','center');label('W / ↑ × 2',535,378,11,'#87b5e4','center');label('DOUBLE JUMP',535,396,8,'#5482b1','center');label('SPACE  ·  HAMMER',950,270,11,'#83b3e3','center');label('SHIFT  →  DASH',1360,470,11,'#7aa9d9','center');}
  for(const e of enemies)if(!e.dead&&e.x>camera-150&&e.x<camera+W+150)burger(e);
  for(const b of projectiles){glow(b.x,b.y,45,'#388aff50');poly([[b.x-23,b.y+16],[b.x-8,b.y-20],[b.x+6,b.y-3],[b.x+20,b.y-27],[b.x+25,b.y+16]],'#69b5ff');}
  const p=player;
  ellipse(p.x,p.y+3,27,5,'#05172b77');
  if(p.dash>0){dude(p.x-p.dir*55,p.y,1,p.dir,0,0,false,true);dude(p.x-p.dir*95,p.y,1,p.dir,0,0,false,true);}
  if(p.hurt<=0||Math.floor(time*18)%2===0)dude(p.x,p.y,1,p.dir,p.attack,p.vx,p.ground);
  for(const f of particles){ctx.globalAlpha=clamp(f.life/f.max,0,1);if(f.ring){ctx.strokeStyle=f.color;ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(f.x,f.y,(1-f.life/f.max)*50+8,8,0,0,TAU);ctx.stroke();}else{rect(f.x,f.y,f.size,f.size*.6,f.color);}}
  ctx.globalAlpha=1;
  for(const f of words){ctx.globalAlpha=Math.min(1,f.life*3);label(f.text,f.x,f.y,f.size,f.color,'center','Barlow Condensed');}ctx.globalAlpha=1;
  ctx.restore();
  if(combo>1){label(`${combo}×`,W-40,155,42,'#8ccaff','right','Barlow Condensed');label('BURGER COMBO',W-40,174,9,'#548fcf','right');}
  label(String(score).padStart(6,'0'),32,H-26,18,'#8db8e3','left','Barlow Condensed');
  label('SCORE',32,H-48,8,'#4677aa');
  if(p.dashCooldown>0){rect(105,H-35,55,3,'#1c3b60');rect(105,H-35,55*(1-p.dashCooldown/.85),3,'#66b3ff');}
  // Offscreen burger indicators prevent leaving an enemy behind by accident.
  const left=enemies.filter(e=>!e.dead&&e.x<camera-35).length;
  if(left)label(`← ${left} BURGER${left>1?'S':''}`,25,H/2,10,'#79b1e6');
}

function render(){
  ctx.setTransform(canvas.width/W,0,0,canvas.height/H,0,0);
  ctx.filter='none';ctx.globalAlpha=1;
  if(state==='intro')drawIntro();else drawGame();
  // A subtle print-like texture; deliberately no flashing overlay.
  for(let y=0;y<H;y+=4)rect(0,y,W,1,'#07162b0c');
}
function resize(){
  const bounds=canvas.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,2);
  W=H*bounds.width/bounds.height;
  canvas.width=Math.round(bounds.width*ratio);canvas.height=Math.round(bounds.height*ratio);
}
window.addEventListener('resize',resize);resize();
function frame(now){
  const dt=Math.min((now-lastFrame)/1000||0,.05);lastFrame=now;accumulator+=dt;
  while(accumulator>=1/120){update(1/120);accumulator-=1/120;}
  render();requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
