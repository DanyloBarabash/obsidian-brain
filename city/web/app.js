/* Brain City: local 3D city with a canvas overlay for labels and links. */
'use strict';
const $ = id => document.getElementById(id);
const canvas = $('city'), screen = canvas.getContext('2d');
const ctx = screen;
const state = {data:null, world:null, worldAt:0, nodes:[], districts:[], byId:new Map(), selected:null, hovered:null, filter:null, query:'', links:false, paused:false, day:false, zoom:1, time:0, dragging:false, reduced:matchMedia('(prefers-reduced-motion: reduce)').matches};
let width=innerWidth, height=innerHeight, ratio=1, initialized=false, lastFrame=0, noteRequest=0;
const libraryCategories={general:'Загальне','general-knowledge':'Загальні знання',science:'Наука',technology:'Технології',sport:'Спорт',sports:'Спорт',energy:'Енергетика',culture:'Культура'};
const kinds={article:'Стаття',hub:'Центр кварталу',org:'Штаб організації',class:'Районна управа',note:'Дім ідей',document:'Бібліотека',session:'Майстерня спогадів'};
const icons={observatory:'✧',workspace:'▥',academy:'⌂',studio:'◇',garden:'♧',library:'▤',civic:'⚑',sports:'⚽'};
const hash = str => {let h=2166136261;for(const c of str){h^=c.codePointAt(0);h=Math.imul(h,16777619);}return h>>>0;};
const project = (x,y,z=0) => view3d.project(x,y,z);
function matches(n){return (!state.filter||n.district===state.filter)&&(!state.query||`${n.title} ${n.sourcePath||n.id} ${n.summary||''} ${n.libraryCategory||''}`.toLocaleLowerCase().includes(state.query));}
function prepare(data,worldOnly=false){
  const prior=state.data;state.data=data;
  const source={...data,nodes:[...data.nodes,...(data.cityState?.missingSources||[])]},plan=CityPlan.fromWorld(source,state.world);planVersion++;if(state.live){plan.residents=state.live.residents;plan.vehicles=state.live.vehicles;}state.districts=plan.districts;state.nodes=plan.sources||plan.nodes;state.urban=plan;
  state.byId=new Map(state.nodes.map(n=>[n.id,n]));state.byNode=new Map(state.nodes.map(n=>[n.stableId,n]));
  if(state.selected&&!state.selected.derived){const previous=state.selected;state.selected=state.nodes.find(n=>n.stableId&&n.stableId===previous.stableId)||state.byId.get(previous.id)||null;if(!state.selected)closeNote();else if(previous.id!==state.selected.id||previous.contentRevision!==state.selected.contentRevision||previous.available!==state.selected.available||previous.model==='grand-library')select(state.selected);}
  state.nodes.sort((a,b)=>(a.x+a.y)-(b.x+b.y));
  $('buildings').textContent=plan.nodes.filter(n=>n.available!==false).length;$('population').textContent=data.population;$('roads').textContent=data.edges.length;
  // A world tick only moves the map; panels re-render when sources change.
  if(worldOnly)return;
  renderDistricts();renderResults();
  renderHistory();
  $('sync').textContent='Синхронізовано з Brain';$('sync').classList.remove('error');
  if(!initialized){fit();initialized=true;}
  else if(prior&&data.nodes.length!==prior.nodes.length){toast(data.nodes.length>prior.nodes.length?`Місто виросло: +${data.nodes.length-prior.nodes.length} будівель`:'Мапу міста оновлено');}
}
function renderDistricts(){
  const nav=$('districts');nav.replaceChildren();
  for(const d of state.districts){const b=document.createElement('button');b.className='district'+(state.filter===d.id?' active':'');b.setAttribute('aria-pressed',String(state.filter===d.id));const dot=document.createElement('span');dot.className='dot';dot.style.color=d.color;dot.style.background=d.color;const name=document.createElement('span');name.textContent=d.title;const count=document.createElement('span');count.className='count';count.textContent=d.count;b.append(dot,name,count);b.onclick=()=>openDistrict(d);nav.append(b);}
}
function openDistrict(d,toggle=true){
  state.filter=toggle&&state.filter===d.id?null:d.id;renderDistricts();renderResults();if(state.filter){focusDistrict(d);showDistrict(d);}else{fit();closeDistrict();}$('view-label').textContent=state.filter?d.title:'Огляд міста';
}
function renderResults(){
  const open=!!(state.query||state.filter);$('results-panel').hidden=!open;if(!open)return;
  const facilities=state.urban.scenery.filter(o=>o.facility).map(o=>({...o.facility,derived:true,x:o.x,y:o.y,w:o.w,d:o.d,h:o.h,physicalId:o.facility.id}));
  const nodes=[...state.nodes,...facilities].filter(matches).sort((a,b)=>a.title.localeCompare(b.title));$('results').replaceChildren();$('result-count').textContent=nodes.length;
  if(!nodes.length){const p=document.createElement('div');p.className='empty';p.textContent='Тут поки тихо. Спробуй іншу назву.';$('results').append(p);}
  for(const n of nodes){$('results').append(noteButton(n));}
}
function noteButton(n){const b=document.createElement('button');b.className='result';b.append(document.createTextNode(n.title));const small=document.createElement('small');small.textContent=n.derived?'Спільна служба району':n.available===false?'Джерело недоступне · адресу збережено':`${n.cityRole==='knowledge-library'?'Каталог бібліотеки':n.knowledgeScope==='library'?`${kinds[n.kind]||'Матеріал'} · ${libraryCategories[n.libraryCategory]||n.libraryCategory||'Загальне'}`:n.unit?`Квартира ${n.unit}`:n.cityRoleTitle||kinds[n.kind]||'Нотатка'} · ${n.degree} зв’язків`;b.append(small);b.onclick=()=>{focusNode(n);select(n);};return b;}
function selectFacility(n){
  if(n.function==='market'&&typeof openMarket==='function'){openMarket();return;}
  closeHistory();$('district-panel').hidden=true;++noteRequest;state.selected=n;$('inspector').hidden=false;$('apartment-panel').hidden=true;$('library-source').hidden=true;
  $('note-kind').textContent='СПІЛЬНА ІНФРАСТРУКТУРА';$('note-title').textContent=n.title;$('note-path').textContent='Служба району';
  const d=state.districts.find(d=>d.id===n.district),owner=state.byNode.get(n.owner);
  $('note-district').textContent=d?.title||n.district;$('note-district').style.color=d?.color||'#b7c5d1';
  $('note-metrics').textContent=`Місткість: ${n.capacity} · відкрито ${n.hours[0]}:00–${n.hours[1]}:00`;
  $('read-document').hidden=true;$('note-history').textContent=owner?`Пов’язаний проєкт: ${owner.title}`:'';$('open-obsidian').hidden=true;
  $('note-content').textContent=n.activity?'Відкритий простір району. Мешканці приходять сюди пішки або транспортом; кожен відвідувач має окреме місце.':'Спільний об’єкт тематичного району. Має власну зарезервовану ділянку та пішохідний вхід. Кількість нотаток і мешканців не змінює.';
  $('note-links').replaceChildren(...(owner?[noteButton(owner)]:[]));$('link-count').textContent=owner?'1':'0';showTab('content');
}
async function select(n){
  if(n.derived){selectFacility(n);return;}
  closeHistory();$('district-panel').hidden=true;
  state.selected=n;$('inspector').hidden=false;$('note-title').textContent=n.title;$('note-kind').textContent=n.cityRoleTitle||kinds[n.kind]||'Нотатка';$('note-path').textContent=n.sourcePath||n.id;
  const library=n.model==='grand-library',units=(library?state.nodes.filter(item=>item.cityRole==='library-item'):(n.members||[]).map(id=>state.byId.get(id)).filter(Boolean)).sort((a,b)=>library?a.title.localeCompare(b.title):(a.unit||0)-(b.unit||0));
  $('apartment-panel').hidden=!library&&n.model!=='apartment-tower';$('units-title').textContent=library?`КАТАЛОГ · МАТЕРІАЛІВ: ${units.filter(item=>item.available!==false).length}`:'СЕСІЇ ЦЬОГО БУДИНКУ';$('apartment-units').replaceChildren(...units.map(unit=>noteButton(unit)));
  if(library&&!units.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='Тут з’являтимуться збережені статті, дослідження й довідкові матеріали.';$('apartment-units').append(empty);}
  $('library-source').hidden=!n.librarySource;if(n.librarySource)$('library-source').href=n.librarySource;
  if(n.unit&&!library)$('note-kind').textContent=`Сесія · квартира ${n.unit}`;
  else if(n.importanceTitle)$('note-kind').textContent+=` · ${{core:'Основа кластера',reference:'Основний документ',supporting:'Робоча нотатка',history:'Історія'}[n.importanceTitle]}`;
  const d=state.districts.find(d=>d.id===n.district);$('note-district').textContent=`${icons[d.theme]} ${d.title}`;$('note-district').style.color=d.color;
  $('note-metrics').textContent=n.available===false?'Джерело недоступне · будинок збережено':`${n.words.toLocaleString('uk')} слів · ${n.degree} зв’язків · ${new Date(n.modified*1000).toLocaleDateString('uk')}`;
  $('note-history').textContent=(n.project?`Проєкт: ${state.byId.get(n.project)?.title||n.project}. `:'')+(n.cityTopic?`Тема: ${d.title}. `:'')+(n.cityDistrict==='civic'?'Міська служба; належність і зв’язки джерела збережені. ':'')+(n.history?`Вперше помічено ${new Date(n.history.firstSeen*1000).toLocaleDateString('uk')}. Дата спорудження невідома.${CityPlan.ERAS[n.appearance?.era]?` Епоха: ${CityPlan.ERAS[n.appearance.era].title} (${new Date(n.appearance.bornAt*1000).toLocaleDateString('uk',{month:'long',year:'numeric'})}).`:''}${n.archived?' Архівна нотатка; будинок збережено.':''}${!n.cityTopic&&n.cityDistrict!=='civic'&&n.sourceClass&&n.sourceClass!==n.district?' Клас нотатки змінено; міська адреса залишилася сталою.':''}`:'');
  $('read-document').hidden=n.available===false;$('read-document').disabled=false;$('open-obsidian').hidden=n.available===false;
  $('open-obsidian').href=n.uri;$('link-count').textContent=n.degree;$('note-content').textContent='Відкриваємо нотатку…';$('note-links').replaceChildren();
  const links=state.data.edges.filter(e=>e.includes(n.id)).map(e=>state.byId.get(e.find(id=>id!==n.id))).filter(Boolean);
  links.sort((a,b)=>a.title.localeCompare(b.title)).forEach(node=>$('note-links').append(noteButton(node)));
  if(!links.length){const p=document.createElement('p');p.className='empty';p.textContent='Додай [[посилання]] в Obsidian — і тут з’явиться зв’язок із сусідньою нотаткою.';$('note-links').append(p);}
  showTab('content');const request=++noteRequest;
  if(n.available===false){$('note-content').textContent='Файл зараз відсутній у Brain. Місто зберегло будинок, історію й адресу. Коли джерело повернеться з тією самою унікальною ідентичністю або шляхом, воно знову відкриватиметься тут. Цей будинок не входить до кількості доступних нотаток і мешканців.';return;}
  try{const res=await fetch(`/api/note?path=${encodeURIComponent(n.id)}`);if(!res.ok)throw Error();const note=await res.json();if(request===noteRequest){if(typeof CityReader!=='undefined')CityReader.render($('note-content'),note.content,n,{compact:true});else $('note-content').textContent=note.content.replace(/^---\s*\n[\s\S]*?\n---\s*\n/,'').trim();}}
  catch{if(request===noteRequest)$('note-content').textContent='Не вдалося прочитати файл. Перевір, чи він ще є у сховищі.';}
}
function closeNote(){state.selected=null;noteRequest++;$('inspector').hidden=true;}
function closeDistrict(){$('district-panel').hidden=true;}
function focusFacility(o){focusNode({x:o.x,y:o.y,w:o.w,d:o.d,h:o.h||20,rcx:o.rcx,rcy:o.rcy});}
function focusMarket(){
  // The market stands on the civic square for every district, so going there lifts a district filter.
  const o=state.urban?.scenery.find(o=>o.kind==='service'&&o.function==='article-market');if(!o)return;
  if(state.filter){state.filter=null;closeDistrict();renderDistricts();renderResults();$('view-label').textContent='Ринок статей';}focusFacility(o);
}
function showDistrict(d){
  // What a district holds: its landmark complex with project bays, every project with its notes, and fields.
  closeNote();closeHistory();$('district-panel').hidden=false;
  $('district-title').textContent=`${icons[d.theme]||'◆'} ${d.title}`;$('district-title').style.color=d.color;
  const nodes=state.nodes.filter(n=>n.district===d.id&&n.available!==false),people=(state.urban.residents||[]).filter(r=>state.byNode.get(r.id)?.district===d.id).length;
  const facts=[[d.physicalCount??d.count,'будівель'],[nodes.length,'нотаток'],[people,'мешканців надворі']];
  $('district-facts').replaceChildren(...facts.map(([v,l])=>{const box=document.createElement('div'),b=document.createElement('b'),s=document.createElement('span');b.textContent=v;s.textContent=l;box.append(b,s);return box;}));
  const services=state.urban.scenery.filter(o=>o.kind==='service'&&o.facility&&o.facility.district===d.id),complex=services.filter(o=>!o.facility.annexOf),bays=services.filter(o=>o.facility.annexOf);
  $('district-caption').textContent=complex.length?`Культова споруда: ${complex.map(o=>o.facility.title).join(', ')}${bays.length?` · прибудов проєктів: ${bays.length}`:''}`:'Район без окремої культової споруди.';
  const sections=[],facility=o=>{const b=document.createElement('button');b.className='result';b.append(document.createTextNode(o.facility.title));const s=document.createElement('small');s.textContent=o.facility.annexOf?'Прибудова проєкту до культової споруди':'Культова споруда району';b.append(s);b.onclick=()=>{focusFacility(o);selectFacility({...o.facility,derived:true,physicalId:o.facility.id});};return b;};
  if(services.length){const box=document.createElement('details');box.open=true;const sum=document.createElement('summary');sum.textContent='Споруди району';const n=document.createElement('small');n.textContent=services.length;sum.append(n);box.append(sum,...[...complex,...bays].map(facility));sections.push(box);}
  const groups=new Map();for(const n of nodes){const key=n.project||'';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(n);}
  const order={hub:0,org:0,document:1,note:2,session:3};
  for(const [key,list] of [...groups].sort((a,b)=>b[1].length-a[1].length)){
    const hub=state.byId.get(key),box=document.createElement('details'),sum=document.createElement('summary'),count=document.createElement('small');
    const kindsOf=list.reduce((m,n)=>(m[n.kind]=(m[n.kind]||0)+1,m),{});
    sum.textContent=hub?.title||(key?key.split('/').pop().replace('.md',''):'Без проєкту');count.textContent=`${list.length} · ${[['document','док.'],['note','нот.'],['session','сес.']].filter(([k])=>kindsOf[k]).map(([k,l])=>`${kindsOf[k]} ${l}`).join(' · ')}`;sum.append(count);box.append(sum);
    box.addEventListener('toggle',()=>{if(!box.open||box.dataset.filled)return;box.dataset.filled='1';
      for(const [kind,title] of [['hub','ЦЕНТР'],['document','ДОКУМЕНТИ'],['note','НОТАТКИ'],['session','СЕСІЇ']]){const items=list.filter(n=>(order[n.kind]??2)===order[kind]&&(kind!=='hub'||['hub','org'].includes(n.kind))).sort((a,b)=>a.title.localeCompare(b.title));if(!items.length)continue;
        const head=document.createElement('div');head.className='sub';head.textContent=`${title} · ${items.length}`;box.append(head,...items.map(noteButton));}});
    sections.push(box);}
  const farmed=nodes.filter(n=>n.cityField);
  if(farmed.length){const box=document.createElement('details'),sum=document.createElement('summary'),n=document.createElement('small');sum.textContent='Поля довідкових даних';n.textContent=farmed.length;sum.append(n);box.append(sum,...farmed.map(noteButton));sections.push(box);}
  $('district-sections').replaceChildren(...sections);
}
function closeHistory(){$('city-history').hidden=true;$('toggle-history').setAttribute('aria-pressed','false');if(typeof closePreparation==='function')closePreparation();if(typeof closeMarket==='function')closeMarket();}
function renderHistory(){
  const memory=state.data?.cityState;if(!memory)return;
  $('history-summary').textContent=`${state.data.nodes.length} доступних джерел · ${memory.missingSources.length} збережених адрес без файла.${memory.identityConflicts.length?' Є повторювані ідентифікатори: такі файли залишено окремими будинками.':''}`;
  const labels={cityFounded:'Місто почало вести історію',stateMigrated:'Адреси перенесено до пам’яті міста',sourceAdded:'Новий дім знань',sourceMoved:'Нова назва або шлях — та сама адреса',sourceUpdated:'Знання оновлено',sourceClassChanged:'Нова тема — адресу збережено',sourceMissing:'Джерело відсутнє — будинок збережено',sourceRestored:'Джерело повернулося додому',sourceArchived:'Знання збережено в архіві',sourceActivated:'Нотатка знову активна'};
  const list=$('history-events');list.replaceChildren();
  const events=memory.events.filter(e=>e.type!=='sourceImported').slice(-60).reverse();
  if(!events.length){const p=document.createElement('p');p.className='empty';p.textContent='Місто спокійно живе. Нові зміни з’являться тут.';list.append(p);}
  for(const event of events){const item=document.createElement('button');item.className='result';const title=document.createElement('span');title.textContent=labels[event.type]||'Місто змінилося';const detail=document.createElement('small');detail.textContent=`${new Date(event.observedAt*1000).toLocaleString('uk')} ${event.title?'· '+event.title:''}`;item.append(title,detail);const n=state.nodes.find(n=>n.stableId===event.source);item.disabled=!n;if(n)item.onclick=()=>{focusNode(n);select(n);};list.append(item);}
}
function showTab(tab){$('note-content').hidden=tab!=='content';$('note-links').hidden=tab!=='links';$('tab-content').classList.toggle('active',tab==='content');$('tab-links').classList.toggle('active',tab==='links');}
// The left panel can be hidden (H); views then use the whole screen.
let panelOpen=true;
const panelLeft=(wide,mid,narrow)=>!panelOpen?25:width>850?wide:width>560?mid:narrow;
function fit(){if(!state.districts.length)return;view3d?.fit({left:panelLeft(340,255,205),right:25,top:110,bottom:130});}
function focusDistrict(d){view3d?.focusDistrict(d,{left:panelLeft(340,255,215),right:25,top:120,bottom:120});}
function focusNode(n){view3d?.focusNode(n,{left:panelLeft(330,215,215),right:width>850?365:15});}
function rotateView(step){view3d?.rotate(step);}
function updateZoom(){$('zoom-label').textContent=`${Math.round(state.zoom*100)}%`;}
function zoom(factor,x=width*.6,y=height*.5){view3d?.zoom(factor,x,y);}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,4000);}
function drawEdges(){
  if(!state.data)return;const selected=state.selected||state.hovered;
  if(!state.links&&!selected)return;
  for(const [aid,bid]of state.data.edges){if(!state.links&&aid!==selected.id&&bid!==selected.id)continue;const a=state.byId.get(aid),b=state.byId.get(bid);if(!a||!b)continue;
    const p=project(a.x+a.w/2,a.y+a.d/2,a.h+8),q=project(b.x+b.w/2,b.y+b.d/2,b.h+8),highlight=selected&&(aid===selected.id||bid===selected.id);
    ctx.beginPath();ctx.moveTo(p.x,p.y);const lift=Math.min(150,Math.abs(p.x-q.x)*.15+25);ctx.bezierCurveTo(p.x,p.y-lift,q.x,q.y-lift,q.x,q.y);ctx.strokeStyle=highlight?(state.day?'#618564be':'#d2eab7b0'):(state.day?'#6f8b7c25':'#98bfb32b');ctx.lineWidth=highlight?1.5:.7;ctx.stroke();
    if(highlight){const t=(state.time*.08+hash(aid+bid)%100/100)%1,mt=1-t,tx=mt*mt*mt*p.x+3*mt*mt*t*p.x+3*mt*t*t*q.x+t*t*t*q.x,ty=mt*mt*mt*p.y+3*mt*mt*t*(p.y-lift)+3*mt*t*t*(q.y-lift)+t*t*t*q.y;ctx.fillStyle=state.day?'#668f59':'#e3efc6';ctx.beginPath();ctx.arc(tx,ty,2,0,Math.PI*2);ctx.fill();}
  }
}
function residents(){
  const elapsed=(performance.now()-state.worldAt)/1000,scene=[];
  for(const r of state.urban.residents){const n=state.byNode?.get(r.id);if(!n||!matches(n))continue;
    let x=r.x,y=r.y,left=state.paused||state.reduced?0:r.speed*elapsed,dx=0,dy=1,moving=false;
    for(const [px,py] of r.points){const step=Math.hypot(px-x,py-y);if(step>.001){dx=px-x;dy=py-y;}if(left<step){x+=(px-x)*left/(step||1);y+=(py-y)*left/(step||1);moving=r.speed>0;left=0;break;}left-=step;x=px;y=py;}
    const S=state.urban.scale;scene.push({kind:'resident',x:x*S,y:y*S,node:n,heading:Math.atan2(dy,dx),moving,activity:r.activity});
  }
  return scene;
}
function vehicles(){
  // Buses follow the route ahead the server sent, like residents, instead of jumping at every refresh.
  const elapsed=(performance.now()-state.worldAt)/1000;
  return (state.urban.vehicles||[]).map(v=>{let x=v.x,y=v.y,heading=v.heading||0,left=state.paused||state.reduced?0:(v.speed||0)*elapsed;
    for(const [px,py] of v.points||[]){const step=Math.hypot(px-x,py-y);if(step>.001)heading=Math.atan2(py-y,px-x);if(left<step){x+=(px-x)*left/(step||1);y+=(py-y)*left/(step||1);left=0;break;}left-=step;x=px;y=py;}
    return {...v,x,y,heading};});
}
function pill(text,x,y,size,fill,ink,border){ctx.font=`600 ${size}px -apple-system, sans-serif`;const w=ctx.measureText(text).width+size*1.4,h=size*1.9;ctx.beginPath();ctx.roundRect(x-w/2,y-h/2,w,h,h/2);ctx.fillStyle=fill;ctx.fill();if(border){ctx.strokeStyle=border;ctx.lineWidth=1.5;ctx.stroke();}ctx.fillStyle=ink;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,x,y+.5);ctx.textBaseline='alphabetic';return w;}
function labels(){
  // Only general district names sit on pills in the district colour.
  labelHits=[];const placed=[],free=(x,y,w,h)=>!placed.some(q=>Math.abs(q.x-x)<(q.w+w)/2+4&&Math.abs(q.y-y)<(q.h+h)/2+2);
  for(const d of state.districts){const active=!state.filter||state.filter===d.id;ctx.globalAlpha=active?1:.35;const p=project(d.label.x,d.label.y,0),size=Math.max(11,Math.min(16,13*state.zoom)),text=`${icons[d.theme]} ${d.title}`,w=text.length*size*.62+size*1.4;
    const anchor=p.y;for(let k=1;!free(p.x,p.y,w,size*2.6)&&k<12;k++)p.y=anchor+(k%2?1:-1)*Math.ceil(k/2)*size*2.2;placed.push({x:p.x,y:p.y,w,h:size*2.6});labelHits.push({x:p.x,y:p.y,w,h:size*2.6,d});pill(text,p.x,p.y,size,d.color,'#1d2622');
    ctx.font=`500 ${Math.max(9,Math.min(12,10*state.zoom))}px -apple-system, sans-serif`;ctx.fillStyle=state.day?'#3d4b45':'#e3e7d5';ctx.textAlign='center';ctx.shadowColor=state.day?'#edf1dd':'#1d2a24';ctx.shadowBlur=5;ctx.fillText(`${d.physicalCount??d.count} будівель · ${d.count} нотаток`,p.x,p.y+size*1.65);ctx.shadowBlur=0;
    ctx.globalAlpha=1;}
}
let lastPaint=0,paintMs=0,planVersion=0,labelHits=[];
// District name pills on the map open their district, like the list on the left.
const labelAt=(x,y)=>labelHits.find(l=>Math.abs(x-l.x)<=l.w/2&&Math.abs(y-l.y)<=l.h/2);
// The 3D view draws the city; this canvas carries only labels and links.
let view3d=null;
function show3DError(error){
  if(error)console.error(error);$('render-error').hidden=false;
}
function attach3D(create){
  try{view3d=create({state,overlay:canvas,matches,residents,vehicles,planVersion:()=>planVersion,onZoom:z=>{state.zoom=z;updateZoom();}});}catch(error){show3DError(error);return;}
  view3d.resize(width,height,ratio);$('render-error').hidden=true;
  if(state.districts.length)fit();
}
$('city-renderer').addEventListener('error',()=>show3DError());
function draw(now){
  // One failing frame is recorded for diagnosis and must not stop the animation loop.
  try{paint(now);}catch(error){canvas.dataset.renderError=String(error&&error.stack||error);console.error(error);requestAnimationFrame(draw);}
}
function paint(now){
  if(now-lastPaint<32){requestAnimationFrame(draw);return;}lastPaint=now;
  const paintStart=performance.now(),delta=lastFrame?Math.min((now-lastFrame)/1000,.1):0;lastFrame=now;if(!state.paused&&!state.reduced)state.time+=delta;
  ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);
  if(view3d){view3d.frame(now);if(state.data){drawEdges();labels();}}
  paintMs=paintMs*.9+(performance.now()-paintStart)*.1;canvas.dataset.renderMs=paintMs.toFixed(1);requestAnimationFrame(draw);
}
function resize(){width=innerWidth;height=innerHeight;ratio=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);view3d?.resize(width,height,ratio);if(initialized)fit();}
function hit(x,y){return view3d?.hit(x,y)||null;}
let pointer=null;
canvas.addEventListener('pointerdown',e=>{pointer={x:e.clientX,y:e.clientY,moved:false};canvas.setPointerCapture(e.pointerId);$('tooltip').hidden=true;});
canvas.addEventListener('pointermove',e=>{
  if(pointer){const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;if(Math.abs(dx)+Math.abs(dy)>4)pointer.moved=true;if(pointer.moved){state.dragging=true;}return;}
  const label=labelAt(e.clientX,e.clientY);if(label){state.hovered=null;canvas.style.cursor='pointer';$('tooltip').hidden=true;return;}
  const h=hit(e.clientX,e.clientY);state.hovered=h?.node||null;canvas.style.cursor=h?'pointer':'grab';const tip=$('tooltip');tip.hidden=!h;if(h){tip.replaceChildren(document.createTextNode(h.node.title));const small=document.createElement('small');small.textContent=h.field?'Поле довідкових даних проєкту · натисни, щоб відкрити':h.node.function==='article-market'?'Свіжі статті · натисни, щоб зайти на ринок':h.node.derived?'Спільна служба району · натисни, щоб відкрити':`${h.person?'Мешканець':'Будівля'} · ${h.node.degree} зв’язків · натисни, щоб відкрити`;tip.append(small);tip.style.left=`${Math.max(8,Math.min(width-285,e.clientX+16))}px`;tip.style.top=`${Math.min(height-90,e.clientY+15)}px`;}
});
canvas.addEventListener('pointerup',e=>{if(pointer&&!pointer.moved){const label=labelAt(e.clientX,e.clientY);if(label){openDistrict(label.d,false);pointer=null;state.dragging=false;return;}const h=hit(e.clientX,e.clientY);if(h?.node.function==='article-market'&&typeof openMarket==='function')openMarket();else if(h)select(h.node);else closeNote();}pointer=null;state.dragging=false;});
canvas.addEventListener('pointercancel',()=>{pointer=null;state.dragging=false;});
canvas.addEventListener('pointerleave',()=>{state.hovered=null;$('tooltip').hidden=true;});
canvas.addEventListener('dblclick',e=>{const h=hit(e.clientX,e.clientY);if(h?.node.uri)location.href=h.node.uri;});
canvas.addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(-e.deltaY*.0012),e.clientX,e.clientY);},{passive:false});
$('search').addEventListener('input',e=>{state.query=e.target.value.trim().toLocaleLowerCase();renderResults();});
$('reset-filter').onclick=()=>{closeDistrict();state.filter=null;state.query='';$('search').value='';renderDistricts();renderResults();fit();$('view-label').textContent='Огляд міста';};
$('open-library').onclick=()=>{const n=state.nodes.find(item=>item.cityRole==='knowledge-library'&&item.available!==false);if(n){state.filter=null;state.query='';$('search').value='';renderDistricts();renderResults();focusNode(n);select(n);}else toast('Бібліотека ще не додана до цього сховища.');};
$('read-document').onclick=()=>{if(state.selected&&!state.selected.derived&&state.selected.available!==false)CityReader.open(state.selected);};
if(typeof CityReader!=='undefined')CityReader.configure({nodes:()=>state.nodes});
$('close-note').onclick=()=>{closeNote();if(state.filter&&$('district-sections').childElementCount)$('district-panel').hidden=false;};$('close-district').onclick=closeDistrict;$('tab-content').onclick=()=>showTab('content');$('tab-links').onclick=()=>showTab('links');
$('close-history').onclick=closeHistory;$('toggle-history').onclick=()=>{const open=$('city-history').hidden;closeNote();if(typeof closePreparation==='function')closePreparation();$('city-history').hidden=!open;$('toggle-history').setAttribute('aria-pressed',String(open));};
$('fit').onclick=()=>{state.filter?focusDistrict(state.districts.find(d=>d.id===state.filter)):fit();};$('zoom-in').onclick=()=>zoom(1.25);$('rotate-left').onclick=()=>rotateView(-1);$('rotate-right').onclick=()=>rotateView(1);$('zoom-out').onclick=()=>zoom(.8);
const PANEL_KEY='brain-city-panel';
function setPanel(open,remember=true){panelOpen=open;document.body.classList.toggle('hud-hidden',!open);$('toggle-panel').setAttribute('aria-pressed',String(open));$('toggle-panel').title=open?'Сховати панель (H)':'Показати панель (H)';if(remember)try{localStorage.setItem(PANEL_KEY,open?'open':'hidden');}catch{}}
try{setPanel(localStorage.getItem(PANEL_KEY)!=='hidden',false);}catch{setPanel(true,false);}
$('toggle-panel').onclick=()=>setPanel(!panelOpen);
$('toggle-links').onclick=()=>{state.links=!state.links;$('toggle-links').setAttribute('aria-pressed',String(state.links));};
$('pause').onclick=()=>{state.paused=!state.paused;$('pause').setAttribute('aria-pressed',String(state.paused));$('pause').textContent=state.paused?'▷':'Ⅱ';$('pause').title=state.paused?'Продовжити рух':'Призупинити рух';};
const CLOCK_CHECK_MS=30000;
let clockDay=null,solarLocation=null,locationRequestedAt=0,locationPending=false;
let locationStatus='Очікуємо системну геолокацію для визначення світлового дня.';
// Solar position adapted from SunCalc 1.9.0, Vladimir Agafonkin (BSD-2-Clause, vendor/suncalc-LICENSE).
function solarDay(date,latitude,longitude){
  const rad=Math.PI/180,d=date.valueOf()/86400000-10957.5;
  const m=rad*(357.5291+.98560028*d),l=m+rad*(1.9148*Math.sin(m)+.02*Math.sin(2*m)+.0003*Math.sin(3*m)+102.9372)+Math.PI;
  const e=rad*23.4397,dec=Math.asin(Math.sin(l)*Math.sin(e)),ra=Math.atan2(Math.sin(l)*Math.cos(e),Math.cos(l));
  const h=rad*(280.16+360.9856235*d+longitude)-ra,phi=rad*latitude;
  return Math.asin(Math.sin(phi)*Math.sin(dec)+Math.cos(phi)*Math.cos(dec)*Math.cos(h))>=rad*(-.833);
}
function setDay(day){
  state.day=day;document.body.classList.toggle('day',day);$('day').querySelector('span').textContent=day?'Денне місто':'Нічне місто';
  $('day').title=locationStatus;
}
function syncDayNight(date=new Date()){
  if(!solarLocation)return;
  const day=solarDay(date,solarLocation.latitude,solarLocation.longitude);
  if(day!==clockDay){clockDay=day;setDay(day);}
}
function receiveCityLocation(payload){
  locationPending=false;
  if(payload&&Number.isFinite(payload.latitude)&&Math.abs(payload.latitude)<=90&&Number.isFinite(payload.longitude)&&Math.abs(payload.longitude)<=180){
    solarLocation={latitude:payload.latitude,longitude:payload.longitude};
    locationStatus='День і ніч за сходом та заходом Сонця у системному місці розташування. Ручний вибір діє до наступної зміни дня / ночі.';
    syncDayNight();
  }else locationStatus=(payload?.error||'Системна геолокація недоступна.')+' Натисни, щоб повторити. Доступне ручне перемикання.';
  $('day').title=locationStatus;
}
function requestCityLocation(force=false){
  const now=Date.now();if(locationPending||(!force&&now-locationRequestedAt<3600000))return;
  locationRequestedAt=now;locationPending=true;
  if(window.webkit?.messageHandlers?.cityLocation)window.webkit.messageHandlers.cityLocation.postMessage('request');
  else if(typeof navigator!=='undefined'&&navigator.geolocation)navigator.geolocation.getCurrentPosition(p=>receiveCityLocation(p.coords),()=>receiveCityLocation({error:'Дозволь доступ до геолокації для дня й ночі за Сонцем.'}),{enableHighAccuracy:false,maximumAge:900000,timeout:15000});
  else receiveCityLocation({error:'Системна геолокація недоступна.'});
  setTimeout(()=>{if(locationPending&&locationRequestedAt===now)receiveCityLocation({error:'Системна геолокація поки не відповідає.'});},20000);
}
$('day').onclick=()=>{setDay(!state.day);if(!solarLocation)requestCityLocation(true);};
addEventListener('city-location',e=>receiveCityLocation(e.detail));
setDay(matchMedia('(prefers-color-scheme: light)').matches);requestCityLocation();
setInterval(()=>{syncDayNight();requestCityLocation();},CLOCK_CHECK_MS);
addEventListener('focus',()=>{syncDayNight();requestCityLocation();});document.addEventListener('visibilitychange',()=>{syncDayNight();if(!document.hidden)requestCityLocation();});
document.addEventListener('keydown',e=>{if($('document-reader').open===true)return;if(e.key==='Escape'){closeNote();closeHistory();closeDistrict();$('search').blur();}if(e.key==='/'&&document.activeElement.tagName!=='INPUT'){e.preventDefault();$('search').focus();}if(document.activeElement.tagName==='INPUT')return;if(e.key==='+'||e.key==='=')zoom(1.2);if(e.key==='-')zoom(.8);if(e.key==='0')fit();if(e.key==='h'||e.key==='р')setPanel(!panelOpen);if(e.key==='q'||e.key==='й')rotateView(-1);if(e.key==='e'||e.key==='у')rotateView(1);});
// Geometry is fetched only when its revision changes (ETag / 304); every refresh carries just the live agents.
function applyLive(){if(state.urban&&state.live){state.urban.residents=state.live.residents;state.urban.vehicles=state.live.vehicles;}}
async function refresh(){try{
  const [res,live]=await Promise.all([fetch('/api/city',{headers:state.cityTag?{'If-None-Match':state.cityTag}:{}}),fetch('/api/world/live')]);
  let data=state.data;
  if(res.status!==304){if(!res.ok)throw Error();data=await res.json();state.cityTag=res.headers.get('ETag');}
  if(live.ok){const current=await live.json();let geometry=false;
    if(!state.world||current.staticRevision!==state.world.staticRevision){const st=await fetch('/api/world/static',{headers:state.staticTag?{'If-None-Match':state.staticTag}:{}});if(st.ok){state.world=await st.json();state.staticTag=st.headers.get('ETag');geometry=true;}}
    state.live=current;state.worldAt=performance.now();
    if(geometry||data!==state.data)prepare(data,data===state.data);else applyLive();}
  else throw Error('City world is unavailable');
  $('sync').textContent='Синхронізовано з Brain';$('sync').classList.remove('error');}catch{$('sync').textContent='З’єднання з Brain перерване';$('sync').classList.add('error');}finally{setTimeout(refresh,5000);}}
addEventListener('resize',resize);resize();requestAnimationFrame(draw);refresh();
