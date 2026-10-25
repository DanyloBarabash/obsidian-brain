/* Stable urban parcels: perimeter blocks, civic cores and garden streets. */
(function(root){
  'use strict';
  const hash=s=>{let h=2166136261;for(const c of s){h^=c.codePointAt(0);h=Math.imul(h,16777619);}return h>>>0;};
  const anchors={workspace:[-650,0],library:[450,60],observatory:[-300,-650],academy:[550,-550],studio:[-400,650],garden:[550,650]};
  function spiral(slot){if(!slot)return [0,0];const r=Math.ceil((Math.sqrt(slot+1)-1)/2),e=2*r,t=(2*r+1)**2-1-slot;if(t<e)return[r-t,-r];if(t<2*e)return[-r,-r+t-e];if(t<3*e)return[-r+t-2*e,r];return[r,r-(t-3*e)];}
  function hull(points){const p=[...points].sort((a,b)=>a.x-b.x||a.y-b.y),cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x),lower=[],upper=[];for(const n of p){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),n)<=0)lower.pop();lower.push(n);}for(const n of p.reverse()){while(upper.length>1&&cross(upper.at(-2),upper.at(-1),n)<=0)upper.pop();upper.push(n);}return lower.slice(0,-1).concat(upper.slice(0,-1));}
  function distance(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);}
  function inside(p,poly){let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;}
  function architecture(n,theme){const s=hash(n.id),landmark=['class','hub','org'].includes(n.kind);const choices={workspace:['townhouse','office','workshop','terrace'],academy:['college','laboratory','library-wing'],observatory:['laboratory','data-tower','observatory'],studio:['timber-house','atelier','theatre'],garden:['cottage','greenhouse','maker-house'],library:['merchant-house','archive','clock-house']};const models=choices[theme]||choices.workspace;return landmark?(theme==='workspace'?'headquarters':theme==='academy'?'college':theme==='observatory'?'observatory':theme==='studio'?'theatre':theme==='garden'?'greenhouse':'clock-house'):models[s%models.length];}
  function plan(data){
    const districts=data.districts.map(d=>({...d,blocks:[],roads:[],parks:[]})),byDistrict=new Map(districts.map(d=>[d.id,d])),roads=[],scenery=[];
    const nodeList=[];
    const road=(points,width=14,kind='local',district=null)=>{const r={points,width,kind,district};roads.push(r);if(district)byDistrict.get(district).roads.push(r);return r;};
    for(const d of districts){
      const known=anchors[d.theme],extra=spiral(d.order+3);[d.wx,d.wy]=known||[extra[0]*1000,extra[1]*1000];
      // Unknown classes get their own outer neighbourhood, even if their theme matches.
      if(d.theme==='workspace'&&d.id!=='client-products'){d.wx=extra[0]*1000;d.wy=extra[1]*1000;}
      d.pattern=['workspace','academy'].includes(d.theme)?'courtyards':d.theme==='garden'?'garden':'old-town';
      const members=data.nodes.filter(n=>n.district===d.id),maxSlot=Math.max(0,...members.map(n=>n.slot));
      if(d.pattern==='courtyards'){
        for(let i=0;i<=Math.floor(maxSlot/8);i++){
          const [gx,gy]=spiral(i),cx=d.wx+gx*260,cy=d.wy+gy*260;
          const block={x:cx,y:cy,size:238,cut:d.theme==='workspace'?20:8};d.blocks.push(block);d.parks.push({x:cx,y:cy,r:45,kind:'courtyard'});
          const corners=[[-130,-130],[130,-130],[130,130],[-130,130],[-130,-130]].map(([x,y])=>({x:cx+x,y:cy+y}));road(corners,17,'local',d.id);
          for(const [x,y]of [[-28,-23],[28,22],[-25,25],[27,-24]])scenery.push({kind:'tree',x:cx+x,y:cy+y,size:17+(i%3)*3,seed:i});
          scenery.push({kind:'bench',x:cx+7,y:cy+8});
        }
      }else{
        let ring=0,capacity=1;
        while(capacity<=maxSlot){const count=12+ring*4,radius=160+ring*135,points=[];for(let i=0;i<=48;i++){const angle=i/48*Math.PI*2;points.push({x:d.wx+Math.cos(angle)*(radius-58),y:d.wy+Math.sin(angle)*(radius-58)});}road(points,d.theme==='garden'?10:15,d.theme==='garden'?'garden':'local',d.id);capacity+=count;ring++;}
        const outer=160+Math.max(0,ring-1)*135;
        for(let i=0;i<4;i++){const a=i*Math.PI/2,points=i===3?[{x:d.wx,y:d.wy},{x:d.wx-60,y:d.wy-20},{x:d.wx-60,y:d.wy-110},{x:d.wx,y:d.wy-110},{x:d.wx,y:d.wy-outer-55}]:[{x:d.wx,y:d.wy},{x:d.wx+Math.cos(a)*(outer+55),y:d.wy+Math.sin(a)*(outer+55)}];road(points,d.theme==='garden'?11:17,'local',d.id);}
        d.parks.push({x:d.wx,y:d.wy,r:d.theme==='garden'?80:59,kind:d.theme==='library'?'square':'park'});
        scenery.push({kind:d.theme==='library'?'fountain':d.theme==='studio'?'bandstand':'monument',x:d.wx,y:d.wy+25,size:22,seed:d.order});
      }
      for(const source of members){
        const appearance=source.appearance||{seedKey:source.id,kind:source.kind},seed=hash(appearance.seedKey),model=architecture({...source,id:appearance.seedKey,kind:appearance.kind},d.theme),landmark=['hub','class','org'].includes(appearance.kind);
        let w=landmark?58:36+seed%13,depth=landmark?48:29+(seed>>>4)%13;
        if(model==='greenhouse'){w=55;depth=43;}if(model==='workshop'||model==='theatre'){w=55;depth=43;}
        let h=landmark?65+Math.min(source.degree,25):23+Math.min(45,Math.log2(source.words+1)*2.2+source.degree*.7);
        if(['cottage','greenhouse','timber-house','atelier','workshop'].includes(model))h=24+seed%14;
        if(model==='data-tower'||model==='headquarters')h+=30;
        let cx,cy,walk;
        if(d.pattern==='courtyards'){
          const b=d.blocks[Math.floor(source.slot/8)],lots=[[-32,-82],[32,-82],[82,-32],[82,32],[32,82],[-32,82],[-82,32],[-82,-32]],[lx,ly]=lots[source.slot%8];cx=b.x+lx;cy=b.y+ly;
          walk=Math.abs(lx)>Math.abs(ly)?[{x:b.x+Math.sign(lx)*130,y:cy-30},{x:b.x+Math.sign(lx)*130,y:cy+30}]:[{x:cx-30,y:b.y+Math.sign(ly)*130},{x:cx+30,y:b.y+Math.sign(ly)*130}];
        }else if(source.slot===0){cx=d.wx;cy=d.wy-60;walk=[{x:d.wx-35,y:d.wy-30},{x:d.wx+35,y:d.wy-30}];}
        else{
          let idx=source.slot-1,ring=0;while(idx>=12+ring*4){idx-=12+ring*4;ring++;}const count=12+ring*4,angle=(idx+.5)/count*Math.PI*2,r=160+ring*135;
          cx=d.wx+Math.cos(angle)*r;cy=d.wy+Math.sin(angle)*r;
          const jitter=d.theme==='garden'?9:5;cx+=(seed%11-5)/5*jitter;cy+=((seed>>>8)%11-5)/5*jitter;
          walk=[-.15,.15].map(offset=>({x:d.wx+Math.cos(angle+offset)*(r-58),y:d.wy+Math.sin(angle+offset)*(r-58)}));
        }
        const palettes={workspace:['#c9b697','#cf997f','#a9bdba','#d6c3a7'],academy:['#a7c5ce','#d5c9af','#88aeb8'],observatory:['#a8a0c5','#b8c7d2','#929fb8'],studio:['#c7928d','#ddb592','#bc8b9e'],garden:['#a9bf9a','#dbc6a1','#92b4a9'],library:['#d5c1a0','#bfa386','#c6bba4']};
        const palette=palettes[d.theme]||palettes.workspace;
        nodeList.push({...source,x:cx-w/2,y:cy-depth/2,w,d:depth,h,color:palette[seed%palette.length],accent:d.color,theme:d.theme,model,seed,walk});
      }
      const own=nodeList.filter(n=>n.district===d.id);d.minX=Math.min(d.wx-180,...own.map(n=>n.x-60));d.maxX=Math.max(d.wx+180,...own.map(n=>n.x+n.w+60));d.minY=Math.min(d.wy-180,...own.map(n=>n.y-60));d.maxY=Math.max(d.wy+180,...own.map(n=>n.y+n.d+60));
      d.label={x:(d.minX+d.maxX)/2,y:d.maxY+40};
    }
    // One connected street network: join the nearest street junctions with a
    // minimum spanning tree, using orthogonal approaches that avoid the blocks.
    const connected=new Set(districts.length?[districts[0].id]:[]);
    while(connected.size<districts.length){let best=null;for(const a of districts.filter(d=>connected.has(d.id)))for(const b of districts.filter(d=>!connected.has(d.id))){const ap=a.roads.flatMap(r=>r.points),bp=b.roads.flatMap(r=>r.points);for(const p of ap)for(const q of bp){const length=Math.hypot(p.x-q.x,p.y-q.y);if(!best||length<best.length)best={a,b,p,q,length};}}
      if(!best)break;road([best.p,best.q],24,'avenue');connected.add(best.b.id);
    }
    const outline=hull(districts.flatMap(d=>[{x:d.minX-150,y:d.minY-150},{x:d.maxX+150,y:d.minY-150},{x:d.maxX+150,y:d.maxY+150},{x:d.minX-150,y:d.maxY+150}]));
    const terrain={outline,minX:Math.min(...outline.map(p=>p.x)),maxX:Math.max(...outline.map(p=>p.x)),minY:Math.min(...outline.map(p=>p.y)),maxY:Math.max(...outline.map(p=>p.y))};
    // Forest edges and pocket parks occupy real leftover land, never the streets.
    const clearance=p=>nodeList.every(n=>p.x<n.x-18||p.x>n.x+n.w+18||p.y<n.y-18||p.y>n.y+n.d+18)&&roads.every(r=>r.points.slice(1).every((b,i)=>distance(p,r.points[i],b)>r.width/2+15))&&districts.every(d=>d.parks.every(k=>Math.hypot(p.x-k.x,p.y-k.y)>k.r));
    for(let i=0;i<1100;i++){const s=hash('tree-'+i),t=hash('grove-'+i),p={x:terrain.minX+(s%100000)/100000*(terrain.maxX-terrain.minX),y:terrain.minY+(t%100000)/100000*(terrain.maxY-terrain.minY)};if(inside(p,outline)&&clearance(p))scenery.push({...p,kind:'tree',size:14+s%19,seed:s});}
    for(const r of roads){if(r.kind==='garden')continue;for(let i=0;i<r.points.length-1;i+=r.points.length>20?5:1){const a=r.points[i],b=r.points[i+1],length=Math.hypot(b.x-a.x,b.y-a.y);if(length<45)continue;const normal={x:-(b.y-a.y)/length,y:(b.x-a.x)/length};for(let t=.2;t<.95;t+=140/length){const p={x:a.x+(b.x-a.x)*t+normal.x*(r.width/2+9),y:a.y+(b.y-a.y)*t+normal.y*(r.width/2+9)};if(nodeList.every(n=>p.x<n.x-5||p.x>n.x+n.w+5||p.y<n.y-5||p.y>n.y+n.d+5))scenery.push({...p,kind:'lamp',size:30});}}}
    return {districts,nodes:nodeList,roads,scenery,terrain};
  }
  // Renders the simulation world: logical metres scaled to scene units; streets arrive as merged continuous ways.
  const BENCH_CELL=64,SCALE=2.4,LAMP_SPACING=42,OLD_TOWN_WIDTH=9,CORE_RADIUS=450,CORE_LIFT=26,palettes={workspace:['#c9b697','#cf997f','#a9bdba','#d6c3a7'],academy:['#a7c5ce','#d5c9af','#88aeb8'],observatory:['#a8a0c5','#b8c7d2','#929fb8'],studio:['#c7928d','#ddb592','#bc8b9e'],garden:['#a9bf9a','#dbc6a1','#92b4a9'],library:['#d5c1a0','#bfa386','#c6bba4']};
  // Rotations are folded into [-45°,45°) with width and depth swapped, so the two front faces stay visible.
  function orient(cx,cy,w,d,angle,S){let k=Math.round(angle/(Math.PI/2)),a=angle-k*Math.PI/2;if(k%2){[w,d]=[d,w];}return {x:cx*S-w*S/2,y:cy*S-d*S/2,w:w*S,d:d*S,rot:a,rcx:cx*S,rcy:cy*S};}
  function fromPolygon(poly,S){const [a,b,,c]=poly,w=Math.hypot(b[0]-a[0],b[1]-a[1]),d=Math.hypot(c[0]-a[0],c[1]-a[1]),cx=poly.reduce((s,p)=>s+p[0],0)/4,cy=poly.reduce((s,p)=>s+p[1],0)/4;return orient(cx,cy,w,d,Math.atan2(b[1]-a[1],b[0]-a[0]),S);}
  // One quarter, one look: walls and roofs derive from the district colour with small, stable shade steps.
  const rgb=hex=>[0,2,4].map(i=>parseInt(hex.slice(1+i,3+i),16)),toHex=c=>'#'+c.map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
  const mix=(a,b,t)=>toHex(rgb(a).map((v,i)=>v+(rgb(b)[i]-v)*t));
  // Each class has its own row-house silhouette and courtyard character, not only a colour.
  const ROWS={workspace:'townhouse',academy:'library-wing',observatory:'laboratory',studio:'timber-house',garden:'cottage',library:'merchant-house',sports:'training-hall'};
  // The era a source was first observed in shifts materials: stone, brick, render, contemporary panels.
  const ERAS=[{title:'Заснування',wall:'#b3a58c',roof:'#4f4038',mix:.38},{title:'Ранній ріст',wall:'#b06a52',roof:'#7d4334',mix:.34},{title:'Розквіт',wall:'#efe6d2',roof:null,mix:0},{title:'Сучасність',wall:'#dde2e1',roof:'#66737a',mix:.4}];
  const COURTS={workspace:'#95ad7a',academy:'#a6c98c',observatory:'#aab6c4',studio:'#d9aab0',garden:'#6f9a5c',library:'#d8ccb2',civic:'#ded0a4',sports:'#75a978'};
  function quarterStyle(d){const colour=d.color||'#c9b697',base=mix(colour,'#efe6d2',.32);return {walls:[0,1,2].map(k=>mix(base,k===1?'#ffffff':'#5b4b3b',k===0?0:.14)),roof:mix(colour,'#2d2622',.38),ground:mix('#ceccb3',colour,.36),groundNight:mix('#6a7260',colour,.34),edge:colour,court:COURTS[d.theme]||COURTS.workspace};}
  // Sub-quarters of one class alternate lighter and darker shades of its palette.
  const SHADES=[0,.26,-.22,.4,-.34];
  function shade(colour,k){const step=SHADES[k%SHADES.length];return step>0?mix(colour,'#ffffff',step):step<0?mix(colour,'#000000',-step):colour;}
  function fromWorld(data,world){
    const S=SCALE,pt=([x,y])=>({x:x*S,y:y*S}),districts=data.districts.map(d=>({...d,blocks:[],roads:[],parks:[]})),byDistrict=new Map(districts.map(d=>[d.id,d])),fallback=byDistrict.get('commons')||districts[0];
    for(const d of districts){d.style=quarterStyle(d);d.quarters=[];}
    // Sub-quarters: a project's own blocks, ordered by size within the class; titles come from the project hub.
    const titles=new Map(data.nodes.map(n=>[n.id.replace(/\.md$/,''),n.title])),blockQuarter=new Map();
    for(const d of districts){const own=world.blocks.filter(b=>(byDistrict.get(b.district)||fallback)===d&&b.neighbourhood),counts=new Map();for(const b of own)counts.set(b.neighbourhood,(counts.get(b.neighbourhood)||0)+1);
      [...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).forEach(([id],k)=>{const members=own.filter(b=>b.neighbourhood===id);const title=titles.get(id)||id.split('/').pop();d.quarters.push({id,title:title.charAt(0).toUpperCase()+title.slice(1),index:k+1,x:members.reduce((s,b)=>s+b.x,0)/members.length*S,y:members.reduce((s,b)=>s+b.y,0)/members.length*S,blocks:members.length});});}
    for(const b of world.blocks){const d=byDistrict.get(b.district)||fallback;if(!d)continue;const q=d.quarters.find(q=>q.id===b.neighbourhood),k=q?q.index:0;blockQuarter.set(b.id,k);
      d.blocks.push({x:b.x*S,y:b.y*S,pad:b.pad.map(pt),court:b.court?b.court.map(pt):null,ring:b.ring,quarter:k,ground:shade(d.style.ground,k),groundNight:shade(d.style.groundNight,k),edge:shade(d.style.edge,k),court_colour:d.style.court,theme:d.theme});}
    const roads=world.ways.map(w=>({points:w.points.map(pt),width:w.width*S,kind:w.kind}));
    const paths=world.paths.map(w=>({points:w.points.map(pt),width:w.width*S,kind:w.kind}));
    const rivers=world.rivers.map(r=>{
      const points=r.points.map(pt),width=r.width*S,left=[],right=[],shoreLeft=[],shoreRight=[],deep=[];
      for(let i=0;i<points.length;i++){
        const p=points[i],a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;
        const fade=Math.sin(Math.PI*i/Math.max(1,points.length-1))**2;
        const lw=width*.5*(1-.13*fade*(.5+.5*Math.sin(i*.17))),rw=width*.5*(1-.17*fade*(.5+.5*Math.sin(i*.13+1.2)));
        left.push({x:p.x+nx*lw,y:p.y+ny*lw});right.push({x:p.x-nx*rw,y:p.y-ny*rw});
        const bank=S*(1.5+fade*(1.5+Math.sin(i*.09)));
        shoreLeft.push({x:p.x+nx*(lw+bank),y:p.y+ny*(lw+bank)});shoreRight.push({x:p.x-nx*(rw+bank*.7),y:p.y-ny*(rw+bank*.7)});
        deep.push({x:p.x+nx*width*.1*fade*Math.sin(i*.05),y:p.y+ny*width*.1*fade*Math.sin(i*.05)});
      }
      return {points,width,order:r.order,id:r.id,waterOutline:left.concat(right.reverse()),shoreOutline:shoreLeft.concat(shoreRight.reverse()),deep};
    });
    const nodes=[];
    for(const source of data.nodes){
      const b=world.buildings[source.stableId];if(!b)continue;
      const d=byDistrict.get(source.district)||fallback,appearance=source.appearance||{seedKey:source.id,kind:source.kind},seed=hash(appearance.seedKey),landmark=['hub','class','org'].includes(appearance.kind);
      // Narrow old-town plots carry gabled row houses; wider plots keep the class architecture.
      const f=b.footprint,narrow=f.fw<=OLD_TOWN_WIDTH;
      const k=blockQuarter.get(b.block)||0;let model=['grand-library','town-hall','council','registry','city-archive','planning-office','infrastructure-office','district-hall','project-council','apartment-tower','manor','sports-institute','research-institute','training-hall'].includes(b.model)?b.model:landmark?architecture({...source,id:appearance.seedKey,kind:appearance.kind},d.theme):narrow?(ROWS[d.theme]||'townhouse'):b.model;const era=ERAS[appearance.era],palette=d.style.walls.map(c=>shade(era?mix(c,era.wall,era.mix):c,k)),roof=era&&era.roof?mix(d.style.roof,era.roof,.45):d.style.roof;
      if(source.cityTopic==='energy'&&source.kind!=='session'&&!['town-hall','council','registry','city-archive','planning-office','infrastructure-office'].includes(model))model=landmark?'grid-control':['solar-lab','battery-vault'][seed%2];
      // Height falls away from the square: the centre is the dense, important core.
      let h=10+b.floors*8+Math.max(0,1-Math.hypot(f.cx,f.cy)/CORE_RADIUS)*CORE_LIFT;if(landmark)h+=20;if(model==='data-tower'||model==='headquarters')h+=20;
      if(model==='apartment-tower')h=92;
      if(model==='town-hall')h=135;
      if(model==='grand-library')h=72;
      if(['solar-lab','grid-control','battery-vault'].includes(model))h=48;
      if(['manor','sports-institute','research-institute'].includes(model))h=38+(source.cityImportance||2)*4;
      nodes.push({...source,...orient(f.cx,f.cy,f.fw,f.fd,f.angle,S),physicalId:b.physicalId||source.stableId||source.id,unit:b.unit,h,color:palette[seed%palette.length],roof,era:appearance.era,accent:d.color,theme:d.theme,model,seed,lifecycle:b.lifecycle,constructionProgress:b.constructionProgress,walk:[pt(b.door),pt(b.gate)]});
    }
    const groups=new Map();for(const n of nodes){if(!groups.has(n.physicalId))groups.set(n.physicalId,[]);groups.get(n.physicalId).push(n);}
    const houses=[];for(const members of groups.values()){const chosen=members.find(n=>n.cityRole==='knowledge-library'&&n.available!==false)||members.find(n=>n.available!==false&&n.lifecycle==='open')||members.find(n=>n.available!==false)||members[0];for(const n of members)n.members=members.map(m=>m.id);houses.push({...chosen,members:chosen.members});}
    for(const d of districts)d.physicalCount=houses.filter(n=>n.district===d.id&&n.available!==false).length;
    for(const d of districts){const points=d.blocks.flatMap(b=>b.pad);if(!points.length)points.push({x:0,y:0});d.minX=Math.min(...points.map(p=>p.x));d.maxX=Math.max(...points.map(p=>p.x));d.minY=Math.min(...points.map(p=>p.y));d.maxY=Math.max(...points.map(p=>p.y));const n=Math.max(1,d.blocks.length);d.label={x:d.blocks.reduce((s,b)=>s+b.x,0)/n,y:d.blocks.reduce((s,b)=>s+b.y,0)/n};const centre=world.centres.find(c=>c.district===d.id);d.wx=centre?centre.x*S:d.label.x;d.wy=centre?centre.y*S:d.label.y;}
    const scenery=[];
    for(const tree of world.trees){const grown=Math.min(1,tree.ageDays/world.maturityDays),s=hash(tree.id);scenery.push({kind:'tree',x:tree.x*S,y:tree.y*S,size:(tree.role==='boulevard-allee'?8:9)+grown*12,seed:tree.species==='conifer'?s-s%3:s-s%3+1});}
    // Garden quarters plant their courtyards densely; this greenery is decorative, not a source.
    for(const d of districts)if(d.theme==='garden')for(const b of d.blocks)if(b.court){const cx=b.court.reduce((s,p)=>s+p.x,0)/b.court.length,cy=b.court.reduce((s,p)=>s+p.y,0)/b.court.length;for(let i=0;i<5;i++){const h=hash(`${cx}:${cy}:${i}`);scenery.push({kind:'tree',x:cx+((h%200)-100)/100*12,y:cy+(((h>>8)%200)-100)/100*12,size:10+h%8,seed:h});}}
    for(const s of world.services){const f=fromPolygon(s.footprint.polygon,S);scenery.push({kind:'service',function:s.function,...f,h:s.function==='stadium'?98:s.function==='campus'?64:s.function==='solar-centre'?88:s.function==='town-hall'?58:s.function==='library'?22:s.function==='research-lab'?26:s.function==='tribology-lab'?22:s.function==='energy-lab'?20:s.function==='sports-lab'?16:s.function==='article-market'?20:14,facility:s.landmark?s:null,walk:s.door?[pt(s.door)]:null});
      if(s.landmark&&s.footprint.fw>=85){const poly=s.footprint.polygon.map(pt),ends=paths.flatMap(p=>[p.points[0],p.points[p.points.length-1]]);let best=null;
        for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],door={x:(a.x+b.x)/2,y:(a.y+b.y)/2};for(const gate of ends){const gap=Math.hypot(gate.x-door.x,gate.y-door.y);if(!best||gap<best.gap)best={door,gate,gap};}}
        if(best&&best.gap>1&&best.gap<=8*S+.5)paths.push({points:[best.gate,best.door],width:4*S,kind:'entrance-path'});
      }
    }
    for(const o of scenery)if(o.facility){const d=byDistrict.get(o.facility.district);if(d){const poly=o.facility.footprint.polygon.map(pt);d.minX=Math.min(d.minX,...poly.map(p=>p.x));d.maxX=Math.max(d.maxX,...poly.map(p=>p.x));d.minY=Math.min(d.minY,...poly.map(p=>p.y));d.maxY=Math.max(d.maxY,...poly.map(p=>p.y));}}
    const placePaths=new Set();
    for(const place of world.places||[]){const [px,py]=place.position;scenery.push({kind:'place',x:px*S,y:py*S,w:12,d:12,h:12,activity:place.activity,district:place.district,facility:place});
      for(const [a,b]of place.paths){const key=JSON.stringify([a,b]);if(!placePaths.has(key)){placePaths.add(key);paths.push({points:[pt(a),pt(b)],width:2*S,kind:'entrance-path'});}}
    }
    // Bench clearance looks only at nearby houses, trees and services through a uniform grid.
    const near=new Map(),key=(x,y)=>`${Math.floor(x/BENCH_CELL)}:${Math.floor(y/BENCH_CELL)}`,reach=o=>o.kind==='tree'?22:Math.hypot(o.w,o.d)/2+16;
    const index=(o,x,y)=>{const r=reach(o);for(let gx=Math.floor((x-r)/BENCH_CELL);gx<=Math.floor((x+r)/BENCH_CELL);gx++)for(let gy=Math.floor((y-r)/BENCH_CELL);gy<=Math.floor((y+r)/BENCH_CELL);gy++){const k=`${gx}:${gy}`;if(!near.has(k))near.set(k,[]);near.get(k).push([o,x,y,r]);}};
    for(const n of houses)index(n,n.rcx,n.rcy);
    for(const o of scenery)if(o.kind==='tree')index(o,o.x,o.y);else if(o.kind==='service')index(o,o.rcx,o.rcy);else if(o.kind==='place')index(o,o.x,o.y);
    for(const d of districts)for(const b of d.blocks)if(b.court){
      const cx=b.court.reduce((s,p)=>s+p.x,0)/b.court.length,cy=b.court.reduce((s,p)=>s+p.y,0)/b.court.length;
      for(const i of [0,2]){const a=b.court[i],next=b.court[(i+1)%b.court.length],x=(a.x+next.x)*.35+cx*.3,y=(a.y+next.y)*.35+cy*.3;
        const clear=(near.get(key(x,y))||[]).every(([,ox,oy,r])=>Math.hypot(x-ox,y-oy)>r);
        if(clear&&inside({x:x-9,y:y-3},b.court)&&inside({x:x+9,y:y+6},b.court))scenery.push({kind:'bench',x:x-9,y:y-3,size:18});
      }
    }
    if(world.plaza)scenery.push({kind:'fountain',x:0,y:0,size:22,seed:1});
    for(const r of roads){if(r.kind==='bridge'||r.kind==='pedestrian')continue;for(let i=0;i<r.points.length-1;i++){const a=r.points[i],b=r.points[i+1],length=Math.hypot(b.x-a.x,b.y-a.y),normal={x:-(b.y-a.y)/length,y:(b.x-a.x)/length};let side=1;for(let t=LAMP_SPACING*S/length/2;t<1;t+=LAMP_SPACING*S/length){side=-side;scenery.push({kind:'lamp',x:a.x+(b.x-a.x)*t+normal.x*side*(r.width/2+5),y:a.y+(b.y-a.y)*t+normal.y*side*(r.width/2+5),size:30});}}}
    const land=world.land||{x:0,y:0,w:0,h:0},m=150*S/2.4,minX=land.x*S-m,minY=land.y*S-m,maxX=(land.x+land.w)*S+m,maxY=(land.y+land.h)*S+m;
    const outline=[{x:minX,y:minY},{x:maxX,y:minY},{x:maxX,y:maxY},{x:minX,y:maxY}];
    return {districts,nodes:houses,sources:nodes,roads,paths,rivers,scenery,plaza:world.plaza?world.plaza.map(pt):null,terrain:{outline,minX,maxX,minY,maxY},residents:world.residents,vehicles:world.vehicles||[],scale:S};
  }
  const api={plan,fromWorld,spiral,inside,distance,ERAS};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CityPlan=api;
})(typeof window!=='undefined'?window:globalThis);
