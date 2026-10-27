'use strict';
// Mountain of Ideas rules (IDEA-MOUNTAIN.md, IM-03…IM-13): places, attention, progress, focus, links, belts, trail, water.
const assert=require('node:assert/strict'),path=require('node:path');
const M=require(path.join(__dirname,'../web/mountain-plan.js'));
const today=Date.parse('2026-10-27'),ago=n=>new Date(today-n*864e5).toISOString().slice(0,10);
const idea=(id,status,days,words=0,links=[])=>({path:id,title:id,status,created:ago(days),updated:ago(days),words,links});
const ideas=[...Array.from({length:6},(_,i)=>idea(`s${i}`,'seed',1,i*40)),idea('rest','seed',9),idea('old','seed',20),
  ...Array.from({length:4},(_,i)=>idea(`g${i}`,'growing',i*3,i*100)),...Array.from({length:4},(_,i)=>idea(`p${i}`,'project',2,300,i===0?['g3']:[])),
  idea('x0','shelved',100),idea('x1','shelved',5)];
const {flags,camps,ropes,summit,station}=M.layout(ideas,today),by=id=>flags.find(f=>f.idea.path===id);
assert.equal(flags.length,ideas.length,'every idea stands on the mountain');
assert(flags.every(f=>[f.x,f.y,f.z].every(Number.isFinite)),'places are finite');
// IM-03: a seed untouched for a week rests in the quiet valley by the lake.
assert.deepEqual(['s0','rest','old'].map(id=>by(id).stage),['seed','incubating','incubating']);
const L=M.MOUNTAIN.lake;assert(flags.filter(f=>f.stage==='incubating').every(f=>Math.hypot(f.x-L.x,f.z-L.z)<L.r*2),'incubating seeds wait by the lake');
// IM-04: attention after the interval of the place.
assert.deepEqual(['s0','rest','old','g0','g3','x0','x1'].map(id=>by(id).due),[false,false,true,false,true,true,false]);
// IM-05: within a stage, more developed ideas stand higher up the trail.
const seeds=['s0','s1','s2','s3','s4','s5'].map(by);for(let i=1;i<seeds.length;i++)assert(seeds[i].s>seeds[i-1].s,'development climbs');
const gaps=seeds.slice(1).map((f,i)=>f.s-seeds[i].s);assert(Math.min(...gaps)>0,'neighbours never share a spot');
// IM-07: three projects fit on the summit, a fourth makes it crowded.
assert.deepEqual(summit,{count:4,capacity:3,crowded:true});
// IM-08: linked ideas share a rope.
assert.deepEqual(ropes.map(([a,b])=>[a.idea.path,b.idea.path]),[['p0','g3']]);
assert.deepEqual(camps.map(c=>[c.stage,c.count]),[['seed',6],['growing',4],['project',4],['incubating',2]]);
// IM-11: each stage's stretch lies in its altitude belt.
const mean=stage=>{const [a,b]=M.ZONES[stage];let sum=0,n=0;for(let s=a;s<=b;s+=.01){sum+=M.trail(s).y;n++;}return sum/n;};
assert(mean('seed')<M.BELTS.meadow,'seeds in the valley meadows');
assert(mean('growing')>M.BELTS.meadow&&mean('growing')<M.BELTS.treeline,'growing ideas in the forest belt');
assert(mean('project')>M.BELTS.treeline,'projects above the tree line');
// IM-12: the trail climbs at a sustainable grade and reaches the summit.
const {points,run}=M.trailLine();let steepest=0;for(let i=1;i<points.length;i++)steepest=Math.max(steepest,Math.abs(points[i].y-points[i-1].y)/(run[i]-run[i-1]));
const average=(points.at(-1).y-points[0].y)/run.at(-1);
assert(average<=.12&&steepest<=.25,`trail grade average ${(average*100).toFixed(1)}%, max ${(steepest*100).toFixed(1)}%`);
assert(M.trail(1).y>M.MOUNTAIN.peak*.9&&M.trail(0).y<M.BELTS.meadow*.2,'the trail runs from the valley to the summit');
for(let s=0;s<=1;s+=.01)assert(M.trail(s).y>M.MOUNTAIN.water,'the trail stays out of the lake');
// IM-13: streams start below the snow line and only run downhill.
const streams=M.streams();assert(streams.length>=3,'snowmelt streams');
for(const line of streams){assert(line[0].y<=M.BELTS.snow);for(let i=1;i<line.length;i++)assert(line[i].y<line[i-1].y,'water flows downhill');}
assert(flags.filter(f=>f.stage==='shelved').every(f=>Math.hypot(f.x-station.x,f.z-station.z)<120),'shelved ideas wait at the station');
assert.equal(station.y,M.MOUNTAIN.flatHeight,'the station yard is level');
assert.deepEqual(M.layout(ideas,today).flags.map(f=>[f.x,f.z]),flags.map(f=>[f.x,f.z]),'the layout is deterministic');
console.log(`Mountain plan: ${flags.length} ideas; stretches at ${mean('seed').toFixed(0)} / ${mean('growing').toFixed(0)} / ${mean('project').toFixed(0)} m, trail ${(average*100).toFixed(1)}% avg, ${(steepest*100).toFixed(1)}% max, ${streams.length} streams; incubation, attention, progress, summit focus and ropes pass.`);
