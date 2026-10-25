/* Brain City: local, dependency-free isometric atlas. */
'use strict';
const $ = id => document.getElementById(id);
const canvas = $('city'), screen = canvas.getContext('2d');
let ctx = screen;
const state = {data:null, world:null, worldAt:0, nodes:[], districts:[], byId:new Map(), selected:null, hovered:null, filter:null, query:'', links:false, paused:false, day:false, zoom:1, camera:{x:0,y:0}, hits:[], time:0, dragging:false, reduced:matchMedia('(prefers-reduced-motion: reduce)').matches};
let width=innerWidth, height=innerHeight, ratio=1, initialized=false, lastFrame=0, noteRequest=0, elevation=0, frame=null;
const libraryCategories={general:'Загальне','general-knowledge':'Загальні знання',science:'Наука',technology:'Технології',sport:'Спорт',sports:'Спорт',energy:'Енергетика',culture:'Культура'};
const kinds={article:'Стаття',hub:'Центр кварталу',org:'Штаб організації',class:'Районна управа',note:'Дім ідей',document:'Бібліотека',session:'Майстерня спогадів'};
const icons={observatory:'✧',workspace:'▥',academy:'⌂',studio:'◇',garden:'♧',library:'▤',civic:'⚑',sports:'⚽'};
const hash = str => {let h=2166136261;for(const c of str){h^=c.codePointAt(0);h=Math.imul(h,16777619);}return h>>>0;};
const iso = (x,y,z=0) => ({x:(x-y)*.866,y:(x+y)*.433-z});
// The map turns in quarter turns about the plaza. Models are drawn axis-aligned from a turned copy (modelSpace),
// so their visible faces stay the ones facing the camera; all other geometry is turned point by point here.
const view={q:0};let modelSpace=false;
const turn = (x,y,q=view.q) => q===1?{x:-y,y:x}:q===2?{x:-x,y:-y}:q===3?{x:y,y:-x}:{x,y};
const project = (x,y,z=0) => {if(view3d?.active)return view3d.project(x,y,z+elevation);if(frame){const dx=x-frame.cx,dy=y-frame.cy;x=frame.cx+dx*frame.cos-dy*frame.sin;y=frame.cy+dx*frame.sin+dy*frame.cos;}if(view.q&&!modelSpace)({x,y}=turn(x,y));const p=iso(x,y,z+elevation);return {x:p.x*state.zoom+state.camera.x,y:p.y*state.zoom+state.camera.y};};
// Shaded colours repeat across thousands of faces per frame; parse each (colour, factor) pair once.
const tints=new Map(),TINT_CACHE=4096;
const tint = (color,factor) => {const cacheKey=color+'|'+factor;let value=tints.get(cacheKey);if(value)return value;const n=color.startsWith('#')?parseInt(color.slice(1),16):0;const channels=color.startsWith('#')?[n>>16,(n>>8)&255,n&255]:color.match(/[\d.]+/g).slice(0,3).map(Number);value=`rgb(${channels.map(c=>Math.min(255,Math.max(0,Math.round(c*factor)))).join(',')})`;if(tints.size>TINT_CACHE)tints.clear();tints.set(cacheKey,value);return value;};
function polygon(points,fill,stroke){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=.7;ctx.stroke();}}
function quad(x,y,w,d,z,fill,stroke){polygon([project(x,y,z),project(x+w,y,z),project(x+w,y+d,z),project(x,y+d,z)],fill,stroke);}
function lineWorld(points,color,lineWidth=1,dash=[]){ctx.lineJoin='round';ctx.lineCap='round';ctx.beginPath();points.forEach((p,i)=>{const s=project(p.x,p.y,p.z||0);i?ctx.lineTo(s.x,s.y):ctx.moveTo(s.x,s.y);});ctx.strokeStyle=color;ctx.lineWidth=lineWidth;ctx.setLineDash(dash);ctx.stroke();ctx.setLineDash([]);}
function box(x,y,w,d,h,color,roof,z=0){
  polygon([project(x,y+d,z),project(x+w,y+d,z),project(x+w,y+d,z+h),project(x,y+d,z+h)],tint(color,state.day?.72:.55));
  polygon([project(x+w,y,z),project(x+w,y+d,z),project(x+w,y+d,z+h),project(x+w,y,z+h)],tint(color,state.day?.88:.72));
  quad(x,y,w,d,z+h,roof||tint(color,state.day?1.14:1.02),tint(color,1.12));
}
const details=CityDetails.create({ctx,project,box,quad,lineWorld,tint,state,hash});
function tree(x,y,size,seed){details.tree(x,y,size,seed);}
// Buildings follow their street: the whole model is drawn in a frame rotated about its centre.
function rotation(o){return o.rot?{cx:o.rcx,cy:o.rcy,cos:Math.cos(o.rot),sin:Math.sin(o.rot)}:null;}
function building(n){
  elevation=14;frame=rotation(n);
  const {x,y,w,d,color}=n;let h=n.h;const selected=state.selected?.id===n.id||(n.physicalId&&state.selected?.physicalId===n.physicalId),hovered=state.hovered?.id===n.id;
  const memberNodes=(n.members||[]).map(id=>state.byId.get(id)).filter(Boolean),active=matches(n)||memberNodes.some(matches),hitNode=state.query?(memberNodes.find(matches)||n):n,fade=active?(n.available===false?.4:1):.16;ctx.globalAlpha=fade;
  // Construction stages: a staked plot, then scaffolding, before the finished house opens.
  if(n.lifecycle==='reserved'||n.lifecycle==='connected'||n.lifecycle==='construction'){
    quad(x-4,y-4,w+8,d+8,0,state.day?'#c9bf9f':'#4d5546',state.day?'#8c8266':'#a39a7c');
    if(n.lifecycle==='construction'){h=h*.45;box(x,y,w,d,h,'#b9b2a2');for(const [px,py] of [[x,y],[x+w,y],[x,y+d],[x+w,y+d]])lineWorld([{x:px,y:py},{x:px,y:py,z:h+10}],'#8a7a5c',Math.max(.7,1.4*state.zoom));lineWorld([{x,y:y+d,z:h+8},{x:x+w,y:y+d,z:h+8}],'#8a7a5c',Math.max(.7,1.4*state.zoom));}
    const top=project(x+w/2,y+d/2,h+10),base=project(x+w/2,y+d/2);
    if(active&&collectHits)state.hits.push({node:hitNode,x:base.x,y:(top.y+base.y)/2,rx:Math.max(7,w*state.zoom*.9),ry:Math.max(10,(base.y-top.y)/2+d*state.zoom*.48),person:false});
    ctx.globalAlpha=1;elevation=0;frame=null;return;
  }
  // A path to the doorstep and a little private garden.
  quad(x-7,y-7,w+14,d+14,0,state.day?'#bbc6ae':'#34463e');
  quad(x+w*.45,y+d,w*.18,25,0,state.day?'#c3c7b6':'#5a6256');
  if(selected||hovered){quad(x-11,y-11,w+22,d+22,1,`${color}38`,color);}
  polygon([project(x,y+d),project(x+w+24,y+d+7),project(x+w+24,y+d+26),project(x+15,y+d+30)],'#07121745');
  if(!details.signatureBuilding(n)){
  if(n.model==='college'){
    box(x,y,w,d*.3,h,color);box(x,y+d*.3,w*.24,d*.7,h,color);box(x+w*.76,y+d*.3,w*.24,d*.7,h,color);quad(x+w*.25,y+d*.32,w*.5,d*.65,1,state.day?'#9eaf82':'#5a7453');
  }else box(x,y,w,d,h,color);
  if(n.model==='apartment-tower'){
    for(let floor=1;floor<6;floor++){box(x,y+d*.86,w,d*.14,3,tint(color,.78),undefined,floor*h/6);lineWorld([{x,y:y+d,z:floor*h/6+5},{x:x+w,y:y+d,z:floor*h/6+5}],tint(color,1.3),Math.max(1,state.zoom));}
    box(x+w*.15,y+d*.15,w*.7,d*.7,5,tint(color,.7),undefined,h);
  } else if(['manor','sports-institute','research-institute','training-hall'].includes(n.model)){
    quad(x-2,y-2,w+4,d+4,h+1,n.model==='sports-institute'||n.model==='training-hall'?'#679b75':tint(color,.75));
    for(let i=1;i<4;i++)box(x+w*i/4-2,y+d,4,4,h*.85,tint(color,1.25));
    if(n.model==='manor'){const a=project(x-3,y+d/2,h+20),b=project(x+w+3,y+d/2,h+20);polygon([project(x-3,y-3,h),project(x+w+3,y-3,h),b,a],tint(n.roof,1.18));polygon([a,b,project(x+w+3,y+d+3,h),project(x-3,y+d+3,h)],n.roof);}
    if(n.model==='research-institute'){box(x+w*.2,y+d*.2,w*.6,d*.5,12,'#b5d0d7',undefined,h);quad(x+w*.25,y+d*.24,w*.5,d*.4,h+13,'#73aebc');}
    if(n.model==='sports-institute'||n.model==='training-hall'){quad(x+w*.15,y+d*.15,w*.7,d*.7,h+2,'#e9ead0');quad(x+w*.19,y+d*.19,w*.62,d*.62,h+3,'#679b75');}
  } else if(['town-hall','district-hall'].includes(n.model)){
    box(x+w*.37,y+d*.25,w*.26,d*.45,30,tint(color,1.12),undefined,h);
    const p=project(x+w*.5,y+d*.7,h+20);ctx.fillStyle='#fff3cd';ctx.beginPath();ctx.arc(p.x,p.y,5*state.zoom,0,Math.PI*2);ctx.fill();
    lineWorld([{x:x+w*.5,y:y+d*.5,z:h+30},{x:x+w*.5,y:y+d*.5,z:h+55}],'#d0c3a5',Math.max(1,state.zoom));polygon([project(x+w*.5,y+d*.5,h+55),project(x+w*.5+16,y+d*.5,h+49),project(x+w*.5,y+d*.5,h+43)],n.accent);
  } else if(['council','project-council','registry'].includes(n.model)){
    for(let i=1;i<5;i++)box(x+w*i/5-2,y+d,4,4,h*.9,tint(color,1.22));
    polygon([project(x-3,y+d+4,h),project(x+w+3,y+d+4,h),project(x+w/2,y+d+4,h+18)],tint(color,1.15));
    quad(x-3,y-3,w+6,d+6,h+1,tint(color,.8));
  } else if(['cottage','timber-house','townhouse','merchant-house','clock-house','atelier','maker-house','greenhouse'].includes(n.model)){
    const p1=project(x-3,y+d/2,h+20),p2=project(x+w+3,y+d/2,h+20);
    const roof=n.roof&&n.model!=='greenhouse'?n.roof:n.model==='greenhouse'?'#8cbdb4':n.theme==='studio'?'#a36962':n.theme==='library'?'#977a68':n.theme==='garden'?'#748e78':'#798c8b';
    polygon([project(x-3,y-3,h),project(x+w+3,y-3,h),p2,p1],tint(roof,1.18));
    polygon([p1,p2,project(x+w+3,y+d+3,h),project(x-3,y+d+3,h)],roof);
    if(n.model==='greenhouse'){for(let i=1;i<6;i++)lineWorld([{x:x+w*i/6,y:y-2,z:h},{x:x+w*i/6,y:y+d/2,z:h+20},{x:x+w*i/6,y:y+d+2,z:h}],tint(color,1.4),Math.max(.7,state.zoom));}
    else if(state.zoom>=ORNAMENT_ZOOM)box(x+w*.7,y+d*.2,6,8,18,'#8c7e70','#b1a28d',h);
    if(n.model==='timber-house'){for(let i=1;i<4;i++)lineWorld([{x:x+w*i/4,y:y+d+.5,z:0},{x:x+w*i/4,y:y+d+.5,z:h}],tint(color,.47),Math.max(.7,2*state.zoom));lineWorld([{x,y:y+d+.6,z:h*.48},{x:x+w,y:y+d+.6,z:h*.48}],tint(color,.47),Math.max(.7,2*state.zoom));}
    if(n.model==='clock-house'){box(x+w*.37,y+d*.3,w*.27,d*.4,24,tint(color,1.12),undefined,h+5);const p=project(x+w*.5,y+d*.7,h+23);ctx.fillStyle='#f1e7c8';ctx.beginPath();ctx.arc(p.x,p.y,5*state.zoom,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#647161';ctx.lineWidth=Math.max(.6,state.zoom);ctx.beginPath();ctx.moveTo(p.x,p.y-3*state.zoom);ctx.lineTo(p.x,p.y);ctx.lineTo(p.x+2*state.zoom,p.y);ctx.stroke();}
    if(n.model==='maker-house')quad(x+w*.12,y+d*.62,w*.6,d*.25,h+12,'#5b8291','#aac1be');
  } else if(n.model==='observatory'){
    box(x+w*.18,y+d*.18,w*.64,d*.64,8,tint(color,.85),undefined,h);
    const p=project(x+w*.5,y+d*.5,h+12),r=w*.31*state.zoom;
    ctx.beginPath();ctx.ellipse(p.x,p.y,r,r*.8,0,Math.PI,0);ctx.lineTo(p.x+r,p.y);ctx.fillStyle=tint(color,1.22);ctx.fill();
    lineWorld([{x:x+w*.5,y:y+d*.5,z:h+12},{x:x+w*.5,y:y+d*.5,z:h+39}],tint(color,1.3),Math.max(.8,state.zoom*1.5));
    const led=project(x+w*.5,y+d*.5,h+39);ctx.fillStyle=state.day?color:'#f1dbaa';ctx.beginPath();ctx.arc(led.x,led.y,Math.max(1,2*state.zoom),0,Math.PI*2);ctx.fill();
  } else if(['college','laboratory','library-wing','archive','city-archive'].includes(n.model)){
    if(n.model!=='college')box(x-4,y-4,w+8,d+8,5,tint(color,.9),undefined,h);
    if(n.model==='college'){for(const side of [0,.78])for(let i=0;i<2;i++)box(x+w*side,y+d*.45+i*10,w*.22,3,5,tint(color,.85),undefined,h);}
    else{quad(x+7,y+7,w-14,d-14,h+1,tint(color,.7));}
    if(n.model==='archive'||n.model==='city-archive'||n.model==='library-wing'){for(let i=1;i<5;i++)box(x+w*i/5-2,y+d,4,5,h*.8,tint(color,1.22));}
    if(n.model==='laboratory'){box(x+w*.2,y+d*.2,w*.6,d*.4,8,'#b7c7c3',undefined,h);quad(x+w*.25,y+d*.25,w*.5,d*.3,h+9,'#80a9b3');}
  } else if(n.model==='theatre'){
    box(x+w*.15,y+d*.15,w*.7,d*.7,11,tint(color,1.13),undefined,h);
    const p=project(x+w*.5,y+d*.5,h+30);ctx.fillStyle=tint(color,1.4);ctx.beginPath();ctx.arc(p.x,p.y,6*state.zoom,0,Math.PI*2);ctx.fill();
    box(x-5,y+d*.75,w+10,d*.32,5,'#b78180',undefined,h*.4);
    lineWorld([{x:x+w*.7,y:y+d*.5,z:h+8},{x:x+w*.7,y:y+d*.5,z:h+40}],'#d0c3a5',Math.max(1,state.zoom));polygon([project(x+w*.7,y+d*.5,h+40),project(x+w*.7+18,y+d*.5,h+34),project(x+w*.7,y+d*.5,h+28)],'#d299a5');
  } else if(n.model==='workshop'){
    for(let i=0;i<3;i++){const sy=y+i*d/3;polygon([project(x,sy,h),project(x+w,sy,h),project(x+w,sy+d/6,h+12),project(x,sy+d/6,h+12)],'#8a9992');polygon([project(x,sy+d/6,h+12),project(x+w,sy+d/6,h+12),project(x+w,sy+d/3,h),project(x,sy+d/3,h)],'#9fc1c3');}box(x+w*.8,y+d*.25,7,8,28,'#a08b79',undefined,h);
  } else if(n.model==='headquarters'||n.model==='data-tower'){
    box(x+w*.1,y+d*.1,w*.8,d*.8,18,tint(color,1.06),undefined,h);box(x+w*.24,y+d*.24,w*.52,d*.52,12,'#92a9ae',undefined,h+18);
    lineWorld([{x:x+w*.5,y:y+d*.5,z:h+30},{x:x+w*.5,y:y+d*.5,z:h+58}],'#c0c9c3',Math.max(.8,state.zoom));
  } else{
    box(x+w*.15,y+d*.1,w*.7,d*.45,7,tint(color,.82),undefined,h);
    quad(x+w*.2,y+d*.16,w*.55,d*.3,h+8,state.day?'#779ca1':'#668a94');
  }
  // Door, awnings and mullions are ornaments: below ORNAMENT_ZOOM they are a few pixels and are skipped.
  if(state.zoom>=ORNAMENT_ZOOM){
  polygon([project(x+w*.45,y+d+.5,0),project(x+w*.61,y+d+.5,0),project(x+w*.61,y+d+.5,13),project(x+w*.45,y+d+.5,13)],state.day?'#4d665b':'#253b38');
  if(['atelier','townhouse','merchant-house','terrace'].includes(n.model)){quad(x-2,y+d+2,w+4,12,17,n.accent);for(let i=0;i<4;i++)quad(x+i*w/4,y+d+2,w/8,12,17,'#eee2c1');}
  if(n.model==='office'||n.model==='headquarters'){for(let i=1;i<4;i++)lineWorld([{x:x+w*i/4,y:y+d+.7,z:18},{x:x+w*i/4,y:y+d+.7,z:h-7}],'#88a3aa',Math.max(1,3*state.zoom));}
  }
  details.facade(n,h);
  }
  if(selected||hovered){const p=project(x+w/2,y+d/2,h+48);ctx.beginPath();ctx.moveTo(p.x,p.y+7);ctx.lineTo(p.x-4,p.y);ctx.lineTo(p.x+4,p.y);ctx.closePath();ctx.fillStyle=color;ctx.fill();}
  const top=project(x+w/2,y+d/2,h+10),base=project(x+w/2,y+d/2);
  if(active&&collectHits)state.hits.push({node:hitNode,x:base.x,y:(top.y+base.y)/2,rx:Math.max(7,w*state.zoom*.9),ry:Math.max(10,(base.y-top.y)/2+d*state.zoom*.48),person:false});
  ctx.globalAlpha=1;elevation=0;frame=null;
}
function matches(n){return (!state.filter||n.district===state.filter)&&(!state.query||`${n.title} ${n.sourcePath||n.id} ${n.summary||''} ${n.libraryCategory||''}`.toLocaleLowerCase().includes(state.query));}
function prepare(data,worldOnly=false){
  const prior=state.data;state.data=data;
  const source={...data,nodes:[...data.nodes,...(data.cityState?.missingSources||[])]},plan=state.world?CityPlan.fromWorld(source,state.world):CityPlan.plan(source);planVersion++;if(state.live){plan.residents=state.live.residents;plan.vehicles=state.live.vehicles;}state.districts=plan.districts;state.nodes=plan.sources||plan.nodes;state.urban=plan;
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
  for(const d of state.districts){const b=document.createElement('button');b.className='district'+(state.filter===d.id?' active':'');b.setAttribute('aria-pressed',String(state.filter===d.id));const dot=document.createElement('span');dot.className='dot';dot.style.color=d.color;dot.style.background=d.color;const name=document.createElement('span');name.textContent=d.title;const count=document.createElement('span');count.className='count';count.textContent=d.count;b.append(dot,name,count);b.onclick=()=>{state.filter=state.filter===d.id?null:d.id;renderDistricts();renderResults();state.filter?focusDistrict(d):fit();$('view-label').textContent=state.filter?d.title:'Огляд міста';};nav.append(b);}
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
  closeHistory();++noteRequest;state.selected=n;$('inspector').hidden=false;$('apartment-panel').hidden=true;$('library-source').hidden=true;
  $('note-kind').textContent='СПІЛЬНА ІНФРАСТРУКТУРА';$('note-title').textContent=n.title;$('note-path').textContent='Служба району';
  const d=state.districts.find(d=>d.id===n.district),owner=state.byNode.get(n.owner);
  $('note-district').textContent=d?.title||n.district;$('note-district').style.color=d?.color||'#b7c5d1';
  $('note-metrics').textContent=`Місткість: ${n.capacity} · відкрито ${n.hours[0]}:00–${n.hours[1]}:00`;
  $('note-history').textContent=owner?`Пов’язаний проєкт: ${owner.title}`:'';$('open-obsidian').hidden=true;
  $('note-content').textContent=n.activity?'Відкритий простір району. Мешканці приходять сюди пішки або транспортом; кожен відвідувач має окреме місце.':'Спільний об’єкт тематичного району. Має власну зарезервовану ділянку та пішохідний вхід. Кількість нотаток і мешканців не змінює.';
  $('note-links').replaceChildren(...(owner?[noteButton(owner)]:[]));$('link-count').textContent=owner?'1':'0';showTab('content');
}
async function select(n){
  if(n.derived){selectFacility(n);return;}
  closeHistory();
  state.selected=n;$('inspector').hidden=false;$('note-title').textContent=n.title;$('note-kind').textContent=n.cityRoleTitle||kinds[n.kind]||'Нотатка';$('note-path').textContent=n.sourcePath||n.id;
  const library=n.model==='grand-library',units=(library?state.nodes.filter(item=>item.cityRole==='library-item'):(n.members||[]).map(id=>state.byId.get(id)).filter(Boolean)).sort((a,b)=>library?a.title.localeCompare(b.title):(a.unit||0)-(b.unit||0));
  $('apartment-panel').hidden=!library&&n.model!=='apartment-tower';$('units-title').textContent=library?`КАТАЛОГ · МАТЕРІАЛІВ: ${units.filter(item=>item.available!==false).length}`:'СЕСІЇ ЦЬОГО БУДИНКУ';$('apartment-units').replaceChildren(...units.map(unit=>noteButton(unit)));
  if(library&&!units.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='Тут з’являтимуться збережені статті, дослідження й довідкові матеріали.';$('apartment-units').append(empty);}
  $('library-source').hidden=!n.librarySource;if(n.librarySource)$('library-source').href=n.librarySource;
  if(n.unit&&!library)$('note-kind').textContent=`Сесія · квартира ${n.unit}`;
  else if(n.importanceTitle)$('note-kind').textContent+=` · ${{core:'Основа кластера',reference:'Основний документ',supporting:'Робоча нотатка',history:'Історія'}[n.importanceTitle]}`;
  const d=state.districts.find(d=>d.id===n.district);$('note-district').textContent=`${icons[d.theme]} ${d.title}`;$('note-district').style.color=d.color;
  $('note-metrics').textContent=n.available===false?'Джерело недоступне · будинок збережено':`${n.words.toLocaleString('uk')} слів · ${n.degree} зв’язків · ${new Date(n.modified*1000).toLocaleDateString('uk')}`;
  $('note-history').textContent=(n.project?`Проєкт: ${state.byId.get(n.project)?.title||n.project}. `:'')+(n.cityTopic?`Тема: ${d.title}. `:'')+(n.cityDistrict==='civic'?'Міська служба; належність і зв’язки джерела збережені. ':'')+(n.history?`Вперше помічено ${new Date(n.history.firstSeen*1000).toLocaleDateString('uk')}. Дата спорудження невідома.${n.archived?' Архівна нотатка; будинок збережено.':''}${!n.cityTopic&&n.cityDistrict!=='civic'&&n.sourceClass&&n.sourceClass!==n.district?' Клас нотатки змінено; міська адреса залишилася сталою.':''}`:'');
  $('open-obsidian').hidden=n.available===false;
  $('open-obsidian').href=n.uri;$('link-count').textContent=n.degree;$('note-content').textContent='Відкриваємо нотатку…';$('note-links').replaceChildren();
  const links=state.data.edges.filter(e=>e.includes(n.id)).map(e=>state.byId.get(e.find(id=>id!==n.id))).filter(Boolean);
  links.sort((a,b)=>a.title.localeCompare(b.title)).forEach(node=>$('note-links').append(noteButton(node)));
  if(!links.length){const p=document.createElement('p');p.className='empty';p.textContent='Додай [[посилання]] в Obsidian — і тут з’явиться зв’язок із сусідньою нотаткою.';$('note-links').append(p);}
  showTab('content');const request=++noteRequest;
  if(n.available===false){$('note-content').textContent='Файл зараз відсутній у Brain. Місто зберегло будинок, історію й адресу. Коли джерело повернеться з тією самою унікальною ідентичністю або шляхом, воно знову відкриватиметься тут. Цей будинок не входить до кількості доступних нотаток і мешканців.';return;}
  try{const res=await fetch(`/api/note?path=${encodeURIComponent(n.id)}`);if(!res.ok)throw Error();const note=await res.json();if(request===noteRequest)$('note-content').textContent=note.content.replace(/^---\s*\n[\s\S]*?\n---\s*\n/,'').trim();}
  catch{if(request===noteRequest)$('note-content').textContent='Не вдалося прочитати файл. Перевір, чи він ще є у сховищі.';}
}
function closeNote(){state.selected=null;noteRequest++;$('inspector').hidden=true;}
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
function bounds(districts){const points=[];for(const d of districts)for(const x of [d.minX,d.maxX])for(const y of [d.minY,d.maxY+50]){const t=turn(x,y);points.push(iso(t.x,t.y,0));}return {minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y))-130,maxY:Math.max(...points.map(p=>p.y))+50};}
function fit(){if(!state.districts.length)return;if(view3d?.active)return view3d.fit({left:width<560?205:width<850?255:340,right:25,top:110,bottom:130});const b=bounds(state.districts),left=width<560?205:width<850?255:340,right=25,usable=Math.max(180,width-left-right);state.zoom=Math.min(1.1,usable/(b.maxX-b.minX),(height-240)/(b.maxY-b.minY));state.zoom=Math.max(.08,state.zoom);state.camera={x:left+usable/2-(b.minX+b.maxX)/2*state.zoom,y:110+(height-230)/2-(b.minY+b.maxY)/2*state.zoom};updateZoom();}
function focusDistrict(d){if(view3d?.active)return view3d.focusDistrict(d,{left:width>850?340:width>560?255:215,right:25,top:120,bottom:120});const b=bounds([d]),left=width>850?340:width>560?255:215,usable=width-left-25;state.zoom=Math.max(.12,Math.min(1.6,usable/(b.maxX-b.minX),(height-240)/(b.maxY-b.minY)));state.camera={x:left+usable/2-(b.minX+b.maxX)/2*state.zoom,y:height*.5-(b.minY+b.maxY)/2*state.zoom};updateZoom();}
function focusNode(n){if(view3d?.active)return view3d.focusNode(n,{left:width>850?330:215,right:width>850?365:15});state.zoom=Math.max(.85,state.zoom);const t=turn(n.x,n.y),p=iso(t.x,t.y,n.h/2);const left=width>850?330:215,right=width>850?365:15;state.camera={x:left+(width-left-right)/2-p.x*state.zoom,y:height*.5-p.y*state.zoom};updateZoom();}
function rotateView(step){
  if(view3d?.active)return view3d.rotate(step);
  // Keep the ground point at the centre of the screen in place while the map turns.
  const cx=width/2,cy=height/2,a=(cx-state.camera.x)/state.zoom/.866,b=((cy-state.camera.y)/state.zoom+14)/.433,w=turn((a+b)/2,(b-a)/2,(4-view.q)%4);
  view.q=(view.q+step+4)%4;const t=turn(w.x,w.y),p=iso(t.x,t.y,14);state.camera={x:cx-p.x*state.zoom,y:cy-p.y*state.zoom};for(const h of levelHits)h.dirty=true;
}
function updateZoom(){$('zoom-label').textContent=`${Math.round(state.zoom*100)}%`;}
function zoom(factor,x=width*.6,y=height*.5){if(view3d?.active)return view3d.zoom(factor,x,y);zoomedAt=performance.now();const old=state.zoom;state.zoom=Math.max(.07,Math.min(3,old*factor));state.camera.x=x-(x-state.camera.x)*state.zoom/old;state.camera.y=y-(y-state.camera.y)*state.zoom/old;updateZoom();}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,4000);}
function circleWorld(x,y,rx,ry,fill,z=14){const points=[];for(let i=0;i<40;i++){const a=i/40*Math.PI*2;points.push(project(x+Math.cos(a)*rx,y+Math.sin(a)*ry,z));}polygon(points,fill);}
function terrain(){
  const t=state.urban.terrain;polygon(t.outline.map(p=>project(p.x,p.y,12)),state.day?'#a7b88b':'#3e5943');
  for(let i=0;i<180;i++){const s=hash('meadow'+i),r=hash('lawn'+i),x=t.minX+(s%10000)/10000*(t.maxX-t.minX),y=t.minY+(r%10000)/10000*(t.maxY-t.minY);if(CityPlan.inside({x,y},t.outline))circleWorld(x,y,25+s%60,15+r%40,state.day?(i%3?'#afbd922b':'#849f6633'):(i%3?'#78966518':'#203e2c28'));}
}
function land(d){
  for(const b of d.blocks){if(b.pad){polygon(b.pad.map(p=>project(p.x,p.y,14)),state.day?(b.ground||'#ceccb3'):(b.groundNight||'#6a7260'));
      // A coloured kerb marks the quarter's edge; courtyards carry the class's character.
      if(b.edge)lineWorld([...b.pad,b.pad[0]].map(p=>({...p,z:14})),`${b.edge}cc`,Math.max(1,2.4*state.zoom));
      if(b.court)polygon(b.court.map(p=>project(p.x,p.y,15)),state.day?(b.court_colour||'#95ad7a'):tint(b.court_colour||'#95ad7a',.55));continue;}
    const x=b.x-b.size/2,y=b.y-b.size/2,s=b.size,c=b.cut;
    polygon([[c,0],[s-c,0],[s,c],[s,s-c],[s-c,s],[c,s],[0,s-c],[0,c]].map(([a,b])=>project(x+a,y+b,14)),state.day?'#ceccb3':'#6a7260',state.day?'#e2ddc5':'#89927b');
    const court=b.court||52;quad(b.x-court,b.y-court,court*2,court*2,15,state.day?'#95ad7a':'#4c6b49');
    lineWorld([{x:b.x-(b.court?b.size/2:45),y:b.y,z:16},{x:b.x+(b.court?b.size/2:45),y:b.y,z:16}],state.day?'#d0c5a3':'#9d9a7b',5*state.zoom);
    if(b.court)lineWorld([{x:b.x,y:b.y-b.size/2,z:16},{x:b.x,y:b.y+b.size/2,z:16}],state.day?'#d0c5a3':'#9d9a7b',5*state.zoom);
  }
  for(const p of d.parks){if(p.kind==='courtyard')continue;circleWorld(p.x,p.y,p.r,p.r,p.kind==='square'?(state.day?'#d8ccb2':'#8c8b70'):(state.day?'#93ac78':'#4c6d48'));if(p.kind!=='square'){lineWorld([{x:p.x-p.r,y:p.y,z:15},{x:p.x+p.r,y:p.y,z:15}],state.day?'#c7bd99':'#929476',8*state.zoom);lineWorld([{x:p.x,y:p.y-p.r,z:15},{x:p.x,y:p.y+p.r,z:15}],state.day?'#c7bd99':'#929476',8*state.zoom);}}
  for(const n of state.nodes.filter(n=>n.district===d.id)){const a={x:n.x+n.w/2,y:n.y+n.d/2,z:15},b={x:(n.walk[0].x+n.walk[1].x)/2,y:(n.walk[0].y+n.walk[1].y)/2,z:15};lineWorld([a,b],state.day?'#c7c1a3':'#96957c',5*state.zoom);}
}
function rivers(){
  if(state.urban.plaza)polygon(state.urban.plaza.map(p=>project(p.x,p.y,14)),state.day?'#d8ccb2':'#8c8b70',state.day?'#e8dfc8':'#9d9b80');
  for(const r of state.urban.rivers||[]){if(r.shoreOutline)polygon(r.shoreOutline.map(p=>project(p.x,p.y,13)),state.day?'#b9bf91':'#53674f');else{const p=r.points.map(p=>({...p,z:13}));lineWorld(p,state.day?'#c9c7a4':'#56634f',(r.width+16)*state.zoom);}}
  for(const r of state.urban.rivers||[]){const p=r.points.map(p=>({...p,z:12}));if(r.waterOutline)polygon(r.waterOutline.map(p=>project(p.x,p.y,12)),state.day?'#75a9b0':'#315968');else lineWorld(p,state.day?'#6b9fa9':'#2d505e',r.width*state.zoom);lineWorld((r.deep||r.points).map(p=>({...p,z:12.1})),state.day?'#6399a5':'#294c5e',r.width*.4*state.zoom);
    if(state.zoom>.2)for(let i=1;i<r.points.length;i++){const a=r.points[i-1],b=r.points[i],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);if(!len)continue;
      for(let k=16;k<len;k+=30){const t=k/len,side=(i+Math.floor(k/30))%2?1:-1,off=r.width*.18*side,x=a.x+dx*t-dy/len*off,y=a.y+dy*t+dx/len*off;lineWorld([{x,y,z:12.2},{x:x+dx/len*8,y:y+dy/len*8,z:12.2}],state.day?'#c1ded88c':'#91b5b45c',Math.max(.5,.8*state.zoom));}
    }
  }
  for(const r of state.urban.paths||[]){const p=r.points.map(p=>({...p,z:15}));lineWorld(p,state.day?'#d6caa6':'#8e8a6c',Math.max(.8,r.width*state.zoom));}
}
function streets(){
  // Sidewalks first, carriageways second: continuous ways merge cleanly at shared junctions.
  const roads=state.urban.roads.map(r=>({...r,p:r.points.map(p=>({...p,z:r.kind==='bridge'?17:15}))}));
  for(const r of roads)lineWorld(r.p,r.kind==='bridge'?(state.day?'#c8bfa8':'#7f7a68'):(state.day?'#d9d4ba':'#a6aa90'),(r.width+11)*state.zoom);
  for(const r of roads)lineWorld(r.p,r.kind==='pedestrian'?(state.day?'#cfc4a4':'#8a866c'):(state.day?'#9aa49a':'#616f67'),r.width*state.zoom);
  for(const r of roads){if(r.kind==='avenue'||r.kind==='district'||r.kind==='bridge')lineWorld(r.p,state.day?'#dedbc4':'#bbc1a2',Math.max(.6,state.zoom),[8*state.zoom,10*state.zoom]);}
  if(state.zoom>.45)for(const r of roads)if(r.kind==='bridge')for(let i=1;i<r.p.length;i++){
    const a=r.p[i-1],b=r.p[i],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);if(!len)continue;
    for(const side of [-1,1]){const ox=-dy/len*(r.width/2+4)*side,oy=dx/len*(r.width/2+4)*side;lineWorld([{x:a.x+ox,y:a.y+oy,z:24},{x:b.x+ox,y:b.y+oy,z:24}],state.day?'#788b80':'#9ba99b',Math.max(.6,state.zoom));for(let k=0;k<=len;k+=12){const x=a.x+dx*k/len+ox,y=a.y+dy*k/len+oy;lineWorld([{x,y,z:17},{x,y,z:24}],state.day?'#788b80':'#9ba99b',Math.max(.5,.7*state.zoom));}}
  }
}
function decoration(o){
  elevation=14;
  if(o.kind==='place'){details.place(o);const p=project(o.x,o.y,12);state.hits.push({node:{...o.facility,derived:true,physicalId:o.facility.id},x:p.x,y:p.y,rx:Math.max(7,12*state.zoom),ry:Math.max(6,9*state.zoom),person:false});}
  else if(o.kind==='tree')tree(o.x,o.y,o.size,o.seed);
  else if(o.kind==='lamp'){details.furniture(o);
  }else if(o.kind==='service'){frame=rotation(o);if(!details.signatureService(o)){if(o.function==='stadium'){
    box(o.x,o.y,o.w,o.d,5,'#c9c4b2');quad(o.x+o.w*.15,o.y+o.d*.15,o.w*.7,o.d*.7,6,'#e7e8ca');quad(o.x+o.w*.19,o.y+o.d*.19,o.w*.62,o.d*.62,7,'#4c9868');
    box(o.x,o.y,o.w,o.d*.13,13,'#d5c39e');box(o.x,o.y+o.d*.87,o.w,o.d*.13,13,'#d5c39e');
    lineWorld([{x:o.x+o.w*.5,y:o.y+o.d*.19,z:8},{x:o.x+o.w*.5,y:o.y+o.d*.81,z:8}],'#fff4d4',Math.max(.7,state.zoom));
  }else if(o.function==='campus'){
    box(o.x,o.y,o.w,o.d*.3,23,'#a9cdd5');box(o.x,o.y,o.w*.24,o.d,23,'#c8dce0');box(o.x+o.w*.76,o.y,o.w*.24,o.d,23,'#c8dce0');quad(o.x+o.w*.25,o.y+o.d*.32,o.w*.5,o.d*.65,2,'#90b88d');
  }else if(o.function==='solar-centre'){
    box(o.x,o.y,o.w,o.d,12,'#cfcdab');for(let i=0;i<3;i++)quad(o.x+o.w*(.08+i*.3),o.y+o.d*.12,o.w*.25,o.d*.75,14,'#507f9b','#a3c6cf');
  }else if(o.function==='innovation-centre'||o.function==='media-centre'){
    box(o.x,o.y,o.w,o.d,22,o.function==='media-centre'?'#cba2bb':'#b1a3cf');quad(o.x+o.w*.1,o.y+o.d*.1,o.w*.8,o.d*.8,23,'#759eac');lineWorld([{x:o.x+o.w*.5,y:o.y+o.d*.5,z:23},{x:o.x+o.w*.5,y:o.y+o.d*.5,z:42}],'#c4d2cc',Math.max(1,state.zoom));
  }else if(o.function==='arts-centre'){
    box(o.x,o.y,o.w,o.d,16,'#d4a2b1');box(o.x,o.y+o.d*.65,o.w,o.d*.35,4,'#9e7c98');quad(o.x-1,o.y-1,o.w+2,o.d+2,20,'#ddb7c3');
  }else if(o.function==='town-hall'){box(o.x,o.y,o.w,o.d,o.h*.55,'#d6c4a2');box(o.x+o.w*.4,o.y+o.d*.3,o.w*.2,o.d*.4,o.h*.45,'#c9b48e',undefined,o.h*.55);const p=project(o.x+o.w*.5,o.y+o.d*.7,o.h*.9);ctx.fillStyle='#f1e7c8';ctx.beginPath();ctx.arc(p.x,p.y,5*state.zoom,0,Math.PI*2);ctx.fill();}else box(o.x,o.y,o.w,o.d,o.h,o.function==='library'?'#b9a98c':o.function==='tribology-lab'?'#c9d3cf':o.function==='sports-lab'?'#d7c7a5':o.function==='research-lab'?'#c9d6d6':o.function==='energy-lab'?'#b7c9a9':o.function==='article-market'?'#e6d9bd':'#c98f74',o.function==='market'||o.function==='article-market'?'#d7b46a':undefined);
    details.service(o);
    }
    if(o.facility){const p=project(o.x+o.w/2,o.y+o.d/2,12);state.hits.push({node:{...o.facility,derived:true,physicalId:o.facility.id},x:p.x,y:p.y,rx:Math.max(9,o.w*state.zoom*.8),ry:Math.max(9,o.d*state.zoom*.7),person:false});}frame=null;}
  else if(o.kind==='bench'){details.furniture(o);}
  else if(o.kind==='fountain'){circleWorld(o.x,o.y,24,24,'#c4c4a8',3);circleWorld(o.x,o.y,18,18,state.day?'#81bbc1':'#749fa0',6);box(o.x-4,o.y-4,8,8,18,'#b2bba7');lineWorld([{x:o.x,y:o.y,z:22},{x:o.x,y:o.y,z:36}],'#cee0d7',Math.max(1,2*state.zoom));}
  else if(o.kind==='bandstand'){circleWorld(o.x,o.y,28,28,'#bcb296',4);for(const a of [0,Math.PI/2,Math.PI,Math.PI*1.5])box(o.x+Math.cos(a)*20,o.y+Math.sin(a)*20,3,3,27,'#c1b99e');circleWorld(o.x,o.y,31,31,'#bd9090',31);}
  else{box(o.x-7,o.y-7,14,14,11,'#b6b6a0');box(o.x-3,o.y-3,6,6,20,'#c8c9ad',undefined,11);}
  elevation=0;
}
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
    const S=state.urban.scale;const t=turn(dx,dy);scene.push({kind:'resident',x:x*S,y:y*S,node:n,direction:{x:t.x-t.y,y:(t.x+t.y)*.5},heading:Math.atan2(dy,dx),moving,activity:r.activity});
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
function vehicle(v){
  const S=state.urban.scale,c=turn(v.x*S,v.y*S),x=c.x-14,y=c.y-7;elevation=14;modelSpace=true;
  box(x,y,28,14,11,'#c99d55','#edcc84',3);box(x+1,y+1,26,12,2,'#e3c584',undefined,14);
  if(state.zoom>.3){
    const glass=v.passengers?(state.day?'#65919b':'#e7ce94'):(state.day?'#5c8392':'#456874');
    for(let i=0;i<4;i++)polygon([project(x+3+i*5,y+14.3,8),project(x+7+i*5,y+14.3,8),project(x+7+i*5,y+14.3,13),project(x+3+i*5,y+14.3,13)],glass);
    polygon([project(x+28.3,y+2,8),project(x+28.3,y+12,8),project(x+28.3,y+12,13),project(x+28.3,y+2,13)],glass);
    for(const xx of [x+5,x+23]){const p=project(xx,y+14.5,3);ctx.fillStyle='#33423f';ctx.beginPath();ctx.ellipse(p.x,p.y,2.4*state.zoom,3.1*state.zoom,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#a8b3a9';ctx.beginPath();ctx.arc(p.x,p.y,1.1*state.zoom,0,Math.PI*2);ctx.fill();}
    lineWorld([{x:x+24,y:y+14.6,z:5},{x:x+24,y:y+14.6,z:13}],state.day?'#8f784f':'#b2a77f',.6*state.zoom);
    quad(x+8,y+4,8,5,16.2,'#aab5a6');
    for(const yy of [y+2,y+12]){const p=project(x+28.5,yy,6);ctx.fillStyle=state.day?'#f8eac2':'#ffe6aa';ctx.beginPath();ctx.arc(p.x,p.y,state.zoom,0,Math.PI*2);ctx.fill();}
  }
  elevation=0;modelSpace=false;
}
function people(){
  for(const n of state.nodes){if(!matches(n)||n.available===false)continue;const seed=n.seed,t=(state.time*(.05+(seed%7)*.006)+(seed%1000)/1000)%1;
    const walk=t<.5?t*2:2-t*2,a=n.walk[0],b=n.walk[1],sign=t<.5?1:-1,dx=(b.x-a.x)*sign,dy=(b.y-a.y)*sign;
    const v=turn(dx,dy),h=details.person(n,a.x+(b.x-a.x)*walk,a.y+(b.y-a.y)*walk,{x:v.x-v.y,y:(v.x+v.y)*.5},true);if(h)state.hits.push(h);
  }
}
function pill(text,x,y,size,fill,ink,border){ctx.font=`600 ${size}px -apple-system, sans-serif`;const w=ctx.measureText(text).width+size*1.4,h=size*1.9;ctx.beginPath();ctx.roundRect(x-w/2,y-h/2,w,h,h/2);ctx.fillStyle=fill;ctx.fill();if(border){ctx.strokeStyle=border;ctx.lineWidth=1.5;ctx.stroke();}ctx.fillStyle=ink;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,x,y+.5);ctx.textBaseline='alphabetic';return w;}
function labels(){
  // Quarter names sit on pills in the quarter colour; sub-quarters get smaller outlined pills once zoomed in.
  const placed=[],free=(x,y,w,h)=>!placed.some(q=>Math.abs(q.x-x)<(q.w+w)/2+4&&Math.abs(q.y-y)<(q.h+h)/2+2);
  for(const d of state.districts){const active=!state.filter||state.filter===d.id;ctx.globalAlpha=active?1:.35;const p=project(d.label.x,d.label.y,0),size=Math.max(11,Math.min(16,13*state.zoom)),text=`${icons[d.theme]} ${d.title}`,w=text.length*size*.62+size*1.4;
    const anchor=p.y;for(let k=1;!free(p.x,p.y,w,size*2.6)&&k<12;k++)p.y=anchor+(k%2?1:-1)*Math.ceil(k/2)*size*2.2;placed.push({x:p.x,y:p.y,w,h:size*2.6});pill(text,p.x,p.y,size,d.color,'#1d2622');
    ctx.font=`500 ${Math.max(9,Math.min(12,10*state.zoom))}px -apple-system, sans-serif`;ctx.fillStyle=state.day?'#3d4b45':'#e3e7d5';ctx.textAlign='center';ctx.shadowColor=state.day?'#edf1dd':'#1d2a24';ctx.shadowBlur=5;ctx.fillText(`${d.physicalCount??d.count} будівель · ${d.count} нотаток`,p.x,p.y+size*1.65);ctx.shadowBlur=0;
    if(state.zoom>=.3)for(const q of d.quarters||[]){const s=project(q.x,q.y,0),qs=Math.max(9,Math.min(12,10*state.zoom)),qw=q.title.length*qs*.6+qs*1.4;if(!free(s.x,s.y,qw,qs*2))continue;placed.push({x:s.x,y:s.y,w:qw,h:qs*2});pill(q.title,s.x,s.y,qs,state.day?'#f6f1e4ee':'#1f2b26ee',state.day?'#2c3a33':'#e8eadb',d.color);}
    ctx.globalAlpha=1;}
}
let lastPaint=0,paintMs=0,collectHits=true,zoomedAt=0,planVersion=0;
// The 3D view (scene3d.js, see RENDER-3D.md) draws the city with WebGL; this canvas then carries only labels and links.
let view3d=null;const RENDERER_KEY='brain-city-renderer';
function attach3D(create){
  try{view3d=create({state,overlay:canvas,matches,residents,vehicles,planVersion:()=>planVersion,onZoom:z=>{$('zoom-label').textContent=`${Math.round(z*100)}%`;}});}catch(error){console.error(error);view3d=null;return;}
  view3d.resize(width,height,ratio);$('toggle-3d').hidden=false;let saved=null;try{saved=localStorage.getItem(RENDERER_KEY);}catch{}setRenderer(saved!=='2d');
}
function setRenderer(on){
  if(!view3d)return;view3d.setActive(on);$('toggle-3d').setAttribute('aria-pressed',String(on));try{localStorage.setItem(RENDERER_KEY,on?'3d':'2d');}catch{}
  if(state.districts.length)fit();else updateZoom();
}
// Static city tiles: ground, streets, buildings and scenery are pre-rendered into tiles on a power-of-two zoom
// pyramid and only copied each frame. The coarse levels cover the whole city up front, finer levels fill in around
// the view in the background. A missing tile is covered by its children or parent and a stale one stays visible
// until rebuilt, so zooming and panning never show gaps or wait for a full redraw. Residents and vehicles are drawn
// live, and buildings in front of them are redrawn on top so occlusion stays correct.
const TILE=512,TILE_PAD=2,LEVELS=[1/16,1/8,1/4,1/2,1,2,4],LEVEL_UPSCALE=1.2,PREBUILD_TILES=32,TILE_BUDGET=112,BUILD_BUDGET_MS=10,MAX_TILES_PER_FRAME=8;
const OCCLUDER_CELL=96,OCCLUSION_ZOOM=.3,ORNAMENT_ZOOM=.3;
const tiles=new Map(),levelHits=LEVELS.map(()=>({list:[],grid:new Map(),dirty:false}));
let tileBase=null,tileFrame=0,shownLevel=0,shownLevels=new Set();
function useContext(next){ctx=next;details.setContext(next);}
function layerBase(){return [view.q,planVersion,state.day,state.filter,state.query,state.selected?.id,state.selected?.physicalId,ratio].join('|');}
function turned(o,rect){
  // Axis-aligned copy of a model after the view turn: the centre turns, width and depth swap on odd quarter turns.
  if(!view.q)return o;if(o.turnCache?.q===view.q)return o.turnCache.copy;
  const odd=view.q%2,c=turn(rect?o.x+o.w/2:o.x,rect?o.y+o.d/2:o.y),copy={...o,turnCache:null};
  if(rect){copy.w=odd?o.d:o.w;copy.d=odd?o.w:o.d;copy.x=c.x-copy.w/2;copy.y=c.y-copy.d/2;}else{copy.x=c.x;copy.y=c.y;}
  if(o.rcx!==undefined){const r=turn(o.rcx,o.rcy);copy.rcx=r.x;copy.rcy=r.y;}
  o.turnCache={q:view.q,copy};return copy;
}
function drawModel(o){
  const model=o.kind==='building'?turned(o.node,true):turned(o,o.kind==='service'),before=state.hits.length;modelSpace=true;
  try{o.kind==='building'?building(model):decoration(model);}finally{modelSpace=false;}
  for(let k=before;k<state.hits.length;k++)if(state.hits[k].node===model)state.hits[k].node=o.node;
}
function staticObjects(){
  const u=state.urban;u.sortedStatic=u.sortedStatic||[];
  if(!u.sortedStatic[view.q]){const depth=o=>{if(o.kind==='building'){const t=turned(o.node,true);return t.x+t.y+(t.w+t.d)*.5;}const t=turned(o,o.kind==='service');return o.depth??t.x+t.y;};
    u.sortedStatic[view.q]=[...u.nodes.map(n=>({kind:'building',x:n.x,y:n.y,node:n})),...u.scenery].map(o=>[depth(o),o]).sort((a,b)=>a[0]-b[0]).map(([d,o])=>o.kind==='building'?Object.assign(o,{depth:d}):o);}
  return u.sortedStatic[view.q];
}
function onScreen(o,w,h){const p=project(o.x,o.y),margin=Math.max(80,(o.kind==='building'?o.node.h+o.node.w+o.node.d+40:o.kind==='service'?o.h+o.w+o.d+40:60)*state.zoom);return !(p.x< -margin||p.x>w+margin||p.y< -margin||p.y>h+margin);}
function extent(){const u=state.urban;u.extents=u.extents||[];if(!u.extents[view.q]){const b=bounds(state.districts);for(const p of u.terrain.outline){const t=turn(p.x,p.y),s=iso(t.x,t.y,26);b.minX=Math.min(b.minX,s.x);b.maxX=Math.max(b.maxX,s.x);b.minY=Math.min(b.minY,s.y-100);b.maxY=Math.max(b.maxY,s.y);}u.extents[view.q]=b;}return u.extents[view.q];}
function cityRange(l){const b=extent(),s=LEVELS[l]/TILE;return {i0:Math.floor(b.minX*s),i1:Math.floor(b.maxX*s),j0:Math.floor(b.minY*s),j1:Math.floor(b.maxY*s)};}
function viewRange(l,ring=0){const k=state.zoom/LEVELS[l],c=cityRange(l);return {i0:Math.max(c.i0,Math.floor(-state.camera.x/k/TILE)-ring),i1:Math.min(c.i1,Math.floor((width-state.camera.x)/k/TILE)+ring),j0:Math.max(c.j0,Math.floor(-state.camera.y/k/TILE)-ring),j1:Math.min(c.j1,Math.floor((height-state.camera.y)/k/TILE)+ring)};}
function targetLevel(){let l=0;while(l<LEVELS.length-1&&LEVELS[l]<state.zoom/LEVEL_UPSCALE)l++;return l;}
function* cells(l,r){for(let j=r.j0;j<=r.j1;j++)for(let i=r.i0;i<=r.i1;i++)yield l+':'+i+':'+j;}
function wantedTiles(){
  // Visible tiles first, then the whole city on coarse levels, then a ring around the view and the next coarser level.
  const l=targetLevel(),cover=Math.max(0,l-2),keys=new Set([...cells(cover,viewRange(cover)),...cells(l,viewRange(l))]);let prebuilt=0;
  for(let p=0;p<LEVELS.length;p++){const r=cityRange(p),count=(r.i1-r.i0+1)*(r.j1-r.j0+1);if(prebuilt+count>PREBUILD_TILES)break;prebuilt+=count;for(const key of cells(p,r))keys.add(key);}
  for(const key of cells(l,viewRange(l,1)))keys.add(key);
  if(l>0)for(const key of cells(l-1,viewRange(l-1)))keys.add(key);
  return keys;
}
function buildTile(key){
  const [l,i,j]=key.split(':').map(Number),size=TILE+2*TILE_PAD,px=Math.round(size*ratio);let t=tiles.get(key);
  if(!t){const c=document.createElement('canvas');t={l,i,j,q:view.q,canvas:c,context:c.getContext('2d'),base:null,hits:[],used:0};tiles.set(key,t);}
  if(t.canvas.width!==px){t.canvas.width=px;t.canvas.height=px;}
  const camera=state.camera,zoomed=state.zoom,hovered=state.hovered,hits=state.hits;
  useContext(t.context);ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,size,size);
  state.zoom=LEVELS[l];state.camera={x:TILE_PAD-i*TILE,y:TILE_PAD-j*TILE};state.hovered=null;state.hits=[];
  try{
    terrain();rivers();for(const d of state.districts)land(d);streets();
    staticObjects().forEach((o,order)=>{if(!onScreen(o,size,size))return;const before=state.hits.length;drawModel(o);
      // Hits are kept in level pixels in draw order; every opaque building that registered one is drawn over agents.
      for(let k=before;k<state.hits.length;k++){const h=state.hits[k];h.x-=state.camera.x;h.y-=state.camera.y;h.depth=order;h.occluder=o.kind==='building'&&o.node.available!==false?o:null;}});
    Object.assign(t,{base:tileBase,hits:state.hits,used:tileFrame,q:view.q});levelHits[l].dirty=true;
  }finally{useContext(screen);state.camera=camera;state.zoom=zoomed;state.hovered=hovered;state.hits=hits;}
}
function evictTile(wanted){
  let oldest=null;for(const [key,t] of tiles)if(t.used!==tileFrame&&!wanted.has(key)&&(!oldest||t.used<oldest[1].used))oldest=[key,t];
  if(!oldest)return false;tiles.delete(oldest[0]);levelHits[oldest[1].l].dirty=true;oldest[1].canvas.width=0;return true;
}
function buildTiles(start){
  tileBase=layerBase();tileFrame++;let built=0;const wanted=wantedTiles(),l=targetLevel(),cover=Math.max(0,l-2);
  // A view with no tile of this side yet (first load, a new rotation) gets a coarse cover at once, whatever the budget.
  for(const key of cells(cover,viewRange(cover))){const t=tiles.get(key);if(t?.base&&t.q===view.q)continue;if(!t&&tiles.size>=TILE_BUDGET)evictTile(wanted);buildTile(key);built++;}
  for(const key of wanted){const t=tiles.get(key);if(t&&t.base===tileBase)continue;
    if(built>=MAX_TILES_PER_FRAME||built&&performance.now()-start>BUILD_BUDGET_MS)break;
    if(!t&&tiles.size>=TILE_BUDGET&&!evictTile(wanted))break;buildTile(key);built++;}
}
function cellTile(l,i,j){const t=tiles.get(l+':'+i+':'+j);if(t?.base&&t.q===view.q){t.used=tileFrame;return t;}return null;}
function blit(t,l,i,j){
  // Draws the part of tile t that covers cell (l,i,j), snapped to device pixels so neighbours meet without seams.
  const s=LEVELS[t.l]/LEVELS[l],k=state.zoom/LEVELS[l],snap=v=>Math.round(v*ratio)/ratio,x0=snap(i*TILE*k+state.camera.x),x1=snap((i+1)*TILE*k+state.camera.x),y0=snap(j*TILE*k+state.camera.y),y1=snap((j+1)*TILE*k+state.camera.y);
  ctx.drawImage(t.canvas,(i*TILE*s-t.i*TILE+TILE_PAD)*ratio,(j*TILE*s-t.j*TILE+TILE_PAD)*ratio,TILE*s*ratio,TILE*s*ratio,x0,y0,x1-x0,y1-y0);shownLevels.add(t.l);
}
function drawCell(l,i,j){
  let t=cellTile(l,i,j);if(t)return blit(t,l,i,j);
  if(l+1<LEVELS.length){const kids=[0,1,2,3].map(n=>cellTile(l+1,2*i+n%2,2*j+(n>>1)));if(kids.every(Boolean)){for(const c of kids)blit(c,l+1,c.i,c.j);return;}}
  for(let p=l-1,s=2;p>=0;p--,s*=2){t=cellTile(p,Math.floor(i/s),Math.floor(j/s));if(t)return blit(t,l,i,j);}
}
function blitTiles(){shownLevel=targetLevel();shownLevels=new Set();const r=viewRange(shownLevel);for(let j=r.j0;j<=r.j1;j++)for(let i=r.i0;i<=r.i1;i++)drawCell(shownLevel,i,j);}
function levelIndex(l){
  const index=levelHits[l];if(!index.dirty)return index;index.dirty=false;const items=new Map();
  for(const t of tiles.values())if(t.l===l&&t.q===view.q)for(const h of t.hits){const key=h.node.physicalId||h.node.id;if(!items.has(key))items.set(key,h);}
  index.list=[...items.values()].sort((a,b)=>a.depth-b.depth);index.grid=new Map();
  for(const h of index.list)if(h.occluder)for(let gx=Math.floor((h.x-h.rx)/OCCLUDER_CELL);gx<=Math.floor((h.x+h.rx)/OCCLUDER_CELL);gx++)for(let gy=Math.floor((h.y-h.ry)/OCCLUDER_CELL);gy<=Math.floor((h.y+h.ry)/OCCLUDER_CELL);gy++){const k=gx+':'+gy;if(!index.grid.has(k))index.grid.set(k,[]);index.grid.get(k).push(h);}
  return index;
}
function liveObjects(){
  const live=[...(state.urban.residents?residents():[]),...vehicles().map(v=>({kind:'vehicle',x:v.x*state.urban.scale,y:v.y*state.urban.scale,vehicle:v}))];
  // Buildings stay above residents and vehicles: every building overlapping an agent's figure is redrawn on top.
  // From afar, where that would redraw most of the city, an agent standing inside a building's outline is hidden instead.
  const index=levelIndex(shownLevel),scale=LEVELS[shownLevel],k=state.zoom/scale,far=state.zoom<OCCLUSION_ZOOM,over=new Map(),agents=[],half=7*scale,tall=32*scale;
  for(const o of live){const p=project(o.x,o.y),cx=(p.x-state.camera.x)/k,cy=(p.y-state.camera.y)/k-(far?0:tall/2);let hidden=false;
    for(const item of index.grid.get(Math.floor(cx/OCCLUDER_CELL)+':'+Math.floor(cy/OCCLUDER_CELL))||[]){
      if(far)hidden=hidden||((cx-item.x)/item.rx)**2+((cy-item.y)/item.ry)**2<=1;
      else if(Math.abs(cx-item.x)<item.rx+half&&Math.abs(cy-item.y)<item.ry+tall/2)over.set(item.occluder,item.depth);}
    if(!hidden){const t=turn(o.x,o.y);o.depth=t.x+t.y;agents.push(o);}}
  agents.sort((a,b)=>a.depth-b.depth);
  for(const [o] of [...over].sort((a,b)=>a[1]-b[1]))agents.push({...o,occluder:true});
  const hovered=state.hovered&&state.urban.nodes.includes(state.hovered)?state.hovered:null;
  if(hovered)agents.push({kind:'building',x:hovered.x,y:hovered.y,node:hovered,occluder:true});
  return agents;
}
function draw(now){
  // One failing frame is recorded for diagnosis and must not stop the animation loop.
  try{paint(now);}catch(error){canvas.dataset.renderError=String(error&&error.stack||error);console.error(error);useContext(screen);requestAnimationFrame(draw);}
}
function paint(now){
  if(now-lastPaint<32){requestAnimationFrame(draw);return;}lastPaint=now;
  const paintStart=performance.now(),delta=lastFrame?Math.min((now-lastFrame)/1000,.1):0;lastFrame=now;if(!state.paused&&!state.reduced)state.time+=delta;
  ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);
  if(view3d?.active){view3d.frame(now);state.hits=[];if(state.data){drawEdges();labels();}paintMs=paintMs*.9+(performance.now()-paintStart)*.1;canvas.dataset.renderMs=paintMs.toFixed(1);requestAnimationFrame(draw);return;}
  const bg=ctx.createLinearGradient(0,0,width,height);bg.addColorStop(0,state.day?'#b7c5a1':'#293f32');bg.addColorStop(.5,state.day?'#a6b891':'#344d39');bg.addColorStop(1,state.day?'#b0bf9b':'#243e31');ctx.fillStyle=bg;ctx.fillRect(0,0,width,height);
  // Quiet water, a cartographer’s grid and drifting flecks.
  ctx.strokeStyle=state.day?'#809e9420':'#a3c7b408';ctx.lineWidth=.6;const grid=75*state.zoom;if(grid>8){const ox=state.camera.x%grid,oy=state.camera.y%grid;for(let x=ox;x<width;x+=grid){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();}for(let y=oy;y<height;y+=grid){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke();}}
  for(let i=0;i<45;i++){const x=(hash('water'+i)%10000)/10000*width,y=(hash('sea'+i)%10000)/10000*height;ctx.strokeStyle=state.day?'#ffffff40':'#a0c8bc10';ctx.beginPath();ctx.moveTo(x+Math.sin(state.time*.1+i)*5,y);ctx.lineTo(x+8+Math.sin(state.time*.1+i)*5,y);ctx.stroke();}
  state.hits=[];
  if(state.data){buildTiles(paintStart);blitTiles();
    for(const o of liveObjects()){if(!onScreen(o,width,height))continue;if(o.kind==='vehicle')vehicle(o.vehicle);else if(o.kind==='resident'){const h=details.person(o.node,o.x,o.y,o.direction,o.moving,o.activity);if(h)state.hits.push(h);}else if(o.kind==='building'){collectHits=!o.occluder;drawModel(o);collectHits=true;}}
    if(!state.urban.residents)people();drawEdges();labels();}
  paintMs=paintMs*.9+(performance.now()-paintStart)*.1;canvas.dataset.renderMs=paintMs.toFixed(1);requestAnimationFrame(draw);
}
function resize(){width=innerWidth;height=innerHeight;ratio=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);view3d?.resize(width,height,ratio);if(initialized)fit();}
function hit(x,y){if(view3d?.active)return view3d.hit(x,y);for(let i=state.hits.length-1;i>=0;i--){const h=state.hits[i];if(((x-h.x)/h.rx)**2+((y-h.y)/h.ry)**2<=1)return h;}
  // Static hits live in level pixels of the tiles on screen; the target level wins over its fallbacks.
  for(const l of [shownLevel,...shownLevels]){const index=levelIndex(l),k=state.zoom/LEVELS[l],lx=(x-state.camera.x)/k,ly=(y-state.camera.y)/k;for(let i=index.list.length-1;i>=0;i--){const h=index.list[i];if(((lx-h.x)/h.rx)**2+((ly-h.y)/h.ry)**2<=1)return h;}}return null;}
let pointer=null;
canvas.addEventListener('pointerdown',e=>{pointer={x:e.clientX,y:e.clientY,cx:state.camera.x,cy:state.camera.y,moved:false};canvas.setPointerCapture(e.pointerId);$('tooltip').hidden=true;});
canvas.addEventListener('pointermove',e=>{
  if(pointer){const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;if(Math.abs(dx)+Math.abs(dy)>4)pointer.moved=true;if(pointer.moved){state.camera.x=pointer.cx+dx;state.camera.y=pointer.cy+dy;state.dragging=true;}return;}
  const h=hit(e.clientX,e.clientY);state.hovered=h?.node||null;canvas.style.cursor=h?'pointer':'grab';const tip=$('tooltip');tip.hidden=!h;if(h){tip.replaceChildren(document.createTextNode(h.node.title));const small=document.createElement('small');small.textContent=h.node.function==='article-market'?'Свіжі статті · натисни, щоб зайти на ринок':h.node.derived?'Спільна служба району · натисни, щоб відкрити':`${h.person?'Мешканець':'Будівля'} · ${h.node.degree} зв’язків · натисни, щоб відкрити`;tip.append(small);tip.style.left=`${Math.max(8,Math.min(width-285,e.clientX+16))}px`;tip.style.top=`${Math.min(height-90,e.clientY+15)}px`;}
});
canvas.addEventListener('pointerup',e=>{if(pointer&&!pointer.moved){const h=hit(e.clientX,e.clientY);if(h?.node.function==='article-market'&&typeof openMarket==='function')openMarket();else if(h)select(h.node);else closeNote();}pointer=null;state.dragging=false;});
canvas.addEventListener('pointercancel',()=>{pointer=null;state.dragging=false;});
canvas.addEventListener('pointerleave',()=>{state.hovered=null;$('tooltip').hidden=true;});
canvas.addEventListener('dblclick',e=>{const h=hit(e.clientX,e.clientY);if(h?.node.uri)location.href=h.node.uri;});
canvas.addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(-e.deltaY*.0012),e.clientX,e.clientY);},{passive:false});
$('search').addEventListener('input',e=>{state.query=e.target.value.trim().toLocaleLowerCase();renderResults();});
$('reset-filter').onclick=()=>{state.filter=null;state.query='';$('search').value='';renderDistricts();renderResults();fit();$('view-label').textContent='Огляд міста';};
$('open-library').onclick=()=>{const n=state.nodes.find(item=>item.cityRole==='knowledge-library'&&item.available!==false);if(n){state.filter=null;state.query='';$('search').value='';renderDistricts();renderResults();focusNode(n);select(n);}else toast('Бібліотека ще не додана до цього сховища.');};
$('close-note').onclick=closeNote;$('tab-content').onclick=()=>showTab('content');$('tab-links').onclick=()=>showTab('links');
$('close-history').onclick=closeHistory;$('toggle-history').onclick=()=>{const open=$('city-history').hidden;closeNote();if(typeof closePreparation==='function')closePreparation();$('city-history').hidden=!open;$('toggle-history').setAttribute('aria-pressed',String(open));};
$('fit').onclick=()=>{state.filter?focusDistrict(state.districts.find(d=>d.id===state.filter)):fit();};$('zoom-in').onclick=()=>zoom(1.25);$('toggle-3d').onclick=()=>setRenderer(!view3d?.active);$('rotate-left').onclick=()=>rotateView(-1);$('rotate-right').onclick=()=>rotateView(1);$('zoom-out').onclick=()=>zoom(.8);
$('toggle-links').onclick=()=>{state.links=!state.links;$('toggle-links').setAttribute('aria-pressed',String(state.links));};
$('pause').onclick=()=>{state.paused=!state.paused;$('pause').setAttribute('aria-pressed',String(state.paused));$('pause').textContent=state.paused?'▷':'Ⅱ';$('pause').title=state.paused?'Продовжити рух':'Призупинити рух';};
$('day').onclick=()=>{state.day=!state.day;document.body.classList.toggle('day',state.day);$('day').querySelector('span').textContent=state.day?'Денне місто':'Нічне місто';};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeNote();closeHistory();$('search').blur();}if(e.key==='/'&&document.activeElement.tagName!=='INPUT'){e.preventDefault();$('search').focus();}if(document.activeElement.tagName==='INPUT')return;if(e.key==='+'||e.key==='=')zoom(1.2);if(e.key==='-')zoom(.8);if(e.key==='0')fit();if(e.key==='q'||e.key==='й')rotateView(-1);if(e.key==='e'||e.key==='у')rotateView(1);});
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
  else if(data!==state.data)prepare(data);
  $('sync').textContent='Синхронізовано з Brain';$('sync').classList.remove('error');}catch{$('sync').textContent='З’єднання з Brain перерване';$('sync').classList.add('error');}finally{setTimeout(refresh,5000);}}
addEventListener('resize',resize);resize();requestAnimationFrame(draw);refresh();
