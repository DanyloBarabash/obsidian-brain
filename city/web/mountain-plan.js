/* Mountain of Ideas zone: the terrain, the trail to the summit and where each idea's flag stands. No three.js dependency. */
(function(root){
  'use strict';
  const MOUNTAIN={size:3200,peak:560,spread:330,trailStart:640,turns:2.35,trailAngle:Math.PI*.15,flat:90,flatHeight:12,yardRamp:4,rails:[-80,560],lake:{x:-380,z:860,r:150,bottom:-14},water:4,cap:{height:70,spread:70}};
  // Each stage camps on its own stretch of the trail: seeds at the foot, projects just under the summit.
  const ZONES={seed:[.05,.33,'Зерна'],growing:[.41,.67,'Проростають'],project:[.75,.94,'Стали проєктами']};
  const TRAIL={step:6,grade:.1,max:.22,summit:14,steps:4000,tread:3,turn:.35,bend:0,blends:40,lean:[-1.3,1.57]};
  // Psychology rules (IDEA-MOUNTAIN.md): incubation after a week untouched, revisit intervals per place in days,
  // development by words, room for three projects on the summit.
  const IDEAS={incubate:7,revisit:{growing:7,incubating:14,project:14,shelved:90},fullWords:400,summit:3,gap:.012,margin:.08,shore:1.35,shoreFrom:-2.4,shoreStep:.42,shoreRow:12};
  // Altitude belts (IM-11): valley meadows, montane forest up to the tree line, alpine meadows, rock, snow.
  const BELTS={meadow:150,treeline:320,alpine:420,snow:450};
  const STREAMS={count:5,angle:.9,from:40,source:400,step:10,steps:300,dirs:16,min:8},DAY=86400000;
  const SIDE_STEP=12,SHELVED_RING=[60,26];
  const NEIGHBOURS=[{x:-560,z:-420,peak:300,spread:210},{x:520,z:-560,peak:260,spread:190},{x:-760,z:220,peak:180,spread:170}];
  const RANGE={from:1050,to:1450,height:420};

  const fract=v=>v-Math.floor(v);
  const lattice=(i,j)=>fract(Math.sin(i*127.1+j*311.7)*43758.5453);
  function noise(x,z){
    const i=Math.floor(x),j=Math.floor(z),u=x-i,v=z-j,su=u*u*(3-2*u),sv=v*v*(3-2*v);
    const a=lattice(i,j),b=lattice(i+1,j),c=lattice(i,j+1),d=lattice(i+1,j+1);
    return a+(b-a)*su+(c-a)*sv+(a-b-c+d)*su*sv;
  }
  function fbm(x,z){let sum=0,amp=.5,f=1;for(let k=0;k<4;k++){sum+=amp*(noise(x*f,z*f)*2-1);amp*=.5;f*=2.03;}return sum;}
  const smooth=(a,b,v)=>{const t=Math.min(1,Math.max(0,(v-a)/(b-a)));return t*t*(3-2*t);};
  const station=()=>{const a=MOUNTAIN.trailAngle,r=MOUNTAIN.trailStart+70;return {x:Math.cos(a)*r,z:Math.sin(a)*r,angle:a};};

  function railYard(x,z,s){
    // Distance to the rail corridor: the yard and the line back to the city are cut level through the hills.
    const ox=Math.cos(s.angle),oz=Math.sin(s.angle),dx=x-s.x,dz=z-s.z,t=Math.min(MOUNTAIN.rails[1],Math.max(MOUNTAIN.rails[0],dx*ox+dz*oz));
    return Math.hypot(dx-ox*t,dz-oz*t);
  }
  /** Terrain height at plan point (x, z): the main peak, its neighbours, a far range closing the view, a lake and a flat yard at the station. */
  function height(x,z){
    const r=Math.hypot(x,z),f=1/(1+(r/MOUNTAIN.spread)**2)**1.4;
    let h=MOUNTAIN.peak*f+MOUNTAIN.cap.height*Math.exp(-((r/MOUNTAIN.cap.spread)**2))+70*fbm(x/260,z/260)*(.25+.75*f)+18*fbm(x/70,z/70)*f;
    for(const n of NEIGHBOURS){const q=Math.hypot(x-n.x,z-n.z);h+=n.peak*Math.exp(-((q/n.spread)**2))*(1+.25*fbm(x/120+5,z/120));}
    h+=RANGE.height*smooth(RANGE.from,RANGE.to,r)*(.55+.45*fbm(x/300+9,z/300));
    const L=MOUNTAIN.lake,l=Math.hypot(x-L.x,z-L.z);h+=(L.bottom-h)*Math.exp(-((l/L.r)**4));
    const s=station(),yard=railYard(x,z,s);h+=(MOUNTAIN.flatHeight-h)*(1-smooth(MOUNTAIN.flat*.6,MOUNTAIN.flat*MOUNTAIN.yardRamp,yard));
    return h;
  }
  let line=null;
  function trailLine(){
    // The trail climbs at the target grade: each step blends the way round the peak with the way up, picking the
    // blend whose climb is closest to TRAIL.grade and never steeper than TRAIL.max (IM-12). It ends at the summit.
    if(line)return line;
    let x=Math.cos(MOUNTAIN.trailAngle)*MOUNTAIN.trailStart,z=Math.sin(MOUNTAIN.trailAngle)*MOUNTAIN.trailStart;const points=[{x,z,y:height(x,z)}],run=[0];let heading=null;
    for(let step=0;step<TRAIL.steps&&Math.hypot(x,z)>TRAIL.summit;step++){
      const r=Math.hypot(x,z),inX=-x/r,inZ=-z/r,roundX=-inZ,roundZ=inX,h=height(x,z);let best=null;
      for(let k=0;k<=TRAIL.blends;k++){const t=TRAIL.lean[0]+(TRAIL.lean[1]-TRAIL.lean[0])*k/TRAIL.blends,dx=roundX*Math.cos(t)+inX*Math.sin(t),dz=roundZ*Math.cos(t)+inZ*Math.sin(t);
        const nx=x+dx*TRAIL.step,nz=z+dz*TRAIL.step,g=(height(nx,nz)-h)/TRAIL.step,turn=heading?1-(dx*heading[0]+dz*heading[1]):0,miss=Math.abs(g-TRAIL.grade)+(Math.abs(g)>TRAIL.max?1:0)+turn*TRAIL.turn;if(!best||miss<best.miss)best={miss,nx,nz,dx,dz};}
      x=best.nx;z=best.nz;heading=[best.dx,best.dz];points.push({x,z,y:height(x,z)});run.push(run[run.length-1]+TRAIL.step);
    }
    // The tread is graded like a real path: its level is a running mean of the ground, cutting through small bumps.
    for(let pass=0;pass<TRAIL.bend;pass++){const xs=points.map(p=>[p.x,p.z]);for(let i=1;i<points.length-1;i++){points[i].x=(xs[i-1][0]+2*xs[i][0]+xs[i+1][0])/4;points[i].z=(xs[i-1][1]+2*xs[i][1]+xs[i+1][1])/4;}}
    for(let i=1;i<points.length;i++)run[i]=run[i-1]+Math.hypot(points[i].x-points[i-1].x,points[i].z-points[i-1].z);
    const ground=points.map(p=>height(p.x,p.z));points.forEach((p,i)=>{let sum=0,n=0;for(let k=Math.max(0,i-TRAIL.tread);k<=Math.min(points.length-1,i+TRAIL.tread);k++){sum+=ground[k];n++;}p.y=sum/n;});
    return line={points,run};
  }
  /** Point on the trail at s in [0, 1]: from the station yard up to the summit, by distance along the trail. */
  function trail(s){
    const {points,run}=trailLine(),d=Math.min(1,Math.max(0,s))*run[run.length-1];let lo=0,hi=run.length-1;
    while(hi-lo>1){const m=(lo+hi)>>1;if(run[m]<=d)lo=m;else hi=m;}
    const a=points[lo],b=points[hi],f=(d-run[lo])/((run[hi]-run[lo])||1);return {x:a.x+(b.x-a.x)*f,z:a.z+(b.z-a.z)*f,y:a.y+(b.y-a.y)*f};
  }
  const daysSince=(date,today)=>{const t=Date.parse(date);return Number.isFinite(t)?Math.max(0,Math.floor((today-t)/DAY)):0;};
  /** Where an idea stands (IM-03): its stage, except that a seed untouched for IDEAS.incubate days rests in the valley. */
  function placeOf(idea,today=Date.now()){const stage=idea.status||'seed';return stage==='seed'&&daysSince(idea.updated||idea.created,today)>=IDEAS.incubate?'incubating':stage;}
  /** Development in [0, 1] from the words in the note, on a log scale (IM-05). */
  const growth=idea=>Math.min(1,Math.log1p(Math.max(0,idea.words||0))/Math.log1p(IDEAS.fullWords));
  /** True when an idea has waited longer than its place's revisit interval (IM-04). */
  function due(idea,today=Date.now()){const limit=IDEAS.revisit[placeOf(idea,today)];return limit!=null&&daysSince(idea.updated||idea.created,today)>=limit;}
  /** Spread positions in [a, b] by development, keeping a minimum gap so neighbours never stand on each other. */
  function spread(values,a,b){
    const gap=Math.min(IDEAS.gap,(b-a)/(values.length+1)),order=values.map((v,i)=>[a+(b-a)*(IDEAS.margin+(1-2*IDEAS.margin)*v),i]).sort((p,q)=>p[0]-q[0]);
    for(let k=1;k<order.length;k++)order[k][0]=Math.max(order[k][0],order[k-1][0]+gap);
    for(let k=order.length-1;k>=0;k--)order[k][0]=Math.min(order[k][0],(k<order.length-1?order[k+1][0]:b)-(k<order.length-1?gap:0));
    const out=[];for(const [s,i] of order)out[i]=s;return out;
  }
  /** Where every idea stands: stages on their trail stretches by development, incubating seeds by the lake,
   * shelved ideas in the store at the station; camps, summit crowding (IM-07) and ropes between linked ideas (IM-08). */
  function layout(ideas,today=Date.now()){
    const flags=[],camps=[],place=new Map(ideas.map(i=>[i,placeOf(i,today)]));
    for(const [stage,[a,b,name]] of Object.entries(ZONES)){
      const own=ideas.filter(i=>place.get(i)===stage),start=trail(a),at=spread(own.map(growth),a,b);camps.push({stage,name,x:start.x,y:start.y,z:start.z,count:own.length});
      own.forEach((idea,i)=>{
        const p=trail(at[i]),q=trail(at[i]+.002),dx=q.x-p.x,dz=q.z-p.z,l=Math.hypot(dx,dz)||1,side=(i%2?1:-1)*SIDE_STEP,x=p.x-dz/l*side,z=p.z+dx/l*side;
        flags.push({idea,stage,s:at[i],x,z,y:height(x,z),growth:growth(idea),due:due(idea,today)});});
    }
    const L=MOUNTAIN.lake,resting=ideas.filter(i=>place.get(i)==='incubating');
    camps.push({stage:'incubating',name:'Тиха долина',x:L.x,y:MOUNTAIN.water,z:L.z-L.r*IDEAS.shore,count:resting.length});
    resting.forEach((idea,i)=>{const a=IDEAS.shoreFrom+i*IDEAS.shoreStep,r=L.r*IDEAS.shore+Math.floor(i/IDEAS.shoreRow)*SHELVED_RING[1],x=L.x+Math.cos(a)*r,z=L.z+Math.sin(a)*r;
      flags.push({idea,stage:'incubating',x,z,y:Math.max(MOUNTAIN.water,height(x,z)),growth:growth(idea),due:due(idea,today)});});
    const s=station(),shelved=ideas.filter(i=>place.get(i)==='shelved');
    shelved.forEach((idea,i)=>{const a=s.angle+Math.PI*.5+i*.55,r=SHELVED_RING[0]+Math.floor(i/11)*SHELVED_RING[1],x=s.x+Math.cos(a)*r,z=s.z+Math.sin(a)*r;flags.push({idea,stage:'shelved',x,z,y:height(x,z),growth:growth(idea),due:due(idea,today)});});
    const byPath=new Map(flags.map(f=>[f.idea.path,f])),ropes=[];
    for(const f of flags)for(const link of f.idea.links||[]){const g=byPath.get(link);if(g&&g!==f&&!ropes.some(([p,q])=>p===g&&q===f))ropes.push([f,g]);}
    const projects=flags.filter(f=>f.stage==='project').length;
    return {flags,camps,ropes,summit:{count:projects,capacity:IDEAS.summit,crowded:projects>IDEAS.summit},station:{...s,y:height(s.x,s.z)}};
  }
  /** Streams from below the snow line down the steepest descent to the lake or the valley floor (IM-13). */
  function streams(){
    const out=[];
    for(let k=0;k<STREAMS.count;k++){
      const a=STREAMS.angle+k*Math.PI*2/STREAMS.count;let r=STREAMS.from;while(r<MOUNTAIN.size/2&&height(Math.cos(a)*r,Math.sin(a)*r)>STREAMS.source)r+=STREAMS.step;
      let x=Math.cos(a)*r,z=Math.sin(a)*r,h=height(x,z);const line=[{x,z,y:h}];
      for(let step=0;step<STREAMS.steps&&h>MOUNTAIN.water+1;step++){
        let best=null;for(let d=0;d<STREAMS.dirs;d++){const t=d/STREAMS.dirs*Math.PI*2,nx=x+Math.cos(t)*STREAMS.step,nz=z+Math.sin(t)*STREAMS.step,nh=height(nx,nz);if(nh<h&&(!best||nh<best.h))best={x:nx,z:nz,h:nh};}
        if(!best)break;x=best.x;z=best.z;h=best.h;line.push({x,z,y:h});}
      if(line.length>STREAMS.min)out.push(line);
    }
    return out;
  }
  const api={MOUNTAIN,ZONES,TRAIL,IDEAS,BELTS,height,trail,trailLine,layout,placeOf,due,growth,streams,noise:fbm};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.MountainPlan=api;
})(typeof window!=='undefined'?window:globalThis);
