'use strict';
// The Knowledge Library room: about the library, then liked and saved articles as books on shelves the user names.
const LIBRARY_UNSHELVED='Без полиці',LIBRARY_LEATHER=['#8c5a45','#a0763f','#4f7672','#6d5a7c','#7b8a4e','#9a5d6a','#3f5f7a','#8a6f4a'],LIBRARY_COVER_VARIANTS=3;
let libraryTab='about',libraryData={shelves:[],shelfClasses:{},liked:[],offline:false},librarySelected=null;
function libraryHash(text){let h=0;for(const c of text)h=(h*31+c.codePointAt(0))|0;return Math.abs(h);}
function shelfDistrict(shelf){const id=(libraryData.shelfClasses||{})[shelf];return id?state.districts.find(d=>d.id===id):null;}
// A face-out cover in its shelf's class colour and emblem, so a shelf reads as one subject at a glance.
function bookCover(book){
  const h=libraryHash(book.key),district=shelfDistrict(book.shelf),b=document.createElement('button');
  b.className=`library-book cover-${h%LIBRARY_COVER_VARIANTS}`+(book.key===librarySelected?' active':'');b.title=book.title;b.draggable=true;
  b.style.setProperty('--c',district?.color||LIBRARY_LEATHER[h%LIBRARY_LEATHER.length]);
  const emblem=document.createElement('span');emblem.className='book-emblem';emblem.textContent=district&&typeof icons!=='undefined'?icons[district.theme]||'◈':'◈';
  const title=document.createElement('span');title.className='book-title';title.textContent=book.title;
  const source=document.createElement('span');source.className='book-source';source.textContent=book.label||(district?.title)||'';
  b.append(emblem,title,source);return b;
}
function libraryNode(){return state.nodes.find(n=>n.cityRole==='knowledge-library'&&n.available!==false);}
function libraryBooks(kind){
  if(kind==='saved')return state.nodes.filter(n=>n.cityRole==='library-item'&&n.available!==false).map(n=>({kind,key:n.id,title:n.title,about:n.summary||'',url:n.librarySource,label:'У Brain',shelf:n.libraryShelf||'',node:n}));
  return libraryData.liked.map(i=>({kind,key:i.id,title:i.title,about:i.about||i.summary||'',url:i.url,label:i.sourceLabel||'',shelf:i.shelf||''}));
}
function libraryShelves(){return [...new Set([...libraryData.shelves,...libraryBooks('saved').map(b=>b.shelf),...libraryBooks('liked').map(b=>b.shelf)].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'uk'));}
async function loadLibrary(){try{const res=await fetch('/api/library');if(res.ok)libraryData=await res.json();}catch{libraryData={...libraryData,offline:true};}}
async function libraryPost(path,body){const res=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!res.ok)throw Error(res.status===503?'Brain Reader не запущено':String(res.status));return res.json();}
// Picks an existing shelf or names a new one; shared by the book card and the market.
function shelfPicker(current,onPick,label='На полицю:'){
  const box=document.createElement('div');box.className='shelf-picker';box.append(document.createTextNode(label));
  for(const name of libraryShelves()){const b=document.createElement('button');b.type='button';b.textContent=name;b.setAttribute('aria-pressed',String(name===current));b.onclick=()=>onPick(name);box.append(b);}
  const form=document.createElement('form'),input=document.createElement('input');input.placeholder='нова полиця…';input.maxLength=40;input.setAttribute('aria-label','Назва нової полиці');
  form.onsubmit=e=>{e.preventDefault();const name=input.value.trim();if(name)onPick(name);};form.append(input);box.append(form);return box;
}
async function shelveBook(book,shelf){
  try{const result=await libraryPost('/api/library/shelve',book.kind==='saved'?{path:book.key,shelf}:{id:book.key,shelf});
    if(book.node)book.node.libraryShelf=result.shelf;else{const item=libraryData.liked.find(i=>i.id===book.key);if(item)item.shelf=result.shelf;}
    if(result.shelf&&!libraryData.shelves.includes(result.shelf))libraryData.shelves.push(result.shelf);
    librarySelected=book.key;renderLibrary();
  }catch(error){toast(`Не вдалося поставити на полицю: ${error.message}`);}
}
function renderAbout(main){
  const tiles=document.createElement('div');tiles.className='library-tiles';
  for(const [tab,count,label] of [['saved',libraryBooks('saved').length,'книжок узято в мозок'],['liked',libraryData.liked.length,'вподобаних статей'],[null,libraryShelves().length,'полиць']]){
    const t=document.createElement('button');t.className='library-tile';const b=document.createElement('b');b.textContent=count;const s=document.createElement('span');s.textContent=label;t.append(b,s);
    if(tab)t.onclick=()=>openLibrary(tab);else t.disabled=true;tiles.append(t);}
  const about=document.createElement('article');about.className='library-about document-prose';about.textContent='Відкриваємо опис бібліотеки…';
  main.replaceChildren(tiles,about);const node=libraryNode();if(!node){about.textContent='Опис бібліотеки ще не додано до Brain.';return;}
  fetch(`/api/note?path=${encodeURIComponent(node.id)}`).then(r=>{if(!r.ok)throw Error();return r.json();}).then(note=>{if(libraryTab==='about')CityReader.render(about,note.content,node);}).catch(()=>{about.textContent='Опис бібліотеки зараз недоступний.';});
}
function renderShelves(main,kind){
  const books=libraryBooks(kind),toolbar=document.createElement('div');toolbar.className='library-toolbar';
  toolbar.append(document.createTextNode(kind==='liked'?(libraryData.offline?'Brain Reader не запущено — вподобане зараз недоступне.':'Вподобане на ринку. Перетягни книжку на полицю або вибери її, щоб призначити категорію.'):'Статті, взяті в мозок. Полиця записується в саму нотатку.'));
  const form=document.createElement('form'),input=document.createElement('input'),add=document.createElement('button');input.placeholder='Нова полиця';input.maxLength=40;input.setAttribute('aria-label','Назва нової полиці');add.textContent='＋ Полиця';
  form.onsubmit=async e=>{e.preventDefault();const name=input.value.trim();if(!name)return;try{const r=await libraryPost('/api/library/shelf',{name});if(r.shelf&&!libraryData.shelves.includes(r.shelf))libraryData.shelves.push(r.shelf);renderLibrary();}catch(error){toast(`Не вдалося створити полицю: ${error.message}`);}};
  form.append(input,add);toolbar.append(form);
  const names=libraryShelves(),sections=[...(books.some(b=>!b.shelf)||!names.length?[LIBRARY_UNSHELVED]:[]),...names].map(name=>{
    const shelf=name===LIBRARY_UNSHELVED?'':name,own=books.filter(b=>b.shelf===shelf),section=document.createElement('section');section.className='library-shelf';
    const head=document.createElement('div');head.className='shelf-head';const title=document.createElement('span');title.textContent=name;const count=document.createElement('span');count.className='shelf-count';count.textContent=own.length;head.append(title);
    if(shelf){const select=document.createElement('select');select.setAttribute('aria-label',`Клас полиці ${name}`);
      for(const [value,label] of [['','без класу'],...state.districts.filter(d=>d.id!=='civic').map(d=>[d.id,d.title])]){const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o);}
      select.value=(libraryData.shelfClasses||{})[shelf]||'';
      select.onchange=async()=>{try{await libraryPost('/api/library/shelf',{name:shelf,class:select.value});libraryData.shelfClasses={...libraryData.shelfClasses,[shelf]:select.value};renderLibrary();}catch(error){toast(`Не вдалося змінити клас: ${error.message}`);}};
      head.append(select);}
    head.append(count);
    const board=document.createElement('div');board.className='library-board';
    if(!own.length){const e=document.createElement('span');e.className='library-empty';e.textContent='Порожня полиця — перетягни сюди книжку.';board.append(e);}
    for(const book of own){const b=bookCover(book);
      b.onclick=()=>{librarySelected=book.key;renderLibrary();};b.ondragstart=e=>{e.dataTransfer.setData('text/plain',book.key);e.dataTransfer.effectAllowed='move';};board.append(b);}
    section.ondragover=e=>{e.preventDefault();section.classList.add('drop');};section.ondragleave=()=>section.classList.remove('drop');
    section.ondrop=e=>{e.preventDefault();section.classList.remove('drop');const book=books.find(b=>b.key===e.dataTransfer.getData('text/plain'));if(book&&book.shelf!==shelf)shelveBook(book,shelf);};
    section.append(head,board);return section;});
  main.replaceChildren(toolbar,...sections);
}
function renderCard(card,kind){
  const book=libraryBooks(kind).find(b=>b.key===librarySelected);card.replaceChildren();
  if(!book){const p=document.createElement('p');p.className='library-hint';p.textContent='Вибери книжку на полиці, щоб побачити її опис і поставити на потрібну полицю.';card.append(p);return;}
  const kicker=document.createElement('div');kicker.className='eyebrow';kicker.textContent=kind==='saved'?'ВЗЯТО В МОЗОК':'ВПОДОБАНО НА РИНКУ';
  const title=document.createElement('h3');title.textContent=book.title;const meta=document.createElement('div');meta.className='meta';meta.textContent=[book.label,book.shelf?`полиця «${book.shelf}»`:LIBRARY_UNSHELVED,shelfDistrict(book.shelf)?.title].filter(Boolean).join(' · ');
  const about=document.createElement('p');about.textContent=book.about||'Опису ще немає.';
  const picker=shelfPicker(book.shelf,name=>shelveBook(book,name===book.shelf?'':name),'Полиця:');
  const actions=document.createElement('div');actions.className='library-actions';
  if(kind==='saved'){const read=document.createElement('button');read.className='primary';read.textContent='Читати в читальні';read.onclick=()=>CityReader.open(book.node);actions.append(read);}
  else{const read=document.createElement('button');read.className='primary';read.textContent='Читати в читальні';read.onclick=()=>CityReader.open({id:`market/${book.key}`,title:book.title,article:book.key});actions.append(read);
    const take=document.createElement('button');take.textContent='Взяти в мозок';
    take.onclick=async()=>{take.disabled=true;take.textContent='Несемо в мозок…';try{const r=await libraryPost('/api/library/take',{id:book.key});toast(`Узято в мозок${r.shelf?` · полиця «${r.shelf}»`:''}`);librarySelected=null;await loadLibrary();renderLibrary();}catch(error){take.disabled=false;take.textContent='Взяти в мозок';toast(`Не вдалося: ${error.message}`);}};actions.append(take);}
  if(book.url){const source=document.createElement('a');source.className='text-button';source.href=book.url;source.target='_blank';source.rel='noopener noreferrer';source.textContent='Першоджерело ↗';actions.append(source);}
  card.append(kicker,title,meta,about,picker,actions);
}
function renderLibrary(){
  for(const b of document.querySelectorAll('.library-tabs button'))b.setAttribute('aria-selected',String(b.dataset.tab===libraryTab));
  $('library-liked-count').textContent=libraryData.liked.length||'';$('library-saved-count').textContent=libraryBooks('saved').length||'';
  const main=$('library-main'),card=$('library-card');card.hidden=libraryTab==='about';
  if(libraryTab==='about')renderAbout(main);else{renderShelves(main,libraryTab);renderCard(card,libraryTab);}
}
async function openLibrary(tab='about'){
  if(tab!==libraryTab)librarySelected=null;libraryTab=tab;closeNote();
  const room=$('library-room');if(!room.open)room.showModal();renderLibrary();await loadLibrary();if(room.open)renderLibrary();
}
document.addEventListener('DOMContentLoaded',()=>{
  for(const b of document.querySelectorAll('.library-tabs button'))b.onclick=()=>openLibrary(b.dataset.tab);
  $('library-close').onclick=()=>$('library-room').close();
  $('library-room').addEventListener('keydown',e=>e.stopPropagation());
});
