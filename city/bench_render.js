#!/usr/bin/env node
/* Render benchmark in Node: real app code against a counting 2D context (JS cost only, no rasterization). */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const dir=process.argv[2]||path.join(__dirname,'build','bench');
const city=JSON.parse(fs.readFileSync(path.join(dir,'city.json'))),world=JSON.parse(fs.readFileSync(path.join(dir,'world.json')));
city.districts=city.districts||[...new Set(city.nodes.map(n=>n.district))].map((id,i)=>({id,title:id,color:'#aabbcc',theme:'workspace',count:city.nodes.filter(n=>n.district===id).length,order:i}));
city.edges=city.edges||[];city.population=city.nodes.length;city.version=city.version||'bench';
const noop=()=>{};let calls=0;
const context=()=>new Proxy({},{get:(t,k)=>k==='measureText'?()=>({width:10}):k==='createLinearGradient'||k==='createRadialGradient'||k==='createPattern'?()=>({addColorStop:noop}):k==='getImageData'?()=>({data:[]}):k in t?t[k]:(...a)=>{calls++;},set:(t,k,v)=>{t[k]=v;return true;}});
const element=()=>new Proxy({style:{},dataset:{},classList:{toggle:noop,remove:noop,add:noop,contains:()=>false},setAttribute:noop,append:noop,replaceChildren:noop,addEventListener:noop,querySelector:()=>element(),getContext:()=>context(),setPointerCapture:noop,getBoundingClientRect:()=>({left:0,top:0,width:1500,height:1000})},{get:(t,k)=>k in t?t[k]:typeof k==='string'?noop:undefined,set:(t,k,v)=>{t[k]=v;return true;}});
const elements={},listeners={};
const canvas=element();canvas.addEventListener=(k,f)=>{listeners[k]=f;};
const document={getElementById:id=>id==='city'?canvas:(elements[id]||(elements[id]=element())),createElement:()=>element(),addEventListener:noop,body:element(),activeElement:{tagName:'BODY'},documentElement:element()};
let frames=[],now=1000;
const sandbox={document,matchMedia:()=>({matches:false,addEventListener:noop}),innerWidth:1500,innerHeight:1000,devicePixelRatio:2,addEventListener:noop,requestAnimationFrame:f=>frames.push(f),setTimeout:noop,clearTimeout:noop,setInterval:noop,performance:{now:()=>now},console,location:{},OffscreenCanvas:undefined,
  fetch:async u=>({ok:true,status:200,headers:{get:()=>null},json:async()=>u.includes('world')?world:city})};
sandbox.window=sandbox;sandbox.globalThis=sandbox;vm.createContext(sandbox);
for(const file of ['city-plan.js','details.js','app.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'web',file),'utf8')+(file==='details.js'?';globalThis.CityDetails=CityDetails;':''),sandbox,{filename:file});
const plan=sandbox.CityPlan;
let started=process.hrtime.bigint();for(let i=0;i<5;i++)plan.fromWorld({...city,nodes:city.nodes},world);
const fromWorldMs=Number(process.hrtime.bigint()-started)/5e6;
const frame=count=>{let total=0n;calls=0;for(let i=0;i<count;i++){now+=40;const f=frames.shift();const s=process.hrtime.bigint();f(now);total+=process.hrtime.bigint()-s;}return {ms:Number(total)/count/1e6,calls:calls/count};};
setTimeout(()=>{const first=frame(1);frame(2);const overview=frame(20);
  // Panning: drag the camera a little each frame.
  listeners.pointerdown?.({clientX:700,clientY:500,pointerId:1});let pan={ms:0,calls:0};
  for(let i=0;i<20;i++){listeners.pointermove?.({clientX:700+i*6,clientY:500+i*3});const r=frame(1);pan.ms+=r.ms/20;pan.calls+=r.calls/20;}
  listeners.pointerup?.({clientX:820,clientY:560});
  listeners.wheel?.({preventDefault:noop,deltaY:-900,clientX:750,clientY:500});const zooming=frame(1);now+=400;const rebuild=frame(1);const close=frame(20);
  console.log(JSON.stringify({buildings:city.nodes.length,firstFrameMs:+first.ms.toFixed(1),firstCalls:Math.round(first.calls),fromWorldMs:+fromWorldMs.toFixed(1),overviewMs:+overview.ms.toFixed(2),overviewCalls:Math.round(overview.calls),panMs:+pan.ms.toFixed(2),panCalls:Math.round(pan.calls),zoomingMs:+zooming.ms.toFixed(2),rebuildMs:+rebuild.ms.toFixed(2),closeMs:+close.ms.toFixed(2),closeCalls:Math.round(close.calls)}));},20);
