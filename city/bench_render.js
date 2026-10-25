#!/usr/bin/env node
/* CPU cost of the 3D plan and mesh build; GPU rendering and FPS are not measured. */
'use strict';
const fs=require('fs'),path=require('path'),{pathToFileURL}=require('url');
const CityPlan=require('./web/city-plan.js'),CityMesh=require('./web/city-mesh.js');
const dir=process.argv[2]||path.join(__dirname,'build','bench');
const city=JSON.parse(fs.readFileSync(path.join(dir,'city.json'))),world=JSON.parse(fs.readFileSync(path.join(dir,'world.json')));
city.districts=city.districts||[...new Set(city.nodes.map(n=>n.district))].map((id,i)=>({id,title:id,color:'#aabbcc',theme:'workspace',count:city.nodes.filter(n=>n.district===id).length,order:i}));
(async()=>{
  const THREE=await import(pathToFileURL(path.join(__dirname,'web/vendor/three.module.min.js')));
  const triangulate=points=>THREE.ShapeUtils.triangulateShape(points.map(([x,y])=>new THREE.Vector2(x,y)),[]).flat();
  let started=process.hrtime.bigint();const plan=CityPlan.fromWorld(city,world);
  const projectionMs=Number(process.hrtime.bigint()-started)/1e6;
  started=process.hrtime.bigint();const model=CityMesh.build(plan,{day:true,triangulate});
  const meshBuildMs=Number(process.hrtime.bigint()-started)/1e6;
  const triangles=[...model.chunks.values()].reduce((n,c)=>n+(c.lit.positions.length+c.glow.positions.length)/9,0);
  console.log(JSON.stringify({buildings:plan.nodes.length,projectionMs:+projectionMs.toFixed(2),meshBuildMs:+meshBuildMs.toFixed(2),triangles,chunks:model.chunks.size,rendererFps:null,scope:'CPU projection and 3D mesh construction only; camera changes reuse this geometry'}));
})().catch(error=>{console.error(error);process.exitCode=1;});
