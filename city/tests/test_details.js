'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const surfaces=[],draws=[];
const context=()=>new Proxy({createRadialGradient:()=>({addColorStop(){}})}, {get(target,key){if(key in target)return target[key];return (...args)=>{for(const arg of args)if(typeof arg==='number')assert(Number.isFinite(arg),`${key}: non-finite geometry`);if(key==='drawImage')draws.push(args);};}});
const sandbox={document:{createElement(name){assert.equal(name,'canvas');const c={width:0,height:0,getContext:context};surfaces.push(c);return c;}},innerWidth:1440,innerHeight:960};
vm.createContext(sandbox);vm.runInContext(fs.readFileSync(`${__dirname}/../web/details.js`,'utf8')+'\nthis.models=CityDetails;',sandbox);
const state={day:true,zoom:1,time:1,paused:false,reduced:false};
const hash=s=>[...s].reduce((a,c)=>(Math.imul(a,31)+c.charCodeAt(0))>>>0,0);
const env={ctx:context(),project:(x,y,z=0)=>({x:500+x-y,y:400+(x+y)/2-z}),box(){},quad(){},lineWorld(){},tint:c=>c,state,hash};
const models=sandbox.models.create(env),node={id:'old.md',stableId:'source-1',appearance:{seedKey:'durable-seed'}};
const hit=models.person(node,0,0,{x:1,y:0},true),first=draws.at(-1);
assert.equal(hit.node,node);assert.equal(hit.person,true);
const renamed={...node,id:'renamed.md'};models.person(renamed,0,0,{x:1,y:0},true);
assert.strictEqual(draws.at(-1)[0],first[0],'rename preserves appearance');
assert.equal(surfaces.length,1,'same avatar reuses one sheet');
assert.notEqual(first[1],0,'walking advances the sprite phase');
state.paused=true;models.person(node,0,0,{x:1,y:0},true);assert.equal(draws.at(-1)[1],0,'pause freezes the gait');
state.paused=false;state.reduced=true;models.person(node,0,0,{x:1,y:0},true);assert.equal(draws.at(-1)[1],0,'reduced motion freezes the gait');
state.reduced=false;models.person(node,0,0,{x:1,y:0},false);assert.equal(draws.at(-1)[1],0,'arrived residents do not walk in place');
const facing=[];for(const dir of [{x:0,y:1},{x:1,y:0},{x:0,y:-1},{x:-1,y:0}]){models.person(node,0,0,dir,false);facing.push(draws.at(-1)[2]);}assert.equal(new Set(facing).size,4);
state.zoom=.1;const before=surfaces.length;models.person({...node,appearance:{seedKey:'another'}},0,0,{x:1,y:0},true);assert.equal(surfaces.length,before,'overview skips detailed sprites');
state.zoom=3;assert.equal(models.person(node,5000,0,{x:1,y:0},true),null,'offscreen residents are culled');
for(const day of [true,false]){state.day=day;for(let i=0;i<1000;i++){models.person({id:String(i)},0,0,{x:1,y:0},true);models.tree(0,0,10+i%25,i);}}
assert(surfaces.length<=144,'avatar and foliage caches stay bounded across the whole city');
for(const d of draws){assert(d[0].width>0&&d[0].height>0);if(d.length===9){assert(d[1]+d[3]<=d[0].width);assert(d[2]+d[4]<=d[0].height);}}
for(const zoom of [.1,.6,1,3])for(const day of [true,false]){state.zoom=zoom;state.day=day;for(const model of ['college','manor','apartment-tower','laboratory','timber-house','town-hall'])models.facade({x:0,y:0,w:24,d:20,color:'#bbaacc',roof:'#887799',model,seed:12},60);for(const type of ['stadium','campus','solar-centre','arts-centre','media-centre','market'])models.service({x:0,y:0,w:30,d:25,h:18,function:type});for(const kind of ['lamp','bench'])models.furniture({x:0,y:0,kind});}
console.log('Visual models: stable identities, bounded sprite caches, four directions, walking/pause/reduced motion, clipping and finite geometry pass.');
for(const zoom of [.15,.6,1.5,3])for(const day of [true,false]){state.zoom=zoom;state.day=day;
  for(const model of ['grand-library','town-hall','solar-lab','grid-control','battery-vault'])assert.equal(models.signatureBuilding({x:0,y:0,w:28,d:22,h:135,model}),true);
  assert.equal(models.signatureBuilding({model:'townhouse'}),false);
  for(const [type,w,d] of [['stadium',396,300],['stadium',300,396],['campus',276,228],['solar-centre',204,156],['swimming-pool',106,82],['football-centre',300,211],['velodrome',192,120],['medical-centre',120,96],['concert-hall',115,86]])assert.equal(models.signatureService({x:0,y:0,w,d,function:type}),true);
}
console.log('Landmark models: unique silhouettes and both stadium orientations render finite geometry in day/night at every detail level.');
for(const zoom of [.15,.6,1.5,3])for(const day of [true,false]){state.zoom=zoom;state.day=day;
  for(const activity of ['training','reading','discussion','experiment','maintenance','filming','play','rehearsal','meeting']){
    models.place({x:0,y:0,activity});models.person(node,0,0,{x:0,y:1},false,activity);
  }
}
assert(surfaces.length<=144,'outdoor activities reuse the bounded resident cache');
console.log('Outdoor places and visitor activity props render finite geometry in day/night at every detail level.');
