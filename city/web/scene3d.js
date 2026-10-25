/* Brain City 3D scene: the city is built once per plan revision and the camera moves over it; see RENDER-3D.md. */
import * as THREE from './vendor/three.module.min.js';
import {OrbitControls} from './vendor/OrbitControls.js';

// An orthographic camera tilted 60° from vertical at 45° azimuth reproduces the 2D atlas; this factor matches its scale.
const ATLAS_SCALE=Math.sqrt(1.5),ATLAS_POLAR=Math.PI/3,ATLAS_AZIMUTH=Math.PI/4;
const CAMERA_DISTANCE=20000,CAMERA_FAR=80000,MIN_ZOOM=.07*ATLAS_SCALE,MAX_ZOOM=4*ATLAS_SCALE,MIN_POLAR=.12,MAX_POLAR=1.3,ROTATE_STEP=Math.PI/4;
const LIFE={seed:'brain-city-life',swayRound:.07,swayCone:.05,flocks:4,birds:9,flockRing:[1300,1800],boats:5,boatSpan:9000,boatOffshore:[140,520],seaGlints:260,riverGlints:.35,clouds:7,cloudRing:[1800,2600],cloudHeight:650};
const CLOUD_OPACITY=.68,CLOUD_FADE=[.28,.5],CONFINE={fill:.98};
const HAZE=[2600,6500],FLY_MS=700,AGENT_CAPACITY=64,FOCUS_ZOOM=.85,DISTRICT_ZOOM=[.12,1.6];
// The sun casts one shadow map over the whole city: a tight box keeps the texels small; flat ground only receives shadows,
// and the biases keep roofs and lots free of acne.
const SHADOW={map:4096,margin:80,height:2000,bias:-.0004,normalBias:.6};
const SUN_DIRECTION=[-.45,1,.75];
const LIGHT={
  day:{sky:'#fffaf0',ground:'#718060',hemi:1.55,sun:'#fff1d6',sunPower:1.8,clear:'#b8cbcf',crown:'#5f8a55',trunk:'#7a5f45',lamp:'#ebddad'},
  night:{sky:'#9fb4c8',ground:'#34483b',hemi:1.45,sun:'#c9d8ff',sunPower:.68,clear:'#22333f',crown:'#2f4a36',trunk:'#4b3e33',lamp:'#ffe6aa'},
};
const COATS=['#3f6979','#b8654b','#d9b35d','#638367','#8c668c','#bd8f85','#e4d4b5','#485775'];
const PERSON={stride:7,swing:.55,trousers:['#2f3640','#4a3f35','#3b4a5a','#5a5048','#25303a','#6b5d4f'],skin:['#f1c9a5','#e0b08a','#c68a5e','#9a6a45','#6f4a33'],hair:['#2b211b','#5a3b26','#8a6a3f','#c9a46a','#3a3a3a','#a0522d']};
const BUS={body:'#e8b04b',stripe:'#b8654b',glassDay:'#4f7380',glassNight:'#f1d79a'};
const hash=str=>{let h=2166136261;for(const c of String(str)){h^=c.codePointAt(0);h=Math.imul(h,16777619);}return h>>>0;};

/** Creates the 3D view over the app's state; `api` supplies state, filter matching, live residents and the overlay canvas. */
function create(api){
  const {state,overlay}=api,canvas=document.createElement('canvas');
  canvas.id='city-3d';canvas.setAttribute('aria-hidden','true');overlay.before(canvas);
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,1,CAMERA_FAR);
  const hemi=new THREE.HemisphereLight(),sun=new THREE.DirectionalLight();scene.add(hemi,sun,sun.target);
  // Haze by depth: land far beyond the view centre fades into the sky colour, so the world has no visible end.
  scene.fog=new THREE.Fog('#ffffff',CAMERA_DISTANCE+HAZE[0],CAMERA_DISTANCE+HAZE[1]);
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;sun.castShadow=true;sun.shadow.mapSize.set(SHADOW.map,SHADOW.map);sun.shadow.bias=SHADOW.bias;sun.shadow.normalBias=SHADOW.normalBias;
  const controls=new OrbitControls(camera,overlay);
  Object.assign(controls,{enableZoom:false,enableDamping:false,screenSpacePanning:false,minPolarAngle:MIN_POLAR,maxPolarAngle:MAX_POLAR,
    mouseButtons:{LEFT:THREE.MOUSE.PAN,MIDDLE:THREE.MOUSE.ROTATE,RIGHT:THREE.MOUSE.ROTATE},touches:{ONE:THREE.TOUCH.PAN,TWO:THREE.TOUCH.DOLLY_ROTATE}});
  const lit=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}),glow=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide});
  const statics=new THREE.Group(),agents=new THREE.Group(),alive=new THREE.Group();scene.add(statics,agents,alive);
  // Living landscape: wind in the crowns (vertex shader), flocks of birds, sailboats along the coast, glints on the
  // water and drifting clouds. Paused or reduced motion freezes all of it with the agents.
  const wind={value:0};let life=null;
  function sway(material,amount){
    material.onBeforeCompile=shader=>{shader.uniforms.uWind=wind;shader.vertexShader='uniform float uWind;\n'+shader.vertexShader.replace('#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
      float phase=instanceMatrix[3].x*.013+instanceMatrix[3].z*.017,lean=max(position.y+1.,0.)*${amount.toFixed(3)};
      transformed.x+=sin(uWind*1.6+phase)*lean;transformed.z+=cos(uWind*1.1+phase*1.3)*lean*.6;
      #endif`);};
    return material;
  }
  // Flat polygons from points (bird wings, sails), with normals for lighting.
  function shape(points){const g=new THREE.BufferGeometry().setFromPoints(points);g.computeVertexNormals();return g;}
  function buildLife(data){
    dispose(alive);life=null;if(!data?.coast)return;const rnd=seededRandom(LIFE.seed),c=data.coast,centre=data.centre;
    const birdGeometry=merged([[shape([new THREE.Vector3(0,0,0),new THREE.Vector3(-1.5,0,-7),new THREE.Vector3(1.5,0,0),new THREE.Vector3(0,0,0),new THREE.Vector3(1.5,0,0),new THREE.Vector3(-1.5,0,7)]),'#2d3530']]);
    const birds=new THREE.InstancedMesh(birdGeometry,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide}),LIFE.flocks*LIFE.birds);
    const flocks=Array.from({length:LIFE.flocks},()=>{const a=rnd()*Math.PI*2,r=LIFE.flockRing[0]+rnd()*LIFE.flockRing[1];return {x:centre.x+Math.cos(a)*r,y:centre.y+Math.sin(a)*r,radius:220+rnd()*380,speed:(.12+rnd()*.1)*(rnd()<.5?-1:1),phase:rnd()*6,height:150+rnd()*120,members:Array.from({length:LIFE.birds},()=>({dx:(rnd()-.5)*90,dy:(rnd()-.5)*90,dz:(rnd()-.5)*30,flap:rnd()*6}))};});
    const sail=merged([[box(26,4,9,0,2,0),'#7a5a3e'],[box(22,1,7.4,0,4.4,0),'#c9a77c'],[box(.8,26,.8,1,17,0),'#5a4a3a'],
      [shape([new THREE.Vector3(1.5,6,0),new THREE.Vector3(1.5,29,0),new THREE.Vector3(12,6,0)]),'#f4efe2'],
      [shape([new THREE.Vector3(.5,7,0),new THREE.Vector3(.5,24,0),new THREE.Vector3(-8,7,0)]),'#e9dcc4']]);
    const boats=new THREE.InstancedMesh(sail,new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}),LIFE.boats);
    const shore=data.shore||[],lane=[0];for(let k=1;k<shore.length;k++)lane.push(lane[k-1]+Math.hypot(shore[k].x-shore[k-1].x,shore[k].y-shore[k-1].y));
    const fleet=Array.from({length:LIFE.boats},()=>({s:rnd()*lane.at(-1),off:LIFE.boatOffshore[0]+rnd()*LIFE.boatOffshore[1],speed:(10+rnd()*14)*(rnd()<.5?-1:1),bob:rnd()*6}));
    const spots=[];for(let i=0;i<LIFE.seaGlints&&shore.length;i++){const p=shore[Math.floor(rnd()*shore.length)],d=40+rnd()*900;spots.push({x:p.x+c.down.x*d,y:p.y+c.down.y*d,z:ground-.1,size:4+rnd()*5,phase:rnd()*6});}
    for(const w of (data.water||[]).filter(()=>rnd()<LIFE.riverGlints))spots.push({x:w.x+(rnd()-.5)*w.w*.5,y:w.y+(rnd()-.5)*w.w*.5,z:ground-.3,size:2+rnd()*2.5,phase:rnd()*6});
    const glints=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2).rotateY(Math.PI/4),new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:.75,depthWrite:false}),spots.length);
    const puff=merged([[new THREE.IcosahedronGeometry(40,1),'#ffffff'],[new THREE.IcosahedronGeometry(30,1).translate(45,-6,10),'#ffffff'],[new THREE.IcosahedronGeometry(28,1).translate(-42,-8,-6),'#ffffff'],[new THREE.IcosahedronGeometry(24,1).translate(10,8,-30),'#ffffff']]);
    const clouds=new THREE.InstancedMesh(puff,new THREE.MeshLambertMaterial({vertexColors:true,transparent:true,opacity:CLOUD_OPACITY,depthWrite:false}),LIFE.clouds);
    const sky=Array.from({length:LIFE.clouds},()=>({a:rnd()*Math.PI*2,r:LIFE.cloudRing[0]+rnd()*LIFE.cloudRing[1],h:LIFE.cloudHeight+rnd()*160,scale:1.8+rnd()*1.6,speed:.006+rnd()*.008}));
    for(const m of [birds,boats,glints,clouds]){m.frustumCulled=false;alive.add(m);}boats.castShadow=true;
    life={birds,flocks,boats,fleet,coast:c,shore,lane,glints,spots,clouds,sky,centre,view:data.view};updateLife(0);confine();
  }
  function updateLife(t){
    if(!life)return;const {birds,flocks,boats,fleet,coast:c,shore,lane,glints,spots,clouds,sky,centre}=life;let i=0;
    birds.visible=state.day;
    for(const f of flocks){const a=t*f.speed+f.phase,cx=f.x+Math.cos(a)*f.radius,cy=f.y+Math.sin(a)*f.radius,heading=a+Math.sign(f.speed)*Math.PI/2;
      for(const b of f.members){const flap=.25+Math.abs(Math.sin(t*9+b.flap))*1.1;position.set(cx+b.dx,ground+f.height+b.dz+Math.sin(t*2+b.flap)*4,cy+b.dy);quaternion.setFromAxisAngle(up,-heading);size.set(1,1,flap);birds.setMatrixAt(i++,matrix.compose(position,quaternion,size));}}
    const total=lane.at(-1)||1;
    fleet.forEach((b,k)=>{
      // Boats sail along the shore at a fixed distance offshore, turning with its bays.
      const s=((b.s+t*b.speed)%total+total)%total;let j=1;while(j<lane.length-1&&lane[j]<s)j++;const p=shore[j-1],q=shore[j],f=(s-lane[j-1])/((lane[j]-lane[j-1])||1);
      const dx=(q.x-p.x)*Math.sign(b.speed),dy=(q.y-p.y)*Math.sign(b.speed);
      position.set(p.x+(q.x-p.x)*f+c.down.x*b.off,ground+.6+Math.sin(t*1.7+b.bob)*.6,p.y+(q.y-p.y)*f+c.down.y*b.off);
      quaternion.setFromEuler(euler.set(Math.sin(t*1.3+b.bob)*.05,-Math.atan2(dy,dx),0));size.set(1,1,1);boats.setMatrixAt(k,matrix.compose(position,quaternion,size));});
    spots.forEach((g,k)=>{const shine=Math.max(0,Math.sin(t*2.2+g.phase))**3*g.size;position.set(g.x,g.z,g.y);quaternion.identity();size.set(shine||1e-3,1,shine||1e-3);glints.setMatrixAt(k,matrix.compose(position,quaternion,size));});
    glints.material.opacity=state.day?.75:.35;
    sky.forEach((s,k)=>{const a=s.a+t*s.speed;position.set(centre.x+Math.cos(a)*s.r,ground+s.h,centre.y+Math.sin(a)*s.r);quaternion.identity();size.set(s.scale,s.scale*.45,s.scale);clouds.setMatrixAt(k,matrix.compose(position,quaternion,size));});
    for(const m of [birds,boats,glints,clouds])m.instanceMatrix.needsUpdate=true;
    fadeClouds();
  }
  function fadeClouds(){
    // Clouds belong to the overview: they fade out as the camera comes closer and are gone at street level.
    if(!life)return;const z=camera.zoom/ATLAS_SCALE,k=THREE.MathUtils.clamp((CLOUD_FADE[1]-z)/(CLOUD_FADE[1]-CLOUD_FADE[0]),0,1);
    life.clouds.material.opacity=CLOUD_OPACITY*k;life.clouds.visible=k>.01;
  }
  function seededRandom(seed){let a=hash(seed);return ()=>{a=(a+0x6D2B79F5)|0;let x=Math.imul(a^(a>>>15),1|a);x=(x+Math.imul(x^(x>>>7),61|x))^x;return ((x^(x>>>14))>>>0)/4294967296;};}
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),scratch=new THREE.Vector3(),matrix=new THREE.Matrix4(),quaternion=new THREE.Quaternion(),size=new THREE.Vector3(),position=new THREE.Vector3(),up=new THREE.Vector3(0,1,0),colourOf=new THREE.Color();
  const outline=new THREE.BoxGeometry(1,1,1),edges=new THREE.EdgesGeometry(outline),selectedBox=new THREE.LineSegments(edges,new THREE.LineBasicMaterial({color:'#f3e3a3'})),hoveredBox=new THREE.LineSegments(edges,new THREE.LineBasicMaterial({color:'#ffffff',transparent:true,opacity:.6}));
  for(const b of [selectedBox,hoveredBox]){b.matrixAutoUpdate=false;b.visible=false;scene.add(b);}
  let key=null,lightKey=null,dirty=true,width=1,height=1,picks=[],pickIndex=new Map(),proxies=null,people=null,arms=null,legs=null,heads=null,hair=null,cars=null,cabins=null,roofs=null,agentList=[],highlight='',ground=14;
  const headings=new Map(),euler=new THREE.Euler(),base=new THREE.Matrix4(),part=new THREE.Matrix4(),limb=new THREE.Matrix4(),turnZ=new THREE.Matrix4();
  const glass=new THREE.MeshLambertMaterial({color:BUS.glassDay});

  function triangulate(points){return THREE.ShapeUtils.triangulateShape(points.map(([x,y])=>new THREE.Vector2(x,y)),[]).flat();}
  function dispose(group){for(const o of [...group.children]){group.remove(o);o.geometry?.dispose();if(o.isInstancedMesh)o.dispose();}}
  function boxMatrix(p,target){
    position.set(p.cx,p.z+p.h/2,p.cy);quaternion.setFromAxisAngle(up,-p.rot);size.set(p.w,p.h,p.d);return target.compose(position,quaternion,size);
  }
  function instanced(geometry,material,count){const mesh=new THREE.InstancedMesh(geometry,material,Math.max(1,count));mesh.count=count;return mesh;}

  function rebuild(){
    // Static geometry depends only on the plan, day / night and the filter; the camera never triggers this.
    dispose(statics);const plan=state.urban,model=CityMesh.build(plan,{day:state.day,matches:api.matches,triangulate}),palette=state.day?LIGHT.day:LIGHT.night;ground=model.ground;
    for(const [name,chunk] of model.chunks)for(const [arrays,material] of [[chunk.lit,lit],[chunk.glow,glow]]){if(!arrays.positions.length)continue;
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(arrays.positions,3));g.setAttribute('normal',new THREE.BufferAttribute(arrays.normals,3));g.setAttribute('color',new THREE.BufferAttribute(arrays.colors,3));g.computeBoundingSphere();
      const mesh=new THREE.Mesh(g,material);mesh.matrixAutoUpdate=false;mesh.castShadow=material===lit&&name!=='ground'&&name!=='landscape';mesh.receiveShadow=material===lit&&name!=='landscape';statics.add(mesh);}
    fitShadow(plan);
    // Trees and lamps: one instanced draw per part.
    const trunks=instanced(new THREE.CylinderGeometry(.09,.13,1,5).translate(0,.5,0),new THREE.MeshLambertMaterial({color:palette.trunk}),model.trees.length);
    const round=model.trees.filter(t=>!t.conifer),pointed=model.trees.filter(t=>t.conifer);
    const crowns=instanced(new THREE.IcosahedronGeometry(1,0),sway(new THREE.MeshLambertMaterial({color:'#ffffff'}),LIFE.swayRound),round.length),cones=instanced(new THREE.ConeGeometry(1,1,6).translate(0,.5,0),sway(new THREE.MeshLambertMaterial({color:'#ffffff'}),LIFE.swayCone),pointed.length);
    model.trees.forEach((t,i)=>{matrix.makeScale(t.size,t.size*.9,t.size).setPosition(t.x,ground,t.y);trunks.setMatrixAt(i,matrix);});
    const crown=new THREE.Color(palette.crown);
    round.forEach((t,i)=>{matrix.makeScale(t.size*.75,t.size*.8,t.size*.75).setPosition(t.x,ground+t.size*1.45,t.y);crowns.setMatrixAt(i,matrix);crowns.setColorAt(i,colourOf.copy(crown).multiplyScalar((t.tone??1)*(.85+(hash(t.x+':'+t.y)%30)/100)));});
    pointed.forEach((t,i)=>{matrix.makeScale(t.size*.6,t.size*1.9,t.size*.6).setPosition(t.x,ground+t.size*.5,t.y);cones.setMatrixAt(i,matrix);cones.setColorAt(i,colourOf.copy(crown).multiplyScalar((t.tone??1)*(.75+(hash(t.x+':'+t.y)%30)/100)));});
    const poles=instanced(new THREE.BoxGeometry(1.2,30,1.2).translate(0,15,0),new THREE.MeshLambertMaterial({color:'#64756a'}),model.lamps.length),bulbs=instanced(new THREE.BoxGeometry(4,5,4).translate(0,30,0),new THREE.MeshBasicMaterial({color:palette.lamp}),model.lamps.length);
    model.lamps.forEach((l,i)=>{matrix.makeTranslation(l.x,ground,l.y);poles.setMatrixAt(i,matrix);bulbs.setMatrixAt(i,matrix);});
    for(const m of [trunks,crowns,cones,poles,bulbs]){m.computeBoundingSphere();m.castShadow=true;m.receiveShadow=m!==bulbs;statics.add(m);}
    // Invisible boxes, one per building, answer pointer picks without testing the merged triangles.
    picks=model.picks;pickIndex=new Map();proxies=instanced(outline,new THREE.MeshBasicMaterial({visible:false}),picks.length);
    picks.forEach((p,i)=>{proxies.setMatrixAt(i,boxMatrix(p,matrix));if(!p.field){pickIndex.set(p.node.physicalId||p.node.id,p);pickIndex.set(p.node.id,p);}});proxies.computeBoundingSphere();statics.add(proxies);
    buildLife(model.life);
    highlight='';dirty=true;
  }
  function fitShadow(plan){
    const t=plan.terrain,cx=(t.minX+t.maxX)/2,cy=(t.minY+t.maxY)/2,r=Math.hypot(t.maxX-t.minX,t.maxY-t.minY)/2+SHADOW.margin,dir=new THREE.Vector3(...SUN_DIRECTION).normalize();
    sun.target.position.set(cx,ground,cy);sun.position.copy(sun.target.position).addScaledVector(dir,SHADOW.height);
    Object.assign(sun.shadow.camera,{left:-r,right:r,top:r,bottom:-r,near:1,far:SHADOW.height*2});sun.shadow.camera.updateProjectionMatrix();sun.shadow.needsUpdate=true;
  }
  function applyLight(){
    const p=state.day?LIGHT.day:LIGHT.night;hemi.color.set(p.sky);hemi.groundColor.set(p.ground);hemi.intensity=p.hemi;sun.color.set(p.sun);sun.intensity=p.sunPower;renderer.setClearColor(p.clear);scene.fog.color.set(p.clear);glass.color.set(state.day?BUS.glassDay:'#3a4a50');glass.emissive.set(state.day?'#000000':BUS.glassNight);glass.emissiveIntensity=state.day?0:.85;dirty=true;
  }
  function merged(parts){
    // Joins coloured parts into one geometry, so a detailed model still draws once per instance set.
    const position=[],normal=[],color=[],c=new THREE.Color();
    for(const [geometry,hex] of parts){const g=geometry.index?geometry.toNonIndexed():geometry,p=g.attributes.position.array,n=g.attributes.normal.array;c.set(hex);
      for(let k=0;k<p.length;k+=3){position.push(p[k],p[k+1],p[k+2]);normal.push(n[k],n[k+1],n[k+2]);color.push(c.r,c.g,c.b);}}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(position,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normal,3));g.setAttribute('color',new THREE.Float32BufferAttribute(color,3));return g;
  }
  const box=(w,h,d,x,y,z)=>new THREE.BoxGeometry(w,h,d).translate(x,y,z);
  function busGeometry(){
    // A 30-unit shuttle facing +x: two-tone body, accent stripe, roof with air conditioning, four wheels with hubs.
    const wheels=[];for(const x of [-9.5,9.5])for(const z of [-6.6,6.6]){wheels.push([new THREE.CylinderGeometry(2.4,2.4,1.6,12).rotateX(Math.PI/2).translate(x,2.4,z),'#26292b'],[new THREE.CylinderGeometry(1.1,1.1,1.7,8).rotateX(Math.PI/2).translate(x,2.4,z),'#b8bcb8']);}
    return {body:merged([[box(30,6,13,0,5,0),BUS.body],[box(30.3,1.2,13.3,0,2.6,0),'#4f4a44'],[box(30.3,.9,13.3,0,8.5,0),BUS.stripe],[box(30,4.6,13,0,11.2,0),BUS.body],
      [box(30.6,1,13.6,0,14,0),'#f3ecd8'],[box(8,1.6,7,-5,15.2,0),'#c9c9c0'],[box(1,1.6,13.4,15.2,4,0),'#4f4a44'],[box(1,1.6,13.4,-15.2,4,0),'#4f4a44'],...wheels]),
      glass:merged([[box(25,3.6,13.25,-1.5,11,0),'#ffffff'],[box(.3,4.4,11.6,15.05,10.8,0),'#ffffff'],[box(4.2,8.2,.3,9,7.6,6.55),'#ffffff']]),
      lights:merged([[box(.3,1.1,2.2,15.2,5.2,-4.6),'#fff4d0'],[box(.3,1.1,2.2,15.2,5.2,4.6),'#fff4d0'],[box(.3,1.1,2,-15.2,5.2,-4.8),'#d0503a'],[box(.3,1.1,2,-15.2,5.2,4.8),'#d0503a'],[box(.3,1.4,6.4,15.2,12.9,0),'#f1c46a']])};
  }
  function ensureAgents(count){
    if(people&&people.instanceMatrix.count>=count)return;
    dispose(agents);const capacity=Math.max(AGENT_CAPACITY,2**Math.ceil(Math.log2(Math.max(1,count))));
    const lambert=(vertexColors=false)=>new THREE.MeshLambertMaterial({color:'#ffffff',vertexColors});
    // People: torso, two arms and two legs that swing while walking, head and hair; parts tinted per resident.
    people=new THREE.InstancedMesh(merged([[box(2.4,5.6,3.8,0,10.2,0),'#ffffff'],[box(2.6,1.2,4,0,7.6,0),'#d8d0c4']]),lambert(true),capacity);
    arms=new THREE.InstancedMesh(merged([[box(1.1,5,1.1,0,-2.5,0),'#ffffff'],[box(1,1,1,0,-5.4,0),'#e2c4a5']]),lambert(true),capacity*2);
    legs=new THREE.InstancedMesh(merged([[box(1.5,6.6,1.5,0,-3.3,0),'#ffffff'],[box(2.4,.9,1.7,.4,-6.9,0),'#3a3330']]),lambert(true),capacity*2);
    heads=new THREE.InstancedMesh(new THREE.SphereGeometry(2.05,10,8).translate(0,15.3,0),lambert(),capacity);
    hair=new THREE.InstancedMesh(new THREE.SphereGeometry(2.25,10,6,0,Math.PI*2,0,Math.PI*.55).translate(-.25,15.55,0),lambert(),capacity);
    const bus=busGeometry();
    cars=new THREE.InstancedMesh(bus.body,lambert(true),capacity);
    cabins=new THREE.InstancedMesh(bus.glass,glass,capacity);
    roofs=new THREE.InstancedMesh(bus.lights,new THREE.MeshBasicMaterial({vertexColors:true}),capacity);
    for(const m of [people,arms,legs,heads,hair,cars,cabins,roofs]){m.count=0;m.frustumCulled=false;m.castShadow=m!==roofs;agents.add(m);}
  }
  function updateAgents(){
    // Agents move every frame: only their instance matrices change.
    const residents=state.urban.residents?api.residents():[],vehicles=api.vehicles?api.vehicles():state.urban.vehicles||[],S=state.urban.scale||1;ensureAgents(Math.max(residents.length,vehicles.length));agentList=residents;
    const t=performance.now()/1000;
    residents.forEach((r,i)=>{
      const seed=hash(r.node.appearance?.seedKey||r.node.stableId||r.node.id),swing=r.moving?Math.sin(t*PERSON.stride+seed%7)*PERSON.swing:0;
      base.makeRotationY(-(r.heading??(seed%628)/100)).setPosition(r.x,ground+.4,r.y);
      people.setMatrixAt(i,base);heads.setMatrixAt(i,base);hair.setMatrixAt(i,base);
      for(const [k,side] of [[0,-1],[1,1]]){
        legs.setMatrixAt(2*i+k,part.copy(base).multiply(limb.makeTranslation(0,7.2,side*1)).multiply(turnZ.makeRotationZ(side*swing)));
        arms.setMatrixAt(2*i+k,part.copy(base).multiply(limb.makeTranslation(0,12.8,side*2.55)).multiply(turnZ.makeRotationZ(-side*swing*.8)));}
      const coat=colourOf.set(COATS[seed%COATS.length]);people.setColorAt(i,coat);arms.setColorAt(2*i,coat);arms.setColorAt(2*i+1,coat);
      const trousers=colourOf.set(PERSON.trousers[(seed>>3)%PERSON.trousers.length]);legs.setColorAt(2*i,trousers);legs.setColorAt(2*i+1,trousers);
      heads.setColorAt(i,colourOf.set(PERSON.skin[(seed>>5)%PERSON.skin.length]));hair.setColorAt(i,colourOf.set(PERSON.hair[(seed>>7)%PERSON.hair.length]));});
    vehicles.forEach((v,i)=>{
      // The server sends the heading; without it the bus faces its last noticeable move.
      const x=v.x*S,y=v.y*S,last=headings.get(v.id)||{x,y,angle:0};if(v.heading!=null)last.angle=v.heading;else if(Math.hypot(x-last.x,y-last.y)>.5){last.angle=Math.atan2(y-last.y,x-last.x);last.x=x;last.y=y;}headings.set(v.id,last);
      matrix.makeRotationFromEuler(euler.set(0,-last.angle,0)).setPosition(x,ground+.6,y);cars.setMatrixAt(i,matrix);cabins.setMatrixAt(i,matrix);roofs.setMatrixAt(i,matrix);});
    people.count=heads.count=hair.count=residents.length;arms.count=legs.count=residents.length*2;cars.count=cabins.count=roofs.count=vehicles.length;
    for(const m of [people,arms,legs,heads,hair,cars,cabins,roofs]){m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true;}
    // Picking tests the moving figures; a bounds sphere from an earlier frame would miss them.
    people.boundingSphere=null;
  }
  function updateHighlight(){
    const next=[state.selected?.physicalId||state.selected?.id,state.hovered?.physicalId||state.hovered?.id].join('|');if(next===highlight)return;highlight=next;
    for(const [box,node] of [[selectedBox,state.selected],[hoveredBox,state.hovered]]){const p=node&&(pickIndex.get(node.physicalId)||pickIndex.get(node.id));box.visible=!!p;if(p){box.matrix.copy(boxMatrix({...p,w:p.w+2,d:p.d+2,h:p.h+2},matrix));}}
    dirty=true;
  }
  function aim(target,azimuth,polar){
    const offset=new THREE.Vector3().setFromSphericalCoords(CAMERA_DISTANCE,polar,azimuth);controls.target.copy(target);camera.position.copy(target).add(offset);camera.lookAt(target);controls.update();dirty=true;
  }
  function spherical(){return new THREE.Spherical().setFromVector3(scratch.copy(camera.position).sub(controls.target));}
  function groundAt(x,y){
    pointer.set(x/width*2-1,-(y/height)*2+1);raycaster.setFromCamera(pointer,camera);const hit=new THREE.Vector3();
    return raycaster.ray.intersectPlane(new THREE.Plane(up,-ground),hit)?hit:null;
  }
  function shiftScreen(dx,dy){
    // Moves the view so the target appears dx, dy pixels from the screen centre.
    camera.updateMatrixWorld();const right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0),upward=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1),shift=right.multiplyScalar(-dx/camera.zoom).add(upward.multiplyScalar(dy/camera.zoom));
    camera.position.add(shift);controls.target.add(shift);controls.update();dirty=true;
  }
  function frameBox(minX,maxX,minY,maxY,top,margins,zoomLimits){
    // Fits a plan box between the side panels at the current camera angle.
    const s=spherical();aim(new THREE.Vector3((minX+maxX)/2,ground,(minY+maxY)/2),s.theta,s.phi);camera.updateMatrixWorld();
    const inverse=camera.matrixWorldInverse,lo=new THREE.Vector3(Infinity,Infinity,0),hi=new THREE.Vector3(-Infinity,-Infinity,0);
    for(const x of [minX,maxX])for(const z of [minY,maxY])for(const y of [ground,ground+top]){scratch.set(x,y,z).applyMatrix4(inverse);lo.min(scratch);hi.max(scratch);}
    const usableW=Math.max(180,width-margins.left-margins.right),usableH=Math.max(180,height-margins.top-margins.bottom);
    camera.zoom=THREE.MathUtils.clamp(Math.min(usableW/(hi.x-lo.x),usableH/(hi.y-lo.y)),zoomLimits[0],zoomLimits[1]);camera.updateProjectionMatrix();
    shiftScreen(margins.left+usableW/2-width/2,margins.top+usableH/2-height/2);api.onZoom?.(camera.zoom/ATLAS_SCALE);
  }

  // The view stays inside the landscape: the zoom can't open wider than it, and the centre can't drift past its edge.
  let confining=false;
  function confine(){
    if(confining||!life?.view)return;confining=true;
    const reachOf=zoom=>Math.max(width,height/Math.cos(spherical().phi||ATLAS_POLAR))/2/zoom;
    const minZoom=Math.max(MIN_ZOOM,Math.max(width,height*2)/2/(life.view*CONFINE.fill));
    if(camera.zoom<minZoom){camera.zoom=minZoom;camera.updateProjectionMatrix();api.onZoom?.(camera.zoom/ATLAS_SCALE);}
    const room=Math.max(0,life.view-reachOf(camera.zoom)),dx=controls.target.x-life.centre.x,dz=controls.target.z-life.centre.y,d=Math.hypot(dx,dz);
    if(d>room){const k=(d-room)/d,shift=new THREE.Vector3(-dx*k,0,-dz*k);camera.position.add(shift);controls.target.add(shift);controls.update();}
    confining=false;dirty=true;
  }
  controls.addEventListener('change',()=>{dirty=true;confine();});
  // Focus moves fly the camera over FLY_MS instead of jumping; any hand on the controls takes over at once.
  let flight=null;
  controls.addEventListener('start',()=>{flight=null;});
  function fly(move){
    const from={p:camera.position.clone(),t:controls.target.clone(),z:camera.zoom};move();
    if(from.p.lengthSq()===0)return;
    const to={p:camera.position.clone(),t:controls.target.clone(),z:camera.zoom};
    camera.position.copy(from.p);controls.target.copy(from.t);camera.zoom=from.z;camera.updateProjectionMatrix();camera.lookAt(from.t);
    flight={from,to,start:performance.now()};dirty=true;
  }
  function flyStep(){
    if(!flight)return;const k=Math.min(1,(performance.now()-flight.start)/FLY_MS),e=k<.5?4*k*k*k:1-(-2*k+2)**3/2,{from,to}=flight;
    camera.position.lerpVectors(from.p,to.p,e);controls.target.lerpVectors(from.t,to.t,e);camera.zoom=from.z*Math.pow(to.z/from.z,e);camera.updateProjectionMatrix();camera.lookAt(controls.target);
    if(k===1){flight=null;controls.update();confine();}dirty=true;api.onZoom?.(camera.zoom/ATLAS_SCALE);
  }
  return {
    resize(w,h,ratio){width=w;height=h;renderer.setPixelRatio(ratio);renderer.setSize(w,h,false);Object.assign(camera,{left:-w/2,right:w/2,top:h/2,bottom:-h/2});camera.updateProjectionMatrix();dirty=true;},
    frame(){
      if(!state.urban)return;
      const next=[api.planVersion(),state.day,state.filter,state.query].join('|');if(next!==key){key=next;rebuild();}
      if(lightKey!==state.day){lightKey=state.day;applyLight();}
      flyStep();
      const moving=!state.paused&&!state.reduced;if(moving||!people)updateAgents();updateHighlight();
      if(moving){const t=performance.now()/1000;wind.value=t;updateLife(t);}else fadeClouds();
      if(dirty||moving){renderer.render(scene,camera);dirty=false;}
    },
    project(x,y,z=0){scratch.set(x,z,y).project(camera);return {x:(scratch.x+1)/2*width,y:(1-scratch.y)/2*height};},
    hit(x,y){
      pointer.set(x/width*2-1,-(y/height)*2+1);raycaster.setFromCamera(pointer,camera);
      const found=raycaster.intersectObjects([people,proxies].filter(Boolean),false)[0];if(!found)return null;
      if(found.object===people){const r=agentList[found.instanceId];return r?{node:r.node,person:true}:null;}
      const p=picks[found.instanceId];return p?{node:p.node,person:false,field:!!p.field}:null;
    },
    zoom(factor,x=width*.6,y=height*.5){
      // Zoom towards the cursor: the ground point under it stays put.
      flight=null;const before=groundAt(x,y);camera.zoom=THREE.MathUtils.clamp(camera.zoom*factor,MIN_ZOOM,MAX_ZOOM);camera.updateProjectionMatrix();camera.updateMatrixWorld();const after=groundAt(x,y);
      if(before&&after){const shift=before.sub(after);camera.position.add(shift);controls.target.add(shift);controls.update();}confine();dirty=true;api.onZoom?.(camera.zoom/ATLAS_SCALE);
    },
    rotate(step){flight=null;const s=spherical();aim(controls.target.clone(),s.theta+step*ROTATE_STEP,s.phi);},
    fit(margins){const ds=state.districts;if(!ds.length)return;flight=null;fly(()=>{aim(controls.target.clone(),ATLAS_AZIMUTH,ATLAS_POLAR);frameBox(Math.min(...ds.map(d=>d.minX)),Math.max(...ds.map(d=>d.maxX)),Math.min(...ds.map(d=>d.minY)),Math.max(...ds.map(d=>d.maxY))+50,100,margins,[MIN_ZOOM,1.1*ATLAS_SCALE]);});},
    focusDistrict(d,margins){flight=null;fly(()=>frameBox(d.minX,d.maxX,d.minY,d.maxY,100,margins,DISTRICT_ZOOM.map(z=>z*ATLAS_SCALE)));},
    focusNode(n,margins){flight=null;fly(()=>{
      const s=spherical();camera.zoom=Math.max(FOCUS_ZOOM*ATLAS_SCALE,camera.zoom);camera.updateProjectionMatrix();aim(new THREE.Vector3(n.rcx??n.x+n.w/2,ground+n.h/2,n.rcy??n.y+n.d/2),s.theta,s.phi);
      shiftScreen(margins.left+(width-margins.left-margins.right)/2-width/2,0);api.onZoom?.(camera.zoom/ATLAS_SCALE);
    });},
    zoomLevel(){return camera.zoom/ATLAS_SCALE;},
  };
}
// The app owns state and UI; it receives the 3D view once WebGL2 and the module are available.
if(typeof window.attach3D==='function'){
  if(window.WebGL2RenderingContext)window.attach3D(create);
  else window.show3DError();
}
