'use strict';
// Static tile pyramid: built in the background, panning reuses it, zoom never leaves gaps, hits follow the camera.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..');
const {city,world}=JSON.parse(execFileSync('python3',['-c',"import sys,json;sys.path.insert(0,'tests');sys.path.insert(0,'.');from test_simulation import snapshot;from simulation import Simulation;m=Simulation();d=snapshot(60,2);d['nodes'][0].update(kind='hub',district='civic',cityDistrict='civic',cityRole='knowledge-library',knowledgeScope='library',project='');d['nodes'][1].update(kind='article',district='civic',cityDistrict='civic',cityRole='library-item',knowledgeScope='library',libraryCategory='science',librarySource='https://example.org/article',project='');m.sync(d);m.advance(400);print(json.dumps({'city':d,'world':m.presentation()}))"],{cwd:root,maxBuffer:1<<26}).toString());
city.districts=[...new Set(city.nodes.map(n=>n.district))].map((id,i)=>({id,title:id,color:'#aabbcc',theme:'workspace',count:1,order:i}));
city.population=city.nodes.length;
world.places=[{id:'place:fixture',title:'Читальний сад',activity:'reading',district:city.districts[0].id,owner:city.nodes[0].stableId,capacity:3,hours:[6,22],position:[0,4],paths:[[[0,4],[4,4]]]}];
const noop=()=>{};let calls=0,layers=0;
const context=()=>new Proxy({},{get:(t,k)=>k==='measureText'?()=>({width:10}):k==='createLinearGradient'||k==='createRadialGradient'?()=>({addColorStop:noop}):k in t?t[k]:(...args)=>{calls++;for(const a of args)if(typeof a==='number')assert(Number.isFinite(a),`${String(k)} non-finite`);},set:(t,k,v)=>{t[k]=v;return true;}});
const element=()=>new Proxy({style:{},dataset:{},classList:{toggle:noop,remove:noop,add:noop},setAttribute:noop,append:noop,replaceChildren(...children){this.children=children;},addEventListener:noop,querySelector:()=>element(),getContext:()=>{layers++;return context();},setPointerCapture:noop},{get:(t,k)=>k in t?t[k]:typeof k==='string'?noop:undefined,set:(t,k,v)=>{t[k]=v;return true;}});
const elements={},listeners={},canvas=element();canvas.addEventListener=(k,f)=>{listeners[k]=f;};
const document={getElementById:id=>id==='city'?canvas:(elements[id]||(elements[id]=element())),createElement:()=>element(),createTextNode:text=>({text}),addEventListener:noop,body:element(),activeElement:{tagName:'BODY'}};
let frames=[],now=1000;
const requests=[];
const sandbox={document,matchMedia:()=>({matches:false}),innerWidth:1200,innerHeight:800,devicePixelRatio:1,addEventListener:noop,requestAnimationFrame:f=>frames.push(f),setTimeout:noop,clearTimeout:noop,performance:{now:()=>now},console,location:{},
  fetch:async(u,options={})=>{requests.push([u,options.headers||{}]);const body=u.startsWith('/api/note')?{content:'# Saved material'}:u.includes('/static')?world:u.includes('/live')?{...world,buildings:undefined}:city;return {ok:true,status:200,headers:{get:()=>'"tag"'},json:async()=>body};}};
sandbox.window=sandbox;vm.createContext(sandbox);
for(const file of ['city-plan.js','details.js','app.js'])vm.runInContext(fs.readFileSync(path.join(root,'web',file),'utf8')+(file==='details.js'?';globalThis.CityDetails=CityDetails;':''),sandbox,{filename:file});
const frame=()=>{now+=40;calls=0;frames.shift()(now);return calls;};
setTimeout(()=>{
  const first=frame();
  assert(requests.some(([u])=>u==='/api/world/live')&&requests.some(([u])=>u==='/api/world/static'),'geometry and live state come from separate routes');
  const run=code=>vm.runInContext(code,sandbox),covered=()=>run("(()=>{const l=targetLevel(),r=viewRange(l);for(let j=r.j0;j<=r.j1;j++)for(let i=r.i0;i<=r.i1;i++){let ok=cellTile(l,i,j)||[0,1,2,3].every(n=>cellTile(l+1,2*i+n%2,2*j+(n>>1)));for(let p=l-1,s=2;!ok&&p>=0;p--,s*=2)ok=cellTile(p,Math.floor(i/s),Math.floor(j/s));if(!ok)return false;}return true;})()");
  const drain=()=>{for(let i=0;i<200;i++){if(run("[...wantedTiles()].every(k=>tiles.get(k)?.base===tileBase)"))return;frame();}assert.fail('tiles never finish building');};
  assert(covered(),'the first frame already covers the view');
  drain();const cachedLayers=layers,steady=frame();
  assert(steady<first/3,`a frame of built tiles is much cheaper than the first (${steady} vs ${first})`);
  assert(run("cityRange(0)").i1>=run("cityRange(0)").i0&&run("[...cells(0,cityRange(0))].every(k=>tiles.get(k)?.base===tileBase)"),'the coarsest level covers the whole city up front');
  // Pan inside the prebuilt ring: no rebuild, and a click still finds the building under the cursor.
  listeners.pointerdown({clientX:600,clientY:400,pointerId:1});listeners.pointermove({clientX:640,clientY:420});const panned=frame();listeners.pointerup({clientX:640,clientY:420});
  assert(panned<first/3,'panning copies the built tiles');
  assert.equal(layers,cachedLayers,'no new tile canvas while panning');
  const found=[...Array(60)].some((_,i)=>{listeners.pointermove({clientX:200+i*15,clientY:200+i*8});frame();return !!elements.tooltip.hidden===false;});
  assert(found,'hover finds a building through the tile hits');
  // Zoom: the view stays covered by coarser or finer tiles while the new level builds a few tiles per frame.
  const before=layers;listeners.wheel({preventDefault:noop,deltaY:-600,clientX:600,clientY:400});frame();
  assert(covered(),'no gaps right after zooming');
  assert(layers-before<=run('MAX_TILES_PER_FRAME'),'a zoom step never redraws the whole view at once');
  drain();assert(run("(()=>{const l=targetLevel();return [...cells(l,viewRange(l))].every(k=>tiles.get(k)?.base===tileBase);})()"),'the new level fills in');
  const settled=frame();
  // Rotation: quarter turns keep the screen centre, rebuild tiles for the new side, and four turns come back home.
  const home=run('({...state.camera})');elements['rotate-right'].onclick();frame();
  assert(covered(),'no gaps right after turning the map');drain();
  const turnedHit=[...Array(60)].some((_,i)=>{listeners.pointermove({clientX:200+i*15,clientY:200+i*8});frame();return !!elements.tooltip.hidden===false;});
  assert(turnedHit,'hover finds a building on the turned map');
  for(let i=0;i<3;i++)elements['rotate-right'].onclick();const back=run('({...state.camera,q:view.q})');
  assert(back.q===0&&Math.abs(back.x-home.x)<1e-6&&Math.abs(back.y-home.y)<1e-6,'four quarter turns return to the same view');
  frame();
  elements.day.onclick();assert(frame()>settled,'day / night invalidates the tiles');assert(covered(),'stale tiles stay visible while rebuilding');
  elements['open-library'].onclick();
  assert.equal(elements['units-title'].textContent,'КАТАЛОГ · МАТЕРІАЛІВ: 1');
  assert.equal(elements['apartment-panel'].hidden,false);
  assert(!elements['note-kind'].textContent.includes('квартира'),'library records are not labelled apartments');
  elements['apartment-units'].children[0].onclick();
  assert.equal(elements['library-source'].href,'https://example.org/article');
  assert.equal(elements['library-source'].hidden,false);
  console.log('Render tiles and library catalogue: prebuilt coverage, cached panning/hits, gapless zoom, quarter-turn rotation, static/live split, article selection and source link pass.');
},20);
