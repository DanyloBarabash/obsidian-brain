'use strict';
// 3D-only startup, camera delegation, picking and source navigation.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..');
const {city,world}=JSON.parse(execFileSync('python3',['-c',"import sys,json;sys.path.insert(0,'tests');sys.path.insert(0,'.');from test_simulation import snapshot;from simulation import Simulation;from simulation.profile import VALUES;m=Simulation();d=snapshot(60,2);d['nodes'][0].update(kind='hub',district='civic',cityDistrict='civic',cityRole='knowledge-library',knowledgeScope='library',project='');d['nodes'][1].update(kind='article',district='civic',cityDistrict='civic',cityRole='library-item',knowledgeScope='library',libraryCategory='science',librarySource='https://example.org/article',project='');m.sync(d);m.advance(2*VALUES['construction_ticks']+VALUES['building_construction_ticks']);print(json.dumps({'city':d,'world':m.presentation()}))"],{cwd:root,maxBuffer:1<<26}).toString());
city.districts=[...new Set(city.nodes.map(n=>n.district))].map((id,i)=>({id,title:id,color:'#aabbcc',theme:'workspace',count:1,order:i}));
city.population=city.nodes.length;
world.places=[{id:'place:fixture',title:'Читальний сад',activity:'reading',district:city.districts[0].id,owner:city.nodes[0].stableId,capacity:3,hours:[6,22],position:[0,4],paths:[[[0,4],[4,4]]]}];
const noop=()=>{};let calls=0,layers=0;
const context=()=>new Proxy({},{get:(t,k)=>k==='measureText'?()=>({width:10}):k==='createLinearGradient'||k==='createRadialGradient'?()=>({addColorStop:noop}):k in t?t[k]:(...args)=>{calls++;for(const a of args)if(typeof a==='number')assert(Number.isFinite(a),`${String(k)} non-finite`);},set:(t,k,v)=>{t[k]=v;return true;}});
const element=()=>new Proxy({style:{},dataset:{},classList:{toggle:noop,remove:noop,add:noop},setAttribute:noop,append:noop,replaceChildren(...children){this.children=children;},addEventListener:noop,querySelector:()=>element(),getContext:()=>{layers++;return context();},setPointerCapture:noop},{get:(t,k)=>k in t?t[k]:typeof k==='string'?noop:undefined,set:(t,k,v)=>{t[k]=v;return true;}});
const elements={},listeners={},canvas=element();canvas.addEventListener=(k,f)=>{listeners[k]=f;};
const document={getElementById:id=>id==='city'?canvas:(elements[id]||(elements[id]=element())),createElement:()=>element(),createTextNode:text=>({text}),addEventListener:noop,body:element(),activeElement:{tagName:'BODY'}};
let frames=[],now=1000,oldPreferenceReads=0;const clockChecks=[];
const requests=[];
const sandbox={document,matchMedia:()=>({matches:false}),innerWidth:1200,innerHeight:800,devicePixelRatio:1,addEventListener:noop,requestAnimationFrame:f=>frames.push(f),setTimeout:noop,setInterval:(callback,ms)=>clockChecks.push({callback,ms}),clearTimeout:noop,performance:{now:()=>now},console,location:{},
  localStorage:{getItem:key=>{if(key==='brain-city-panel')return 'hidden';oldPreferenceReads++;return '2d';},setItem:noop},
  fetch:async(u,options={})=>{requests.push([u,options.headers||{}]);const body=u.startsWith('/api/note')?{content:'# Saved material'}:u.includes('/static')?world:u.includes('/live')?{...world,buildings:undefined}:city;return {ok:true,status:200,headers:{get:()=>'"tag"'},json:async()=>body};}};
sandbox.window=sandbox;vm.createContext(sandbox);
for(const file of ['city-plan.js','app.js'])vm.runInContext(fs.readFileSync(path.join(root,'web',file),'utf8'),sandbox,{filename:file});
const frame=()=>{now+=40;calls=0;frames.shift()(now);return calls;};
setTimeout(()=>{
  const run=code=>vm.runInContext(code,sandbox),cameraCalls=[];
  assert.match(elements.day.title,/геолокація недоступна/,'missing location is explained without a fixed clock fallback');
  for(const [date,latitude,longitude,expected] of [
    ['2026-06-21T04:30:00Z',51.4779,0,true],['2026-12-21T04:30:00Z',51.4779,0,false],
    ['2026-06-21T18:30:00Z',51.4779,0,true],['2026-12-21T18:30:00Z',51.4779,0,false],
    ['2026-06-21T00:00:00Z',78,0,true],['2026-12-21T12:00:00Z',78,0,false],
    ['2026-03-20T12:00:00Z',0,0,true],['2026-03-20T12:00:00Z',0,180,false],
    ['2026-03-20T05:50:00Z',0,0,false],['2026-03-20T06:10:00Z',0,0,true],
    ['2026-03-20T18:00:00Z',0,0,true],['2026-03-20T18:20:00Z',0,0,false]]){
    assert.equal(run(`solarDay(new Date('${date}'),${latitude},${longitude})`),expected,`${date}, ${latitude}, ${longitude}`);
  }
  run('receiveCityLocation({latitude:51.4779,longitude:0})');
  run("syncDayNight(new Date('2026-06-21T12:00:00Z'))");elements.day.onclick();
  run("syncDayNight(new Date('2026-06-21T12:30:00Z'))");assert.equal(run('state.day'),false,'manual preview lasts within the current solar period');
  run("syncDayNight(new Date('2026-06-21T23:00:00Z'));syncDayNight(new Date('2026-06-22T12:00:00Z'))");assert.equal(run('state.day'),true,'sunrise restores automatic lighting');
  run('receiveCityLocation({latitude:91,longitude:0})');assert.equal(run('solarLocation.latitude'),51.4779,'invalid locations cannot replace a valid fix');
  let nativeRequests=0;sandbox.webkit={messageHandlers:{cityLocation:{postMessage:message=>{assert.equal(message,'request');nativeRequests++;}}}};
  run('requestCityLocation(true)');assert.equal(nativeRequests,1,'native app requests the system location');
  run('receiveCityLocation({error:"Location unavailable"})');
  delete sandbox.webkit;
  let browserRequests=0;sandbox.navigator={geolocation:{getCurrentPosition:(success,error,options)=>{browserRequests++;assert.equal(options.enableHighAccuracy,false);success({coords:{latitude:0,longitude:0}});}}};
  run('requestCityLocation(true)');assert.equal(browserRequests,1,'browser uses system geolocation when the native bridge is absent');
  assert.equal(run('solarLocation.latitude'),0,'browser location restores automatic solar lighting');
  assert(clockChecks.some(c=>c.ms===30000),'solar changes are checked while the city stays open');
  frame();assert.equal(layers,1,'waiting for the 3D module never creates a 2D scene');
  assert(requests.some(([u])=>u==='/api/world/live')&&requests.some(([u])=>u==='/api/world/static'),'geometry and live state come from separate routes');
  let api;
  sandbox.attach3D(options=>{api=options;return {
    frame:()=>cameraCalls.push('frame'),resize:()=>cameraCalls.push('resize'),
    fit:()=>cameraCalls.push('fit'),focusDistrict:()=>cameraCalls.push('district'),focusNode:()=>cameraCalls.push('node'),
    zoom:()=>cameraCalls.push('zoom'),rotate:step=>cameraCalls.push('rotate:'+step),
    project:(x,y,z)=>({x:x+600,y:y-z+400}),hit:()=>({node:api.state.nodes[10],person:false})};});
  assert(cameraCalls.includes('fit'),'a late-loading 3D module frames the already-loaded city');
  api.onZoom(.85);assert.equal(elements['zoom-label'].textContent,'85%');assert.equal(run('state.zoom'),.85);
  elements['zoom-in'].onclick();elements['rotate-right'].onclick();
  assert(cameraCalls.includes('zoom')&&cameraCalls.includes('rotate:1'),'camera controls use the 3D view');
  frame();assert(cameraCalls.includes('frame'));assert.equal(layers,1,'only the labels and links use a canvas overlay');
  assert.equal(oldPreferenceReads,0,'an old 2D preference cannot switch the city out of 3D');
  // The left panel remembers being hidden and comes back with its toggle.
  assert.equal(run('panelOpen'),false,'a hidden panel stays hidden after a reload');elements['toggle-panel'].onclick();assert.equal(run('panelOpen'),true,'the toggle shows the panel again');
  listeners.pointermove({clientX:600,clientY:400});assert.equal(elements.tooltip.hidden,false,'ray picking drives the tooltip');
  listeners.pointerdown({clientX:600,clientY:400,pointerId:1});listeners.pointermove({clientX:640,clientY:420});listeners.pointerup({clientX:640,clientY:420});
  assert.equal(run('state.selected'),null,'dragging the 3D camera does not select a building');
  listeners.pointerdown({clientX:600,clientY:400,pointerId:1});listeners.pointerup({clientX:600,clientY:400});
  assert.equal(run('state.selected.id'),api.state.nodes[10].id,'a click selects the ray-picked source');
  elements['open-library'].onclick();assert(cameraCalls.includes('node'));
  assert.equal(elements['units-title'].textContent,'КАТАЛОГ · МАТЕРІАЛІВ: 1');assert.equal(elements['apartment-panel'].hidden,false);
  elements['apartment-units'].children[0].onclick();assert.equal(elements['library-source'].href,'https://example.org/article');assert.equal(elements['library-source'].hidden,false);
  assert(requests.some(([u])=>u.startsWith('/api/note?path=')),'source selection fetches the saved note');
  const html=fs.readFileSync(path.join(root,'web/index.html'),'utf8');assert(!html.includes('toggle-3d')&&!html.includes('/details.js'),'there is no mode switch or legacy renderer script');
  sandbox.WebGL2RenderingContext=undefined;
  vm.runInContext('(()=>{'+fs.readFileSync(path.join(root,'web/scene3d.js'),'utf8').replace(/^import .*;\n/gm,'')+'})();',sandbox,{filename:'scene3d.js'});
  assert.equal(elements['render-error'].hidden,false,'a missing WebGL2 context is explained without falling back to 2D');
  console.log('3D-only view: late startup, camera controls, picking, overlay, library/source navigation and WebGL2 failure state pass.');
},20);
