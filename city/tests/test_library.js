'use strict';
// DOM integration: needs jsdom from `npm install` in city/.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),root=path.join(__dirname,'..');
const dom=new JSDOM(fs.readFileSync(path.join(root,'web/index.html'),'utf8'),{url:'http://127.0.0.1:8765/',runScripts:'outside-only'});
const w=dom.window,d=w.document,$=id=>d.getElementById(id),tick=()=>new Promise(r=>setImmediate(r));
w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
const saved={id:'_global/library/articles/a.md',title:'Збережена стаття',cityRole:'library-item',summary:'Про рух',libraryShelf:'Спорт',librarySource:'https://example.org/a'};
const hub={id:'_global/library.md',title:'Бібліотека знань',cityRole:'knowledge-library'};
let library={shelves:['Спорт','Порожня'],shelfClasses:{'Спорт':'sports'},offline:false,liked:[{id:'x1',url:'https://example.org/x',title:'Вподобана стаття',about:'Опис',sourceLabel:'Blog',shelf:''}]};
const posts=[],read=[],toasts=[];
w.fetch=async(url,init)=>{
  if(init?.method==='POST'){const body=JSON.parse(init.body);posts.push([url,body]);
    if(url==='/api/library/take'){library={...library,liked:[]};return {ok:true,json:async()=>({note:'_global/library/articles/x.md',shelf:'Спорт'})};}
    return {ok:true,json:async()=>({shelf:body.shelf??body.name})};}
  if(url==='/api/library')return {ok:true,json:async()=>JSON.parse(JSON.stringify(library))};
  return {ok:true,json:async()=>({content:'# Бібліотека знань\n\nЗагальний фонд.'})};
};
w.eval(`var state={nodes:[],districts:[{id:'sports',title:'Спорт і тренування',color:'#efb15f',theme:'sports'},{id:'civic',title:'Міське управління',color:'#e1c66e',theme:'civic'}]};var icons={sports:'⚽',civic:'⚑'};var $=id=>document.getElementById(id);var closeNote=()=>{};var toast=m=>window.toasts.push(m);
  var CityReader={render:(el,text)=>{el.textContent=text;},open:n=>window.read.push(n.id)};`);
w.toasts=toasts;w.read=read;w.nodes=[saved,hub];w.eval('state.nodes=window.nodes');
// Strict eval would keep the script's functions local, so it runs as the page's classic script does.
w.eval(fs.readFileSync(path.join(root,'web/library.js'),'utf8').replace("'use strict';",''));
d.dispatchEvent(new w.Event('DOMContentLoaded'));
const tab=name=>d.querySelector(`.library-tabs [data-tab="${name}"]`),shelf=name=>[...d.querySelectorAll('.library-shelf')].find(s=>s.querySelector('.shelf-head span').textContent===name);
(async()=>{
  await w.openLibrary();await tick();
  assert($('library-room').open);assert.equal(tab('about').getAttribute('aria-selected'),'true','the library opens on its own description');
  assert($('library-main').textContent.includes('Загальний фонд'));assert($('library-card').hidden);
  assert.deepEqual([...d.querySelectorAll('.library-tile b')].map(b=>b.textContent),['1','1','2']);
  tab('liked').click();await tick();await tick();
  assert.equal(tab('liked').getAttribute('aria-selected'),'true');
  assert.deepEqual([...d.querySelectorAll('.shelf-head span:first-child')].map(s=>s.textContent),['Без полиці','Порожня','Спорт']);
  const book=shelf('Без полиці').querySelector('.library-book');assert.equal(book.querySelector('.book-title').textContent,'Вподобана стаття');assert.equal(book.querySelector('.book-source').textContent,'Blog');
  // Dragging a book onto a shelf files it there.
  const data=new Map(),transfer={setData:(k,v)=>data.set(k,v),getData:k=>data.get(k),effectAllowed:''};
  const drag=(el,type)=>{const e=new w.Event(type,{bubbles:true,cancelable:true});e.dataTransfer=transfer;el.dispatchEvent(e);};
  drag(book,'dragstart');drag(shelf('Спорт'),'drop');await tick();
  assert.deepEqual(posts.at(-1),['/api/library/shelve',{id:'x1',shelf:'Спорт'}]);
  assert(shelf('Спорт').textContent.includes('Вподобана стаття'));assert(!shelf('Без полиці'),'an empty unshelved row disappears');
  const cover=shelf('Спорт').querySelector('.library-book');assert.equal(cover.style.getPropertyValue('--c'),'#efb15f','a book takes its shelf class colour');assert.equal(cover.querySelector('.book-emblem').textContent,'⚽');
  const select=shelf('Порожня').querySelector('select');assert.deepEqual([...select.options].map(o=>o.value),['','sports'],'civic is not a reading class');
  select.value='sports';select.dispatchEvent(new w.Event('change'));await tick();await tick();
  assert.deepEqual(posts.at(-1),['/api/library/shelf',{name:'Порожня',class:'sports'}]);assert.equal(shelf('Порожня').querySelector('select').value,'sports');
  // The card names the shelf and moves the book with a chip.
  shelf('Спорт').querySelector('.library-book').click();
  assert.equal($('library-card').querySelector('h3').textContent,'Вподобана стаття');
  [...$('library-card').querySelectorAll('.shelf-picker button')].find(b=>b.textContent==='Порожня').click();await tick();
  assert.deepEqual(posts.at(-1),['/api/library/shelve',{id:'x1',shelf:'Порожня'}]);
  const form=$('library-card').querySelector('.shelf-picker form');form.querySelector('input').value='  Нова  ';form.dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
  assert.deepEqual(posts.at(-1),['/api/library/shelve',{id:'x1',shelf:'Нова'}]);
  [...$('library-card').querySelectorAll('button')].find(b=>b.textContent==='Взяти в мозок').click();await tick();await tick();await tick();
  assert.deepEqual(posts.at(-1),['/api/library/take',{id:'x1'}]);assert(toasts.at(-1).includes('Узято в мозок'));
  tab('saved').click();await tick();await tick();
  assert(shelf('Спорт').textContent.includes('Збережена стаття'));
  shelf('Спорт').querySelector('.library-book').click();
  [...$('library-card').querySelectorAll('button')].find(b=>b.textContent==='Читати в читальні').click();assert.deepEqual(read,[saved.id]);
  [...$('library-card').querySelectorAll('.shelf-picker button')].find(b=>b.textContent==='Спорт').click();await tick();
  assert.deepEqual(posts.at(-1),['/api/library/shelve',{path:saved.id,shelf:''}],'choosing the current shelf takes the book off it');
  $('library-close').click();assert(!$('library-room').open);
  dom.window.close();console.log('Library room: about first, liked and saved shelves, drag to shelve, shelf chips and new shelves, take into Brain and read pass.');
})().catch(error=>{console.error(error);dom.window.close();process.exitCode=1;});
