/* Brain City 3D geometry: turns a CityPlan into flat-shaded triangle buffers. No three.js dependency. */
(function(root){
  'use strict';
  // Plan heights of the 2D atlas, so overlays and agents meet the ground where they did before.
  // A project compound's paving sits above the court layer; its buildings stand on it.
  const COMPOUND_LIFT=.55;
  // At most this many idea flags on the mountain path, so a large collection stays readable.
  const IDEA_FLAGS=24;
  const Z={terrain:12,shore:13,water:13.4,pad:14,court:14.4,sidewalk:15,carriage:15.2,path:15.1,bridge:17,base:14,lot:14.1,walk:14.2};
  const WINDOW={w:4.2,h:6,first:8,floor:13,spacing:11,top:5,offset:.35,maxFloors:14,maxColumns:10};
  const BRIDGE={rail:7,post:12,pier:45,pierWidth:6};
  const FADE={day:'#9aa39a',night:'#47524a',keep:.3};
  const JOINT_SIDES=8,ROUND_SIDES=12,STICK=.8;
  const GABLED=new Set(['cottage','timber-house','townhouse','merchant-house','clock-house','atelier','maker-house','greenhouse']);
  const SIGNATURE_SERVICES=new Set(['stadium','campus','innovation-centre','solar-centre','swimming-pool','football-centre','velodrome','medical-centre','concert-hall']);

  const toLinear=c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;};
  const parsed=new Map();
  function colour(value){
    let rgb=parsed.get(value);if(rgb)return rgb;
    if(value.startsWith('#')){const hex=value.length===4?value.slice(1).split('').map(c=>c+c).join(''):value.slice(1,7),n=parseInt(hex,16);rgb=[n>>16,(n>>8)&255,n&255];}
    else rgb=value.match(/[\d.]+/g).slice(0,3).map(Number);
    rgb=rgb.map(toLinear);parsed.set(value,rgb);return rgb;
  }
  const mix=(a,b,t)=>a.map((v,i)=>v*(1-t)+b[i]*t);
  const scale=(a,f)=>a.map(v=>Math.min(1,v*f));

  // Triangles in three.js axes: plan (x, y, z) becomes (x, z, y). The atlas draws plan y downwards on screen, so this
  // mirror keeps the city as the 2D map shows it; materials are double-sided and normals follow each triangle's winding.
  class Buffer{
    constructor(){this.p=[];this.n=[];this.c=[];}
    tri(a,b,c,rgb){
      const ax=a[0],ay=a[2],az=a[1],bx=b[0],by=b[2],bz=b[1],cx=c[0],cy=c[2],cz=c[1];
      const ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx-ax,vy=cy-ay,vz=cz-az;let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const l=Math.hypot(nx,ny,nz);if(!l)return;nx/=l;ny/=l;nz/=l;
      this.p.push(ax,ay,az,bx,by,bz,cx,cy,cz);for(let i=0;i<3;i++){this.n.push(nx,ny,nz);this.c.push(rgb[0],rgb[1],rgb[2]);}
    }
    quad(a,b,c,d,rgb){this.tri(a,b,c,rgb);this.tri(a,c,d,rgb);}
    // Flat-normal quad with one colour per corner, for smooth ground gradients.
    shaded(a,b,c,d,ca,cb,cc,cd){for(const [p,q,r,cp,cq,cr] of [[a,b,c,ca,cb,cc],[a,c,d,ca,cc,cd]]){const n=this.p.length;this.tri(p,q,r,cp);if(this.p.length===n)continue;this.c.splice(-9,9,...cp,...cq,...cr);}}
    arrays(){return {positions:new Float32Array(this.p),normals:new Float32Array(this.n),colors:new Float32Array(this.c)};}
  }
  // A frame rotates a model about its centre, the same rule the 2D renderer applies to street-aligned buildings.
  const frameOf=o=>o.rot?{cx:o.rcx,cy:o.rcy,cos:Math.cos(o.rot),sin:Math.sin(o.rot)}:null;
  const place=(f,x,y,z)=>{if(!f)return [x,y,z];const dx=x-f.cx,dy=y-f.cy;return [f.cx+dx*f.cos-dy*f.sin,f.cy+dx*f.sin+dy*f.cos,z];};
  function doorSide(o,f){
    // The front faces the building's own path: the wall nearest to the door point in the model frame (0..3: y-, x+, y+, x-).
    const door=o.walk?.[0];if(!door)return 2;let px=door.x,py=door.y;
    if(f){const dx=px-f.cx,dy=py-f.cy;px=f.cx+dx*f.cos+dy*f.sin;py=f.cy-dx*f.sin+dy*f.cos;}
    const gaps=[Math.abs(py-o.y),Math.abs(px-(o.x+o.w)),Math.abs(py-(o.y+o.d)),Math.abs(px-o.x)];return gaps.indexOf(Math.min(...gaps));
  }
  /**
   * Model space of a footprint: u runs along the front, v from the back (0) to the front wall (D), z up from the ground.
   * Quarter turns keep the 2D models' front (their y+d side) on the wall that faces the street.
   */
  function localFrame(o,side){
    const f=frameOf(o),{x,y,w,d}=o,odd=side%2===1;
    const map=side===2?(u,v)=>[x+u,y+v]:side===0?(u,v)=>[x+w-u,y+d-v]:side===1?(u,v)=>[x+v,y+d-u]:(u,v)=>[x+w-v,y+u];
    return {W:odd?d:w,D:odd?w:d,at:(u,v,z)=>{const [px,py]=map(u,v);return place(f,px,py,z);}};
  }

  // Drawing primitives in model space. `col` fades colours for the filter; `top` tracks the highest point for picking.
  function painter(B,G,L,base,fade){
    const at=(u,v,z)=>{if(z>P.top)P.top=z;return L.at(u,v,base+z);};
    const P={W:L.W,D:L.D,top:0,
      col:c=>fade(colour(c)),tint:(c,f)=>scale(fade(colour(c)),f),
      face(points,rgb,glow){const q=points.map(p=>at(p[0],p[1],p[2])),buf=glow?G:B;for(let i=1;i<q.length-1;i++)buf.tri(q[0],q[i],q[i+1],rgb);},
      box(u,v,w,d,h,rgb,top,z=0){const c=[[u,v],[u+w,v],[u+w,v+d],[u,v+d]];
        for(let i=0;i<4;i++){const j=(i+1)%4;P.face([[c[i][0],c[i][1],z],[c[j][0],c[j][1],z],[c[j][0],c[j][1],z+h],[c[i][0],c[i][1],z+h]],rgb);}
        P.face(c.map(([a,b])=>[a,b,z+h]),top||rgb);},
      quad(u,v,w,d,z,rgb,glow){P.face([[u,v,z],[u+w,v,z],[u+w,v+d,z],[u,v+d,z]],rgb,glow);},
      roofX(u,v,w,d,z,rise,rgb,ends){const m=v+d/2;P.face([[u,v,z],[u+w,v,z],[u+w,m,z+rise],[u,m,z+rise]],scale(rgb,1.12));P.face([[u,m,z+rise],[u+w,m,z+rise],[u+w,v+d,z],[u,v+d,z]],rgb);
        P.face([[u,v,z],[u,v+d,z],[u,m,z+rise]],ends);P.face([[u+w,v,z],[u+w,v+d,z],[u+w,m,z+rise]],ends);},
      roofY(u,v,w,d,z,rise,rgb,ends){const m=u+w/2;P.face([[u,v,z],[u,v+d,z],[m,v+d,z+rise],[m,v,z+rise]],scale(rgb,1.12));P.face([[m,v,z+rise],[m,v+d,z+rise],[u+w,v+d,z],[u+w,v,z]],rgb);
        P.face([[u,v,z],[u+w,v,z],[m,v,z+rise]],ends);P.face([[u,v+d,z],[u+w,v+d,z],[m,v+d,z+rise]],ends);},
      gable(u,v,w,d,z,rise,rgb,ends){(d>w?P.roofY:P.roofX)(u,v,w,d,z,rise,rgb,ends||scale(rgb,.7));},
      spire(u,v,w,d,z,rise,rgb){const a=[u+w/2,v+d/2,z+rise],c=[[u,v],[u+w,v],[u+w,v+d],[u,v+d]];for(let i=0;i<4;i++){const j=(i+1)%4;P.face([[c[i][0],c[i][1],z],[c[j][0],c[j][1],z],a],scale(rgb,.85+i*.08));}},
      stick(a,b,rgb,t=STICK){
        // A thin square beam between two model-space points: rails, poles, trims and pitch lines.
        const A=at(a[0],a[1],a[2]),Bp=at(b[0],b[1],b[2]),dx=Bp[0]-A[0],dy=Bp[1]-A[1],dz=Bp[2]-A[2],l=Math.hypot(dx,dy,dz);if(!l)return;
        let px,py,pz;if(Math.abs(dz)/l>.9){px=1;py=0;pz=0;}else{const h=Math.hypot(dx,dy);px=-dy/h;py=dx/h;pz=0;}
        const qx=(dy*pz-dz*py)/l,qy=(dz*px-dx*pz)/l,qz=(dx*py-dy*px)/l,r=t/2,o=[[r,r],[-r,r],[-r,-r],[r,-r]].map(([s,k])=>[px*s+qx*k,py*s+qy*k,pz*s+qz*k]);
        for(let i=0;i<4;i++){const j=(i+1)%4,p0=[A[0]+o[i][0],A[1]+o[i][1],A[2]+o[i][2]],p1=[A[0]+o[j][0],A[1]+o[j][1],A[2]+o[j][2]];B.quad(p0,p1,[p1[0]+dx,p1[1]+dy,p1[2]+dz],[p0[0]+dx,p0[1]+dy,p0[2]+dz],rgb);}},
      pole(u,v,z0,z1,rgb,t){P.stick([u,v,z0],[u,v,z1],rgb,t);},
      line(points,rgb,t){for(let i=1;i<points.length;i++)P.stick(points[i-1],points[i],rgb,t);},
      disc(cu,cv,ru,rv,z,rgb,glow,sides=ROUND_SIDES){const ring=[];for(let i=0;i<sides;i++){const a=i/sides*Math.PI*2;ring.push([cu+Math.cos(a)*ru,cv+Math.sin(a)*rv,z]);}P.face(ring,rgb,glow);},
      frontDisc(cu,z,r,rgb,glow,v=P.D+.5){const ring=[];for(let i=0;i<ROUND_SIDES;i++){const a=i/ROUND_SIDES*Math.PI*2;ring.push([cu+Math.cos(a)*r,v,z+Math.sin(a)*r]);}P.face(ring,rgb,glow);},
      cylinder(cu,cv,r,z,h,rgb,top,sides=ROUND_SIDES){for(let i=0;i<sides;i++){const a=i/sides*Math.PI*2,b=(i+1)/sides*Math.PI*2,p=[cu+Math.cos(a)*r,cv+Math.sin(a)*r],q=[cu+Math.cos(b)*r,cv+Math.sin(b)*r];P.face([[p[0],p[1],z],[q[0],q[1],z],[q[0],q[1],z+h],[p[0],p[1],z+h]],rgb);}P.disc(cu,cv,r,r,z+h,top||rgb,false,sides);},
      dome(cu,cv,r,z,rgb,sides=ROUND_SIDES,rings=4){for(let k=0;k<rings;k++){const a0=k/rings*Math.PI/2,a1=(k+1)/rings*Math.PI/2;for(let i=0;i<sides;i++){const b0=i/sides*Math.PI*2,b1=(i+1)/sides*Math.PI*2,pt=(a,b)=>[cu+Math.cos(b)*Math.cos(a)*r,cv+Math.sin(b)*Math.cos(a)*r,z+Math.sin(a)*r];P.face([pt(a0,b0),pt(a0,b1),pt(a1,b1),pt(a1,b0)],scale(rgb,.9+k*.06));}}},
      windows(u,v,w,d,z,h,o,step=WINDOW.spacing){
        // Every wall gets glass; at night some panes are lit by a stable per-building pattern.
        const floors=Math.min(WINDOW.maxFloors,Math.max(1,Math.floor((h-WINDOW.first-WINDOW.top)/WINDOW.floor)+1));
        const walls=[[[u,v],[u+w,v],[0,-1]],[[u+w,v],[u+w,v+d],[1,0]],[[u+w,v+d],[u,v+d],[0,1]],[[u,v+d],[u,v],[-1,0]]];
        walls.forEach(([[ax,ay],[bx,by],[nx,ny]],side)=>{const len=Math.hypot(bx-ax,by-ay),cols=Math.min(WINDOW.maxColumns,Math.floor(len/step));if(cols<1)return;const ex=(bx-ax)/len,ey=(by-ay)/len,ww=Math.min(WINDOW.w,len/cols*.55);
          for(let k=0;k<floors;k++){const zz=z+WINDOW.first+k*WINDOW.floor;if(zz+WINDOW.h>z+h-2)break;
            for(let i=0;i<cols;i++){const s=len/cols*(i+.5)-ww/2,lit=o.lit&&((o.seed+k*11+i*7+side)%5)>1,c=lit?o.lit:o.glass,off=WINDOW.offset,p0=[ax+ex*s+nx*off,ay+ey*s+ny*off],p1=[p0[0]+ex*ww,p0[1]+ey*ww];
              P.face([[p0[0],p0[1],zz],[p1[0],p1[1],zz],[p1[0],p1[1],zz+WINDOW.h],[p0[0],p0[1],zz+WINDOW.h]],c,lit);}}});
      },
    };
    return P;
  }

  function glassOf(P,day,seed,available=true){return {glass:P.col(day?'#4f7f88':'#405960'),lit:day||!available?null:P.col('#e7c98c'),seed};}

  function signatureBuilding(P,n,day){
    const {W:w,D:d}=P,model=n.model,stone=P.col(day?'#d8c5a4':'#a5a998'),win=glassOf(P,day,n.seed||7,n.available!==false);
    if(model==='grand-library'){
      const wall=P.col(day?'#d4c7ad':'#a4b09d'),roof=P.col(day?'#477b76':'#315d5d'),h=38;
      P.box(0,0,w,d,3,stone);P.box(0,0,w,d*.83,h,wall);P.windows(0,0,w,d*.83,0,h,win,7);P.gable(0,0,w,d*.83,h,15,roof,wall);
      P.box(w*.23,d*.22,w*.54,d*.4,9,P.col('#85a7a8'),undefined,h+5);P.gable(w*.23,d*.22,w*.54,d*.4,h+14,6,P.col('#acc7bf'));
      P.quad(w*.15,d*.75,w*.7,d*.25,2,stone);P.box(w*.2,d*.8,w*.6,d*.2,4,stone);
      for(let i=0;i<4;i++){const u=w*(.22+i*.185);P.cylinder(u+w*.022,d*.9,Math.min(w*.025,d*.035),4,23,stone);P.box(u-w*.012,d*.86,w*.07,d*.08,2,wall,undefined,27);}
      P.box(w*.15,d*.76,w*.7,d*.24,3,stone,undefined,29);P.face([[w*.14,d,32],[w*.86,d,32],[w*.5,d,43]],wall);P.face([[w*.14,d*.76,32],[w*.86,d*.76,32],[w*.5,d*.76,43]],wall);
      P.roofX(w*.14,d*.76,w*.72,d*.24,32,0,roof,wall);P.face([[w*.14,d*.76,32],[w*.5,d*.76,43],[w*.5,d,43],[w*.14,d,32]],roof);P.face([[w*.86,d*.76,32],[w*.5,d*.76,43],[w*.5,d,43],[w*.86,d,32]],scale(roof,1.1));
      P.face([[w*.43,d*.84+.2,4],[w*.57,d*.84+.2,4],[w*.57,d*.84+.2,19],[w*.5,d*.84+.2,23],[w*.43,d*.84+.2,19]],P.col('#456767'));
      for(const u of [.08,.92]){P.box(w*u-w*.025,d*.75,w*.05,d*.08,31,stone);P.spire(w*u-w*.04,d*.73,w*.08,d*.12,31,8,roof);}
      const books=['#9c6852','#c1a262','#658e8e','#8b6e8a'];for(let i=0;i<7;i++)P.box(w,d*(.12+i*.085),.35,d*.055,4,P.col(books[i%4]),undefined,10);
      return true;
    }
    if(model==='idea-mountain'){
      // The Mountain of Ideas: grassy and rocky terraces, a winding path, one flag per idea and a beacon on the summit.
      const cu=w/2,cv=d/2,R=Math.min(w,d)*.5,tiers=7,th=Math.max(3,R*.19),rock=P.col(day?'#8f9a8a':'#56645c'),grass=P.col(day?'#8fae78':'#4d6b4c'),snow=P.col(day?'#f2f0e6':'#c9d2d0');
      for(let k=0;k<tiers;k++)P.cylinder(cu+Math.sin(k*1.7)*R*.05,cv+Math.cos(k*2.3)*R*.05,R*(1-k*.13),k*th,th,k<3?(k%2?rock:grass):rock,k<3?grass:k>=tiers-2?snow:rock);
      P.dome(cu,cv,R*.125,tiers*th,snow);
      const along=t=>{const a=t*Math.PI*4,r=R*(1-t*.85)+.4;return [cu+Math.cos(a)*r,cv+Math.sin(a)*r,t*(tiers-.3)*th+.5];};
      P.line(Array.from({length:41},(_,i)=>along(i/40)),P.col(day?'#e3d3a8':'#9c9478'),.6);
      const flags=['#e2654f','#f2c14e','#5fb3c9','#9b7fd4','#7cc47a'],count=Math.min(Math.max(1,n.ideas??(n.members?.length||1)-1),IDEA_FLAGS);
      for(let i=0;i<count;i++){const [x,y,z]=along((i+1)/(count+1));P.pole(x,y,z,z+7,stone,.25);P.face([[x,y,z+7],[x+3.2,y,z+6],[x,y,z+5]],P.col(flags[i%flags.length]));}
      const top=tiers*th+R*.125;P.pole(cu,cv,top-1,top+10,stone,.5);
      P.face(Array.from({length:ROUND_SIDES},(_,i)=>[cu+Math.cos(i/ROUND_SIDES*Math.PI*2)*2.2,cv+Math.sin(i/ROUND_SIDES*Math.PI*2)*2.2,top+11]),P.col(day?'#f4d27a':'#ffe08a'),!day);
      return true;
    }
    if(model==='town-hall'){
      const wall=P.col(day?'#d6c29d':'#a3aa9a'),roof=P.col(day?'#577d78':'#3d6864'),body=32,tower=Math.max(body+20,n.h-31);
      P.box(0,0,w,d,body,wall);P.roofX(-.7,-.7,w+1.4,d+1.4,body,17,roof,wall);P.windows(0,0,w,d,0,body,win,7);
      for(const u of [.07,.93])for(const v of [.1,.9]){P.box(w*u-1,d*v-1,2,2,body+10,stone);P.spire(w*u-2,d*v-2,4,4,body+10,12,roof);}
      const tx=w*.35,ty=d*.58,tw=w*.3,td=d*.34;
      P.box(tx,ty,tw,td,tower,wall);P.box(tx-1,ty-1,tw+2,td+2,3,stone,undefined,tower-2);P.spire(tx-1,ty-1,tw+2,td+2,tower+1,30,roof);
      for(let z=18;z<tower-19;z+=20){P.line([[tx,ty+td+.3,z],[tx+tw,ty+td+.3,z],[tx+tw+.3,ty,z]],stone,.7);
        for(const u of [.3,.65])P.face([[tx+tw*u,ty+td+.3,z+4],[tx+tw*(u+.12),ty+td+.3,z+4],[tx+tw*(u+.12),ty+td+.3,z+11],[tx+tw*(u+.06),ty+td+.3,z+13],[tx+tw*u,ty+td+.3,z+11]],P.col('#526862'));}
      const r=Math.min(tw*.36,4.2);P.frontDisc(tx+tw/2,tower-12,r,P.col(day?'#f6e9c9':'#eddaa6'),!day,ty+td+.4);P.stick([tx+tw/2,ty+td+.6,tower-12],[tx+tw/2,ty+td+.6,tower-12+r*.65],P.col('#425d5a'),.5);P.stick([tx+tw/2,ty+td+.6,tower-12],[tx+tw/2+r*.55,ty+td+.6,tower-12-r*.15],P.col('#425d5a'),.5);
      for(let u=2;u<w-2;u+=5){P.pole(u,d+.3,3,body-1,stone,.9);P.spire(u-.8,d-.3,1.6,1.6,body,5,stone);}
      P.face([[tx+tw*.25,ty+td+.5,0],[tx+tw*.75,ty+td+.5,0],[tx+tw*.75,ty+td+.5,13],[tx+tw*.5,ty+td+.5,17],[tx+tw*.25,ty+td+.5,13]],P.col('#405955'));
      P.pole(tx+tw/2,ty+td/2,tower+31,tower+42,stone,.6);P.face([[tx+tw/2,ty+td/2,tower+42],[tx+tw/2+7,ty+td/2,tower+40],[tx+tw/2,ty+td/2,tower+37]],P.col('#c99658'));
      return true;
    }
    if(!['solar-lab','grid-control','battery-vault'].includes(model))return false;
    const h=model==='battery-vault'?26:32,panels=(u,v,ww,dd,z)=>{P.box(u,v,ww,dd,.5,P.col(day?'#275d7e':'#1e425b'),undefined,z);for(let i=1;i<5;i++)P.stick([u+ww*i/5,v,z+.6],[u+ww*i/5,v+dd,z+.6],P.col('#a4c7cc'),.25);for(let i=1;i<4;i++)P.stick([u,v+dd*i/4,z+.6],[u+ww,v+dd*i/4,z+.6],P.col('#a4c7cc'),.25);};
    P.quad(-1,-1,w+2,d+2,.15,P.col(day?'#b7bca8':'#617766'));
    if(model==='battery-vault'){for(let i=0;i<3;i++){const u=w*(.04+i*.32);P.box(u,d*.08,w*.25,d*.84,h,P.col('#a0b6ad'),P.col('#d4dcca'));for(let j=0;j<3;j++)P.pole(u+w*.25+.3,d*(.2+j*.24),5,h-3,P.col('#567b79'),.7);}}
    else{P.box(0,0,w,d,h,P.col(model==='solar-lab'?'#c3c7a9':'#a5bdb4'));P.windows(0,0,w,d,0,h,win,8);
      if(model==='solar-lab')for(let i=0;i<3;i++)panels(w*(.05+i*.32),d*.08,w*.26,d*.82,h+1);
      else{P.box(w*.15,d*.15,w*.7,d*.35,9,P.col('#d4dbcc'),undefined,h);panels(w*.2,d*.2,w*.6,d*.25,h+10);for(let i=0;i<3;i++){P.box(w*(.18+i*.25),d*.7,w*.15,d*.15,5,P.col('#768e88'),undefined,h);P.pole(w*(.25+i*.25),d*.77,h+5,h+12,P.col('#cfdbbf'),.6);}}}
    const s=Math.max(2,w*.12),cu=w*.5,v=d+.6;
    P.face([[cu+.1*s,v,18+s],[cu-.5*s,v,18],[cu+.05*s,v,18]],P.col('#e1c05d'),!day);P.face([[cu-.1*s,v,18-s],[cu+.5*s,v,18+.2*s],[cu-.05*s,v,18+.2*s]],P.col('#e1c05d'),!day);
    return true;
  }

  function facade(P,n,h,day){
    // Plinth, cornice, entrance, flower box and the roofline details of the 2D facade.
    const {W:w,D:d}=P,stone=P.col(day?'#e6d9bd':'#a4a797'),trim=P.col(day?'#ecdfc5':'#a5b2a4');
    P.box(-.2,-.2,w+.4,d+.4,3,P.tint(n.color,.67));
    P.line([[-.5,-.5,h-3],[w+.5,-.5,h-3],[w+.5,d+.5,h-3],[-.5,d+.5,h-3],[-.5,-.5,h-3]],trim,1.2);
    if(n.model!=='college')for(const f of [1,Math.max(1,Math.floor((h-12)/13)-1)]){const z=7+f*13;if(z<h-5)P.stick([0,d+.6,z],[w,d+.6,z],P.tint(n.color,1.13),.7);}
    const du=w*.45,dw=Math.max(4,w*.16);
    P.box(du-1,d,dw+2,2,2,stone);P.box(du-2,d+2,dw+4,2,1,stone);P.face([[du,d+.6,1],[du+dw,d+.6,1],[du+dw,d+.6,14],[du,d+.6,14]],P.col(day?'#4d665b':'#253b38'));
    P.line([[du,d+1,1],[du,d+1,14],[du+dw,d+1,14],[du+dw,d+1,1]],trim,.7);
    if(w>22&&n.model!=='college'){P.box(w*.12,d+1,Math.min(8,w*.23),2.4,2.6,P.col('#9b7860'),undefined,5);for(let k=0;k<3;k++)P.box(w*.14+k*2,d+1.6,1.4,1.2,1.4,P.col(k%2?'#c7b078':'#8caa68'),undefined,7.6);}
    P.pole(w-.8,d+.8,2,h-2,P.tint(n.roof||n.color,.72),.8);
    // Era details: stone quoins in the founding era, glass bands in the contemporary one.
    if(n.era===0)for(const u of [-.4,w-1.4])P.box(u,d-.4,1.8,1.2,h-3,stone);
    if(n.era===3)for(let z=14;z<h-6;z+=13)P.box(.5,d,w-1,.8,3.2,P.col(day?'#5f8790':'#e7c98c'),undefined,z);
    if(['manor','town-hall','registry','council','project-council'].includes(n.model))for(const u of [1,w-2])P.box(u,d+.3,1.8,1.5,h-4,stone);
    if(['apartment-tower','laboratory','data-tower','research-institute'].includes(n.model)){P.box(w*.13,d*.15,w*.25,d*.22,4,P.col('#a3aea7'),undefined,h+1);for(let k=0;k<3;k++)P.stick([w*.16,d*(.18+k*.05),h+5.2],[w*.35,d*(.18+k*.05),h+5.2],P.col('#687c79'),.4);}
    if(['town-hall','district-hall','clock-house'].includes(n.model)){const z=h+(n.model==='clock-house'?23:20);P.frontDisc(w*.5,z,4.1,P.col(day?'#f7eed4':'#eddaa6'),!day,d*.7+.6);}
  }

  function building(B,G,n,day,faded,trees){
    const f=frameOf(n),side=doorSide(n,f),L=localFrame(n,side),fade=c=>faded?mix(c,colour(day?FADE.day:FADE.night),1-FADE.keep):c,P=painter(B,G,L,Z.base,fade);
    const {W:w,D:d}=P,color=P.col(n.color),model=n.model;let h=n.h;
    // Construction stages: a staked plot, then scaffolding, before the finished house opens.
    if(n.lifecycle==='reserved'||n.lifecycle==='connected'||n.lifecycle==='construction'){
      P.quad(-4,-4,w+8,d+8,.12,P.col(day?'#c9bf9f':'#4d5546'));P.line([[-4,-4,.3],[w+4,-4,.3],[w+4,d+4,.3],[-4,d+4,.3],[-4,-4,.3]],P.col(day?'#8c8266':'#a39a7c'),.5);
      if(n.lifecycle==='construction'){const target=h,progress=Math.max(.03,Math.min(.98,n.constructionProgress??.45));h=Math.max(2,target*progress);P.box(0,0,w,d,h,P.col('#b9b2a2'));for(const [u,v] of [[0,0],[w,0],[0,d],[w,d]])P.pole(u,v,0,target+10,P.col('#8a7a5c'),.9);
        for(const z of [Math.max(2,h*.5),Math.min(target+8,h+8)])P.line([[0,d+.5,z],[w,d+.5,z],[w+.5,0,z]],P.col('#8a7a5c'),.7);P.pole(w*.8,d*.3,0,target+28,P.col('#c99d55'),1.2);P.stick([w*.8,d*.3,target+28],[w*.8-18,d*.3,target+28],P.col('#c99d55'),1);}
      else for(const [u,v] of [[0,0],[w,0],[0,d],[w,d]])P.pole(u,v,0,6,P.col('#8a7a5c'),.9);
      return P.top;
    }
    // A path to the doorstep and a little private garden.
    P.quad(-7,-7,w+14,d+14,.1,P.col(day?'#bbc6ae':'#34463e'));P.quad(w*.45,d,w*.18,25,.2,P.col(day?'#c3c7b6':'#5a6256'));
    const win=glassOf(P,day,n.seed||7,n.available!==false);
    if(!signatureBuilding(P,n,day)){
      if(model==='college'){P.box(0,0,w,d*.3,h,color);P.box(0,d*.3,w*.24,d*.7,h,color);P.box(w*.76,d*.3,w*.24,d*.7,h,color);P.quad(w*.25,d*.32,w*.5,d*.65,.3,P.col(day?'#9eaf82':'#5a7453'));
        P.windows(0,0,w,d*.3,0,h,win);P.windows(0,d*.3,w*.24,d*.7,0,h,win);P.windows(w*.76,d*.3,w*.24,d*.7,0,h,win);}
      else{P.box(0,0,w,d,h,color);P.windows(0,0,w,d,0,h,win);}
      if(model==='apartment-tower'){
        for(let floor=1;floor<6;floor++){P.box(0,d*.86,w,d*.14+2,3,P.tint(n.color,.78),undefined,floor*h/6);P.stick([0,d+2,floor*h/6+5],[w,d+2,floor*h/6+5],P.tint(n.color,1.3),.6);
          for(let i=0;i<=Math.max(2,Math.floor(w/4));i++){const u=w*i/Math.max(2,Math.floor(w/4));P.pole(u,d+2,floor*h/6+3,floor*h/6+5,P.tint(n.color,1.1),.4);}}
        P.box(w*.15,d*.15,w*.7,d*.7,5,P.tint(n.color,.7),undefined,h);
      }else if(['manor','sports-institute','research-institute','training-hall'].includes(model)){
        P.quad(-2,-2,w+4,d+4,h+.3,model==='sports-institute'||model==='training-hall'?P.col('#679b75'):P.tint(n.color,.75));
        for(let i=1;i<4;i++)P.box(w*i/4-2,d,4,4,h*.85,P.tint(n.color,1.25));
        if(model==='manor')P.roofX(-3,-3,w+6,d+6,h,20,P.col(n.roof||'#917d69'),color);
        if(model==='research-institute'){P.box(w*.2,d*.2,w*.6,d*.5,12,P.col('#b5d0d7'),P.col('#73aebc'),h);}
        if(model==='sports-institute'||model==='training-hall'){P.quad(w*.15,d*.15,w*.7,d*.7,h+.6,P.col('#e9ead0'));P.quad(w*.19,d*.19,w*.62,d*.62,h+.9,P.col('#679b75'));}
      }else if(['town-hall','district-hall'].includes(model)){
        P.box(w*.37,d*.25,w*.26,d*.45,30,P.tint(n.color,1.12),undefined,h);P.spire(w*.35,d*.23,w*.3,d*.49,h+30,10,P.col(n.roof||'#577d78'));
        P.pole(w*.5,d*.47,h+38,h+55,P.col('#d0c3a5'),.6);P.face([[w*.5,d*.47,h+55],[w*.5+16,d*.47,h+49],[w*.5,d*.47,h+43]],P.col(n.accent||'#c99658'));
      }else if(['council','project-council','registry'].includes(model)){
        for(let i=1;i<5;i++)P.cylinder(w*i/5,d+2,1.8,0,h*.9,P.tint(n.color,1.22));
        P.box(-3,d,w+6,4,2,P.tint(n.color,1.15),undefined,h*.9);P.face([[-3,d+4,h],[w+3,d+4,h],[w/2,d+4,h+18]],P.tint(n.color,1.15));P.face([[-3,d,h],[w+3,d,h],[w/2,d,h+18]],P.tint(n.color,1.05));
        P.roofX(-3,-3,w+6,d+7,h,18,P.tint(n.color,.8),P.tint(n.color,1.1));
      }else if(GABLED.has(model)){
        const roof=P.col(n.roof&&model!=='greenhouse'?n.roof:model==='greenhouse'?'#8cbdb4':n.theme==='studio'?'#a36962':n.theme==='library'?'#977a68':n.theme==='garden'?'#748e78':'#798c8b');
        P.roofX(-3,-3,w+6,d+6,h,20,roof,color);
        if(model==='greenhouse')for(let i=1;i<6;i++)P.line([[w*i/6,-2,h],[w*i/6,d/2,h+20],[w*i/6,d+2,h]],P.tint(n.color,1.4),.6);
        else{P.box(w*.7,d*.2,6,8,18,P.col('#8c7e70'),P.col('#b1a28d'),h);
          if(w>22){const u=w*.28,v=d*.76,z=h+6;P.box(u,v,5,4,6,P.col(day?'#e6d9bd':'#a4a797'),undefined,z);P.roofY(u-.5,v-.5,6,5,z+6,3,P.tint(n.roof||'#917d69',.85),P.col('#e6d9bd'));P.face([[u+1,v+4.2,z+1],[u+4,v+4.2,z+1],[u+4,v+4.2,z+4],[u+1,v+4.2,z+4]],P.col(day?'#60818a':'#e6c68d'),!day);}}
        if(model==='timber-house'){for(let i=1;i<4;i++)P.pole(w*i/4,d+.5,0,h,P.tint(n.color,.47),1);P.stick([0,d+.6,h*.48],[w,d+.6,h*.48],P.tint(n.color,.47),1);}
        if(model==='clock-house'){P.box(w*.37,d*.3,w*.27,d*.4,24,P.tint(n.color,1.12),undefined,h+5);P.spire(w*.35,d*.28,w*.31,d*.44,h+29,10,roof);}
        if(model==='maker-house')P.box(w*.12,d*.62,w*.6,d*.25,.6,P.col('#5b8291'),undefined,h+12);
      }else if(model==='observatory'){
        P.box(w*.18,d*.18,w*.64,d*.64,8,P.tint(n.color,.85),undefined,h);P.dome(w*.5,d*.5,w*.31,h+8,P.tint(n.color,1.22));
        P.stick([w*.5,d*.5,h+12],[w*.62,d*.4,h+39],P.tint(n.color,1.3),1.6);P.box(w*.62-1,d*.4-1,2,2,2,P.col(day?n.color:'#f1dbaa'),undefined,h+38);
      }else if(['laboratory','library-wing','archive','city-archive'].includes(model)){
        P.box(-4,-4,w+8,d+8,5,P.tint(n.color,.9),undefined,h);P.quad(7,7,w-14,d-14,h+5.2,P.tint(n.color,.7));
        if(model!=='laboratory')for(let i=1;i<5;i++)P.cylinder(w*i/5,d+2.5,2,0,h*.8,P.tint(n.color,1.22));
        if(model==='laboratory'){P.box(w*.2,d*.2,w*.6,d*.4,8,P.col('#b7c7c3'),P.col('#80a9b3'),h+5);}
      }else if(model==='college'){for(const s of [0,.78])for(let i=0;i<2;i++)P.box(w*s,d*.45+i*10,w*.22,3,5,P.tint(n.color,.85),undefined,h);P.roofX(-1,-1,w+2,d*.3+2,h,10,P.col(n.roof||'#7d6a5a'),color);}
      else if(model==='theatre'){
        P.box(w*.15,d*.15,w*.7,d*.7,11,P.tint(n.color,1.13),undefined,h);P.dome(w*.5,d*.5,6,h+11,P.tint(n.color,1.4));
        P.box(-5,d*.75,w+10,d*.32,5,P.col('#b78180'),undefined,h*.4);P.pole(w*.7,d*.5,h+8,h+40,P.col('#d0c3a5'),.6);P.face([[w*.7,d*.5,h+40],[w*.7+18,d*.5,h+34],[w*.7,d*.5,h+28]],P.col('#d299a5'));
      }else if(model==='workshop'){
        for(let i=0;i<3;i++){const v=i*d/3;P.face([[0,v,h],[w,v,h],[w,v+d/6,h+12],[0,v+d/6,h+12]],P.col('#8a9992'));P.face([[0,v+d/6,h+12],[w,v+d/6,h+12],[w,v+d/3,h],[0,v+d/3,h]],P.col('#9fc1c3'),!day);
          P.face([[0,v,h],[0,v+d/6,h+12],[0,v+d/3,h]],color);P.face([[w,v,h],[w,v+d/6,h+12],[w,v+d/3,h]],color);}
        P.box(w*.8,d*.25,7,8,28,P.col('#a08b79'),undefined,h);
      }else if(model==='headquarters'||model==='data-tower'){
        P.box(w*.1,d*.1,w*.8,d*.8,18,P.tint(n.color,1.06),undefined,h);P.box(w*.24,d*.24,w*.52,d*.52,12,P.col('#92a9ae'),undefined,h+18);P.pole(w*.5,d*.5,h+30,h+58,P.col('#c0c9c3'),.7);
      }else{P.box(w*.15,d*.1,w*.7,d*.45,7,P.tint(n.color,.82),P.col(day?'#779ca1':'#668a94'),h);}
      if(['atelier','townhouse','merchant-house','terrace'].includes(model)){P.face([[-2,d,17],[w+2,d,17],[w+2,d+12,13],[-2,d+12,13]],P.col(n.accent||'#c9a77c'));for(let i=0;i<4;i++)P.face([[i*w/4,d+.05,17.05],[i*w/4+w/8,d+.05,17.05],[i*w/4+w/8,d+12,13.05],[i*w/4,d+12,13.05]],P.col('#eee2c1'));}
      if(model==='office'||model==='headquarters')for(let i=1;i<4;i++)P.pole(w*i/4,d+.7,18,h-7,P.col('#88a3aa'),1.2);
      facade(P,n,h,day);
    }
    return P.top;
  }

  function compound(B,G,o,day){
    // Shared site of a project building and its wings: one paved forecourt with a kerb, above the surrounding ground.
    const P=painter(B,G,localFrame(o,doorSide(o,frameOf(o))),Z.base,c=>c),{W:w,D:d}=P;
    P.quad(0,0,w,d,COMPOUND_LIFT-.05,P.col(day?'#d8d2c0':'#717a6e'));P.line([[0,0,COMPOUND_LIFT+.2],[w,0,COMPOUND_LIFT+.2],[w,d,COMPOUND_LIFT+.2],[0,d,COMPOUND_LIFT+.2],[0,0,COMPOUND_LIFT+.2]],P.col(day?'#b9b19b':'#59614f'),.6);
  }

  function gallery(B,G,o,day){
    // A covered gallery along the shared facade line, with one project sign at its middle.
    const P=painter(B,G,localFrame(o,doorSide(o,frameOf(o))),Z.base+COMPOUND_LIFT,c=>c),{W:w,D:d}=P,post=P.col(day?'#8b8f88':'#9aa49a');
    P.box(0,0,w,d,.7,P.col(day?'#c9c3b4':'#7b8379'),undefined,9);
    for(let u=0;u<=w+.01;u+=w/Math.max(2,Math.round(w/14)))for(const v of [.4,d-.4])P.pole(Math.min(u,w-.4),v,0,9,post,.45);
    P.box(w/2-2.5,d+1,5,1.2,13,P.col(o.accent||'#c9a77c'));P.face([[w/2-2,d+2.25,8],[w/2+2,d+2.25,8],[w/2+2,d+2.25,11.5],[w/2-2,d+2.25,11.5]],P.col(day?'#f3ead2':'#f7dfa4'),!day);
  }

  function service(B,G,o,day,faded,trees){
    const L=localFrame(o,doorSide(o,frameOf(o))),fade=c=>faded?mix(c,colour(day?FADE.day:FADE.night),1-FADE.keep):c,P=painter(B,G,L,Z.base+(o.compound?COMPOUND_LIFT:0),fade),{W:w,D:d}=P,fn=o.function;
    const stone=P.col(day?'#d5ccba':'#9ba89a'),win={glass:P.col(day?'#527e91':'#405960'),lit:day?null:P.col('#cbbd89'),seed:o.x|0};
    if(fn==='swimming-pool'){
      P.quad(0,0,w,d,.1,P.col(day?'#e2d9be':'#829b97'));P.box(w*.06,d*.07,w*.88,d*.15,12,stone);P.windows(w*.06,d*.07,w*.88,d*.15,0,12,win,8);
      P.box(w*.11,d*.3,w*.64,d*.58,1.8,P.col('#cadbd4'));P.quad(w*.13,d*.32,w*.6,d*.54,2,P.col(day?'#52bfd4':'#31859d'));
      for(let i=1;i<7;i++)P.stick([w*.13,d*(.32+i*.54/7),2.2],[w*.73,d*(.32+i*.54/7),2.2],P.col(i%2?'#f8e3a4':'#426c9c'),.5);
      for(let i=0;i<7;i++)P.box(w*.75,d*(.34+i*.075),w*.045,d*.04,3.5,P.col('#f4eee1'));for(let i=0;i<3;i++)P.box(w*.84,d*(.35+i*.16),w*.09,d*.11,2+i*.8,stone);
    }else if(fn==='football-centre'||fn==='velodrome'){
      P.quad(0,0,w,d,.1,P.col(day?'#adc39a':'#4b7254'));
      if(fn==='football-centre'){for(let i=0;i<10;i++)P.quad(w*(.08+i*.084),d*.12,w*.084,d*.76,.5,P.col(i%2?'#64995e':'#70a46b'));const white=P.col(day?'#f5efda':'#c9d7be');
        P.line([[w*.08,d*.12,.7],[w*.92,d*.12,.7],[w*.92,d*.88,.7],[w*.08,d*.88,.7],[w*.08,d*.12,.7]],white,.5);P.stick([w*.5,d*.12,.7],[w*.5,d*.88,.7],white,.5);
        for(const end of [.08,.92])P.line([[w*end,d*.44,0],[w*end,d*.44,6],[w*end,d*.56,6],[w*end,d*.56,0]],white,.5);}
      else{P.disc(w/2,d/2,w*.47,d*.45,2,P.col(day?'#b8926c':'#9a886e'),false,48);P.disc(w/2,d/2,w*.34,d*.29,2.2,P.col(day?'#82a477':'#4a765e'),false,48);
        const ring=Array.from({length:49},(_,i)=>[w/2+Math.cos(i*Math.PI/24)*w*.4,d/2+Math.sin(i*Math.PI/24)*d*.37,2.5]);P.line(ring,P.col('#efe1be'),.5);}
      P.box(w*.12,d*.02,w*.76,d*.07,9,stone);
    }else if(fn==='medical-centre'){
      P.quad(0,0,w,d,.1,P.col(day?'#b2c6ae':'#5e7c72'));for(const [u,v,ww,dd] of [[.08,.12,.28,.76],[.64,.12,.28,.76],[.36,.4,.28,.2]]){P.box(w*u,d*v,w*ww,d*dd,30,stone);P.windows(w*u,d*v,w*ww,d*dd,0,30,win,7);}
      P.quad(w*.19,d*.32,w*.06,d*.3,30.2,P.col('#bd6866'));P.quad(w*.13,d*.42,w*.18,d*.09,30.2,P.col('#bd6866'));
    }else if(fn==='concert-hall'){
      P.quad(0,0,w,d,.1,stone);const wall=P.col(day?'#c29e82':'#9b8e87');P.box(w*.12,d*.2,w*.76,d*.62,27,wall);P.gable(w*.12,d*.2,w*.76,d*.62,27,18,P.col(day?'#637e8a':'#526777'),wall);
      P.box(w*.18,d*.84,w*.64,d*.1,15,win.glass);for(let i=0;i<6;i++)P.cylinder(w*(.19+i*.115),d*.96,Math.min(w*.012,1.5),0,15,stone);
      for(let i=0;i<3;i++)P.box(w*(.14-i*.025),d*(.95+i*.015),w*(.72+i*.05),d*.018,3-i*.8,stone);
    }else if(fn==='stadium'){
      // Rounded stands stepping down to the pitch, roofs over the long sides and four floodlights.
      const swap=w<d,Lng=Math.max(w,d),unit=Lng/165,H=Math.min(w,d)/unit,pt=(u,v,z=0)=>swap?[v*unit,u*unit,z*unit]:[u*unit,v*unit,z*unit];
      const ring=(inset,z)=>{const r=Math.max(4,20-inset*.25),points=[];for(const [cx,cy,start] of [[165-inset-r,H-inset-r,0],[inset+r,H-inset-r,Math.PI/2],[inset+r,inset+r,Math.PI],[165-inset-r,inset+r,Math.PI*1.5]])for(let i=0;i<=6;i++){const a=start+i*Math.PI/12;points.push(pt(cx+r*Math.cos(a),cy+r*Math.sin(a),z));}return points;};
      const sheet=(u,v,ww,dd,z,rgb,glow)=>P.face([pt(u,v,z),pt(u+ww,v,z),pt(u+ww,v+dd,z),pt(u,v+dd,z)],rgb,glow);
      sheet(0,0,165,H,.1,P.col(day?'#c5c3b2':'#6c7d72'));const outer=ring(2,19),bottom=ring(2,0);
      for(let i=0;i<outer.length;i++){const j=(i+1)%outer.length;P.face([bottom[i],bottom[j],outer[j],outer[i]],scale(stone,.72+(i%4)*.055));}
      for(let tier=0;tier<7;tier++){const a=ring(3+tier*1.8,19-tier*2),b=ring(4.8+tier*1.8,17-tier*2),seat=P.col(tier%2?(day?'#8d9da8':'#607482'):(day?'#c4b29e':'#8b9283'));for(let i=0;i<a.length;i++){const j=(i+1)%a.length;P.face([a[i],a[j],b[j],b[i]],seat);}}
      const inner=ring(4.8+6*1.8,5);P.face(inner,P.col('#51865d'));
      const px=30,py=(H-68)/2;for(let i=0;i<10;i++)sheet(px+i*10.5,py,10.5,68,5.3,P.col(i%2?'#538958':'#669c64'));
      const white=P.col(day?'#f3efdb':'#d4ddc7'),path=(pts,t=.35)=>P.line(pts.map(([u,v,z])=>pt(u,v,z)),white,t*unit*2);
      path([[px,py,5.5],[px+105,py,5.5],[px+105,py+68,5.5],[px,py+68,5.5],[px,py,5.5]]);path([[82.5,py,5.5],[82.5,py+68,5.5]]);
      path(Array.from({length:33},(_,i)=>[82.5+Math.cos(i/32*Math.PI*2)*9.15,H/2+Math.sin(i/32*Math.PI*2)*9.15,5.5]));
      for(const end of [0,1]){const gx=px+105*end,sgn=end?-1:1;path([[gx,py+13.84,5.5],[gx+sgn*16.5,py+13.84,5.5],[gx+sgn*16.5,py+54.16,5.5],[gx,py+54.16,5.5]]);path([[gx,H/2-3.66,5.5],[gx,H/2-3.66,8],[gx,H/2+3.66,8],[gx,H/2+3.66,5.5]],.5);}
      for(const s of [0,H-10]){sheet(24,s,117,9,22,P.col(day?'#e1e3d9':'#a3b6ae'));for(let u=28;u<140;u+=16)P.line([pt(u,s+4,22),pt(u,s+4,28),pt(u+7,s+4,22)],P.col('#8c9d98'),unit);}
      for(const u of [15,150])for(const v of [15,H-15]){P.stick(pt(u,v,3),pt(u,v,39),P.col('#8b9d96'),unit*1.4);sheet(u-4,v-2,8,4,39,P.col(day?'#e9e4cc':'#ffe7af'),!day);}
      sheet(74,H-5,17,4,8,P.col('#697d81'));
    }else if(fn==='innovation-centre'){
      const wall=P.col(day?'#c1b4d4':'#898ba7'),roof=P.col(day?'#586f85':'#394d6a'),glass=P.col(day?'#7ba9b6':'#415f86');
      P.quad(0,0,w,d,.1,P.col(day?'#b4bcaa':'#53695f'));
      for(const [u,v,ww,dd,h] of [[.06,.08,.28,.68,30],[.36,.08,.58,.22,24],[.66,.38,.28,.38,20]]){
        P.box(w*u,d*v,w*ww,d*dd,h,wall,roof);P.windows(w*u,d*v,w*ww,d*dd,0,h,win,8);
      }
      P.box(w*.35,d*.12,w*.03,d*.12,15,glass,roof,7);
      P.quad(w*.36,d*.37,w*.25,d*.43,.3,P.col(day?'#91a78a':'#405f50'));
      P.quad(w*.43,d*.8,w*.14,d*.2,.5,stone);
      P.cylinder(w*.48,d*.57,5,0,2,stone);P.pole(w*.48,d*.57,2,13,P.col('#8b9ca6'),1.2);
      for(let k=0;k<3;k++){const a=k*Math.PI*2/3;P.stick([w*.48,d*.57,14],[w*.48+Math.cos(a)*7,d*.57+Math.sin(a)*7,20],glass,1.5);}
      for(let k=0;k<4;k++)P.box(w*(.4+k*.12),d*.12,w*.08,d*.12,1,P.col('#365e7d'),undefined,25);
    }else if(fn==='campus'){
      const sx=w/115,sy=d/95,roof=P.col(day?'#64797b':'#405e63'),wall=P.col(day?'#ccb899':'#9ba99b');
      P.quad(0,0,w,d,.1,P.col(day?'#b2c095':'#566f52'));P.quad(w*.24,d*.3,w*.5,d*.45,.3,P.col(day?'#83a56f':'#416347'));
      const wing=(u,v,ww,dd,h,c)=>{const uu=u*sx,vv=v*sy;P.box(uu,vv,ww*sx,dd*sy,h,c||wall);P.gable(uu,vv,ww*sx,dd*sy,h,8,roof,c||wall);P.windows(uu,vv,ww*sx,dd*sy,0,h,win,9);};
      wing(5,5,105,17,34);wing(5,22,18,65,29);wing(88,22,22,46,38);wing(71,73,39,17,27,P.col('#b6c8bf'));
      P.quad(w*.23,d*.47,w*.54,d*.035,.5,P.col(day?'#dfd7bd':'#9da58b'));P.quad(w*.445,d*.23,w*.03,d*.7,.5,P.col(day?'#dfd7bd':'#9da58b'));
      wing(32,76,16,14,22);wing(57,76,16,14,22);P.box(w*.42,d*.76,w*.16,d*.08,5,stone,undefined,19);
      for(let i=0;i<7;i++){const u=(29+i*8)*sx;P.box(u,22*sy,1.4*sx,2*sy,11,stone);P.stick([u,24*sy,12],[u+6*sx,24*sy,12],stone,1);}
      P.box(95*sx,30*sy,10*sx,14*sy,12,P.col('#a8c6c8'),P.col('#628f9f'),38);
      for(const [u,v] of [[31,34],[74,34],[31,64],[74,64]]){const p=L.at(u*sx,v*sy,0);trees.push({x:p[0],y:p[1],size:13,conifer:false});}
      P.box(w*.47,d*.49,4*sx,4*sy,4,stone);P.spire(w*.48,d*.5,2*sx,2*sy,4,9,P.col('#818f86'));
    }else if(fn==='solar-centre'){
      P.quad(0,0,w,d,.1,P.col(day?'#aaba95':'#526e55'));
      for(let row=0;row<4;row++)for(let c=0;c<3;c++){const u=w*(.04+c*.18),v=d*(.06+row*.22);P.box(u,v,w*.15,d*.16,1.5,P.col('#7e948b'));P.face([[u,v,2],[u+w*.15,v,2],[u+w*.15,v+d*.16,4],[u,v+d*.16,4]],P.col(day?'#275d7e':'#1e425b'));}
      for(let i=0;i<3;i++){P.box(w*.63,d*(.08+i*.23),w*.13,d*.16,15,P.col('#b8cab9'),P.col('#dce0ce'));for(let k=0;k<3;k++)P.pole(w*.76+.3,d*(.1+i*.23+k*.04),4,12,P.col('#6a8d84'),.6);}
      P.box(w*.81,d*.1,w*.15,d*.38,22,P.col('#b8c8be'));P.windows(w*.81,d*.1,w*.15,d*.38,0,22,win,6);
      for(let i=0;i<3;i++){const v=d*(.63+i*.12);P.box(w*.81,v,w*.14,d*.07,8,P.col('#839d96'));P.line([[w*.83,v,8],[w*.83,v,17],[w*.92,v,17],[w*.92,v,8]],P.col('#ccd4ba'),.7);}
      const tu=w*.57,tv=d*.86;P.cylinder(tu,tv,2,0,63,P.col('#b2c7bc'));P.box(tu-2,tv-3,4,5,4,P.col('#dce4d8'),undefined,63);
      for(let i=0;i<3;i++){const a=-Math.PI/2+i*Math.PI*2/3;P.face([[tu,tv+2.2,65],[tu+Math.cos(a)*20,tv+2.2,65+Math.sin(a)*20],[tu+Math.cos(a+.14)*16,tv+2.2,65+Math.sin(a+.14)*16]],P.col('#e1e7db'));}
    }else if(fn==='idea-mountain'){
      // The mountain railway station: a snowy range at the back, the line out to the mountains (the train runs on it,
      // see the landscape), the station house with its sign and bunting with one pennant per idea.
      const rock=P.col(day?'#8f9a8a':'#56645c'),snow=P.col(day?'#f2f0e6':'#c9d2d0'),wall=P.col(day?'#e6d6b4':'#a7aa98'),roof=P.col(day?'#a4553f':'#7a4a3e'),iron=P.col('#55585a'),wood=P.col(day?'#7a5f45':'#55473a');
      P.quad(0,0,w,d,.1,P.col(day?'#a9bf8c':'#4f6c4c'));
      for(const [u,pw,pd,h] of [[.0,.26,.16,20],[.17,.3,.2,30],[.4,.26,.15,19],[.58,.42,.26,36]]){const cap=.36,k=(1-cap)/2;P.spire(w*u,0,w*pw,d*pd,0,h,rock);P.spire(w*(u+pw*k),d*pd*k,w*pw*cap,d*pd*cap,h*(1-cap),h*cap,snow);}
      const rv=d*RAILWAY.line;for(let u=1;u<w;u+=3)P.box(u,rv-d*.05,1.2,d*.1,.4,wood);
      for(const side of [-1,1])P.stick([0,rv+side*d*.03,.9],[w,rv+side*d*.03,.9],iron,.5);
      P.box(w*.04,d*.38,w*.6,d*.1,1.6,stone);for(const u of [.08,.24,.4,.56])P.pole(w*u,d*.43,1.6,10,iron,.6);P.quad(w*.04,d*.37,w*.6,d*.12,10,roof);
      const pennants=['#e2654f','#f2c14e','#5fb3c9','#9b7fd4','#7cc47a'],count=Math.min(Math.max(1,o.ideas||1),IDEA_FLAGS);
      for(let i=0;i<count;i++){const u=w*(.05+.58*(i+.5)/count),z=9.6;P.face([[u-.9,d*.49,z],[u+.9,d*.49,z],[u,d*.49,z-2.2]],P.col(pennants[i%pennants.length]));}
      const hu=w*.22,hv=d*.52,hw=w*.36,hd=d*.22,hh=14;P.box(hu,hv,hw,hd,hh,wall);P.windows(hu,hv,hw,hd,0,hh,win,6);P.gable(hu-.6,hv-.6,hw+1.2,hd+1.2,hh,8,roof,wall);
      P.box(hu+hw*.8,hv+hd*.3,hw*.14,hd*.4,hh+10,wall);P.spire(hu+hw*.79,hv+hd*.28,hw*.16,hd*.44,hh+10,6,roof);P.frontDisc(hu+hw*.87,hh+6,1.8,P.col(day?'#f6e9c9':'#eddaa6'),!day,hv+hd*.7+.2);
      P.box(hu+hw*.25,hv+hd,hw*.3,.6,3,P.col('#2f5d50'),undefined,hh-5);P.face([[hu+hw*.3,hv+hd+.7,hh-4.4],[hu+hw*.4,hv+hd+.7,hh-2.6],[hu+hw*.5,hv+hd+.7,hh-4.4]],snow,!day);
      P.quad(w*.06,d*.78,w*.88,d*.2,.25,stone);for(const u of [.12,.88]){P.pole(w*u,d*.9,.3,12,iron,.6);P.box(w*u-1.2,d*.9-1.2,2.4,2.4,2,P.col(day?'#e8dcb0':'#ffe6aa'),undefined,12);}
    }else if(fn==='knowledge-library'){
      signatureBuilding(P,{model:'grand-library',seed:o.x|0},day);
    }else if(fn==='article-market'){
      // The article market: a columned hall with a terracotta roof, a glazed lantern and clock cupola, a pedimented
      // entrance with a lit sign, two rows of stalls under striped awnings, bunting across the front and planted corners.
      const roof=P.col(day?'#b9744e':'#8a5a44'),stone=P.col(day?'#ece2c9':'#a8ab9b'),post=P.col(day?'#f2ead6':'#b4b6a6'),wood=P.col(day?'#9b7860':'#6a5848');
      const papers=['#f3ecd8','#d9c48f','#8fb3c4','#c98f74','#a7c08a','#d6a2b1'],stripes=[['#d2af68','#f3e6c3'],['#b8654b','#f3e6c3'],['#3f6979','#e9e4cc']];
      const H=20,rise=Math.min(16,d*.36),cols=Math.max(4,Math.round(w/12)),rows=Math.max(3,Math.round(d/12));
      P.box(-4,-4,w+8,d+8,1.2,stone);for(let k=0;k<3;k++)P.box(w*.36-k*2,d+4+k*2.2,w*.28+k*4,2.2,1.2-k*.35,stone);
      P.quad(-1,-1,w+2,d+2,1.3,P.col(day?'#d9c7a0':'#8f8a72'));
      for(let i=0;i<=cols;i++)for(const v of [0,d]){const u=i*w/cols;P.cylinder(u,v,1.3,1.3,H-1.3,post);P.box(u-1.8,v-1.8,3.6,3.6,1.2,stone,undefined,H-1);}
      for(let j=1;j<rows;j++)for(const u of [0,w]){const v=j*d/rows;P.cylinder(u,v,1.3,1.3,H-1.3,post);P.box(u-1.8,v-1.8,3.6,3.6,1.2,stone,undefined,H-1);}
      P.box(-2.5,-2.5,w+5,d+5,1.6,stone,undefined,H);
      // Striped valance all round under the eaves: the market reads as a market from every side and from afar.
      const edges=[[[0,d],[w,d],[0,1]],[[w,d],[w,0],[1,0]],[[w,0],[0,0],[0,-1]],[[0,0],[0,d],[-1,0]]];
      for(const [[ax,ay],[bx,by],[nx,ny]] of edges){const len=Math.hypot(bx-ax,by-ay),n=Math.max(4,Math.round(len/4));
        for(let i=0;i<n;i++){const t0=i/n,t1=(i+1)/n,p0=[ax+(bx-ax)*t0,ay+(by-ay)*t0],p1=[ax+(bx-ax)*t1,ay+(by-ay)*t1],o=2.6,c=P.col(i%2?'#f3e6c3':(['#b8654b','#d2af68','#3f6979','#b8654b'][Math.floor(i/2)%4]));
          P.face([[p0[0]+nx*.4,p0[1]+ny*.4,H-.2],[p1[0]+nx*.4,p1[1]+ny*.4,H-.2],[p1[0]+nx*o,p1[1]+ny*o,H-4],[p0[0]+nx*o,p0[1]+ny*o,H-4]],c);}}
      P.roofX(-3.5,-3.5,w+7,d+7,H+1.6,rise,roof,post);
      const top=H+1.6+rise;P.box(w*.28,d/2-3,w*.44,6,5,P.col(day?'#7fa3ad':'#f1d79a'),undefined,top-2.5);P.roofX(w*.27,d/2-4,w*.46,8,top+2.5,3,roof,post);
      const cu=w/2,cv=d/2,cw=Math.min(12,w*.15);P.box(cu-cw/2,cv-cw/2,cw,cw,8,post,undefined,top+3);P.frontDisc(cu,top+7,cw*.32,P.col(day?'#f7eed4':'#eddaa6'),!day,cv+cw/2+.3);
      P.dome(cu,cv,cw*.62,top+11,P.col(day?'#5f8a7f':'#3d6864'));P.pole(cu,cv,top+11+cw*.6,top+24,stone,.6);P.face([[cu,cv,top+24],[cu+9,cv,top+22],[cu,cv,top+20]],P.col('#e1c05d'));
      P.roofY(w*.37,d-2,w*.26,9,H+1.6,rise*.8,roof,post);P.frontDisc(w/2,H+1.6+rise*.38,Math.min(3.2,w*.04),P.col(day?'#f7eed4':'#eddaa6'),!day,d+7.1);
      P.box(w*.33,d+1.2,w*.34,1,4.2,P.col(day?'#e1c05d':'#f1d79a'),undefined,H-6);
      for(let k=0;k<6;k++)P.box(w*.36+k*w*.05,d+2.25,w*.03,.2,2.2,P.col('#5b4a3b'),undefined,H-5);
      for(let r=0;r<2;r++)for(let k=0;k<3;k++){const u=w*(.08+k*.31),cw2=w*.24,v=r?d*.58:d*.16,sd=d*.2,stripe=stripes[(k+r)%3];
        P.box(u,v,cw2,sd,4.5,wood,undefined,1.3);
        for(let i=0;i<5;i++)P.box(u+.8+i*cw2/5,v+sd*.15,cw2/6,sd*.6,1+(i%3)*.6,P.col(papers[(i+k+r)%papers.length]),undefined,5.8);
        P.pole(u+1,v+sd,5.8,10.5,wood,.5);P.pole(u+cw2-1,v+sd,5.8,10.5,wood,.5);
        for(let i=0;i<6;i++)P.face([[u+i*cw2/6,v,11.5],[u+(i+1)*cw2/6,v,11.5],[u+(i+1)*cw2/6,v+sd+3,9.5],[u+i*cw2/6,v+sd+3,9.5]],P.col(stripe[i%2]));
        P.box(u+cw2/2-.7,v+sd/2-.7,1.4,1.4,1.4,P.col('#ffe6aa'),undefined,H-3);}
      for(let i=0;i<cols;i++){const a=i*w/cols,b=(i+1)*w/cols,v=d+.4,z=H-2.5;P.stick([a,v,z],[(a+b)/2,v,z-2.2],P.col('#8a7a5c'),.25);P.stick([(a+b)/2,v,z-2.2],[b,v,z],P.col('#8a7a5c'),.25);
        for(let k=0;k<3;k++){const t=(k+.5)/3,x=a+(b-a)*t,sag=z-2.2*(1-Math.abs(t-.5)*2);P.face([[x-1.2,v,sag],[x+1.2,v,sag],[x,v,sag-2.6]],P.col(['#d2af68','#b8654b','#3f6979','#a7c08a'][(i+k)%4]));}}
      for(const u of [-1,w-5]){P.box(u,d+5,6,6,3,stone);P.disc(u+3,d+8,2.6,2.6,3.2,P.col(day?'#7fa36a':'#3f5c43'));const p=L.at(u+3,d+8,0);trees.push({x:p[0],y:p[1],size:9,conifer:false});}
      for(const u of [w*.12,w*.78])P.box(u,d+12,w*.1,2.4,2.2,wood,undefined,0);
    }else if(fn==='tribology-lab'){
      // Lubricant research: a lab hall, oil tanks with rising air bubbles, an in-line camera on the flow pipe and a foam vessel.
      const oil=P.col(day?'#c99a3b':'#9b7a3c'),bubble=P.col(day?'#f4f1e2':'#f6e7b8'),metal=P.col('#7f8f8c');
      P.quad(-2,-2,w+4,d+4,.1,P.col(day?'#c9c6b2':'#66705f'));P.box(0,0,w*.55,d,22,P.col('#c9d3cf'),P.col('#8fa7a9'));P.windows(0,0,w*.55,d,0,22,win,7);
      for(let k=0;k<3;k++){const u=w*(.06+k*.09)+3;P.cylinder(u,d*.25,1.8,22,6,metal);}
      for(let k=0;k<3;k++){const cu=w*(.66+k*.11),cv=d*.38,r=Math.min(w*.045,d*.12);P.cylinder(cu,cv,r,0,26,oil,P.col('#e0c27a'));P.dome(cu,cv,r,26,metal);
        for(let b=0;b<4;b++)P.frontDisc(cu+((k+b)%3-1)*r*.35,5+b*5.2,r*(.18+.06*((k+b)%2)),bubble,!day,cv+r+.05);}
      P.stick([w*.55,d*.78,6],[w*.97,d*.78,6],metal,2.2);P.box(w*.74,d*.78-4,3,3,4,P.col('#36454d'),undefined,13);P.pole(w*.755,d*.78-2.5,8,13,metal,.7);
      P.cylinder(w*.9,d*.8,3,0,10,P.col('#bcd2d4'));P.disc(w*.9,d*.8,2.6,2.6,7.5,bubble);
    }else if(fn==='sports-lab'){
      // Sports science: a test hall, a 10 metre sprint lane with timing gates and pose-tracking cameras, a jump platform.
      P.quad(-2,-2,w+4,d+4,.1,P.col(day?'#c7c3ae':'#5f6a5c'));P.box(0,0,w,d*.45,16,P.col('#d7c7a5'),P.col('#a8a596'));P.windows(0,0,w,d*.45,0,16,win,6);
      P.box(w*.1,d*.45,w*.8,.6,8,win.glass,undefined,2);
      const track=P.col(day?'#b86f55':'#7a5246'),white=P.col(day?'#f2ecd8':'#cbd2bf'),lane=d*.62;
      P.quad(w*.05,lane,w*.9,d*.16,.3,track);for(const v of [lane,lane+d*.16])P.stick([w*.05,v,.5],[w*.95,v,.5],white,.4);
      for(const u of [w*.12,w*.88]){P.pole(u,lane-1,.5,7,white,.5);P.pole(u,lane+d*.16+1,.5,7,white,.5);P.stick([u,lane-1,7],[u,lane+d*.16+1,7],P.col('#d7a64b'),.5);}
      for(const u of [w*.3,w*.7]){P.pole(u,d*.95,0,11,P.col('#5f6f6c'),.7);P.box(u-1.2,d*.95-1,2.4,2,1.6,P.col('#2f3b40'),undefined,11);}
      P.box(w*.42,d*.84,w*.16,d*.1,.8,P.col('#5d7f8c'));
    }else if(fn==='motion-lab'){
      // Exercise analysis: a glass motion-capture studio under a ring truss of cameras, a gridded capture stage and a pose-skeleton screen.
      const truss=P.col('#4f5d63'),cam=P.col('#22303a'),led=P.col(day?'#d6524a':'#ff6a5a'),cx=w*.62,cy=d*.5,r=Math.min(w*.3,d*.42);
      P.quad(-2,-2,w+4,d+4,.1,P.col(day?'#c8cabc':'#5d685f'));
      P.box(0,d*.1,w*.26,d*.8,14,P.col('#3e4a52'),P.col('#56646c'));P.windows(0,d*.1,w*.26,d*.8,0,14,win,5);
      P.quad(cx-r,cy-r,r*2,r*2,.3,P.col(day?'#d9dcd5':'#7f8783'));
      for(let k=1;k<6;k++){P.stick([cx-r+r*2*k/6,cy-r,.45],[cx-r+r*2*k/6,cy+r,.45],P.col('#9aa3a0'),.2);P.stick([cx-r,cy-r+r*2*k/6,.45],[cx+r,cy-r+r*2*k/6,.45],P.col('#9aa3a0'),.2);}
      const ring=[];for(let k=0;k<12;k++){const a=k/12*Math.PI*2;ring.push([cx+Math.cos(a)*r,cy+Math.sin(a)*r,16]);}
      P.line([...ring,ring[0]],truss,.8);
      for(let k=0;k<12;k+=3)P.pole(ring[k][0],ring[k][1],0,16,truss,.7);
      for(let k=0;k<12;k++){P.box(ring[k][0]-.9,ring[k][1]-.9,1.8,1.8,1.4,cam,undefined,14.4);P.box(ring[k][0]-.3,ring[k][1]-.3,.6,.6,.4,led,undefined,14.1);}
      const bone=P.col(day?'#7fd1c3':'#9ff0de'),sx=w*.13,sy=d*.9+.3,sz=3;
      for(const [a,c] of [[[0,8],[0,4.6]],[[0,4.6],[-1.6,1]],[[0,4.6],[1.6,1]],[[0,7.2],[-2,5.4]],[[0,7.2],[2,5.4]]])P.stick([sx+a[0],sy,sz+a[1]],[sx+c[0],sy,sz+c[1]],bone,.35);
      P.frontDisc(sx,sz+8.8,.8,bone,!day,sy+.05);
    }else if(fn==='practice-centre'){
      // Practice planning: a coaching house with a tactics board, a small pitch with goals and a row of drill cones.
      const white=P.col(day?'#f4f0e0':'#d2d8c6'),grass=P.col(day?'#6f9d5f':'#3f5e3e'),stripe=P.col(day?'#7fae6c':'#47684a');
      P.quad(-2,-2,w+4,d+4,.1,P.col(day?'#c9c5ae':'#5f685a'));P.box(0,0,w*.42,d*.4,20,P.col('#d9c9a6'),P.col('#a99c86'));P.windows(0,0,w*.42,d*.4,0,20,win,6);
      P.roofX(-1,-1,w*.42+2,d*.4+2,20,8,P.col(day?'#8b6f5a':'#5d4a3e'),P.col('#d9c9a6'));
      P.box(w*.46,d*.06,w*.16,1,10,P.col('#6f675c'),undefined,1);P.face([[w*.47,1.1,3],[w*.61,1.1,3],[w*.61,1.1,10],[w*.47,1.1,10]],P.col(day?'#f1efe6':'#cfd0c4'));
      for(const [u,z,c] of [[.5,8,'#c75b4a'],[.55,5,'#3f6aa0'],[.58,8,'#c75b4a'],[.52,4.5,'#3f6aa0']])P.frontDisc(w*u,z,.55,P.col(c),false,1.2);
      const px=w*.48,py=d*.3,pw=w*.48,pd=d*.62;P.quad(px,py,pw,pd,.2,grass);for(let k=0;k<4;k+=2)P.quad(px+pw*k/4,py,pw/4,pd,.25,stripe);
      P.line([[px+1,py+1,.35],[px+pw-1,py+1,.35],[px+pw-1,py+pd-1,.35],[px+1,py+pd-1,.35],[px+1,py+1,.35]],white,.3);P.stick([px+pw/2,py+1,.35],[px+pw/2,py+pd-1,.35],white,.3);
      for(const u of [px+.5,px+pw-.5]){P.pole(u,py+pd*.4,0,3,white,.25);P.pole(u,py+pd*.6,0,3,white,.25);P.stick([u,py+pd*.4,3],[u,py+pd*.6,3],white,.25);}
      for(let k=0;k<6;k++)P.cylinder(w*(.06+k*.065),d*.6,.7,0,1.4,P.col('#e88a3a'));
      for(let k=0;k<3;k++)P.box(w*(.06+k*.12),d*.8,w*.08,1.4,1.4,P.col('#c9b07c'),undefined,0);
    }else if(fn==='memory-vault'){
      // Knowledge memory: a domed rotunda with a glowing index ring, two archive wings of note drawers and linked graph nodes on the roof.
      const stone=P.col(day?'#d8d0c0':'#8e8f86'),glow=P.col(day?'#8fb7d8':'#ffd98a'),cx=w*.5,cy=d*.45,r=Math.min(w,d)*.24;
      P.quad(-2,-2,w+4,d+4,.1,P.col(day?'#cbc7b6':'#5e665c'));
      for(const u of [0,w*.7]){P.box(u,d*.12,w*.3,d*.62,16,P.col('#c9c1d6'),P.col('#a39bb5'));
        for(let row=0;row<3;row++)for(let k=0;k<5;k++)P.face([[u+w*.3*(k+.15)/5,d*.74+.05,3+row*4],[u+w*.3*(k+.85)/5,d*.74+.05,3+row*4],[u+w*.3*(k+.85)/5,d*.74+.05,5.6+row*4],[u+w*.3*(k+.15)/5,d*.74+.05,5.6+row*4]],P.col(['#7c6fa6','#5f8fa8','#a2869d','#6f9f8a'][(row+k)%4]),!day&&(row+k)%3===0);}
      P.cylinder(cx,cy,r,0,24,stone);P.dome(cx,cy,r,24,P.col('#9a93b8'));P.cylinder(cx,cy,r*1.04,15,1.4,glow);
      for(let k=0;k<6;k++){const a=k/6*Math.PI*2;P.cylinder(cx+Math.cos(a)*r*1.12,cy+Math.sin(a)*r*1.12,.9,0,15,stone);}
      const nodes=[[w*.08,d*.25],[w*.22,d*.55],[w*.15,d*.68],[w*.78,d*.3],[w*.9,d*.6],[w*.82,d*.66]];
      for(const [u,v] of nodes){P.pole(u,v,16,19,stone,.4);P.box(u-.9,v-.9,1.8,1.8,1.8,glow,undefined,19);}
      for(const [i,j] of [[0,1],[1,2],[0,2],[3,4],[4,5],[3,5]])P.stick([nodes[i][0],nodes[i][1],20],[nodes[j][0],nodes[j][1],20],glow,.25);
      P.box(cx-3,d*.74,6,4,10,P.col(day?'#4e5a6b':'#2c3442'));P.box(cx-6,d*.74+4,12,3,1.2,stone);
    }else if(fn==='lab-depot'){
      // Lab operations: an inventory hall with roller doors and a loading dock, a scanned gate and a yard of labelled sample racks.
      const metal=P.col('#8a9796'),white=P.col(day?'#eef0ea':'#c7cdc4');
      P.quad(-2,-2,w+4,d+4,.1,P.col(day?'#c6c4b4':'#5f665b'));P.box(0,0,w*.6,d*.55,16,P.col('#b9c6c4'),P.col('#8fa09f'));P.windows(0,0,w*.6,d*.55,8,16,win,6);
      for(let k=0;k<3;k++){const u=w*(.04+k*.19);P.face([[u,d*.55+.05,0],[u+w*.13,d*.55+.05,0],[u+w*.13,d*.55+.05,7],[u,d*.55+.05,7]],P.col(day?'#7f8b8f':'#4a5458'));for(let z=1.4;z<7;z+=1.4)P.stick([u,d*.55+.2,z],[u+w*.13,d*.55+.2,z],P.col('#6d777a'),.2);}
      P.box(0,d*.55,w*.6,3,1.4,P.col('#a6a28f'));
      P.pole(w*.66,d*.62,0,7,metal,.5);P.pole(w*.66,d*.86,0,7,metal,.5);P.stick([w*.66,d*.62,7],[w*.66,d*.86,7],metal,.5);P.box(w*.66-.6,d*.72,1.2,3,1.2,P.col('#c75b4a'),undefined,6);
      for(let row=0;row<2;row++){const v=d*(.1+row*.24),u=w*.68;P.box(u,v,w*.28,1,10,metal,undefined,0);
        for(let level=0;level<3;level++)for(let k=0;k<4;k++)P.box(u+w*.28*(k+.1)/4,v+1,w*.28*.75/4,2.4,2.4,P.col(['#d8b45c','#6f9fc4','#c98670','#8fb47a'][(k+level+row)%4]),undefined,1+level*3.2);}
      for(let k=0;k<3;k++){P.cylinder(w*(.06+k*.07),d*.8,1.6,0,6,white);P.disc(w*(.06+k*.07),d*.8,1.6,1.6,6.1,P.col('#4f86b0'));}
    }else if(fn==='research-lab'||fn==='energy-lab'){
      P.quad(-2,-2,w+4,d+4,.1,P.col(day?'#c3c8b8':'#5d6a60'));const h=fn==='energy-lab'?20:26;
      P.box(0,0,w,d,h,P.col(fn==='energy-lab'?'#b7c9a9':'#c9d6d6'),P.col('#9fb2b4'));P.windows(0,0,w,d,0,h,win,7);
      for(let k=0;k<4;k++)P.face([[w*(.1+k*.2),d*.2,h],[w*(.2+k*.2),d*.2,h],[w*(.2+k*.2),d*.2,h+5],[w*(.1+k*.2),d*.2,h]],P.col('#e3eadf'),!day);
      if(fn==='energy-lab')for(let k=0;k<2;k++)P.face([[w*(.15+k*.4),d*.45,h+.5],[w*(.45+k*.4),d*.45,h+.5],[w*(.45+k*.4),d*.85,h+3],[w*(.15+k*.4),d*.85,h+3]],P.col(day?'#275d7e':'#1e425b'));
      else{P.cylinder(w*.8,d*.6,2,h,8,P.col('#8a9a96'));P.cylinder(w*.88,d*.6,1.5,h,6,P.col('#8a9a96'));}
      P.face([[w*.3,d,9],[w*.7,d,9],[w*.7,d+5,8],[w*.3,d+5,8]],P.col(day?'#6f8f96':'#4c6870'));
    }else if(fn==='stadium'||fn==='campus'||fn==='solar-centre'){/* handled above */}
    else{
      const body=P.col({'innovation-centre':'#b1a3cf','media-centre':'#cba2bb','arts-centre':'#d4a2b1','town-hall':'#d6c4a2',library:'#b9a98c'}[fn]||'#c98f74');
      if(fn==='town-hall'){P.box(0,0,w,d,o.h*.55,body);P.box(w*.4,d*.3,w*.2,d*.4,o.h*.45,P.col('#c9b48e'),undefined,o.h*.55);P.frontDisc(w*.5,o.h*.9,5,P.col('#f1e7c8'),!day,d*.7+.5);P.windows(0,0,w,d,0,o.h*.55,win);}
      else{const h=fn==='arts-centre'?16:fn==='innovation-centre'||fn==='media-centre'?22:o.h;P.box(0,0,w,d,h,body,fn==='market'?P.col('#d7b46a'):undefined);P.windows(0,0,w,d,0,h,win);
        if(fn==='innovation-centre'||fn==='media-centre')P.box(w*.1,d*.1,w*.8,d*.8,1,P.col('#759eac'),undefined,h);
        if(fn==='media-centre'){P.pole(w*.5,d*.5,h,35,P.col('#c4d2cc'),.8);P.disc(w*.5,d*.5,3.5,2.4,35,P.col('#d7d5d1'));}
        if(fn==='arts-centre'){P.box(0,d*.65,w,d*.35,4,P.col('#9e7c98'),undefined,0);P.quad(-1,-1,w+2,d+2,h+4,P.col('#ddb7c3'));P.box(w*.15,d+.3,w*.7,2,10,P.col('#835669'));}
        if(fn==='market'){P.face([[-1,d,h*.65],[w+1,d,h*.65],[w+1,d+4,h*.55],[-1,d+4,h*.55]],P.col('#d2af68'));for(let k=0;k<5;k++)P.face([[k*w/5,d+.05,h*.65+.05],[k*w/5+w/10,d+.05,h*.65+.05],[k*w/5+w/10,d+4,h*.55+.05],[k*w/5,d+4,h*.55+.05]],P.col('#f3e6c3'));}}
    }
    return P.top;
  }

  function polygon(B,points,z,rgb,triangulate){
    if(points.length<3)return;const flat=points.map(p=>[p.x,p.y]),index=triangulate(flat);
    for(let i=0;i<index.length;i+=3){const a=flat[index[i]],b=flat[index[i+1]],c=flat[index[i+2]];B.tri([a[0],a[1],z],[b[0],b[1],z],[c[0],c[1],z],rgb);}
  }
  function disc(B,x,y,r,z,rgb){for(let i=0;i<JOINT_SIDES;i++){const a=i/JOINT_SIDES*Math.PI*2,b=(i+1)/JOINT_SIDES*Math.PI*2;B.tri([x,y,z],[x+Math.cos(a)*r,y+Math.sin(a)*r,z],[x+Math.cos(b)*r,y+Math.sin(b)*r,z],rgb);}}
  function ribbon(B,points,width,z,rgb){
    // Straight segments plus round joints: continuous ways merge cleanly at bends and shared junctions.
    const r=width/2;
    for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy);if(!l)continue;const nx=-dy/l*r,ny=dx/l*r;
      B.quad([a.x+nx,a.y+ny,z],[b.x+nx,b.y+ny,z],[b.x-nx,b.y-ny,z],[a.x-nx,a.y-ny,z],rgb);}
    for(const p of points)disc(B,p.x,p.y,r,z,rgb);
  }
  function bridges(B,plan,day){
    // Rails with posts along both edges, and piers down to the water.
    const ident={W:0,D:0,at:(u,v,z)=>[u,v,z]},P=painter(B,B,ident,0,c=>c),rail=colour(day?'#788b80':'#9ba99b'),pier=colour(day?'#b5ab92':'#6f6a5b');
    for(const r of plan.roads){if(r.kind!=='bridge')continue;
      for(let i=1;i<r.points.length;i++){const a=r.points[i-1],b=r.points[i],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);if(!len)continue;
        for(const side of [-1,1]){const ox=-dy/len*(r.width/2+5.5)*side,oy=dx/len*(r.width/2+5.5)*side;P.stick([a.x+ox,a.y+oy,Z.bridge+BRIDGE.rail],[b.x+ox,b.y+oy,Z.bridge+BRIDGE.rail],rail,1);
          for(let k=0;k<=len;k+=BRIDGE.post)P.pole(a.x+dx*k/len+ox,a.y+dy*k/len+oy,Z.bridge,Z.bridge+BRIDGE.rail,rail,.8);}
        for(let k=BRIDGE.pier/2;k<len;k+=BRIDGE.pier){const cx=a.x+dx*k/len,cy=a.y+dy*k/len,nx=-dy/len,ny=dx/len,hw=r.width/2+3,tx=dx/len*BRIDGE.pierWidth/2,ty=dy/len*BRIDGE.pierWidth/2;
          const c=[[cx+nx*hw-tx,cy+ny*hw-ty],[cx+nx*hw+tx,cy+ny*hw+ty],[cx-nx*hw+tx,cy-ny*hw+ty],[cx-nx*hw-tx,cy-ny*hw-ty]];
          for(let s=0;s<4;s++){const j=(s+1)%4;B.quad([c[s][0],c[s][1],Z.terrain],[c[j][0],c[j][1],Z.terrain],[c[j][0],c[j][1],Z.bridge-.1],[c[s][0],c[s][1],Z.bridge-.1],pier);}}}}
  }
  function ground(B,plan,day,triangulate){
    const t=plan.terrain,c=(a,b)=>colour(day?a:b);
    // No separate city ground: the landscape's ground grid runs under the city too, so there is no edge to see.
    for(const r of plan.rivers||[]){if(r.shoreOutline)polygon(B,r.shoreOutline,Z.shore,c('#b9bf91','#53674f'),triangulate);}
    for(const r of plan.rivers||[]){if(r.waterOutline)polygon(B,r.waterOutline,Z.water,c('#75a9b0','#315968'),triangulate);else ribbon(B,r.points,r.width,Z.water,c('#6b9fa9','#2d505e'));
      if(r.deep)ribbon(B,r.deep,r.width*.4,Z.water+.1,c('#6399a5','#294c5e'));}
    if(plan.plaza)polygon(B,plan.plaza,Z.pad,c('#d8ccb2','#8c8b70'),triangulate);
    for(const d of plan.districts){
      for(const b of d.blocks){
        if(b.pad){polygon(B,b.pad,Z.pad,colour(day?(b.ground||'#ceccb3'):(b.groundNight||'#6a7260')),triangulate);if(b.court)polygon(B,b.court,Z.court,day?colour(b.court_colour||'#95ad7a'):scale(colour(b.court_colour||'#95ad7a'),.3),triangulate);continue;}
        const s=b.size,k=b.cut,x=b.x-s/2,y=b.y-s/2;polygon(B,[[k,0],[s-k,0],[s,k],[s,s-k],[s-k,s],[k,s],[0,s-k],[0,k]].map(([u,v])=>({x:x+u,y:y+v})),Z.pad,c('#ceccb3','#6a7260'),triangulate);
        const court=b.court||52;polygon(B,[{x:b.x-court,y:b.y-court},{x:b.x+court,y:b.y-court},{x:b.x+court,y:b.y+court},{x:b.x-court,y:b.y+court}],Z.court,c('#95ad7a','#4c6b49'),triangulate);
      }
      for(const p of d.parks||[]){if(p.kind==='courtyard')continue;const ring=Array.from({length:24},(_,i)=>({x:p.x+Math.cos(i/24*Math.PI*2)*p.r,y:p.y+Math.sin(i/24*Math.PI*2)*p.r}));polygon(B,ring,Z.court,p.kind==='square'?c('#d8ccb2','#8c8b70'):c('#93ac78','#4c6d48'),triangulate);}
    }
    for(const r of plan.roads){const z=r.kind==='bridge'?Z.bridge:Z.sidewalk;ribbon(B,r.points,r.width+11,z,r.kind==='bridge'?c('#c8bfa8','#7f7a68'):c('#d9d4ba','#a6aa90'));}
    for(const r of plan.roads)ribbon(B,r.points,r.width,(r.kind==='bridge'?Z.bridge:Z.sidewalk)+(Z.carriage-Z.sidewalk),r.kind==='pedestrian'?c('#cfc4a4','#8a866c'):c('#9aa49a','#616f67'));
    for(const r of plan.roads){if(!['avenue','district','bridge'].includes(r.kind))continue;const z=(r.kind==='bridge'?Z.bridge:Z.sidewalk)+(Z.carriage-Z.sidewalk)+.1;
      // Dashed centre line: 8 units painted, 10 units gap, like the 2D atlas.
      for(let i=1;i<r.points.length;i++){const a=r.points[i-1],b=r.points[i],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);if(!len)continue;const nx=-dy/len*.5,ny=dx/len*.5;
        for(let k=0;k<len;k+=18){const e=Math.min(len,k+8),p={x:a.x+dx*k/len,y:a.y+dy*k/len},q={x:a.x+dx*e/len,y:a.y+dy*e/len};B.quad([p.x+nx,p.y+ny,z],[q.x+nx,q.y+ny,z],[q.x-nx,q.y-ny,z],[p.x-nx,p.y-ny,z],c('#dedbc4','#bbc1a2'));}}}
    for(const r of plan.paths||[])ribbon(B,r.points,Math.max(1,r.width),Z.path,c('#d6caa6','#8e8a6c'));
    bridges(B,plan,day);
  }
  // Landscape beyond the city (LANDSCAPE.md): land-use rings from the city outwards, noise-shaped forest edges with
  // fringe, shrub belt and mantle, clustered trees with gaps, riparian belts, a tributary network, fields of project reference data with shelterbelts,
  // mountains where the river rises and a sea where it ends. Scenario scenery only: deterministic, never simulated.
  const LAND={ground:100000,upstream:2200,downstream:900,seaMargin:60,coastRivers:[-6000,-4700,-3500,-2300,-1300,1300,2300,3500,4700],coastRiverGap:600,coastRiverWidth:1.1,coastRiverLength:[1500,1300],rim:[.62,.9],rimNoise:1400,seaLift:.3,bayReach:9000,coastStep:60,mouthCalm:500,bayScale:1800,bayDepth:900,wetSand:16,surf:[8,14],duneStep:9,duneDepth:70,duneGap:.55,duneReach:3500,meander:.12,coastWave:60,beach:110,band:3800,cell:30,clear:45,
    meadow:140,fieldsEnd:700,noise:2.3,detail:.4,valley:.45,valleyReach:650,edge:{fringe:.04,shrub:.09,mantle:.2},step:26,thinFrom:900,thin:.012,gapScales:[90,260],gap:.74,
    riparian:30,junction:72*Math.PI/180,junctionJitter:10*Math.PI/180,meanderWaves:11,orders:[[2,4,.45,1300],[1,3,.25,520]],
    groundCell:60,mountains:46,mountainNear:500,mountainFar:2600,mountainSpread:1.05,valley:.16};
  // Fields of project reference data (LANDSCAPE.md, LS-11): size from words, a road and shelterbelts per project.
  // The idea railway: track across the station site at RAILWAY.line of its depth, the train waiting at `platform`.
  const RAILWAY={line:.3,platform:.12,lead:24,straight:240,smooth:5,search:40000,foot:.95,lift:2,ramp:60,gauge:5,ballast:12,sleeper:4,clear:16,pier:6,portal:[30,8,24],view:500};
  const FARM={crops:['#d8c27a','#9bbd6a','#b9cf86','#a88a62','#a7c08a','#d9d36a','#c4b07a'],side:[130,300],perWord:2.2,gap:16,road:9,beltStep:11,beltSize:[8,4],push:[0,120,260,420,620],lift:.6,linkTries:60,roadStep:8,ramp:10,bridgeCost:6,builtCost:1.5,
    layer:.35,roadLift:1,margin:5,barn:[24,16,10],
    kinds:[{base:'#d8c27a',row:'#c4a95c',spacing:6,width:2.4,tramline:'#e6d49a'},{base:'#8fb062',row:'#6f9a4e',spacing:7,width:3},
      {base:'#a88a62',row:'#8a6d48',spacing:4.5,width:2},{base:'#a7c08a',row:'#98b37c',spacing:9,width:4,bales:7},
      {base:'#d9d36a',row:'#c9c35a',spacing:6,width:2.4,tramline:'#e3df90'},{base:'#7f9a4a',row:'#6b8a3c',spacing:7,width:2.6,heads:'#e8c547'},
      {base:'#9bb36a',row:'#8aa35c',spacing:14,width:5,orchard:true}]};
  // Fields lie just above the city's own ground, which covers the land near town; water and blocks stay above them.
  // Landscape layers sit whole units apart: far views of a large scene leave little depth precision for thin gaps.
  const LAYER={plane:6,grid:4,field:2,beach:1};
  function random(seed){let a=hash32(seed);return ()=>{a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};}
  function hash32(str){let h=2166136261;for(const c of str){h^=c.codePointAt(0);h=Math.imul(h,16777619);}return h>>>0;}
  function inside(p,poly){let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;}
  // Value noise on a hashed lattice with Perlin's quintic fade; fbm sums four octaves into [0, 1].
  const lattice=(i,j)=>{let h=Math.imul(i,374761393)+Math.imul(j,668265263)|0;h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296;};
  const fade=t=>t*t*t*(t*(t*6-15)+10);
  function noise(x,y){const i=Math.floor(x),j=Math.floor(y),u=fade(x-i),v=fade(y-j),a=lattice(i,j),b=lattice(i+1,j),c=lattice(i,j+1),d=lattice(i+1,j+1);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;}
  function fbm(x,y,scale){let sum=0,amp=.5,norm=0,f=1/scale;for(let o=0;o<4;o++){sum+=noise(x*f+o*17.3,y*f-o*9.1)*amp;norm+=amp;amp*=.5;f*=2;}return sum/norm;}
  const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
  function segmentGap(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy||1,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l));return Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t);}
  function lineGap(p,points){let best=Infinity;for(let i=1;i<points.length;i++)best=Math.min(best,segmentGap(p,points[i-1],points[i]));return best;}
  function course(from,dir,length,width,rand,widen){
    // A meandering continuation of the river, narrowing upstream or widening into an estuary.
    const side={x:-dir.y,y:dir.x},points=[],phase=rand()*6;
    for(let s=0;s<=length;s+=40){const k=s/length,wobble=Math.sin(s/length*Math.PI*3+phase)*length*LAND.meander*Math.min(1,k*3);
      points.push({x:from.x+dir.x*s+side.x*wobble,y:from.y+dir.y*s+side.y*wobble,w:width*(widen?1+k*1.6:1-k*.55)});}
    return points;
  }
  function waterRibbon(B,line,shoreCol,waterCol){
    for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy)||1;
      for(const [w,z,col] of [[a.w/2+Math.max(3,a.w*.35),Z.shore,shoreCol],[a.w/2,Z.water,waterCol]]){const nx=-dy/l*w,ny=dx/l*w;B.quad([a.x+nx,a.y+ny,z],[b.x+nx,b.y+ny,z],[b.x-nx,b.y-ny,z],[a.x-nx,a.y-ny,z],col);disc(B,b.x,b.y,w,z,col);}}
  }
  function landscape(B,plan,day,triangulate,trees,fields,near,life){
    const t=plan.terrain,c=(a,b)=>colour(day?a:b),centre={x:(t.minX+t.maxX)/2,y:(t.minY+t.maxY)/2},reach=Math.hypot(t.maxX-t.minX,t.maxY-t.minY)/2,G=LAND.ground;
    const meadow=c('#a7b88b','#3e5943'),fringe=c('#b7c48c','#435c44'),floor=c('#7f9668','#2c4232');
    B.quad([centre.x-G,centre.y-G,Z.terrain-LAYER.plane],[centre.x+G,centre.y-G,Z.terrain-LAYER.plane],[centre.x+G,centre.y+G,Z.terrain-LAYER.plane],[centre.x-G,centre.y+G,Z.terrain-LAYER.plane],floor);
    const rand=random('brain-city-landscape'),water=c('#75a9b0','#315968'),shore=c('#b9bf91','#53674f'),rivers=plan.rivers||[];
    // Grid over the landscape band: built cells, distance to the city, water and riparian cells.
    // The camera may show land only within the full landscape, before the rim starts to fade (scene3d confines it).
    life.view=(reach+LAND.band)*LAND.rim[0];
    const C=LAND.cell,half=reach+LAND.band,x0=centre.x-half,y0=centre.y-half,n=Math.ceil(2*half/C),cellOf=p=>{const i=Math.floor((p.x-x0)/C),j=Math.floor((p.y-y0)/C);return i<0||j<0||i>=n||j>=n?-1:i+j*n;};
    const built=new Uint8Array(n*n),wet=new Uint8Array(n*n),riparian=new Uint8Array(n*n),solid=new Uint8Array(n*n);
    const stamp=(grid,x,y,r)=>{const i0=Math.max(0,Math.floor((x-r-x0)/C)),i1=Math.min(n-1,Math.floor((x+r-x0)/C)),j0=Math.max(0,Math.floor((y-r-y0)/C)),j1=Math.min(n-1,Math.floor((y+r-y0)/C));for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++)grid[i+j*n]=1;};
    const along=(grid,points,r)=>{for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],l=Math.hypot(b.x-a.x,b.y-a.y);for(let s=0;s<=l;s+=C/2)stamp(grid,a.x+(b.x-a.x)*s/(l||1),a.y+(b.y-a.y)*s/(l||1),typeof r==='function'?r(a):r);}};
    for(const r of [...plan.roads,...(plan.paths||[])])along(built,r.points,r.width/2+LAND.clear);
    for(const d of plan.districts)for(const b of d.blocks){if(b.pad){const xs=b.pad.map(p=>p.x),ys=b.pad.map(p=>p.y);for(let x=Math.min(...xs);x<=Math.max(...xs);x+=C)for(let y=Math.min(...ys);y<=Math.max(...ys);y+=C)if(inside({x,y},b.pad)){stamp(built,x,y,LAND.clear);stamp(solid,x,y,C/2);}}else stamp(built,b.x,b.y,(b.size||0)/2+LAND.clear);}
    // `solid` is what a farm road may never cross: buildings, service sites and block pads, without the clearing.
    for(const nd of plan.nodes){stamp(built,nd.rcx??nd.x+nd.w/2,nd.rcy??nd.y+nd.d/2,Math.hypot(nd.w,nd.d)/2+LAND.clear);stamp(solid,nd.rcx??nd.x+nd.w/2,nd.rcy??nd.y+nd.d/2,Math.hypot(nd.w,nd.d)/2);}
    for(const o of plan.scenery)if(o.kind==='service'){stamp(built,o.rcx??o.x+o.w/2,o.rcy??o.y+o.d/2,Math.hypot(o.w,o.d)/2+LAND.clear);stamp(solid,o.rcx??o.x+o.w/2,o.rcy??o.y+o.d/2,Math.hypot(o.w,o.d)/2+4);}
    if(plan.plaza)for(const p of plan.plaza)stamp(built,p.x,p.y,LAND.clear*2);
    // Distance to the city in cells (chamfer 3-4), the axis of the land-use rings.
    const dist=new Float32Array(n*n).fill(1e9),queue=[];for(let k=0;k<n*n;k++)if(built[k]){dist[k]=0;queue.push(k);}
    for(let pass=0;pass<2;pass++)for(let jj=0;jj<n;jj++)for(let ii=0;ii<n;ii++){const i=pass?n-1-ii:ii,j=pass?n-1-jj:jj,k=i+j*n,s=pass?1:-1;
      for(const [di,dj,w] of [[s,0,1],[0,s,1],[s,s,1.414],[-s,s,1.414]]){const a=i+di,b=j+dj;if(a>=0&&b>=0&&a<n&&b<n&&dist[a+b*n]+w<dist[k])dist[k]=dist[a+b*n]+w;}}
    const cityGap=p=>{const k=cellOf(p);return k<0?LAND.band:Math.min(LAND.band,dist[k]*C);};
    if(!rivers.length)return;
    // Main river continued to the mountains and to the sea.
    const first=rivers.find(r=>/inflow/.test(r.id))||rivers[0],last=rivers.find(r=>/outflow/.test(r.id))||rivers[rivers.length-1];
    const source=first.points[0],mouth=last.points[last.points.length-1],unit=v=>{const l=Math.hypot(v.x,v.y)||1;return {x:v.x/l,y:v.y/l};};
    const up=unit({x:source.x-first.points[Math.min(4,first.points.length-1)].x,y:source.y-first.points[Math.min(4,first.points.length-1)].y});
    const down=unit({x:mouth.x-last.points[Math.max(0,last.points.length-5)].x,y:mouth.y-last.points[Math.max(0,last.points.length-5)].y});
    // The sea comes as close as the city allows: its coast lies just past the last built cell along the river's
    // direction (plus the beach, the wave and a margin). If that is before the river's end, the sea takes the rest.
    let reachDown=-Infinity;for(let k=0;k<n*n;k++)if(built[k]){const x=x0+(k%n+.5)*C-mouth.x,y=y0+(Math.floor(k/n)+.5)*C-mouth.y;reachDown=Math.max(reachDown,x*down.x+y*down.y);}
    const coastAt=Math.max(-LAND.downstream,reachDown+LAND.beach+LAND.coastWave*1.3+LAND.seaMargin);
    const upper=course(source,up,LAND.upstream,first.width,rand,false),lower=coastAt>0?course(mouth,down,coastAt,last.width,rand,true):[{...mouth,w:last.width}];
    waterRibbon(B,upper,shore,water);waterRibbon(B,lower,shore,water);
    const main=[...upper.slice().reverse(),...rivers.flatMap(r=>r.points.map(p=>({...p,w:r.width}))),...lower];
    for(const line of [main])along(wet,line,a=>(a.w||20)/2+6),along(riparian,line,a=>(a.w||20)/2+LAND.riparian);
    for(const r of rivers)if(r.waterOutline)for(const p of r.waterOutline)stamp(wet,p.x,p.y,6);
    // Sea: a wavy coast with a beach across the downstream direction, past the estuary.
    const end={x:mouth.x+down.x*coastAt,y:mouth.y+down.y*coastAt},across={x:-down.y,y:down.x},coast=[];
    // Bays and headlands: noise of two scales along the shore, flat at the river mouth so the estuary meets open water.
    const shoreWave=s=>Math.abs(s)<LAND.bayReach?((fbm(s,0,LAND.bayScale)-.5)*LAND.bayDepth+Math.sin(s/97)*LAND.coastWave*.3)*Math.min(1,Math.abs(s)/LAND.mouthCalm):0;
    for(let s=-G/4;s<=G/4;s+=Math.abs(s)<LAND.bayReach?LAND.coastStep:G/200){const wave=shoreWave(s);coast.push({x:end.x+across.x*s+down.x*wave,y:end.y+across.y*s+down.y*wave});}
    const offshore=coast.map(p=>({x:p.x+down.x*G/2,y:p.y+down.y*G/2})).reverse(),beachLine=coast.map(p=>({x:p.x-down.x*LAND.beach,y:p.y-down.y*LAND.beach}));
    polygon(B,[...beachLine,...coast.slice().reverse()],Z.terrain-LAYER.beach,c('#e0d3a8','#7a7560'),triangulate);
    // Wet sand at the waterline and a line of surf just offshore; the sea lies above the river so it takes the estuary.
    const wetLine=coast.map(p=>({x:p.x-down.x*LAND.wetSand,y:p.y-down.y*LAND.wetSand}));polygon(B,[...wetLine,...coast.slice().reverse()],Z.terrain-LAYER.beach+.5,c('#c9b98a','#665f4c'),triangulate);
    polygon(B,[...coast,...offshore],Z.water+LAND.seaLift,c('#5f9aa8','#264656'),triangulate);
    const surf=d=>coast.map(p=>({x:p.x+down.x*d,y:p.y+down.y*d}));polygon(B,[...surf(LAND.surf[0]),...surf(LAND.surf[1]).reverse()],Z.water+LAND.seaLift+.3,c('#e4eeea','#6f8a8c'),triangulate);
    for(let i=0;i<beachLine.length-1;i++){const a=beachLine[i],b=beachLine[i+1],l=Math.hypot(b.x-a.x,b.y-a.y);for(let s=0;s<l;s+=LAND.duneStep){const t=s/l,back=rand()*LAND.duneDepth,p={x:a.x+(b.x-a.x)*t-down.x*back,y:a.y+(b.y-a.y)*t-down.y*back},k=cellOf(p);if(rand()<LAND.duneGap)continue;
      if(k>=0&&!built[k]&&Math.hypot(p.x-end.x,p.y-end.y)<LAND.duneReach&&!rivers.some(r=>lineGap(p,r.points)<r.width/2+LAND.riparian)&&lineGap(p,lower)>LAND.riparian)trees.push({wild:true,x:p.x,y:p.y,size:4+rand()*3,conifer:false,tone:1.1+rand()*.15});}}
    life.coast={x:end.x,y:end.y,down,across,beach:LAND.beach};
    // Sea lanes for boats and glints follow the real wavy shore.
    life.shore=coast.filter(p=>Math.hypot(p.x-end.x,p.y-end.y)<LAND.bayReach);
    const seaGap=p=>{const dx=p.x-end.x,dy=p.y-end.y;return dx*down.x+dy*down.y-shoreWave(dx*across.x+dy*across.y);},dry=p=>seaGap(p)<-LAND.beach-20;
    // Mountains around the source, a valley left open for the river; forest only on their lower slopes.
    const peaks=[],rock=c('#7d8471','#39433c'),snow=c('#f2f2ec','#b9c2c4'),slope=c('#8f9a78','#3e4a3e'),ridge={x:source.x+up.x*LAND.upstream*.8,y:source.y+up.y*LAND.upstream*.8};
    for(let k=0;k<LAND.mountains;k++){
      const angle=(rand()-.5)*2*LAND.mountainSpread,d=LAND.mountainNear+rand()*(LAND.mountainFar-LAND.mountainNear);
      if(Math.abs(angle)<LAND.valley&&d<LAND.upstream*.9)continue;
      const dir={x:up.x*Math.cos(angle)-up.y*Math.sin(angle),y:up.x*Math.sin(angle)+up.y*Math.cos(angle)},p={x:ridge.x+dir.x*d-up.x*LAND.mountainNear,y:ridge.y+dir.y*d-up.y*LAND.mountainNear};
      const scale=.5+d/LAND.mountainFar,r=(180+rand()*240)*scale,h=(260+rand()*420)*scale;
      if(lineGap(p,upper)<r*.6||Math.hypot(p.x-centre.x,p.y-centre.y)<reach+r||seaGap(p)>-LAND.beach-r)continue;
      peaks.push({...p,r});const sides=7,top={x:p.x+(rand()-.5)*r*.3,y:p.y+(rand()-.5)*r*.3},cap=.62+rand()*.1,ring=[];
      for(let i=0;i<sides;i++){const a=i/sides*Math.PI*2+rand()*.3,rr=r*(.8+rand()*.35);ring.push({x:p.x+Math.cos(a)*rr,y:p.y+Math.sin(a)*rr});}
      for(let i=0;i<sides;i++){const a=ring[i],b=ring[(i+1)%sides],mid=q=>({x:q.x+(top.x-q.x)*cap,y:q.y+(top.y-q.y)*cap});const ma=mid(a),mb=mid(b),z0=Z.terrain-.2,zc=Z.terrain+h*cap;
        B.quad([a.x,a.y,z0],[b.x,b.y,z0],[mb.x,mb.y,zc],[ma.x,ma.y,zc],i%2?rock:slope);B.tri([ma.x,ma.y,zc],[mb.x,mb.y,zc],[top.x,top.y,Z.terrain+h],snow);}
    }
    const onPeak=p=>peaks.some(m=>Math.hypot(p.x-m.x,p.y-m.y)<m.r*.75),nearPeak=p=>peaks.reduce((b,m)=>Math.max(b,1-Math.hypot(p.x-m.x,p.y-m.y)/(m.r*2.5)),0);
    // Tributaries: Strahler orders 2 and 1 join at ~72°, narrower and shorter by order, meandering ~11 widths per wave.
    const blocked=p=>{const k=cellOf(p);return k<0||built[k]||!dry(p)||onPeak(p);};
    const streams=[];
    function grow(start,heading,order,width,length,parentWet){
      const line=[{...start,w:width}],step=Math.max(10,width*1.4),lambda=width*LAND.meanderWaves,phase=rand()*6;let h=heading,p={...start};
      for(let s=step;s<=length;s+=step){h+=(fbm(p.x,p.y,700)-.5)*.18;const wiggle=Math.sin(s/lambda*Math.PI*2+phase)*.55;
        p={x:p.x+Math.cos(h+wiggle)*step,y:p.y+Math.sin(h+wiggle)*step};const k=cellOf(p);
        if(blocked(p)||(s>step*3&&k>=0&&wet[k]&&!parentWet.has(k)))break;line.push({...p,w:width*(1-.5*s/length)});}
      if(line.length<4)return null;streams.push(line);return line;
    }
    const mainWet=new Set();for(let k=0;k<n*n;k++)if(wet[k])mainWet.add(k);
    const [[,count2,ratio2,len2],[,count1,ratio1,len1]]=LAND.orders,mainWidth=first.width;
    const candidates=main.map((p,i)=>({p,i})).filter(({p,i})=>i>3&&i<main.length-4&&!built[cellOf(p)]&&dry(p)&&cityGap(p)>LAND.meadow);
    for(let k=0;k<count2&&candidates.length;k++){
      const {p,i}=candidates[Math.floor((k+.5)/count2*candidates.length)],toSource=unit({x:main[i-3].x-main[i+3].x,y:main[i-3].y-main[i+3].y}),side=k%2?1:-1;
      const angle=Math.atan2(toSource.y,toSource.x)+side*(LAND.junction+(rand()-.5)*2*LAND.junctionJitter);
      const trunk=grow(p,angle,2,mainWidth*ratio2,len2*(.8+rand()*.4),mainWet);if(!trunk)continue;
      for(let b=0;b<count1;b++){const at=trunk[Math.floor((b+1)/(count1+1)*trunk.length)],q=trunk[Math.max(0,trunk.indexOf(at)-2)],dir=Math.atan2(at.y-q.y,at.x-q.x),bs=b%2?1:-1;
        grow(at,dir+bs*(LAND.junction+(rand()-.5)*2*LAND.junctionJitter),1,mainWidth*ratio1,len1*(.7+rand()*.6),mainWet);}
    }
    // Coastal rivers (LS-08): independent order-2 rivers reach the sea along the coast, each grown upstream from its
    // mouth so it narrows inland, with order-1 tributaries joining at ~72°. They stay clear of the city and the main river.
    const shoreAt=(s,d)=>({x:end.x+across.x*s+down.x*(shoreWave(s)+d),y:end.y+across.y*s+down.y*(shoreWave(s)+d)});
    for(const s of LAND.coastRivers){const mouthP=shoreAt(s,-LAND.beach-30);
      const k=cellOf(mouthP);if(k<0||built[k]||lineGap(mouthP,main)<LAND.coastRiverGap)continue;
      const inland=Math.atan2(-down.y,-down.x)+(rand()-.5)*.6,width=mainWidth*LAND.coastRiverWidth;
      const trunk=grow(mouthP,inland,2,width,LAND.coastRiverLength[0]+rand()*LAND.coastRiverLength[1],mainWet);if(!trunk)continue;
      trunk.unshift({...shoreAt(s,LAND.beach*.6),w:width},{...shoreAt(s,0),w:width});
      for(let b=0;b<2;b++){const at=trunk[Math.floor((b+1)/3*trunk.length)],q=trunk[Math.max(0,trunk.indexOf(at)-2)],dir=Math.atan2(at.y-q.y,at.x-q.x);
        grow(at,dir+(b?1:-1)*(LAND.junction+(rand()-.5)*2*LAND.junctionJitter),1,width*.55,LAND.orders[1][3]*(.7+rand()*.6),mainWet);}}
    life.water=[];for(const line of [main,...streams])for(let i=0;i<line.length;i+=4)life.water.push({x:line[i].x,y:line[i].y,w:line[i].w||20});
    for(const line of streams){waterRibbon(B,line,shore,water);along(wet,line,a=>a.w/2+4);along(riparian,line,a=>a.w/2+LAND.riparian);}
    // Forestness: far from the city and on noise highs; the forest edge is its 0.5 contour.
    // Distance to the river network: farmland follows the flat valley, forest keeps the higher ground between rivers.
    const riverDist=new Float32Array(n*n).fill(1e9);for(let k=0;k<n*n;k++)if(wet[k])riverDist[k]=0;
    for(let pass=0;pass<2;pass++)for(let jj=0;jj<n;jj++)for(let ii=0;ii<n;ii++){const i=pass?n-1-ii:ii,j=pass?n-1-jj:jj,k=i+j*n,s=pass?1:-1;
      for(const [di,dj,w] of [[s,0,1],[0,s,1],[s,s,1.414],[-s,s,1.414]]){const a=i+di,b=j+dj;if(a>=0&&b>=0&&a<n&&b<n&&riverDist[a+b*n]+w<riverDist[k])riverDist[k]=riverDist[a+b*n]+w;}}
    const valley=p=>{const k=cellOf(p);return k<0?0:Math.exp(-riverDist[k]*C/LAND.valleyReach);};
    const forestness=p=>{const d=cityGap(p);let f=.15+smooth(LAND.fieldsEnd*.1,LAND.fieldsEnd*3.5,d)*.8+(fbm(p.x,p.y,1400)-.5)*LAND.noise+(fbm(p.x+911,p.y-377,320)-.5)*LAND.detail-valley(p)*LAND.valley;
      if(d<LAND.meadow)f-=1-d/LAND.meadow;return f+nearPeak(p)*.6;};
    // Fields (LS-11): only project reference data farms land. Each project's fields form one block beyond the city on
    // the side of its district, reached by a farm road from the city edge; shelterbelts line the road and the gaps
    // between fields. Each field is one document, sized by its length; without such documents there are no fields.
    const crops=FARM.crops.map(h=>day?colour(h):scale(colour(h),.42)),dirt=c('#a88d62','#5a5141'),farm=new Uint8Array(n*n);
    const groups=new Map();for(const s of plan.sources||[])if(s.cityField&&s.available!==false){const key=s.project||s.district;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(s);}
    const fieldOk=p=>{const k=cellOf(p);return k>=0&&!built[k]&&!wet[k]&&!farm[k]&&dry(p)&&!onPeak(p);};
    const belt=(a,b,offset)=>{const dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy)||1,ox=-dy/l*offset,oy=dx/l*offset;
      for(let s=FARM.beltStep/2;s<l;s+=FARM.beltStep){const p={x:a.x+dx*s/l+ox,y:a.y+dy*s/l+oy};if(fieldOk(p))trees.push({wild:true,x:p.x,y:p.y,size:FARM.beltSize[0]+rand()*FARM.beltSize[1],conifer:rand()<.2,tone:.95+rand()*.15});}};
    // A farm road joins the nearest city street that reaches the fields without crossing built land again or the sea.
    const link=A=>{const ends=plan.roads.flatMap(r=>r.points).sort((p,q)=>Math.hypot(p.x-A.x,p.y-A.y)-Math.hypot(q.x-A.x,q.y-A.y));
      for(const S of ends.slice(0,FARM.linkTries)){const l=Math.hypot(A.x-S.x,A.y-S.y);let leaving=true,clear=l>0;
        for(let s=0;s<l&&clear;s+=C/2){const p={x:S.x+(A.x-S.x)*s/l,y:S.y+(A.y-S.y)*s/l},k=cellOf(p);if(k<0||!dry(p)||onPeak(p)||(s>C&&solid[k])){clear=false;break;}
          if(built[k]){if(!leaving)clear=false;}else leaving=false;}
        if(clear)return [S];}
      return detour(A);};
    // Otherwise the cheapest grid path from the fields to any street cell: never through solid or the sea, water costs
    // a bridge; then straightened by line of sight so the road runs in a few long straight pieces.
    const street=new Uint8Array(n*n);for(const r of plan.roads)along(street,r.points,r.width/2);
    const passable=k=>k>=0&&!solid[k]&&!street[k];
    const detour=(A,reached=k=>street[k],free=()=>false,guess=()=>0,budget=Infinity)=>{
      const start=cellOf(A);if(start<0)return null;const cost=new Float32Array(n*n).fill(Infinity),from=new Int32Array(n*n).fill(-1),heap=[[0,start]];cost[start]=0;let goal=-1;
      const push=(c,k)=>{heap.push([c,k]);let i=heap.length-1;while(i>0){const p=(i-1)>>1;if(heap[p][0]<=heap[i][0])break;[heap[p],heap[i]]=[heap[i],heap[p]];i=p;}};
      const pop=()=>{const top=heap[0],last=heap.pop();if(heap.length){heap[0]=last;let i=0;for(;;){const l=2*i+1,r=l+1;let m=i;if(l<heap.length&&heap[l][0]<heap[m][0])m=l;if(r<heap.length&&heap[r][0]<heap[m][0])m=r;if(m===i)break;[heap[m],heap[i]]=[heap[i],heap[m]];i=m;}}return top;};
      while(heap.length&&budget-->0){const [priority,k]=pop(),c=cost[k];if(priority>c+guess(k)+1e-6)continue;if(reached(k)){goal=k;break;}const i=k%n,j=(k-i)/n;
        for(const [di,dj,w] of [[1,0,1],[-1,0,1],[0,1,1],[0,-1,1],[1,1,1.414],[1,-1,1.414],[-1,1,1.414],[-1,-1,1.414]]){const a=i+di,b=j+dj;if(a<0||b<0||a>=n||b>=n)continue;const q=a+b*n;
          if(solid[q]&&!free(q))continue;const p={x:x0+(a+.5)*C,y:y0+(b+.5)*C};if(!dry(p)||onPeak(p))continue;const step=w*(wet[q]?FARM.bridgeCost:built[q]?FARM.builtCost:1);
          if(c+step<cost[q]){cost[q]=c+step;from[q]=k;push(c+step+guess(q),q);}}}
      if(goal<0)return null;
      const cells=[];for(let k=goal;k>=0;k=from[k])cells.push({x:x0+(k%n+.5)*C,y:y0+(Math.floor(k/n)+.5)*C});
      const sight=(a,b)=>{const l=Math.hypot(b.x-a.x,b.y-a.y);for(let s=0;s<=l;s+=C/3){const k=cellOf({x:a.x+(b.x-a.x)*s/l,y:a.y+(b.y-a.y)*s/l});if(k<0||(solid[k]&&!free(k)))return false;}return true;};
      const path=[cells[0]];for(let i=0;i<cells.length-1;){let j=cells.length-1;while(j>i+1&&!sight(cells[i],cells[j]))j--;path.push(cells[j]);i=j;}
      return path.slice(0,-1);};
    const roadZ=Z.shore+FARM.roadLift,verge=c('#8f7a55','#4b4438'),tint=h=>day?colour(h):scale(colour(h),.42);
    const field=(f,seed)=>{
      // One crop per document: a grass margin, the crop, then rows, tramlines, bales, flower heads or orchard trees.
      const kind=FARM.kinds[seed%FARM.kinds.length],[q0,q1,,q3]=f.q,pt=(s,t,z)=>[q0.x+(q1.x-q0.x)*s+(q3.x-q0.x)*t,q0.y+(q1.y-q0.y)*s+(q3.y-q0.y)*t,z];
      const z0=Z.terrain+FARM.lift,z1=z0+FARM.layer,z2=z1+FARM.layer,m=FARM.margin/Math.min(f.w,f.depth),rect=(s0,t0,s1,t1,z,col)=>B.quad(pt(s0,t0,z),pt(s1,t0,z),pt(s1,t1,z),pt(s0,t1,z),col);
      rect(0,0,1,1,z0,tint('#9fb57c'));rect(m,m,1-m,1-m,z1,tint(kind.base));
      const across=(seed>>4)%2===0,length=across?f.w:f.depth,count=Math.floor((across?f.depth:f.w)/kind.spacing);
      if(kind.row)for(let i=1;i<count;i++){const t=i/count;if(t<m||t>1-m)continue;const half=kind.width/2/(across?f.depth:f.w);
        if(across)rect(m,t-half,1-m,t+half,z2,tint(kind.row));else rect(t-half,m,t+half,1-m,z2,tint(kind.row));}
      if(kind.tramline)for(const t of [.33,.66]){const half=1.2/(across?f.depth:f.w);if(across)rect(m,t-half,1-m,t+half,z2+FARM.layer,tint(kind.tramline));else rect(t-half,m,t+half,1-m,z2+FARM.layer,tint(kind.tramline));}
      const P=painter(B,B,{W:0,D:0,at:(u,v,z)=>pt(u,v,z)},0,q=>q),rnd=random(String(seed));
      if(kind.bales)for(let i=0;i<kind.bales;i++){const s=m*2+rnd()*(1-m*4),t=m*2+rnd()*(1-m*4),[x,y]=pt(s,t,0),Q=painter(B,B,{W:0,D:0,at:(u,v,z)=>[u,v,z]},0,q=>q);Q.cylinder(x,y,3.2,z2,3.4,tint('#d9c27a'),tint('#e8d79a'),8);}
      if(kind.heads)for(let i=1;i<count;i+=1)for(let k=1;k<length/kind.spacing;k++){const a=k/(length/kind.spacing),b=i/count;if(a<m||a>1-m||b<m||b>1-m||rnd()<.35)continue;const [x,y]=across?pt(a,b,0):pt(b,a,0),Q=painter(B,B,{W:0,D:0,at:(u,v,z)=>[u,v,z]},0,q=>q);Q.disc(x,y,1.6,1.6,z2+.3,tint(kind.heads),false,6);}
      if(kind.orchard)for(let i=1;i<count;i++)for(let k=1;k<length/kind.spacing;k++){const a=k/(length/kind.spacing),b=i/count;if(a<m*2||a>1-m*2||b<m*2||b>1-m*2)continue;const [x,y]=across?pt(a,b,0):pt(b,a,0);trees.push({wild:true,x,y,size:7+rnd()*2,conifer:false,tone:1.05+rnd()*.15});}
    };
    const farmstead=(at,ax)=>{
      // A barn and a silo beside the farm road, where it reaches the fields.
      const spot=at(FARM.gap,-(FARM.road/2+FARM.gap+FARM.barn[1])),ay={x:-ax.y,y:ax.x};if(!fieldOk(spot))return;
      const P=painter(B,B,{W:0,D:0,at:(u,v,z)=>[spot.x+ax.x*u+ay.x*v,spot.y+ax.y*u+ay.y*v,z]},Z.terrain+FARM.lift,q=>q),[bw,bd,bh]=FARM.barn;
      P.box(0,0,bw,bd,bh,tint('#a5523f'));P.roofX(-1,-1,bw+2,bd+2,bh,7,tint('#6b6b66'),tint('#a5523f'));P.face([[bw*.4,bd+.3,0],[bw*.6,bd+.3,0],[bw*.6,bd+.3,bh*.7],[bw*.4,bd+.3,bh*.7]],tint('#5a3b2c'));
      P.cylinder(bw+7,bd/2,4,0,20,tint('#c9c9c0'));P.dome(bw+7,bd/2,4,20,tint('#9aa3a0'));
      stamp(farm,spot.x,spot.y,bw);
    };
    function rounded(line){
      // Chaikin corner cutting with fixed ends: each pass replaces a corner by two points a quarter in from it.
      let points=line;for(let pass=0;pass<RAILWAY.smooth;pass++){const next=[points[0]];for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1];
        if(i>0)next.push({x:a.x*.75+b.x*.25,y:a.y*.75+b.y*.25});if(i<points.length-2)next.push({x:a.x*.25+b.x*.75,y:a.y*.25+b.y*.75});}next.push(points[points.length-1]);points=next;}
      return points;
    }
    function railway(line){
      // Ballast, sleepers and two rails at ground level, rising on ramps onto bridges over water; a portal at the end.
      const P=painter(B,B,{W:0,D:0,at:(u,v,z)=>[u,v,z]},0,q=>q),gravel=c('#a39a88','#56544c'),wood=c('#6f5843','#463b31'),steel=c('#5d6266','#8a9296'),stone=c('#b8ae98','#6b6a5e');
      const ground=Z.terrain+RAILWAY.lift,zAt=p=>{const k=cellOf(p);return k<0?ground:ground+(Z.bridge-ground)*(1-smooth(0,RAILWAY.ramp,riverDist[k]*C));};
      const track=[];for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],l=Math.hypot(b.x-a.x,b.y-a.y);for(let s=0;s<l;s+=RAILWAY.sleeper){const p={x:a.x+(b.x-a.x)*s/l,y:a.y+(b.y-a.y)*s/l};track.push({...p,z:zAt(p)});}}
      const last=line[line.length-1];track.push({...last,z:zAt(last)});
      for(let i=1;i<track.length;i++){const a=track[i-1],b=track[i],l=Math.hypot(b.x-a.x,b.y-a.y)||1,nx=-(b.y-a.y)/l,ny=(b.x-a.x)/l,w=RAILWAY.ballast/2,g=RAILWAY.gauge/2;
        B.quad([a.x+nx*w,a.y+ny*w,a.z],[b.x+nx*w,b.y+ny*w,b.z],[b.x-nx*w,b.y-ny*w,b.z],[a.x-nx*w,a.y-ny*w,a.z],gravel);
        const t=w*.75;B.quad([a.x+nx*t,a.y+ny*t,a.z+.35],[a.x+nx*t+(b.x-a.x)*.3,a.y+ny*t+(b.y-a.y)*.3,a.z+.35],[a.x-nx*t+(b.x-a.x)*.3,a.y-ny*t+(b.y-a.y)*.3,a.z+.35],[a.x-nx*t,a.y-ny*t,a.z+.35],wood);
        for(const side of [-1,1])P.stick([a.x+nx*g*side,a.y+ny*g*side,a.z+.8],[b.x+nx*g*side,b.y+ny*g*side,b.z+.8],steel,.5);
        if(a.z>ground+2&&i%RAILWAY.pier===0)for(const side of [-1,1])P.pole(a.x+nx*w*side,a.y+ny*w*side,Z.water-1,a.z,stone,1.6);}
      for(const p of track)stamp(farm,p.x,p.y,RAILWAY.clear);
      const prev=track[Math.max(0,track.length-4)],l=Math.hypot(last.x-prev.x,last.y-prev.y)||1,ax={x:(last.x-prev.x)/l,y:(last.y-prev.y)/l},ay={x:-ax.y,y:ax.x},[pw,pd,ph]=RAILWAY.portal;
      const Q=painter(B,B,{W:0,D:0,at:(u,v,z)=>[last.x+ax.x*v+ay.x*u,last.y+ax.y*v+ay.y*u,z]},ground,q=>q);
      Q.box(-pw/2,0,pw,pd,ph,stone);Q.face([[-pw*.25,-.1,0],[pw*.25,-.1,0],[pw*.25,-.1,ph*.55],[0,-.1,ph*.75],[-pw*.25,-.1,ph*.55]],c('#1d2224','#0d1012'));
      life.rail=track.map(p=>({x:p.x,y:p.y,z:p.z}));
      // The view may pan out as far as the tunnel, so the whole line can be followed.
      life.view=Math.max(life.view,Math.hypot(last.x-centre.x,last.y-centre.y)+RAILWAY.view);
    }
    const farmRoad=route=>{
      // Gravel on a darker verge; where it meets water it rises onto a small bridge with rails.
      const P=painter(B,B,{W:0,D:0,at:(u,v,z)=>[u,v,z]},0,q=>q),rail=c('#788b80','#9ba99b'),deck=c('#b5a98c','#6d6656');
      for(let i=1;i<route.length;i++){const a=route[i-1],b=route[i],l=Math.hypot(b.x-a.x,b.y-a.y);if(!l)continue;const dx=(b.x-a.x)/l,dy=(b.y-a.y)/l,nx=-dy,ny=dx;let run=[];
        const flush=wetRun=>{if(run.length<2){run=[];return;}const p0=run[0],p1=run[run.length-1];
          if(!wetRun){ribbon(B,[p0,p1],FARM.road+4,roadZ-.1,verge);ribbon(B,[p0,p1],FARM.road,roadZ,dirt);}
          else{const w=FARM.road/2+1,z=Z.bridge,e0={x:p0.x-dx*FARM.ramp,y:p0.y-dy*FARM.ramp},e1={x:p1.x+dx*FARM.ramp,y:p1.y+dy*FARM.ramp};
            B.quad([e0.x+nx*w,e0.y+ny*w,roadZ],[p0.x+nx*w,p0.y+ny*w,z],[p0.x-nx*w,p0.y-ny*w,z],[e0.x-nx*w,e0.y-ny*w,roadZ],deck);
            B.quad([p0.x+nx*w,p0.y+ny*w,z],[p1.x+nx*w,p1.y+ny*w,z],[p1.x-nx*w,p1.y-ny*w,z],[p0.x-nx*w,p0.y-ny*w,z],deck);
            B.quad([p1.x+nx*w,p1.y+ny*w,z],[e1.x+nx*w,e1.y+ny*w,roadZ],[e1.x-nx*w,e1.y-ny*w,roadZ],[p1.x-nx*w,p1.y-ny*w,z],deck);
            for(const side of [-1,1])P.stick([p0.x+nx*w*side,p0.y+ny*w*side,z+3],[p1.x+nx*w*side,p1.y+ny*w*side,z+3],rail,.8);}
          run=[];};
        let wetNow=null;for(let s=0;s<=l;s+=FARM.roadStep){const p={x:a.x+dx*Math.min(s,l),y:a.y+dy*Math.min(s,l)},k=cellOf(p),w=k>=0&&!!wet[k];
          if(wetNow!==null&&w!==wetNow){run.push(p);flush(wetNow);}if(!run.length||run[run.length-1]!==p)run.push(p);wetNow=w;}
        const end={x:b.x,y:b.y};run.push(end);flush(wetNow);}
    };
    // Mountain railway to the Mountain of Ideas: from the station the cheapest dry path to the foot of the nearest
    // peak, where the line enters a tunnel. Rivers are crossed on bridges; fields and forest keep off the line.
    const station=plan.scenery.find(o=>o.kind==='service'&&o.function==='idea-mountain');
    if(station&&peaks.length){
      const L=localFrame(station,doorSide(station,frameOf(station))),at=u=>{const [x,y]=L.at(u,L.D*RAILWAY.line,0);return {x,y};};
      const centreOf={x:station.rcx??station.x+station.w/2,y:station.rcy??station.y+station.d/2},own=Math.hypot(station.w,station.d)/2+C,cell=k=>({x:x0+(k%n+.5)*C,y:y0+(Math.floor(k/n)+.5)*C});
      // The line leaves from the end of the station that faces the nearest peak and runs straight on before it turns;
      // corners are then rounded, so the train never takes a sharp bend.
      const mid=at(L.W/2),gap=m=>Math.hypot(m.x-mid.x,m.y-mid.y)-m.r,peak=peaks.reduce((b,m)=>gap(m)<gap(b)?m:b),axis=at(L.W),forward=(peak.x-mid.x)*(axis.x-mid.x)+(peak.y-mid.y)*(axis.y-mid.y)>=0;
      const clear=p=>{const k=cellOf(p);return k>=0&&(!solid[k]||Math.hypot(p.x-centreOf.x,p.y-centreOf.y)<own)&&dry(p)&&!onPeak(p);};
      const foot=k=>Math.hypot(cell(k).x-peak.x,cell(k).y-peak.y)-peak.r*RAILWAY.foot,onSite=k=>Math.hypot(cell(k).x-centreOf.x,cell(k).y-centreOf.y)<own;
      // A* towards the foot of the peak with a search budget; the far end of the station is the fallback.
      for(const side of [forward,!forward]){
        const along=u=>at(side?u:L.W-u);let lead=RAILWAY.lead;for(let u=RAILWAY.lead;u<=RAILWAY.straight;u+=C/2){if(!clear(along(L.W+u)))break;lead=u;}
        const exit=along(L.W+lead),found=detour(exit,k=>foot(k)<0,onSite,k=>Math.max(0,foot(k))/C,RAILWAY.search);
        if(found){railway([along(L.W*RAILWAY.platform),...rounded([along(L.W),exit,...found.reverse()])]);break;}
      }
    }
    for(const [key,docs] of [...groups].sort((p,q)=>p[0]<q[0]?-1:1)){
      docs.sort((p,q)=>p.id<q.id?-1:1);const district=plan.districts.find(d=>d.id===docs[0].district)||plan.districts[0];
      const base=Math.atan2(district.label.y-centre.y,district.label.x-centre.x)||hash32(key)%628/100;
      const sides=docs.map(d=>Math.max(FARM.side[0],Math.min(FARM.side[1],FARM.side[0]+Math.sqrt(d.words||0)*FARM.perWord))),cols=Math.ceil(Math.sqrt(docs.length));
      let done=false;
      for(const push of FARM.push)for(const turn of [0,.25,-.25,.5,-.5,.75,-.75,1,-1,1.4,-1.4,1.8,-1.8,Math.PI]){if(done)break;
        const ax={x:Math.cos(base+turn),y:Math.sin(base+turn)},ay={x:-ax.y,y:ax.x};let edge=null;
        for(let r=0;r<half;r+=C){const p={x:centre.x+ax.x*r,y:centre.y+ax.y*r};if(cityGap(p)>LAND.meadow*.6&&dry(p)){edge=p;break;}}
        if(!edge)continue;
        // Lay fields in rows across the road, outwards from the city; every field must stand on free, dry land.
        const placed=[];let row=0,v=FARM.gap+push,ok=true;
        while(placed.length<docs.length&&row<cols*3){const rowDocs=docs.slice(placed.length,placed.length+cols),rowDepth=Math.max(...rowDocs.map((_,i)=>sides[placed.length+i]));let u=FARM.road/2+FARM.gap,fits=true;const row_=[];
          for(let i=0;i<rowDocs.length;i++){const w=sides[placed.length+i],at=(a,b)=>({x:edge.x+ax.x*a+ay.x*b,y:edge.y+ax.y*a+ay.y*b}),q=[at(v,u),at(v,u+w),at(v+rowDepth,u+w),at(v+rowDepth,u)];
            if(![...q,at(v+rowDepth/2,u+w/2)].every(fieldOk)){fits=false;break;}row_.push({doc:rowDocs[i],q,u,w,depth:rowDepth,v});u+=w+FARM.gap;}
          if(!fits){ok=false;break;}placed.push(...row_);v+=rowDepth+FARM.gap;row++;}
        if(!ok||!placed.length)continue;
        const at=(a,b)=>({x:edge.x+ax.x*a+ay.x*b,y:edge.y+ax.y*a+ay.y*b}),far=v;
        // Farm road from the city edge along one side of the block, shelterbelts on both sides of it.
        const roadA=at(0,0),roadB=at(far,0),approach=link(roadA)||[],route=[...approach,roadA,roadB];
        farmRoad(route);
        for(let i=1;i<route.length;i++){belt(route[i-1],route[i],FARM.road/2+FARM.gap*.35);belt(route[i-1],route[i],-(FARM.road/2+FARM.gap*.35));}
        for(let i=1;i<route.length;i++){const a=route[i-1],b=route[i],l=Math.hypot(b.x-a.x,b.y-a.y);for(let s=0;s<=l;s+=C/2)stamp(farm,a.x+(b.x-a.x)*s/l,a.y+(b.y-a.y)*s/l,FARM.road);}
        for(const f of placed){
          field(f,hash32(f.doc.id));
          for(const p of f.q)stamp(farm,p.x,p.y,FARM.gap);for(let a=0;a<=1;a+=.25)for(let b=0;b<=1;b+=.25)stamp(farm,f.q[0].x+(f.q[1].x-f.q[0].x)*a+(f.q[3].x-f.q[0].x)*b,f.q[0].y+(f.q[1].y-f.q[0].y)*a+(f.q[3].y-f.q[0].y)*b,FARM.gap);
          belt(at(f.v+f.depth+FARM.gap/2,f.u),at(f.v+f.depth+FARM.gap/2,f.u+f.w),0);belt(at(f.v,f.u-FARM.gap/2),at(f.v+f.depth,f.u-FARM.gap/2),0);
          const mid=at(f.v+f.depth/2,f.u+f.w/2);fields.push({node:f.doc,cx:mid.x,cy:mid.y,w:f.depth,d:f.w,h:2,z:Z.terrain+FARM.lift,rot:Math.atan2(ax.y,ax.x),field:true});}
        for(let r=0;r<=far;r+=C)stamp(farm,at(r,0).x,at(r,0).y,FARM.road);
        farmstead(at,ax);
        done=true;
      }
    }
    // Ground colour grid: meadow near the city, a light fringe at the edge, forest floor inside.
    // The square edge of the landscape band never shows: towards it the ground turns to forest floor and the forest
    // thins out along a noisy ring, so the plane beyond reads as the same land fading into the haze.
    const rim=p=>smooth(half*LAND.rim[0],half*LAND.rim[1],Math.hypot(p.x-centre.x,p.y-centre.y)+(fbm(p.x-1733,p.y+911,900)-.5)*LAND.rimNoise);
    const S=LAND.groundCell,gn=Math.ceil(2*half/S),gx0=centre.x-half,gy0=centre.y-half,tone=p=>{const k=cellOf(p);if(k>=0&&farm[k])return meadow;return mix(baseTone(p),floor,rim(p));},baseTone=p=>{const f=forestness(p);return f<.44?meadow:f<.5?mix(meadow,fringe,(f-.44)/.06):f<.56?mix(fringe,floor,(f-.5)/.06):floor;};
    const corner=[];for(let j=0;j<=gn;j++)for(let i=0;i<=gn;i++){const p={x:gx0+i*S,y:gy0+j*S};corner.push(tone(p));}
    for(let j=0;j<gn;j++)for(let i=0;i<gn;i++){const x=gx0+i*S,y=gy0+j*S,k=i+j*(gn+1);
      // Cells under and around the city go to the ground chunk, which receives building shadows.
      const into=x+S>t.minX&&x<t.maxX&&y+S>t.minY&&y<t.maxY?near:B;
      into.shaded([x,y,Z.terrain-LAYER.grid],[x+S,y,Z.terrain-LAYER.grid],[x+S,y+S,Z.terrain-LAYER.grid],[x,y+S,Z.terrain-LAYER.grid],corner[k],corner[k+1],corner[k+gn+2],corner[k+gn+1]);}
    // Trees: jittered sampling, thinning with distance; layered edge, clustered gaps, species by depth and terrain.
    for(let gy=y0;gy<y0+2*half;gy+=LAND.step)for(let gx=x0;gx<x0+2*half;gx+=LAND.step){
      const p={x:gx+(rand()-.5)*LAND.step*.9,y:gy+(rand()-.5)*LAND.step*.9},k=cellOf(p);if(k<0||built[k]||wet[k]||farm[k]||!dry(p)||onPeak(p))continue;
      const fade=1-rim(p);if(fade<=0||rand()>fade)continue;
      const d=cityGap(p),thin=LAND.step/(LAND.step+Math.max(0,d-LAND.thinFrom)*LAND.thin*LAND.step),roll=rand();
      if(riparian[k]){if(roll<.55*thin)trees.push({wild:true,x:p.x,y:p.y,size:(9+rand()*9)/Math.sqrt(thin),conifer:false,tone:.95+rand()*.2});continue;}
      const depth=forestness(p)-.5;if(depth<LAND.edge.fringe)continue;
      const gap=fbm(p.x,p.y,LAND.gapScales[0])*.5+fbm(p.x,p.y,LAND.gapScales[1])*.5;if(depth>LAND.edge.mantle&&gap>LAND.gap)continue;
      const zone=depth<LAND.edge.shrub?['shrub',.35,5,4]:depth<LAND.edge.mantle?['mantle',.6,11,7]:['interior',.8,15,13];
      if(roll>zone[1]*thin)continue;
      const conifer=zone[0]!=='shrub'&&rand()<Math.min(.85,.2+Math.max(0,depth-.1)*1.4+nearPeak(p)*.6);
      trees.push({wild:true,x:p.x,y:p.y,size:(zone[2]+rand()*zone[3])/Math.sqrt(thin),conifer,tone:zone[0]==='mantle'&&!conifer?1.05+rand()*.2:.85+rand()*.2});
    }
  }

  function furniture(B,G,o,day){
    const ident={W:0,D:0,at:(u,v,z)=>[u,v,z]},P=painter(B,G,ident,Z.base,c=>c);
    if(o.kind==='bench'){const wood=P.col(day?'#997b58':'#62574a');for(const u of [o.x+2,o.x+16])P.box(u,o.y,1.5,6,5,P.col('#526058'));for(let k=0;k<3;k++)P.box(o.x,o.y+k*2,18,1.4,1.2,wood,undefined,5);P.stick([o.x,o.y-1,9],[o.x+18,o.y-1,9],wood,1.2);}
    else if(o.kind==='fountain'){P.cylinder(o.x,o.y,24,0,3,P.col('#c4c4a8'));P.disc(o.x,o.y,18,18,3.4,P.col(day?'#81bbc1':'#749fa0'));P.cylinder(o.x,o.y,4,0,18,P.col('#b2bba7'));P.pole(o.x,o.y,18,32,P.col('#cee0d7'),2);}
    else if(o.kind==='bandstand'){P.cylinder(o.x,o.y,28,0,4,P.col('#bcb296'));for(const a of [0,Math.PI/2,Math.PI,Math.PI*1.5])P.pole(o.x+Math.cos(a)*20,o.y+Math.sin(a)*20,4,31,P.col('#c1b99e'),2);P.dome(o.x,o.y,31,31,P.col('#bd9090'),ROUND_SIDES,2);}
    else{P.box(o.x-7,o.y-7,14,14,11,P.col('#b6b6a0'));P.box(o.x-3,o.y-3,6,6,20,P.col('#c8c9ad'),undefined,11);}
  }
  function placeModel(B,G,o,day){
    const ident={W:0,D:0,at:(u,v,z)=>[u,v,z]},P=painter(B,G,ident,Z.base,c=>c),{x,y,activity}=o,wood=P.col(day?'#a98259':'#62796a'),metal=P.col(day?'#607f80':'#739793');
    P.quad(x-6,y-6,12,12,.2,activity==='training'?P.col(day?'#9caa81':'#526e55'):P.col(day?'#d4c5aa':'#798f81'));
    if(activity==='training'){for(const dx of [-4,4]){P.pole(x+dx,y-4,0,6,metal,.7);P.pole(x+dx,y+4,0,6,metal,.7);P.stick([x+dx,y-4,6],[x+dx,y+4,6],metal,.7);}}
    else if(activity==='filming'){P.box(x-1,y-1,2,2,5,P.col('#3d5260'));P.box(x-1.5,y-1.5,3,3,2,P.col('#36454d'),undefined,5);for(const dx of [-4,4]){P.pole(x+dx,y+3,0,9,metal,.6);P.box(x+dx-2,y+2,4,1.5,2,P.col('#e6d8b4'),undefined,8);}}
    else if(activity==='rehearsal'){P.box(x-4,y-4,8,8,.8,wood);for(const dx of [-3,3])P.box(x+dx,y-3,1,1,3,P.col('#3d5156'));}
    else P.box(x-1.5,y-1.5,3,3,2,wood,P.col(activity==='play'?'#d6c49f':'#d4c5aa'));
    for(let k=0;k<3;k++){const a=k*Math.PI*2/3+.2;P.box(x+Math.cos(a)*2.04-.7,y+Math.sin(a)*2.04-.7,1.4,1.4,1.2,wood);}
  }

  /**
   * Builds static geometry per chunk ('ground', 'services' and one per district) plus instance lists and pick boxes.
   * `matches(node)` dims what the filter or search hides; `triangulate(points)` returns triangle indices of a polygon.
   */
  function build(plan,{day=false,matches=()=>true,triangulate}){
    const chunks=new Map(),chunk=key=>{if(!chunks.has(key))chunks.set(key,{lit:new Buffer(),glow:new Buffer()});return chunks.get(key);},picks=[],trees=[],lamps=[];
    ground(chunk('ground').lit,plan,day,triangulate);const fields=[];const life={};landscape(chunk('landscape').lit,plan,day,triangulate,trees,fields,chunk('ground').lit,life);picks.push(...fields);const sources=new Map((plan.sources||[]).map(s=>[s.id,s]));
    for(const n of plan.nodes){const c=chunk('district:'+n.district),members=(n.members||[]).map(id=>sources.get(id)).filter(Boolean);
      const faded=!(matches(n)||members.some(matches))||n.available===false,top=building(c.lit,c.glow,n,day,faded,trees);
      if(n.available!==false)picks.push({node:n,cx:n.rcx??n.x+n.w/2,cy:n.rcy??n.y+n.d/2,w:n.w,d:n.d,h:Math.max(6,top),z:Z.base,rot:n.rot||0});}
    for(const o of plan.scenery){const c=chunk('services');
      if(o.kind==='tree')trees.push({x:o.x,y:o.y,size:o.size,conifer:o.seed%3===0});
      else if(o.kind==='lamp')lamps.push({x:o.x,y:o.y});
      else if(o.kind==='service'){const top=service(c.lit,c.glow,o,day,o.facility?!matches(o.facility):false,trees);if(o.facility)picks.push({node:{...o.facility,derived:true,physicalId:o.facility.id},cx:o.rcx??o.x+o.w/2,cy:o.rcy??o.y+o.d/2,w:o.w,d:o.d,h:Math.max(6,top),z:Z.base,rot:o.rot||0});}
      else if(o.kind==='compound')compound(c.lit,c.glow,o,day);
      else if(o.kind==='gallery')gallery(c.lit,c.glow,o,day);
      else if(o.kind==='place'){placeModel(c.lit,c.glow,o,day);if(o.facility)picks.push({node:{...o.facility,derived:true,physicalId:o.facility.id},cx:o.x,cy:o.y,w:12,d:12,h:6,z:Z.base,rot:0});}
      else furniture(c.lit,c.glow,o,day);}
    const out=new Map();for(const [key,c] of chunks)out.set(key,{lit:c.lit.arrays(),glow:c.glow.arrays()});
    life.centre={x:(plan.terrain.minX+plan.terrain.maxX)/2,y:(plan.terrain.minY+plan.terrain.maxY)/2};
    return {chunks:out,picks,trees,lamps,ground:Z.base,life};
  }
  const api={build,colour,Z,localFrame,doorSide};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CityMesh=api;
})(typeof window!=='undefined'?window:globalThis);
