/* Mountain of Ideas zone: a separate 3D landscape reached by train; terrain, places and rules come from MountainPlan
   (IDEA-MOUNTAIN.md). */
import * as THREE from './vendor/three.module.min.js';
import {OrbitControls} from './vendor/OrbitControls.js';

// Clouds drift on a far ring, so they frame the mountain without covering the view.
const CLOUD_RING=[1700,900],CLOUD_HEIGHT=[640,260];
const GRID=200,TREES=1500,ROCKS=110,CLOUDS=9,STARS=900,TRAIL_SAMPLES=1200,TRAIL_WIDTH=7,TRAIL_LIFT=1.2,TRAIL_CLEAR=16;
const INTRO_MS=2600,FOCUS_MS=1100,MOVE_MS=2200,LABEL_MAX=34,OCCLUSION_STEPS=24,ROPE_SAG=.12,ROPE_POINTS=14;
// Per place: pole height and pennant size, the object at its foot (IM-10), the pick box and the label lift.
const MARK={seed:{pole:13,cloth:[8,5],at:[-6.5,0,-1],top:7},incubating:{pole:15,cloth:[8,5],at:[7,0,-6],top:9},growing:{pole:18,cloth:[10,6],at:[-7.5,0,3],top:18},project:{pole:34,cloth:[16,10],at:[-11,0,-8],top:19},shelved:{pole:11,cloth:[6,4],at:[6.5,0,-3],top:10}};
const FOOTING=6,GLADE=22,RAIL_CLEAR=[60,110];
const SIZE={base:1.3,growth:.9},ROCK_SLOPE=1.15,PICK=[22,30,22],LANTERN={radius:1.5,lift:4,pulse:3.2};
const CAMERA={fov:38,near:5,far:9000,approach:[320,90,-200,120],view:[1238,820,847],target:[0,190,0],min:220,max:2600,polar:1.42,spin:.35};
const ZONE_VIEW=[820,520],STAGE_TINT=.55,CAMP={gate:[16,22],tent:6},KRUMMHOLZ={band:90,shrink:.7};
// Colour-blind-safe stage hues that also differ in lightness (IM-09).
const STAGE_COLOURS={seed:'#f2c14e',incubating:'#b49ad8',growing:'#7cc47a',project:'#5fb3c9',shelved:'#9aa7a6'};
const PALETTE={
  day:{sky:'#a9cfe2',fog:'#c8dde6',hemi:['#fff8ea','#6f8a62',1.5],sun:['#fff0d2',1.9],meadow:'#93b96f',forest:'#5d8a4f',alpine:'#a9b873',rock:'#8d918a',scree:'#a39b8c',dark:'#6f6f6c',snow:'#f6f5ef',sand:'#e2d2a2',water:'#5fa6bf',crown:'#4f7d47',leaf:'#6f9d4f',beacon:'#f4d27a',lantern:'#ffd27a',rope:'#cdbb92'},
  night:{sky:'#14202c',fog:'#1b2833',hemi:['#9fb4c8','#2c3b32',1.1],sun:['#c9d8ff',.55],meadow:'#3f5c44',forest:'#2f4a36',alpine:'#4d5a45',rock:'#5a605e',scree:'#5f5a52',dark:'#474b4a',snow:'#c9d2d6',sand:'#8f8a73',water:'#28485a',crown:'#2a4433',leaf:'#34503a',beacon:'#ffe08a',lantern:'#ffd27a',rope:'#8d8167'},
};
const PLACE_NAMES={seed:'Зерно',incubating:'Інкубація',growing:'Проростає',project:'Проєкт',shelved:'Відкладена'};

let view=null;
function build(canvas,labels){
  const plan=window.MountainPlan,{MOUNTAIN,BELTS,height,trail}=plan;
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true}),scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(CAMERA.fov,1,CAMERA.near,CAMERA.far),controls=new OrbitControls(camera,canvas);
  Object.assign(controls,{enableDamping:true,dampingFactor:.08,minDistance:CAMERA.min,maxDistance:CAMERA.max,maxPolarAngle:CAMERA.polar,autoRotate:true,autoRotateSpeed:CAMERA.spin});
  controls.target.set(...CAMERA.target);
  const hemi=new THREE.HemisphereLight(),sun=new THREE.DirectionalLight();sun.position.set(-900,1400,700);scene.add(hemi,sun);
  scene.fog=new THREE.Fog('#ffffff',1800,6200);
  const lit=()=>new THREE.MeshLambertMaterial({vertexColors:true,flatShading:true});
  const world=new THREE.Group(),flagGroup=new THREE.Group();scene.add(world,flagGroup);
  const colour=new THREE.Color(),matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),pos=new THREE.Vector3(),size=new THREE.Vector3();
  let palette=null,flags=[],camps=[],ropes=[],hovered=null,flight=null,last=performance.now(),running=false,onPick=()=>{},summitInfo=null;
  const previous=new Map(),models={};let woods=null;
  const random=(()=>{let a=7;return ()=>{a=(a*16807)%2147483647;return a/2147483647;};})();
  const slope=(x,z)=>{const e=6;return Math.hypot(height(x+e,z)-height(x-e,z),height(x,z+e)-height(x,z-e))/(2*e);};
  // The terrain mesh is linear between grid vertices; everything that stands on the mountain uses this surface rather
  // than the analytic height, so nothing floats above the slope or sinks into it.
  const cell=MOUNTAIN.size/GRID,half=MOUNTAIN.size/2,grid=new Float32Array((GRID+1)**2);
  for(let iy=0;iy<=GRID;iy++)for(let ix=0;ix<=GRID;ix++)grid[iy*(GRID+1)+ix]=height(-half+ix*cell,-half+iy*cell);
  function groundAt(x,z){
    const u0=(x+half)/cell,v0=(z+half)/cell,ix=Math.min(GRID-1,Math.max(0,Math.floor(u0))),iy=Math.min(GRID-1,Math.max(0,Math.floor(v0))),u=u0-ix,v=v0-iy,row=GRID+1;
    const ha=grid[iy*row+ix],hb=grid[(iy+1)*row+ix],hc=grid[(iy+1)*row+ix+1],hd=grid[iy*row+ix+1];
    return u+v<=1?ha+(hd-ha)*u+(hb-ha)*v:hc+(hb-hc)*(1-u)+(hd-hc)*(1-v);
  }
  const smooth=(a,b,v)=>{const t=Math.min(1,Math.max(0,(v-a)/(b-a)));return t*t*(3-2*t);};
  const trailPoints=Array.from({length:TRAIL_SAMPLES+1},(_,i)=>trail(i/TRAIL_SAMPLES));
  const nearTrail=(x,z,d)=>trailPoints.some(p=>Math.abs(p.x-x)<d&&Math.abs(p.z-z)<d);
  const tip=document.createElement('div');tip.className='mountain-tip';tip.hidden=true;

  function ground(p){
    // Altitude belts (IM-11): valley meadow, montane forest floor, alpine meadow above the tree line, rock and scree,
    // snow above a ragged snow line; steep ground is bare rock at any height.
    const terrain=new THREE.PlaneGeometry(MOUNTAIN.size,MOUNTAIN.size,GRID,GRID).rotateX(-Math.PI/2),at=terrain.attributes.position,colours=[];
    const c=Object.fromEntries(['meadow','forest','alpine','rock','scree','dark','snow','sand'].map(k=>[k,new THREE.Color(p[k])]));
    for(let i=0;i<at.count;i++){
      const x=at.getX(i),z=at.getZ(i),h=grid[i],s=slope(x,z),n=plan.noise(x/90,z/90),edge=n*50;at.setY(i,h);
      if(h<MOUNTAIN.water+3)colour.copy(c.sand);
      else if(h>BELTS.snow+edge&&s<1.1)colour.copy(c.snow);
      else if(s>ROCK_SLOPE)colour.copy(c.rock).lerp(c.dark,Math.min(1,(s-ROCK_SLOPE)*1.5));
      else if(h>BELTS.alpine+edge)colour.copy(c.scree).lerp(c.rock,smooth(BELTS.alpine,BELTS.snow,h));
      else if(h>BELTS.treeline+edge)colour.copy(c.alpine).lerp(c.scree,smooth(BELTS.treeline,BELTS.alpine,h+edge));
      else if(h>BELTS.meadow+edge)colour.copy(c.forest).lerp(c.alpine,smooth(BELTS.treeline-60,BELTS.treeline,h));
      else colour.copy(c.meadow).lerp(c.forest,smooth(BELTS.meadow-60,BELTS.meadow,h+edge));
      colour.multiplyScalar(.92+n*.16);colours.push(colour.r,colour.g,colour.b);}
    terrain.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));terrain.computeVertexNormals();
    world.add(new THREE.Mesh(terrain,lit()));
    const water=new THREE.Mesh(new THREE.CircleGeometry(MOUNTAIN.lake.r*1.25,48).rotateX(-Math.PI/2),new THREE.MeshLambertMaterial({color:p.water,transparent:true,opacity:.88}));
    water.position.set(MOUNTAIN.lake.x,MOUNTAIN.water,MOUNTAIN.lake.z);world.add(water);
  }
  function onRailway(x,z){
    // The station yard and the line out of the valley stay free of trees.
    const st=plan.layout([]).station,ox=Math.cos(st.angle),oz=Math.sin(st.angle),dx=x-st.x,dz=z-st.z,t=Math.min(MOUNTAIN.rails[1],Math.max(-RAIL_CLEAR[1],dx*ox+dz*oz));
    return Math.hypot(dx-ox*t,dz-oz*t)<RAIL_CLEAR[0];
  }
  function forest(p){
    // Broadleaf trees in the valley, conifers above; towards the tree line they shrink into krummholz and stop.
    const spots=[];
    for(let k=0;spots.length<TREES&&k<TREES*12;k++){
      const a=random()*Math.PI*2,r=180+random()*1150,x=Math.cos(a)*r,z=Math.sin(a)*r,h=groundAt(x,z);
      if(h<MOUNTAIN.water+6||h>BELTS.treeline||onRailway(x,z)||slope(x,z)>ROCK_SLOPE*.85||nearTrail(x,z,TRAIL_CLEAR))continue;
      const stunt=1-smooth(BELTS.treeline-KRUMMHOLZ.band,BELTS.treeline,h)*KRUMMHOLZ.shrink;spots.push([x,h,z,(7+random()*9)*stunt,h<BELTS.meadow&&random()<.6]);}
    const pointed=spots.filter(s=>!s[4]),round=spots.filter(s=>s[4]);
    // Conifers in three tiers, broadleaf crowns in clusters; one instanced draw each, tinted per tree.
    const fir=merged([[new THREE.ConeGeometry(1,.55,7).translate(0,.42,0),'#ffffff'],[new THREE.ConeGeometry(.78,.48,7).translate(0,.7,0),'#f2f2f2'],[new THREE.ConeGeometry(.52,.42,7).translate(0,.95,0),'#e6e6e6']]);
    const cones=new THREE.InstancedMesh(fir,new THREE.MeshLambertMaterial({vertexColors:true,flatShading:true}),pointed.length);
    const cluster=merged([[new THREE.IcosahedronGeometry(1,0),'#ffffff'],[new THREE.IcosahedronGeometry(.72,0).translate(.7,-.25,.35),'#ececec'],[new THREE.IcosahedronGeometry(.66,0).translate(-.62,-.2,-.4),'#f4f4f4'],[new THREE.IcosahedronGeometry(.55,0).translate(.1,.62,-.2),'#e2e2e2']]);
    const crowns=new THREE.InstancedMesh(cluster,new THREE.MeshLambertMaterial({vertexColors:true,flatShading:true}),round.length);
    const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.12,.16,1,5).translate(0,.5,0),new THREE.MeshLambertMaterial({color:'#6a5440'}),spots.length);
    const crown=new THREE.Color(p.crown),leaf=new THREE.Color(p.leaf);
    woods={cones,crowns,trunks,pointed,round,spots};
    pointed.forEach(([x,y,z,s],i)=>{matrix.makeScale(s*.6,s*2.6,s*.6).setPosition(x,y+s*.3,z);cones.setMatrixAt(i,matrix);cones.setColorAt(i,colour.copy(crown).multiplyScalar(.8+random()*.4));});
    round.forEach(([x,y,z,s],i)=>{matrix.makeScale(s*.8,s*.85,s*.8).setPosition(x,y+s*1.4,z);crowns.setMatrixAt(i,matrix);crowns.setColorAt(i,colour.copy(leaf).multiplyScalar(.8+random()*.4));});
    spots.forEach(([x,y,z,s],i)=>{matrix.makeScale(s,s*(s<6?.4:.7)+2,s).setPosition(x,y-2,z);trunks.setMatrixAt(i,matrix);});
    const rocks=new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1,0),new THREE.MeshLambertMaterial({color:p.rock,flatShading:true}),ROCKS);
    for(let i=0;i<ROCKS;i++){const a=random()*Math.PI*2,r=40+random()*900,x=Math.cos(a)*r,z=Math.sin(a)*r,h=groundAt(x,z),s=(3+random()*8)*(h>BELTS.treeline?1.1:.8);q.setFromEuler(new THREE.Euler(random(),random()*3,random()));pos.set(x,h+s*.3,z);size.set(s,s*.7,s*1.2);rocks.setMatrixAt(i,matrix.compose(pos,q,size));}
    world.add(cones,crowns,trunks,rocks);
  }
  function streams(p){
    // Snowmelt streams follow the steepest descent to the lake (IM-13), widening downstream.
    const positions=[];
    for(const line of plan.streams())for(let i=1;i<line.length;i++){
      const a=line[i-1],b=line[i],dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz)||1,w=1.5+i/line.length*4,nx=-dz/l*w,nz=dx/l*w;
      const c=[[a.x+nx,a.z+nz],[a.x-nx,a.z-nz],[b.x-nx,b.z-nz],[b.x+nx,b.z+nz]].map(([x,z])=>[x,groundAt(x,z)+.8,z]);positions.push(...c[0],...c[1],...c[2],...c[0],...c[2],...c[3]);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();
    world.add(new THREE.Mesh(g,new THREE.MeshLambertMaterial({color:p.water,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-3})));
  }
  function path(p){
    // The trail is a graded ribbon (IM-12) tinted by the stage whose stretch it crosses.
    const positions=[],colours=[],sand=new THREE.Color(p.sand),tints=Object.entries(plan.ZONES).map(([stage,[a,b]])=>[a,b,new THREE.Color(sand).lerp(new THREE.Color(STAGE_COLOURS[stage]),STAGE_TINT)]);
    for(let i=0;i<TRAIL_SAMPLES;i++){
      const s=(i+.5)/TRAIL_SAMPLES,tint=tints.find(([a,b])=>s>=a&&s<=b)?.[2]||sand;for(let k=0;k<6;k++)colours.push(tint.r,tint.g,tint.b);
      const a=trailPoints[i],b=trailPoints[i+1],dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz)||1,nx=-dz/l*TRAIL_WIDTH/2,nz=dx/l*TRAIL_WIDTH/2;
      const c=[[a,a.x+nx,a.z+nz],[a,a.x-nx,a.z-nz],[b,b.x-nx,b.z-nz],[b,b.x+nx,b.z+nz]].map(([o,x,z])=>[x,Math.max(o.y,groundAt(x,z))+TRAIL_LIFT,z]);
      positions.push(...c[0],...c[1],...c[2],...c[0],...c[2],...c[3]);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));g.computeVertexNormals();
    world.add(new THREE.Mesh(g,new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2})));
    // Each stage's camp: a gate over the trail with its banner and a tent beside it.
    for(const [stage,[a]] of Object.entries(plan.ZONES)){
      const at=trail(a),next=trail(a+.004),angle=Math.atan2(next.z-at.z,next.x-at.x),col=STAGE_COLOURS[stage],[gw,gh]=CAMP.gate;
      const parts=[cyl(1.6,2,3,0,-2,-gw/2,'#8a8a84',6),cyl(1.6,2,3,0,-2,gw/2,'#8a8a84',6),cyl(.8,.9,gh,0,0,-gw/2,'#6a5440',7),cyl(.8,.9,gh,0,0,gw/2,'#6a5440',7),log(.8,gw+5,0,gh+.4,0,'#6a5440',Math.PI/2),log(.6,gw+2,0,gh-2.4,0,'#7a5f45',Math.PI/2)];
      parts.push(box(.4,gh*.42,gw*.75,0,gh*.42,0,col),box(.5,1,gw*.75,0,gh*.42+gh*.42,0,'#f3ecd8'),gable(3.6,gw+7,2.4,0,gh+1,0,'#7b4a3a'));
      parts.push(footing(CAMP.tent*1.6,'#86ad66'),gable(CAMP.tent*1.8,CAMP.tent*2,CAMP.tent*1.3,0,0,gw*1.5,col),cyl(.15,.15,CAMP.tent*1.3,0,0,gw*1.5-CAMP.tent,'#5a4030',4));
      const gate=new THREE.Mesh(merged(parts),lit());gate.position.set(at.x,groundAt(at.x,at.z),at.z);gate.rotation.y=-angle;world.add(gate);}
    // The quiet valley camp by the lake, where untouched seeds rest (IM-03).
    const L=MOUNTAIN.lake,fire=[[new THREE.CylinderGeometry(3,3.4,1.2,8).translate(0,.6,0),'#6b6660'],[new THREE.ConeGeometry(1.6,3.4,5).translate(0,2.6,0),'#f2a54e']];
    const camp=new THREE.Mesh(merged(fire),lit());camp.position.set(L.x,Math.max(MOUNTAIN.water,groundAt(L.x,L.z-L.r*1.35)),L.z-L.r*1.35);world.add(camp);
  }
  function box(w,h,d,x,y,z,hex){return [new THREE.BoxGeometry(w,h,d).translate(x,y+h/2,z),hex];}
  function merged(parts){
    const position=[],normal=[],colours=[],c=new THREE.Color();
    for(const [geometry,hex] of parts){const g=geometry.index?geometry.toNonIndexed():geometry,pa=g.attributes.position.array,na=g.attributes.normal.array;c.set(hex);
      for(let k=0;k<pa.length;k+=3){position.push(pa[k],pa[k+1],pa[k+2]);normal.push(na[k],na[k+1],na[k+2]);colours.push(c.r,c.g,c.b);}}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(position,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normal,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));return g;
  }
  function station(p,night){
    // The terminus: platform, station house, the train that came from the city and rails leading back over the edge.
    const s=plan.layout([]).station,group=new THREE.Group(),glass=night?'#f1d79a':'#4f7380';
    const parts=[box(150,3,26,0,0,-22,'#c9bfa8'),box(56,22,26,10,0,22,'#e6d6b4'),box(60,2,30,10,22,22,'#a4553f'),box(10,30,10,-30,0,22,'#e6d6b4'),box(12,2,12,-30,30,22,'#a4553f')];
    parts.push([new THREE.ConeGeometry(23,14,4).rotateY(Math.PI/4).scale(1.35,1,.62).translate(10,31,22),'#a4553f']);
    for(let i=0;i<5;i++)parts.push(box(6,7,.6,-8+i*9,8,35.4,glass));
    for(let u=-90;u<=plan.MOUNTAIN.rails[1];u+=6)parts.push(box(2,.8,22,u,0,-46,'#6a5440'));
    for(const v of [-52,-40])parts.push(box(plan.MOUNTAIN.rails[1]+90,1.2,1.4,(plan.MOUNTAIN.rails[1]-90)/2,.8,v,'#55585a'));
    const train=[box(34,12,16,-50,2,-46,'#2f5d50'),box(12,8,16,-38,14,-46,'#2f5d50'),box(4,9,4,-62,14,-46,'#333333'),box(35,3,17,-50,1,-46,'#b8483a')];
    for(const [x,c] of [[-8,'#c9a24b'],[34,'#3f6979']]){train.push(box(38,13,16,x,2,-46,c),box(39,2,17,x,15,-46,'#f3ecd8'));for(let i=0;i<4;i++)train.push(box(6,5,.6,x-13+i*8.6,8,-37.8,glass));}
    group.add(new THREE.Mesh(merged(parts),lit()),new THREE.Mesh(merged(train),lit()));
    group.position.set(s.x,s.y,s.z);group.rotation.y=-s.angle;group.userData.station=true;world.add(group);
  }
  function summit(p){
    // The summit: a cairn of stacked stones and a beacon tower with a fire bowl that lights the valley at night.
    const top=trail(1),group=new THREE.Group(),stone=['#8a8a84','#9a9890','#7c7b76'];top.y=groundAt(top.x,top.z);
    const parts=[footing(9,'#7c7b76')];for(let k=0;k<6;k++){const r=5.5-k*.75;for(let i=0;i<5;i++){const a=i/5*Math.PI*2+k;parts.push(ball(r*.55,Math.cos(a)*r*.6+9,1+k*1.9,Math.sin(a)*r*.6,stone[(i+k)%3],1,.7,1));}}
    parts.push(cyl(3.6,4.4,14,-4,0,0,'#9a9890',8),box(8.4,1,8.4,-4,14,0,'#6f6c66'));for(const [x,z] of [[-7,-3],[-1,-3],[-7,3],[-1,3]])parts.push(cyl(.35,.35,9,x,15,z,'#4b4f52',5));
    parts.push(cyl(3.6,2.2,2.2,-4,23,0,'#4b4f52',10));
    const fire=new THREE.Mesh(merged([cone(2.6,5,-4,25,0,'#f2a54e',7),cone(1.4,3.6,-4,25.4,0,'#ffe08a',6)]),new THREE.MeshBasicMaterial({vertexColors:true}));
    const glow=new THREE.PointLight(p.beacon,palette===PALETTE.night?2.2:0,900,1.2);glow.position.set(-4,30,0);
    group.add(new THREE.Mesh(merged(parts),lit()),fire,glow);group.position.set(top.x,top.y,top.z);world.add(group);
  }
  function sky(p,night){
    const clouds=new THREE.Group();clouds.name='clouds';
    const puff=new THREE.IcosahedronGeometry(1,1),cloud=new THREE.MeshLambertMaterial({color:night?'#56636e':'#ffffff',transparent:true,opacity:.86,flatShading:true});
    for(let i=0;i<CLOUDS;i++){const g=new THREE.Group(),a=i/CLOUDS*Math.PI*2,r=CLOUD_RING[0]+random()*CLOUD_RING[1];g.position.set(Math.cos(a)*r,CLOUD_HEIGHT[0]+random()*CLOUD_HEIGHT[1],Math.sin(a)*r);
      for(let k=0;k<4;k++){const m=new THREE.Mesh(puff,cloud),s=34+random()*40;m.scale.set(s*1.6,s*.7,s);m.position.set((k-1.5)*42,random()*14,random()*30);g.add(m);}g.userData.speed=.01+random()*.012;clouds.add(g);}
    world.add(clouds);
    if(night){const stars=[];for(let i=0;i<STARS;i++){const a=random()*Math.PI*2,e=.12+random()*1.2;stars.push(Math.cos(a)*Math.cos(e)*5200,Math.sin(e)*5200,Math.sin(a)*Math.cos(e)*5200);}
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(stars,3));world.add(new THREE.Points(g,new THREE.PointsMaterial({color:'#ffffff',size:2,sizeAttenuation:false,fog:false})));}
  }
  function rebuild(night){
    palette=night?PALETTE.night:PALETTE.day;for(const k of Object.keys(models))delete models[k];
    for(const o of [...world.children]){world.remove(o);o.traverse(m=>{m.geometry?.dispose();});}
    hemi.color.set(palette.hemi[0]);hemi.groundColor.set(palette.hemi[1]);hemi.intensity=palette.hemi[2];sun.color.set(palette.sun[0]);sun.intensity=palette.sun[1];
    renderer.setClearColor(palette.sky);scene.fog.color.set(palette.fog);
    ground(palette);forest(palette);streams(palette);path(palette);station(palette,night);summit(palette);sky(palette,night);
  }
  const cyl=(rt,rb,h,x,y,z,hex,seg=8)=>[new THREE.CylinderGeometry(rt,rb,h,seg).translate(x,y+h/2,z),hex];
  const cone=(r,h,x,y,z,hex,seg=7)=>[new THREE.ConeGeometry(r,h,seg).translate(x,y+h/2,z),hex];
  const ball=(r,x,y,z,hex,sx=1,sy=1,sz=1)=>[new THREE.IcosahedronGeometry(r,1).scale(sx,sy,sz).translate(x,y,z),hex];
  const log=(r,len,x,y,z,hex,turn=0)=>[new THREE.CylinderGeometry(r,r,len,7).rotateZ(Math.PI/2).rotateY(turn).translate(x,y,z),hex];
  function gable(w,len,rise,x,y,z,hex){const shape=new THREE.Shape([new THREE.Vector2(-w/2,0),new THREE.Vector2(w/2,0),new THREE.Vector2(0,rise)]);return [new THREE.ExtrudeGeometry(shape,{depth:len,bevelEnabled:false}).translate(x,y,z-len/2),hex];}
  // Every model stands on a footing that reaches FOOTING below its base, so on a slope it sits in the ground.
  const footing=(r,hex)=>[new THREE.CylinderGeometry(r,r*1.05,FOOTING+1,10).translate(0,-FOOTING/2,0),hex];
  function model(stage,night){
    // What stands at each idea's place (IM-10): a raised bed with seedlings and a sign, a tent by a campfire, a young
    // tree in its fence, a log cabin on a stone footing with a porch, a stack of crates under a tarp.
    const key=stage+(night?':night':'');if(models[key])return models[key];
    const col=STAGE_COLOURS[stage],wood='#8a6a45',dark='#5a4030',leaf=['#5f9b4c','#6fae55','#7fbf63'],stone='#8d8a80',glass=night?'#ffd27a':'#5f8fa0',grass=night?'#3f5c44':'#86ad66';
    let parts;
    if(stage==='seed'){
      parts=[footing(4.6,'#6b5a40'),box(9.4,1,6.4,0,0,0,'#5a4030')];
      for(const [w,d,x,z] of [[10,.8,0,-3.4],[10,.8,0,3.4],[.8,6.8,-4.6,0],[.8,6.8,4.6,0]])parts.push(box(w,1.6,d,x,0,z,wood));
      for(let i=0;i<3;i++)for(let j=0;j<2;j++){const x=-3+i*3,z=-1.5+j*3,h=1.8+((i+j)%2)*.8;parts.push(cyl(.16,.22,h,x,1,z,leaf[1],5),ball(.8,x+.7,1+h,z,leaf[(i+j)%3],1.6,.35,.8),ball(.7,x-.6,.8+h,z,leaf[(i+2*j)%3],1.5,.35,.8));}
      parts.push(cyl(.3,.35,5.4,5.8,0,3.8,wood,6),box(3.8,2.4,.4,5.8,3.4,4.1,col),box(4.2,.4,.5,5.8,5.8,4.1,dark));
    }else if(stage==='incubating'){
      parts=[footing(5.5,grass),box(11,.3,13,0,0,0,'#8a7a62'),gable(10,12,8,0,.3,0,col),gable(3.6,.3,5,0,.3,6.05,'#4a3f55'),cyl(.25,.25,9.4,0,0,-6.2,dark,5),cyl(.25,.25,9.4,0,0,6.2,dark,5)];
      for(const [x,z] of [[-6.5,-7],[6.5,-7],[-6.5,7],[6.5,7]])parts.push(cyl(.15,.2,1.4,x,0,z,dark,4));
      for(let i=0;i<7;i++){const a=i/7*Math.PI*2;parts.push(ball(.7,-10+Math.cos(a)*2.2,.4,5+Math.sin(a)*2.2,'#77736c'));}
      parts.push(log(.35,3.4,-10,.5,5,'#6a4b33',.6),log(.35,3.4,-10,.7,5,'#6a4b33',-.6),cone(1,2.6,-10,.6,5,'#f2a54e',6),cone(.5,1.6,-10,1.2,5,'#ffe08a',5),log(.9,6,-10.5,.9,10,'#7a5a3e',.2));
    }else if(stage==='growing'){
      parts=[footing(4,grass),cyl(.7,1.1,9,0,0,0,'#6a5440',7),ball(4.6,0,12,0,leaf[0]),ball(3.6,2.4,10.2,1.4,leaf[1]),ball(3.3,-2.2,10.6,-1.6,leaf[2]),ball(2.8,.4,15.4,-.3,leaf[1]),ball(2.2,-1.4,9,2.2,leaf[0])];
      for(let i=0;i<10;i++){const a=i/10*Math.PI*2;parts.push(cyl(.22,.26,3,Math.cos(a)*5.4,0,Math.sin(a)*5.4,'#9b7b55',5));}
      parts.push([new THREE.TorusGeometry(5.4,.16,4,20).rotateX(Math.PI/2).translate(0,2.3,0),'#9b7b55'],[new THREE.TorusGeometry(5.4,.16,4,20).rotateX(Math.PI/2).translate(0,1.2,0),'#9b7b55']);
    }else if(stage==='project'){
      parts=[box(17,FOOTING+1,13,0,-FOOTING,0,stone),box(14,8,10,0,1,0,'#b98d5f')];
      for(let k=0;k<5;k++)parts.push(box(14.3,.4,10.3,0,1.6+k*1.6,0,'#9a7048'));
      for(const [x,z] of [[-7,-5],[7,-5],[-7,5],[7,5]])parts.push(box(1,8,1,x,1,z,'#7a5534'));
      parts.push(gable(16.5,12.4,6.5,0,9,0,'#7b4a3a'),box(.8,.8,12.6,0,15.2,0,'#5e3a2e'),box(2.2,7,2.2,4,11,-2.2,stone),box(2.6,.6,2.6,4,18,-2.2,'#6f6c66'));
      parts.push(box(2.6,5,.3,0,1,5.1,'#5a3d28'),box(2.6,2.2,.3,-4.2,4,5.1,glass),box(2.6,2.2,.3,4.2,4,5.1,glass),box(.3,2.2,2.6,7.1,4,0,glass),box(.3,2.2,2.6,-7.1,4,0,glass));
      parts.push(box(9,.6,3.4,0,.6,6.8,'#9a7048'),cyl(.3,.3,5,-4,1.2,8.2,'#7a5534',5),cyl(.3,.3,5,4,1.2,8.2,'#7a5534',5),box(9.6,.5,4,0,6.2,7,'#7b4a3a'));
    }else{
      parts=[box(13,FOOTING+1,11,0,-FOOTING,0,'#8f8a80'),box(5,5,5,-2.6,.6,0,'#a98a62'),box(4.4,4.4,4.4,2.8,.6,1,'#9b7b55'),box(4,4,4,-1.6,5.6,.4,'#b39466'),box(5.6,.4,4.6,-1.6,9.6,.4,'#7f8b88')];
      for(const [w,x,y,z] of [[5.2,-2.6,3,2.55],[5.2,-2.6,3,-2.55],[4.6,2.8,2.8,3.25]])parts.push(box(w,.5,.3,x,y,z,'#6e5338'));
    }
    return models[key]=merged(parts);
  }
  function clearings(places){
    // A glade around every idea: forest trees standing on its spot are hidden, the rest keep their place.
    if(!woods)return;const free=(x,z)=>!places.some(p=>Math.hypot(p.x-x,p.z-z)<GLADE);
    const put=(mesh,list,shape)=>{list.forEach((t,i)=>{if(free(t[0],t[2]))shape(t,matrix);else matrix.makeScale(0,0,0);mesh.setMatrixAt(i,matrix);});mesh.instanceMatrix.needsUpdate=true;};
    put(woods.cones,woods.pointed,([x,y,z,s],m)=>m.makeScale(s*.6,s*2.6,s*.6).setPosition(x,y+s*.3,z));
    put(woods.crowns,woods.round,([x,y,z,s],m)=>m.makeScale(s*.8,s*.85,s*.8).setPosition(x,y+s*1.4,z));
    put(woods.trunks,woods.spots,([x,y,z,s],m)=>m.makeScale(s,s*(s<6?.4:.7)+2,s).setPosition(x,y-2,z));
  }
  function setIdeas(ideas){
    // Idea objects are rebuilt from the layout; an idea whose place changed walks there from where it stood (IM-14).
    for(const o of [...flagGroup.children]){flagGroup.remove(o);if(o.userData.own)o.traverse(m=>m.geometry?.dispose());}
    const placed=plan.layout(ideas),stone=new THREE.MeshLambertMaterial({color:'#5b5f60'}),now=performance.now();summitInfo=placed.summit;
    flags=placed.flags.map(f=>{
      const mark=MARK[f.stage],scale=SIZE.base+SIZE.growth*(f.growth||0),g=new THREE.Group(),staff=new THREE.Group();f.y=Math.max(MOUNTAIN.water,groundAt(f.x,f.z));
      const pole=new THREE.Mesh(new THREE.CylinderGeometry(.4,.55,mark.pole+FOOTING,6).translate(0,(mark.pole-FOOTING)/2,0),stone),finial=new THREE.Mesh(new THREE.SphereGeometry(.9,8,6).translate(0,mark.pole+.6,0),new THREE.MeshLambertMaterial({color:'#d9c27a'}));
      const cloth=new THREE.Mesh(new THREE.PlaneGeometry(...mark.cloth,6,1).translate(mark.cloth[0]/2,0,0),new THREE.MeshLambertMaterial({color:STAGE_COLOURS[f.stage],side:THREE.DoubleSide}));
      cloth.position.y=mark.pole-mark.cloth[1]/2-.5;const hit=new THREE.Mesh(new THREE.BoxGeometry(...PICK).translate(0,PICK[1]/2,0),new THREE.MeshBasicMaterial({visible:false}));
      staff.add(pole,finial,cloth);staff.position.set(...mark.at);g.add(staff,hit,new THREE.Mesh(model(f.stage,night),lit()));g.userData.own=true;
      let lantern=null;if(f.due){lantern=new THREE.Mesh(new THREE.SphereGeometry(LANTERN.radius,12,8),new THREE.MeshBasicMaterial({color:palette.lantern}));lantern.position.set(mark.at[0],mark.pole+LANTERN.lift,mark.at[2]);g.add(lantern);}
      g.scale.setScalar(scale);g.rotation.y=(f.idea.path.length*1.7)%(Math.PI*2);hit.userData.flag=f;flagGroup.add(g);
      const before=previous.get(f.idea.path),moved=before&&(Math.hypot(before.x-f.x,before.z-f.z)>1);
      const move=moved?{from:before,start:now}:null;g.position.set(...(moved?[before.x,before.y,before.z]:[f.x,f.y,f.z]));
      const label=document.createElement('button');label.className=`mountain-label stage-${f.stage}${f.due?' due':''}`;label.type='button';
      label.textContent=f.idea.title.length>LABEL_MAX?f.idea.title.slice(0,LABEL_MAX-1)+'…':f.idea.title;label.title=f.idea.title;label.onclick=()=>onPick(f.idea.path);
      label.onpointerenter=()=>showTip(f,label);label.onpointerleave=()=>{tip.hidden=true;};
      return {...f,group:g,cloth,hit,lantern,label,move,lift:Math.max(mark.pole,mark.top)*scale,base:cloth.geometry.attributes.position.array.slice()};});
    previous.clear();for(const f of flags)previous.set(f.idea.path,{x:f.x,y:f.y,z:f.z,s:f.s});clearings(flags);
    // Ropes between ideas that link to each other (IM-08).
    ropes=placed.ropes.map(([a,b])=>{const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({length:ROPE_POINTS},()=>new THREE.Vector3())),new THREE.LineBasicMaterial({color:palette.rope}));
      line.userData.own=true;flagGroup.add(line);return {line,a:flags.find(f=>f.idea===a.idea),b:flags.find(f=>f.idea===b.idea)};});
    camps=placed.camps.map(c=>{const label=document.createElement('div');label.className=`mountain-camp stage-${c.stage}`;
      label.textContent=`${c.name} · ${c.count}${c.stage==='project'&&placed.summit.crowded?' · тісно':''}`;return {...c,label};});
    labels.replaceChildren(...camps.map(c=>c.label),...flags.map(f=>f.label),tip);
  }
  function showTip(f,anchor){
    // Hover card: the idea's title, place, rest time, opening line and whether it asks for attention.
    const days=Math.max(0,Math.floor((Date.now()-Date.parse(f.idea.updated||f.idea.created))/864e5));
    tip.replaceChildren();const h=document.createElement('strong');h.textContent=f.idea.title;const meta=document.createElement('span');
    meta.textContent=`${PLACE_NAMES[f.stage]} · ${Number.isFinite(days)?`без змін ${days} дн.`:''}${f.due?' · чекає уваги':''}`;tip.append(h,meta);
    if(f.idea.summary){const p=document.createElement('p');p.textContent=f.idea.summary;tip.append(p);}
    tip.className=`mountain-tip stage-${f.stage}`;tip.hidden=false;tip.style.transform=anchor.style.transform.replace('translate(-50%,-100%)','translate(-50%,-100%) translateY(-34px)');
  }
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),scratch=new THREE.Vector3();
  function pickAt(event){
    const r=canvas.getBoundingClientRect();pointer.set((event.clientX-r.left)/r.width*2-1,-((event.clientY-r.top)/r.height)*2+1);raycaster.setFromCamera(pointer,camera);
    return raycaster.intersectObjects(flags.map(f=>f.hit),false)[0]?.object.userData.flag||null;
  }
  let down=null;
  canvas.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY];});
  canvas.addEventListener('pointermove',e=>{const f=pickAt(e);if(f!==hovered){hovered=f;canvas.style.cursor=f?'pointer':'';const own=flags.find(x=>x.idea===f?.idea);for(const x of flags)x.label.classList.toggle('hot',x===own);if(own)showTip(own,own.label);else tip.hidden=true;}});
  canvas.addEventListener('pointerup',e=>{if(down&&Math.hypot(e.clientX-down[0],e.clientY-down[1])<5){const f=pickAt(e);if(f)onPick(f.idea.path);}down=null;});
  controls.addEventListener('start',()=>{controls.autoRotate=false;flight=null;});
  function hidden(point){
    // A label behind the mountain hides: sample the height field along the line of sight.
    for(let k=1;k<OCCLUSION_STEPS;k++){const t=k/OCCLUSION_STEPS;scratch.lerpVectors(camera.position,point,t);if(height(scratch.x,scratch.z)>scratch.y+2)return true;}return false;
  }
  function place(el,x,y,z,lift){
    const p=new THREE.Vector3(x,y+lift,z);if(hidden(p)){el.style.display='none';return;}
    p.project(camera);if(p.z>1){el.style.display='none';return;}
    el.style.display='';el.style.transform=`translate(-50%,-100%) translate(${(p.x+1)/2*canvas.clientWidth}px,${(1-p.y)/2*canvas.clientHeight}px)`;
  }
  function walk(f,now){
    // Moving between places: along the trail when both ends lie on it, otherwise in a low arc across the slope.
    const k=Math.min(1,(now-f.move.start)/MOVE_MS),e=k<.5?2*k*k:1-(-2*k+2)**2/2,from=f.move.from;
    if(from.s!=null&&f.s!=null){const p=trail(from.s+(f.s-from.s)*e);f.group.position.set(p.x,groundAt(p.x,p.z),p.z);}
    else f.group.position.set(from.x+(f.x-from.x)*e,from.y+(f.y-from.y)*e+Math.sin(e*Math.PI)*40,from.z+(f.z-from.z)*e);
    if(k===1){f.group.position.set(f.x,f.y,f.z);f.move=null;}
  }
  function fly(to,target,ms){flight={from:camera.position.clone(),fromTarget:controls.target.clone(),to:new THREE.Vector3(...to),target:new THREE.Vector3(...target),start:performance.now(),ms};}
  function frame(){
    if(!running)return;requestAnimationFrame(frame);
    const now=performance.now(),t=now/1000,dt=Math.min(.1,(now-last)/1000);last=now;
    if(flight){const k=Math.min(1,(now-flight.start)/flight.ms),e=k<.5?4*k*k*k:1-(-2*k+2)**3/2;camera.position.lerpVectors(flight.from,flight.to,e);controls.target.lerpVectors(flight.fromTarget,flight.target,e);if(k===1)flight=null;}
    controls.update(dt);
    for(const f of flags){
      if(f.move)walk(f,now);
      const a=f.cloth.geometry.attributes.position;for(let i=0;i<a.count;i++){const x=f.base[i*3];a.setZ(i,Math.sin(t*3+x*.45+f.x)*x*.09);}a.needsUpdate=true;
      if(f.lantern)f.lantern.scale.setScalar(1+.25*Math.sin(t*LANTERN.pulse+f.x));}
    for(const r of ropes){
      const a=r.a.group.position,b=r.b.group.position,ha=r.a.lift,hb=r.b.lift,span=Math.hypot(b.x-a.x,b.z-a.z),at=r.line.geometry.attributes.position;
      for(let i=0;i<ROPE_POINTS;i++){const u=i/(ROPE_POINTS-1);at.setXYZ(i,a.x+(b.x-a.x)*u,a.y+ha+(b.y+hb-a.y-ha)*u-Math.sin(u*Math.PI)*span*ROPE_SAG,a.z+(b.z-a.z)*u);}at.needsUpdate=true;r.line.geometry.computeBoundingSphere();}
    world.getObjectByName('clouds')?.children.forEach(c=>{const a=Math.atan2(c.position.z,c.position.x)+c.userData.speed*dt,r=Math.hypot(c.position.x,c.position.z);c.position.x=Math.cos(a)*r;c.position.z=Math.sin(a)*r;});
    for(const c of camps)place(c.label,c.x,c.y,c.z,40);
    for(const f of flags){const p=f.group.position;place(f.label,p.x,p.y,p.z,f.lift+6);}
    if(!tip.hidden){const own=flags.find(f=>f.label.classList.contains('hot'));if(own)tip.style.transform=own.label.style.transform.replace('translate(-50%,-100%)','translate(-50%,-100%) translateY(-34px)');}
    renderer.render(scene,camera);
  }
  function resize(){const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;renderer.setPixelRatio(Math.min(2,devicePixelRatio));renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
  new ResizeObserver(resize).observe(canvas);
  let night=null;
  return {
    show(ideas,options={}){
      onPick=options.onPick||onPick;const dark=!document.body.classList.contains('day');if(dark!==night){night=dark;rebuild(dark);}
      previous.clear();setIdeas(ideas);resize();
      // Arrival: the camera starts at the platform and rises over the valley to the whole mountain.
      const s=plan.layout([]).station,ox=Math.cos(s.angle),oz=Math.sin(s.angle),[out,lift,ahead,look]=CAMERA.approach;controls.autoRotate=!options.still;
      camera.position.set(s.x+ox*out,s.y+lift,s.z+oz*out);controls.target.set(s.x+ox*ahead,s.y+look,s.z+oz*ahead);
      if(options.still){camera.position.set(...CAMERA.view);controls.target.set(...CAMERA.target);}else fly(CAMERA.view,CAMERA.target,INTRO_MS);
      if(!running){running=true;last=performance.now();frame();}
    },
    update(ideas){setIdeas(ideas);},
    focus(path){
      const f=flags.find(x=>x.idea.path===path);if(!f)return;controls.autoRotate=false;
      const out=new THREE.Vector3(f.x,0,f.z).normalize().multiplyScalar(460);fly([f.x+out.x,f.y+260,f.z+out.z],[f.x,f.y+10,f.z],FOCUS_MS);
      for(const x of flags)x.label.classList.toggle('hot',x===f);
    },
    focusZone(stage){
      // Fly to a stage's stretch of the trail, the lake for incubating seeds, or the station for shelved ideas.
      controls.autoRotate=false;const range=plan.ZONES[stage],L=MOUNTAIN.lake;
      const at=range?trail((range[0]+range[1])/2):stage==='incubating'?{x:L.x,y:MOUNTAIN.water,z:L.z}:plan.layout([]).station;
      const out=new THREE.Vector3(at.x,0,at.z).normalize().multiplyScalar(ZONE_VIEW[0]);fly([at.x+out.x,at.y+ZONE_VIEW[1],at.z+out.z],[at.x,at.y+20,at.z],FOCUS_MS);
    },
    summit(){return summitInfo;},
    hide(){running=false;},
  };
}
window.MountainScene={
  show(ideas,options){const canvas=document.getElementById('mountain-3d');if(!canvas||!window.WebGL2RenderingContext)return;view??=build(canvas,document.getElementById('mountain-labels'));view.show(ideas,options);},
  update(ideas){view?.update(ideas);},
  focus(path){view?.focus(path);},
  focusZone(stage){view?.focusZone(stage);},
  hide(){view?.hide();},
};
