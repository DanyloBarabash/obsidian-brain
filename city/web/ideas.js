'use strict';
// The Mountain of Ideas: a zone reached by train from the city; quick capture of passing thoughts, kept in Brain and grown stage by stage.
const IDEA_STAGES=[['seed','Зерна','Щойно записані думки'],['growing','Проростають','Те, що варто розвинути'],['project','Стали проєктами','Виросли в щось більше']],IDEA_SHELVED='shelved';
// Altitude ladder, top to bottom: where each stage lives on the mountain.
const IDEA_LADDER=[['project','Вершина','Стали проєктами'],['growing','Ліс на схилі','Проростають'],['seed','Луки біля підніжжя','Зерна'],['incubating','Тиха долина','Інкубація'],['shelved','Вокзал','Відкладені']];
// Place and attention follow the mountain rules (IDEA-MOUNTAIN.md); without the plan an idea stands at its stage.
const ideaPlace=idea=>window.MountainPlan?window.MountainPlan.placeOf(idea):idea.status,ideaDue=idea=>!!window.MountainPlan?.due(idea);
const IDEA_MOVES={seed:[['growing','→ Проростає']],growing:[['project','→ Проєкт'],['seed','← У зерна']],project:[['growing','← Проростає']],shelved:[['seed','Повернути']]};
let ideaList=[],ideasShelvedOpen=false;
const RIDE_MS={to:1600,back:1100};
function ideasWord(n){const t=n%10,h=n%100;return t===1&&h!==11?'ідея':t>=2&&t<=4&&(h<12||h>14)?'ідеї':'ідей';}
async function loadIdeas(){try{const res=await fetch('/api/ideas');if(res.ok)ideaList=(await res.json()).ideas;}catch{}}
async function ideaPost(path,body){const res=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!res.ok)throw Error(String(res.status));return res.json();}
async function moveIdea(idea,stage){try{await ideaPost('/api/ideas/stage',{path:idea.path,stage});idea.status=stage;idea.updated=new Date().toISOString().slice(0,10);renderIdeas();window.MountainScene?.update(ideaList);}catch(error){toast(`Не вдалося перенести ідею: ${error.message}`);}}
function ideaCard(idea){
  const card=document.createElement('article');card.className='idea-card';card.dataset.path=idea.path;
  const title=document.createElement('h3');title.textContent=idea.title;title.title='Показати прапорець на горі';title.onclick=()=>window.MountainScene?.focus(idea.path);
  const meta=document.createElement('div');meta.className='idea-date';meta.textContent=idea.created||'';
  card.append(title,meta);
  const badges=[ideaPlace(idea)==='incubating'&&['rest','відпочиває в долині'],ideaDue(idea)&&['due','чекає уваги']].filter(Boolean);
  if(badges.length){const row=document.createElement('div');row.className='idea-badges';for(const [kind,text] of badges){const b=document.createElement('span');b.className=`idea-badge ${kind}`;b.textContent=text;row.append(b);}card.append(row);}
  if(idea.summary){const p=document.createElement('p');p.textContent=idea.summary;card.append(p);}
  const actions=document.createElement('div');actions.className='idea-actions';
  const grow=document.createElement('button');grow.className='primary';grow.textContent='Розвинути';grow.title='Відкрити ідею в читальні й дописати';
  grow.onclick=()=>CityReader.open({id:idea.path,title:idea.title});actions.append(grow);
  for(const [stage,label] of IDEA_MOVES[idea.status]||[]){const b=document.createElement('button');b.textContent=label;b.onclick=()=>moveIdea(idea,stage);actions.append(b);}
  if(idea.status!==IDEA_SHELVED){const b=document.createElement('button');b.textContent='Відкласти';b.onclick=()=>moveIdea(idea,IDEA_SHELVED);actions.append(b);}
  card.append(actions);return card;
}
function renderIdeas(){
  const columns=IDEA_STAGES.map(([stage,name,hint])=>{
    const own=ideaList.filter(i=>i.status===stage),column=document.createElement('section');column.className='idea-column';column.dataset.stage=stage;
    const head=document.createElement('div');head.className='idea-column-head';const t=document.createElement('span');t.textContent=name;const c=document.createElement('span');c.textContent=own.length;head.append(t,c);
    const sub=document.createElement('div');sub.className='idea-hint';sub.textContent=hint;column.append(head,sub,...own.map(ideaCard));
    if(!own.length){const e=document.createElement('p');e.className='idea-empty';e.textContent=stage==='seed'?'Запиши першу ідею вгорі — вона ляже тут.':'Поки порожньо.';column.append(e);}
    return column;});
  const shelved=ideaList.filter(i=>i.status===IDEA_SHELVED),box=document.createElement('details');box.className='idea-shelved';box.open=ideasShelvedOpen;box.ontoggle=()=>{ideasShelvedOpen=box.open;};
  const sum=document.createElement('summary');sum.textContent=`Відкладені · ${shelved.length}`;box.append(sum,...shelved.map(ideaCard));
  $('ideas-board').replaceChildren(...columns);$('ideas-shelved').replaceChildren(...(shelved.length?[box]:[]));
  renderLadder();
  $('ideas-count').textContent=ideaList.length?`${ideaList.length} ${ideasWord(ideaList.length)} на горі`:'Гора чекає на першу ідею';
}
function renderLadder(){
  const count=stage=>ideaList.filter(i=>ideaPlace(i)===stage).length,most=Math.max(1,...IDEA_LADDER.map(([stage])=>count(stage))),summit=window.MountainPlan?.IDEAS.summit??Infinity;
  $('mountain-ladder').replaceChildren(...IDEA_LADDER.map(([stage,place,name])=>{
    const n=count(stage),b=document.createElement('button');b.type='button';b.className=`ladder-step stage-${stage}`;b.dataset.stage=stage;
    b.innerHTML='<span class="ladder-place"></span><span class="ladder-name"></span><span class="ladder-bar"><i></i></span><span class="ladder-count"></span>';
    b.querySelector('.ladder-place').textContent=place;b.querySelector('.ladder-name').textContent=stage==='project'&&n>summit?`${name} · тісно`:name;b.querySelector('.ladder-count').textContent=n;b.querySelector('i').style.width=`${n/most*100}%`;
    if(stage==='project'&&n>summit)b.title=`На вершині місце для ${summit} проєктів: зосередься або віддай один у «Проростають»`;
    b.onclick=()=>{window.MountainScene?.focusZone(stage);const target=stage==='shelved'?document.querySelector('.idea-shelved'):document.querySelector(`.idea-column[data-stage="${stage==='incubating'?'seed':stage}"]`);if(target?.tagName==='DETAILS')target.open=true;target?.scrollIntoView?.({block:'start',behavior:'smooth'});};
    return b;}));
}
async function captureIdea(){
  // A second ⌘↵ while the first save is in flight must not write the idea twice.
  const input=$('idea-text'),text=input.value.trim();if(!text||$('idea-save').disabled)return;$('idea-save').disabled=true;
  try{await ideaPost('/api/ideas',{text});input.value='';toast('Ідея на горі ✓');await loadIdeas();renderIdeas();window.MountainScene?.update(ideaList);input.focus();}
  catch(error){toast(`Не вдалося записати ідею: ${error.message}`);}finally{$('idea-save').disabled=false;}
}
function pickIdea(path){
  // A flag picked on the mountain shows its card in the panel.
  const room=$('ideas-room');room.classList.remove('panel-hidden');$('ideas-panel').textContent='Сховати ідеї';
  const card=[...document.querySelectorAll('#ideas-room .idea-card')].find(c=>c.dataset.path===path);if(!card)return;
  const box=card.closest('details');if(box&&!box.open){box.open=true;ideasShelvedOpen=true;}
  document.querySelectorAll('#ideas-room .idea-card.picked').forEach(c=>c.classList.remove('picked'));card.classList.add('picked');card.scrollIntoView?.({block:'nearest',behavior:'smooth'});
}
function ride(direction){
  // The train between the city and the mountain; skipped under reduced motion.
  if(!window.matchMedia||matchMedia('(prefers-reduced-motion: reduce)').matches)return Promise.resolve();
  const el=$('train-ride'),ms=RIDE_MS[direction];el.classList.toggle('back',direction==='back');el.style.setProperty('--ride',ms+'ms');
  $('ride-caption').textContent=direction==='back'?'Повертаємось у місто…':'Потяг їде до Гори ідей…';el.hidden=false;
  return new Promise(done=>setTimeout(done,ms));
}
async function openIdeas(){
  const room=$('ideas-room');closeNote();
  if(!room.open){await ride('to');room.showModal();$('train-ride').hidden=true;}
  renderIdeas();await loadIdeas();if(!room.open)return;renderIdeas();
  window.MountainScene?.show(ideaList,{onPick:pickIdea,still:!window.matchMedia||matchMedia('(prefers-reduced-motion: reduce)').matches});$('idea-text').focus();
}
async function leaveIdeas(){
  const room=$('ideas-room');if(!room.open)return;window.MountainScene?.hide();room.close();
  await ride('back');$('train-ride').hidden=true;
}
document.addEventListener('DOMContentLoaded',()=>{
  $('ideas-close').onclick=leaveIdeas;
  $('ideas-room').addEventListener('cancel',e=>{e.preventDefault();leaveIdeas();});
  $('ideas-panel').onclick=()=>{const hidden=$('ideas-room').classList.toggle('panel-hidden');$('ideas-panel').textContent=hidden?'Показати ідеї':'Сховати ідеї';$('ideas-panel').setAttribute('aria-expanded',String(!hidden));};
  $('idea-form').onsubmit=e=>{e.preventDefault();captureIdea();};
  $('idea-text').addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();captureIdea();}});
  $('ideas-room').addEventListener('keydown',e=>e.stopPropagation());
  // An idea developed in the reader comes back with its new opening line.
  addEventListener('city-note-saved',()=>{if($('ideas-room').open)loadIdeas().then(()=>{renderIdeas();window.MountainScene?.update(ideaList);});});
  $('open-ideas').onclick=()=>{const hill=state.nodes.find(n=>n.cityRole==='idea-mountain'&&n.available!==false);if(hill&&typeof focusNode==='function')focusNode(hill);openIdeas();};
});
