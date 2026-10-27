'use strict';
// DOM integration: needs jsdom from `npm install` in city/.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),root=path.join(__dirname,'..');
const dom=new JSDOM(fs.readFileSync(path.join(root,'web/index.html'),'utf8'),{url:'http://127.0.0.1:8765/',runScripts:'outside-only'});
const w=dom.window,d=w.document,$=id=>d.getElementById(id),tick=()=>new Promise(r=>setImmediate(r));
w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
const daysAgo=n=>new Date(Date.now()-n*864e5).toISOString().slice(0,10);
let ideas=[{path:'_global/ideas/idea-a.md',title:'Гора ідей',status:'seed',created:daysAgo(1),updated:daysAgo(0),summary:'Записувати думки.'},
  {path:'_global/ideas/idea-b.md',title:'Стара думка',status:'shelved',created:daysAgo(30),updated:daysAgo(30),summary:''},
  {path:'_global/ideas/idea-r.md',title:'Тиха думка',status:'seed',created:daysAgo(20),updated:daysAgo(20),summary:''}];
const posts=[],read=[],toasts=[];
w.fetch=async(url,init)=>{
  if(init?.method==='POST'){const body=JSON.parse(init.body);posts.push([url,body]);
    if(url==='/api/ideas')ideas=[{path:'_global/ideas/idea-c.md',title:body.text.split('\n')[0],status:'seed',created:'2026-10-27',summary:''},...ideas];
    return {ok:true,json:async()=>({path:'_global/ideas/idea-c.md'})};}
  return {ok:true,json:async()=>({ideas:JSON.parse(JSON.stringify(ideas))})};
};
w.toasts=toasts;w.read=read;
w.eval(`var state={nodes:[]};var $=id=>document.getElementById(id);var closeNote=()=>{};var toast=m=>window.toasts.push(m);var CityReader={open:n=>window.read.push(n.id)};`);
const scene={shown:[],updates:0,focused:[],zones:[]};w.MountainScene={show:(list,o)=>{scene.shown.push(list.length);scene.pick=o.onPick;},update:()=>{scene.updates++;},focus:p=>scene.focused.push(p),focusZone:z=>scene.zones.push(z),hide:()=>{scene.hidden=true;}};
// Strict eval would keep the script's functions local, so it runs as the page's classic script does.
w.eval(fs.readFileSync(path.join(root,'web/mountain-plan.js'),'utf8'));
w.eval(fs.readFileSync(path.join(root,'web/ideas.js'),'utf8').replace("'use strict';",''));
d.dispatchEvent(new w.Event('DOMContentLoaded'));
const column=stage=>d.querySelector(`.idea-column[data-stage="${stage}"]`),button=(card,label)=>[...card.querySelectorAll('button')].find(b=>b.textContent===label);
(async()=>{
  $('open-ideas').click();await tick();await tick();
  assert($('ideas-room').open);assert.deepEqual([...d.querySelectorAll('.idea-column-head span:first-child')].map(s=>s.textContent),['Зерна','Проростають','Стали проєктами']);
  assert.equal(column('seed').querySelector('h3').textContent,'Гора ідей');assert(column('seed').textContent.includes('Записувати думки.'));
  assert(column('growing').textContent.includes('Поки порожньо'));assert($('ideas-shelved').textContent.includes('Відкладені · 1'));
  assert.equal($('ideas-count').textContent,'3 ідеї на горі');assert.deepEqual(scene.shown,[3],'the mountain zone opens with every flag');
  // A flag picked on the mountain highlights its card; a card title flies the camera to its flag.
  scene.pick('_global/ideas/idea-b.md');assert(d.querySelector('.idea-card.picked h3').textContent==='Стара думка');assert(d.querySelector('.idea-shelved').open);
  d.querySelector('.idea-card h3').click();assert.deepEqual(scene.focused,['_global/ideas/idea-a.md']);
  // The altitude ladder: summit to station, with counts; a step flies to its stretch of the trail.
  assert.deepEqual([...d.querySelectorAll('.ladder-step')].map(b=>[b.dataset.stage,b.querySelector('.ladder-count').textContent]),[['project','0'],['growing','0'],['seed','1'],['incubating','1'],['shelved','1']]);
  d.querySelector('.ladder-step[data-stage="seed"]').click();assert.deepEqual(scene.zones,['seed']);
  // A seed untouched for 20 days rests in the valley and, past its 14-day interval, asks for attention (IM-03, IM-04).
  const resting=[...d.querySelectorAll('.idea-card')].find(c=>c.dataset.path==='_global/ideas/idea-r.md');
  assert.deepEqual([...resting.querySelectorAll('.idea-badge')].map(b=>b.textContent),['відпочиває в долині','чекає уваги']);
  $('ideas-panel').click();assert($('ideas-room').classList.contains('panel-hidden'));$('ideas-panel').click();assert(!$('ideas-room').classList.contains('panel-hidden'));
  // Capture: the first line becomes the title, the field clears for the next thought.
  $('idea-text').value='Нова думка\nподробиці';$('idea-text').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',metaKey:true}));await tick();await tick();await tick();
  assert.deepEqual(posts.at(-1),['/api/ideas',{text:'Нова думка\nподробиці'}]);assert.equal(posts.filter(([u])=>u==='/api/ideas').length,1,'one ⌘↵ writes one idea');assert.equal($('idea-text').value,'');assert(toasts.at(-1).includes('Ідея на горі'));
assert.equal(column('seed').querySelectorAll('.idea-card').length,3);assert(scene.updates>=1,'a new idea plants its flag');
  // Stages move a card; "Розвинути" opens the idea in the reader.
  const card=[...column('seed').querySelectorAll('.idea-card')].find(c=>c.querySelector('h3').textContent==='Гора ідей');
  button(card,'Розвинути').click();assert.deepEqual(read,['_global/ideas/idea-a.md']);
  button(card,'→ Проростає').click();await tick();
  assert.deepEqual(posts.at(-1),['/api/ideas/stage',{path:'_global/ideas/idea-a.md',stage:'growing'}]);assert(column('growing').textContent.includes('Гора ідей'));
  const back=$('ideas-shelved').querySelector('.idea-card');button(back,'Повернути').click();await tick();
  assert.deepEqual(posts.at(-1),['/api/ideas/stage',{path:'_global/ideas/idea-b.md',stage:'seed'}]);assert.equal($('ideas-shelved').children.length,0);
  $('ideas-close').click();await tick();assert(!$('ideas-room').open);assert(scene.hidden,'the train back stops the mountain view');
  dom.window.close();console.log('Mountain of ideas: zone with flags, altitude ladder, pick and focus, panel toggle, stages, quick capture with ⌘↵, develop in the reader, move between stages and return shelved ideas pass.');
})().catch(error=>{console.error(error);dom.window.close();process.exitCode=1;});
