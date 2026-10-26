'use strict';
// 3D geometry: finite buffers, real walls on every side, rotated buildings stay in their footprint, bounded size.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..'),CityPlan=require(path.join(root,'web','city-plan.js')),CityMesh=require(path.join(root,'web','city-mesh.js'));
const MAX_TRIANGLES_PER_BUILDING=2500,EPS=1e-3,LOT=27;

(async()=>{
  const THREE=await import(path.join(root,'web','vendor','three.module.min.js'));
  const triangulate=points=>THREE.ShapeUtils.triangulateShape(points.map(([x,y])=>new THREE.Vector2(x,y)),[]).flat();
  const check=(model,label)=>{let triangles=0;
    for(const [key,chunk] of model.chunks)for(const part of [chunk.lit,chunk.glow]){
      assert.equal(part.positions.length,part.normals.length,`${label} ${key}: one normal per vertex`);assert.equal(part.positions.length,part.colors.length,`${label} ${key}: one colour per vertex`);
      for(const v of part.positions)assert(Number.isFinite(v),`${label} ${key}: finite positions`);
      for(let i=0;i<part.normals.length;i+=3)assert(Math.abs(Math.hypot(part.normals[i],part.normals[i+1],part.normals[i+2])-1)<EPS,`${label} ${key}: unit normals`);
      for(const c of part.colors)assert(c>=0&&c<=1,`${label} ${key}: linear colours in range`);
      triangles+=part.positions.length/9;}
    return triangles;};

  // One rotated gabled house on an empty plan.
  const house={id:'h',district:'d',x:100,y:50,w:30,d:20,h:40,rot:Math.PI/6,rcx:115,rcy:60,color:'#c9a77c',roof:'#8a5a44',model:'cottage',walk:[{x:115,y:75},{x:115,y:85}],lifecycle:'open'};
  const empty={terrain:{outline:[{x:-500,y:-500},{x:500,y:-500},{x:500,y:500},{x:-500,y:500}]},rivers:[],districts:[{id:'d',blocks:[]}],roads:[],paths:[],nodes:[house],scenery:[],sources:[house]};
  for(const day of [true,false]){
    const model=CityMesh.build(empty,{day,triangulate});check(model,day?'day':'night');
    const lit=model.chunks.get('district:d').lit,p=lit.positions,n=lit.normals,c=Math.cos(-house.rot),s=Math.sin(-house.rot),walls=new Set();
    for(let i=0;i<p.length;i+=3){const dx=p[i]-house.rcx,dy=p[i+2]-house.rcy,lx=house.rcx+dx*c-dy*s-house.x,ly=house.rcy+dx*s+dy*c-house.y;
      // Garden, front path and roof overhang reach beyond the walls, never further than the lot.
      assert(lx>-LOT&&lx<house.w+LOT&&ly>-LOT&&ly<house.d+LOT,'rotated house stays on its rotated lot');
      assert(p[i+1]>=CityMesh.Z.base-EPS&&p[i+1]<=CityMesh.Z.base+house.h+30+EPS,'house height stays within body and roof');}
    // The entrance faces the house's own path: door-coloured vertices sit on the wall nearest the door point.
    const door=CityMesh.colour(day?'#4d665b':'#253b38'),col=lit.colors;let sx=0,sy=0,count=0;
    for(let i=0;i<col.length;i+=3)if(Math.abs(col[i]-door[0])<EPS&&Math.abs(col[i+1]-door[1])<EPS&&Math.abs(col[i+2]-door[2])<EPS){sx+=p[i];sy+=p[i+2];count++;}
    assert(count>0,'the house has a door');
    const dx=sx/count-house.rcx,dy=sy/count-house.rcy,wx=house.walk[0].x-house.rcx,wy=house.walk[0].y-house.rcy;
    assert(dx*wx+dy*wy>0,'the door faces the path, not the back yard');
    for(let i=0;i<n.length;i+=9)if(Math.abs(n[i+1])<EPS)walls.add(`${Math.round(Math.abs(n[i])*10)}:${Math.round(Math.abs(n[i+2])*10)}`);
    assert(walls.size>=2,'walls face both horizontal axes of the house');
    assert.equal(model.picks.length,1,'the house can be picked');
    if(!day)assert(model.chunks.get('district:d').glow.positions.length>0,'windows glow at night');
  }
  const early=CityMesh.build({...empty,nodes:[{...house,lifecycle:'construction',constructionProgress:.1}],sources:[]},{day:true,triangulate});
  const late=CityMesh.build({...empty,nodes:[{...house,lifecycle:'construction',constructionProgress:.9}],sources:[]},{day:true,triangulate});
  assert.notDeepEqual(early.chunks.get('district:d').lit.positions,late.chunks.get('district:d').lit.positions,'construction geometry rises with persisted progress');

  // Every model and service function builds finite geometry by day and night, whichever side its door is on.
  const MODELS=['grand-library','town-hall','solar-lab','grid-control','battery-vault','college','apartment-tower','manor','sports-institute','research-institute','training-hall','district-hall','council','project-council','registry','cottage','timber-house','townhouse','merchant-house','clock-house','atelier','maker-house','greenhouse','observatory','laboratory','library-wing','archive','city-archive','theatre','workshop','headquarters','data-tower','office','terrace'];
  const SERVICES=['stadium','campus','solar-centre','swimming-pool','football-centre','velodrome','medical-centre','concert-hall','town-hall','library','market','arts-centre','innovation-centre','media-centre','clinic','research-lab','tribology-lab','sports-lab','energy-lab','article-market','motion-lab','practice-centre','memory-vault','lab-depot'];
  const doors=[{x:115,y:40},{x:140,y:60},{x:115,y:80},{x:90,y:60}];
  const nodes=MODELS.map((model,i)=>({...house,id:'m'+i,model,h:model==='town-hall'?135:60,rot:i%3?.3:0,walk:[doors[i%4],doors[i%4]],lifecycle:i===2?'construction':'open'}));
  // A project compound draws its shared forecourt, gallery and sign as finite geometry on either door side.
  for(const walk of [[{x:300,y:420}],[{x:300,y:270}]])assert(check(CityMesh.build({...empty,nodes:[],sources:[],scenery:[{kind:'compound',x:200,y:280,w:200,d:130,rot:.2,rcx:300,rcy:345,walk,members:3},{kind:'gallery',x:220,y:400,w:160,d:12,rot:.2,rcx:300,rcy:406,walk,accent:'#c9a77c'}]},{day:false,triangulate}),'compound')>60,'compound geometry');
  // Founding and contemporary eras add facade details to an ordinary house; the middle eras only recolour.
  const townhouse=era=>check(CityMesh.build({...empty,nodes:[{...nodes[MODELS.indexOf('townhouse')],era}],sources:[]},{day:true,triangulate}),'era '+era);
  assert(townhouse(0)>townhouse(2)&&townhouse(3)>townhouse(2)&&townhouse(1)===townhouse(2),'era facade details');
  const services=SERVICES.map((fn,i)=>({kind:'service',function:fn,x:300,y:300,w:120,d:90,h:40,rot:i%2?.2:0,rcx:360,rcy:345,facility:{id:'s'+i,title:fn,district:'d'}}));
  for(const day of [true,false]){const m=CityMesh.build({...empty,nodes,sources:nodes,scenery:services},{day,triangulate});check(m,'models');assert.equal(m.picks.length,nodes.length+services.length,'every model and service can be picked');
    for(const p of m.picks)assert(p.h>5&&Number.isFinite(p.h),'pick boxes cover the model height');}

  // A simulated city through the real plan projection.
  const {city,world}=JSON.parse(execFileSync('python3',['-c',"import sys,json;sys.path.insert(0,'tests');sys.path.insert(0,'.');from test_simulation import snapshot;from simulation import Simulation;from simulation.profile import VALUES;m=Simulation();d=snapshot(60,2);m.sync(d);m.advance(2*VALUES['construction_ticks']+VALUES['building_construction_ticks']);print(json.dumps({'city':d,'world':m.presentation()}))"],{cwd:root,maxBuffer:1<<26}).toString());
  city.districts=[...new Set(city.nodes.map(n=>n.district))].map((id,i)=>({id,title:id,color:'#aabbcc',theme:'workspace',count:1,order:i}));
  const plan=CityPlan.fromWorld(city,world),started=process.hrtime.bigint(),model=CityMesh.build(plan,{day:true,triangulate});
  const ms=Number(process.hrtime.bigint()-started)/1e6,triangles=check(model,'city');
  assert(model.chunks.has('ground'),'ground chunk exists');
  assert(triangles/Math.max(1,plan.nodes.length)<MAX_TRIANGLES_PER_BUILDING,`triangle budget (${triangles} for ${plan.nodes.length} buildings)`);
  assert(model.trees.length>=plan.scenery.filter(o=>o.kind==='tree').length,'every planted tree becomes an instance; complexes may add their own');
  // Landscape (LANDSCAPE.md): trees stay off rivers and built blocks; forest, edge shrubs and both leaf types exist.
  assert(model.chunks.has('landscape'),'the landscape is built');
  const pads=plan.districts.flatMap(d=>d.blocks.filter(b=>b.pad).map(b=>b.pad)),inPad=(p,poly)=>{let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;};
  const gap=(p,pts)=>{let best=Infinity;for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy||1,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l));best=Math.min(best,Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t));}return best;};
  const wild=model.trees.filter(t=>t.wild);
  assert(wild.length>0&&wild.some(t=>t.conifer)&&wild.some(t=>!t.conifer)&&wild.some(t=>t.size<10),'forest has conifers, broadleaves and edge shrubs');
  for(const t of wild){assert(!pads.some(p=>inPad(t,p)),'no tree on a city block');for(const r of plan.rivers)assert(gap(t,r.points)>r.width/2,'no tree in the river');}
  // Fields only for project reference data: none without such documents, one per document with them.
  assert.equal(model.picks.filter(p=>p.field).length,0,'no reference data, no fields');
  const docs=plan.sources.filter(s=>s.available!==false).slice(0,5);
  const farmed=CityMesh.build({...plan,sources:plan.sources.map(s=>docs.includes(s)?{...s,cityField:true,words:400}:s)},{day:true,triangulate});
  const fields=farmed.picks.filter(p=>p.field);
  assert.equal(fields.length,docs.length,'every reference document farms one field');
  for(const f of fields){assert(docs.some(d=>d.id===f.node.id),'a field opens its own document');assert(!pads.some(p=>inPad({x:f.cx,y:f.cy},p)),'no field inside the city');}
  const dimmed=CityMesh.build(plan,{day:true,triangulate,matches:()=>false});assert.notDeepEqual(dimmed.chunks.get([...dimmed.chunks.keys()].find(k=>k.startsWith('district:'))).lit.colors.slice(0,30),model.chunks.get([...model.chunks.keys()].find(k=>k.startsWith('district:'))).lit.colors.slice(0,30),'the filter dims buildings');

  // Optional: the 3000-building benchmark plan, when it has been dumped.
  const bench=path.join(root,'build','bench');let benchLine='';
  if(fs.existsSync(path.join(bench,'world.json'))){const bc=JSON.parse(fs.readFileSync(path.join(bench,'city.json'))),bw=JSON.parse(fs.readFileSync(path.join(bench,'world.json')));
    bc.districts=bc.districts||[...new Set(bc.nodes.map(n=>n.district))].map((id,i)=>({id,title:id,color:'#aabbcc',theme:'workspace',count:1,order:i}));
    const bp=CityPlan.fromWorld(bc,bw),t=process.hrtime.bigint(),bm=CityMesh.build(bp,{day:false,triangulate}),bms=Number(process.hrtime.bigint()-t)/1e6;benchLine=` · bench ${bp.nodes.length} buildings: ${check(bm,'bench')} triangles in ${bms.toFixed(0)} ms`;}
  console.log(`City mesh: finite buffers, walls on all sides, rotated lot, door to the path, all ${MODELS.length} models and ${SERVICES.length} services, glowing night windows, filter dimming; ${plan.nodes.length} buildings → ${triangles} triangles in ${ms.toFixed(0)} ms${benchLine}.`);
})().catch(error=>{console.error(error);process.exit(1);});
