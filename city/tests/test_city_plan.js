'use strict';
const assert=require('node:assert/strict');
const {plan,fromWorld,inside}=require('../web/city-plan.js');
const definitions=[['client-products','workspace',81],['commons','library',15],['systems-and-agents','observatory',10],['education-and-research','academy',16],['games','studio',3],['personal-tools','garden',14]];
const data={districts:definitions.map(([id,theme,count],order)=>({id,theme,count,order,color:'#aabbcc'})),nodes:definitions.flatMap(([district,,count])=>Array.from({length:count},(_,slot)=>({id:`${district}/${slot}.md`,district,slot,kind:slot===0?'class':slot===1?'hub':'note',words:300,degree:3}))) };
const city=plan(data);
function overlaps(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.d&&a.y+a.d>b.y;}
function segmentHitsBox(a,b,n,padding){let lo=0,hi=1;for(const [p,q]of [[-(b.x-a.x),a.x-n.x+padding],[b.x-a.x,n.x+n.w+padding-a.x],[-(b.y-a.y),a.y-n.y+padding],[b.y-a.y,n.y+n.d+padding-a.y]]){if(Math.abs(p)<1e-9){if(q<0)return false;continue;}const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return false;}return true;}
function intersects(a,b,c,d){const cross=(p,q,r)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);const u=cross(a,b,c),v=cross(a,b,d),w=cross(c,d,a),x=cross(c,d,b);return u*v<=.001&&w*x<=.001&&Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x))<=Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))+.001&&Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y))<=Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y))+.001;}
assert.equal(city.nodes.length,data.nodes.length);
for(let i=0;i<city.nodes.length;i++){
  const a=city.nodes[i];
  for(const b of city.nodes.slice(i+1))assert(!overlaps(a,b),`${a.id} overlaps ${b.id}`);
  for(const p of [{x:a.x,y:a.y},{x:a.x+a.w,y:a.y+a.d}])assert(inside(p,city.terrain.outline),`${a.id} leaves connected terrain`);
  for(const road of city.roads)for(let j=1;j<road.points.length;j++)assert(!segmentHitsBox(road.points[j-1],road.points[j],a,road.width/2-.01),`Street crosses ${a.id}`);
}
// All neighbourhood streets belong to the same geometric network.
const seen=new Set([0]);let changed=true;
while(changed){changed=false;for(let i=0;i<city.roads.length;i++){if(seen.has(i))continue;const r=city.roads[i];let found=false;for(const j of seen){const s=city.roads[j];for(let a=1;a<r.points.length&&!found;a++)for(let b=1;b<s.points.length;b++)if(intersects(r.points[a-1],r.points[a],s.points[b-1],s.points[b])){found=true;break;}if(found)break;}if(found){seen.add(i);changed=true;}}}
assert.equal(seen.size,city.roads.length,'Every street must reach the city network');
// Incremental growth leaves parcel positions and building models unchanged.
const grown=plan({...data,nodes:[...data.nodes,{id:'new.md',district:'client-products',slot:81,kind:'note',words:200,degree:1}]});
const after=new Map(grown.nodes.map(n=>[n.id,n]));for(const before of city.nodes){const n=after.get(before.id);assert.deepEqual([n.x,n.y,n.model],[before.x,before.y,before.model]);}
assert(new Set(city.nodes.map(n=>n.model)).size>=14,'Architecture must contain distinct silhouettes');
assert(city.districts.some(d=>d.pattern==='courtyards')&&city.districts.some(d=>d.pattern==='garden')&&city.districts.some(d=>d.pattern==='old-town'));
// A stable source identity retains its footprint and family after rename,
// metadata changes or temporary loss. Missing houses reserve their old lots.
const anchored={...data,nodes:data.nodes.map(n=>({...n,appearance:{seedKey:n.id,kind:n.kind}}))};
const originalPlan=plan(anchored),renamedPlan=plan({...anchored,nodes:anchored.nodes.map((n,i)=>({...n,id:'renamed/'+i+'.md',kind:'session',available:i!==0}))});
for(let i=0;i<originalPlan.nodes.length;i++){
  const a=originalPlan.nodes[i],b=renamedPlan.nodes[i];
  assert.deepEqual([a.x,a.y,a.w,a.d,a.model,a.seed],[b.x,b.y,b.w,b.d,b.model,b.seed],'Identity must preserve the physical building');
}
// The simulation world renders every source, keeps streets as continuous ways and buildings off the carriageway.
const {execFileSync}=require('node:child_process'),path=require('node:path');
const world=JSON.parse(execFileSync('python3',['-c',"import sys,json;sys.path.insert(0,'tests');sys.path.insert(0,'.');from test_simulation import river_band,snapshot;m=river_band(800);print(json.dumps({'world':m.presentation(),'nodes':snapshot(800,1)['nodes']}))"],{cwd:path.join(__dirname,'..'),maxBuffer:1<<26}).toString());
const rendered=fromWorld({districts:[{id:'systems-and-agents',theme:'observatory',count:800,color:'#aabbcc'}],nodes:world.nodes},world.world);
assert.equal(rendered.nodes.length,800);
assert.equal(rendered.roads.length,world.world.ways.length);
assert(rendered.roads.some(r=>r.kind==='bridge')&&rendered.rivers.length===3&&rendered.plaza&&rendered.paths.some(r=>r.kind==='promenade'));
for(const river of rendered.rivers){
  assert.equal(river.waterOutline.length,river.points.length*2);
  assert.equal(river.shoreOutline.length,river.points.length*2);
  assert(river.waterOutline.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
}
// Buildings are rotated with their street: test the true outline against each carriageway half-width.
const outline=n=>{const c=Math.cos(n.rot||0),s=Math.sin(n.rot||0),cx=n.rcx??n.x+n.w/2,cy=n.rcy??n.y+n.d/2;return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>({x:cx+a*n.w/2*c-b*n.d/2*s,y:cy+a*n.w/2*s+b*n.d/2*c}));};
const gap=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
for(const n of rendered.nodes){const poly=outline(n);for(const road of rendered.roads)for(let j=1;j<road.points.length;j++){const a=road.points[j-1],b=road.points[j];assert(poly.every(p=>gap(p,a,b)>road.width/2-.01)&&!poly.some((p,k)=>intersects(p,poly[(k+1)%4],a,b)),`Street crosses ${n.id}`);}}
// A quarter reads as one place: one wall palette, one roof colour, one row-house type.
const styled=fromWorld({districts:[{id:'a',theme:'studio',count:75,color:'#c7928d'},{id:'b',theme:'academy',count:75,color:'#88aeb8'}],nodes:world.nodes.map((n,i)=>({...n,district:i%2?'a':'b'}))},world.world);
for(const id of ['a','b']){const own=styled.nodes.filter(n=>n.district===id);assert(new Set(own.map(n=>n.color)).size<=3);assert.equal(new Set(own.map(n=>n.roof)).size,1);}
assert.notEqual(styled.nodes.find(n=>n.district==='a').roof,styled.nodes.find(n=>n.district==='b').roof);
// Sub-quarters: blocks of two projects in one class get different ground shades and their own labels.
const projectWorld={...world.world,blocks:world.world.blocks.map((b,i)=>({...b,district:'a',neighbourhood:i%2?'projects/one':'projects/two'}))};
const split=fromWorld({districts:[{id:'a',theme:'studio',count:400,color:'#c7928d'}],nodes:[...world.nodes.map(n=>({...n,district:'a'})),{id:'projects/one.md',title:'one'}]},projectWorld);
assert.equal(split.districts[0].quarters.length,2);
assert(split.districts[0].quarters.some(q=>q.title==='One'));
assert.equal(new Set(split.districts[0].blocks.map(b=>b.ground)).size,2);
const civicNodes=world.nodes.slice(0,2).map((n,i)=>({...n,district:'civic',sourceClass:'systems-and-agents',project:'projects/brain.md',cityRole:i?'council':'town-hall'}));
const civicWorld={...world.world,buildings:{...world.world.buildings}};
for(const n of civicNodes)civicWorld.buildings[n.stableId]={...civicWorld.buildings[n.stableId],model:n.cityRole};
const civic=fromWorld({districts:[{id:'civic',theme:'civic',count:2,color:'#e1c66e'}],nodes:civicNodes},civicWorld);
assert.deepEqual(civic.nodes.map(n=>n.model),['town-hall','council']);
assert(civic.nodes.every(n=>n.project==='projects/brain.md'&&n.sourceClass==='systems-and-agents'&&n.theme==='civic'));
const apartments={...civicWorld,buildings:{...civicWorld.buildings}};
for(let i=0;i<civicNodes.length;i++)apartments.buildings[civicNodes[i].stableId]={...apartments.buildings[civicNodes[0].stableId],model:'apartment-tower',physicalId:'residence:one',unit:i+1};
const shared=fromWorld({districts:[{id:'civic',theme:'civic',count:2,color:'#e1c66e'}],nodes:civicNodes},apartments);
assert.equal(shared.nodes.length,1);assert.equal(shared.sources.length,2);assert.equal(shared.nodes[0].members.length,2);
assert.equal(shared.districts[0].physicalCount,1);
console.log('City plan: no overlapping buildings, no streets crossing buildings, connected streets and terrain, stable growth, varied architecture; simulation world renders with bridges, rivers and promenades.');
