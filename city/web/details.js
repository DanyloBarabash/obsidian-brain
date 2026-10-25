/* Stable, reusable canvas models for the living city. */
'use strict';
const CityDetails = (() => {
  const SKIN=['#edc6a5','#c98c64','#915d40','#623f32','#e1ac83','#b77b56'];
  const HAIR=['#302b29','#65402d','#b78243','#d3c5ae','#8d4930','#181f25'];
  const COATS=['#3f6979','#b8654b','#d9b35d','#638367','#8c668c','#bd8f85','#e4d4b5','#485775'];
  const TROUSERS=['#34444f','#645b50','#3c4e58','#77796c','#4c414b'];
  const AVATARS=48,PHASES=8,DIRECTIONS=4,CELL_W=28,CELL_H=36,SPRITE_RATIO=2,ORNAMENT_ZOOM=.3;
  const trees=new Map(),avatars=new Map();
  function surface(w,h){const c=document.createElement('canvas');c.width=w*SPRITE_RATIO;c.height=h*SPRITE_RATIO;const g=c.getContext('2d');g.scale(SPRITE_RATIO,SPRITE_RATIO);return [c,g];}
  function ellipse(g,x,y,rx,ry,color){g.fillStyle=color;g.beginPath();g.ellipse(x,y,rx,ry,0,0,Math.PI*2);g.fill();}
  function stroke(g,points,color,width){g.strokeStyle=color;g.lineWidth=width;g.lineCap='round';g.lineJoin='round';g.beginPath();points.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.stroke();}
  function avatar(seed,day){
    const id=seed%AVATARS,key=`${id}:${day}`;if(avatars.has(key))return avatars.get(key);
    const [sheet,g]=surface(CELL_W*PHASES,CELL_H*DIRECTIONS),skin=SKIN[id%SKIN.length],hair=HAIR[Math.floor(id/3)%HAIR.length],coat=COATS[Math.floor(id/2)%COATS.length],pants=TROUSERS[id%TROUSERS.length];
    for(let dir=0;dir<DIRECTIONS;dir++)for(let step=0;step<PHASES;step++){
      g.save();g.translate(step*CELL_W+14,dir*CELL_H+32);
      const swing=Math.sin(step/PHASES*Math.PI*2),bob=Math.abs(swing)*.45,side=dir===1||dir===3,back=dir===2,sign=dir===3?-1:1,stocky=id%5===0,short=id%7===0,head=short?-18:-21,shoulder=stocky?4:3.2;
      ellipse(g,1,0,6,2,'#10221d30');g.translate(0,-bob);
      if(side)g.scale(sign,1);
      const legTop=short?-8:-10,span=side?2.7:2;
      stroke(g,[[-1.8,legTop],[-1.5+swing*span,-5],[-1.5+swing*span,0]],pants,2.5);
      stroke(g,[[1.8,legTop],[1.5-swing*span,-5],[1.5-swing*span,0]],pants,2.5);
      stroke(g,[[-2+swing*span,0],[-.4+swing*span,0]],'#282f31',2.3);stroke(g,[[1-swing*span,0],[3-swing*span,0]],'#282f31',2.3);
      stroke(g,[[-shoulder,head+6],[-4.8,head+10],[-4.3-swing*1.4,head+14]],coat,2.6);
      ellipse(g,-4.3-swing*1.4,head+14,1.1,1.3,skin);
      g.fillStyle=coat;g.beginPath();g.moveTo(-shoulder,head+5);g.quadraticCurveTo(0,head+3.4,shoulder,head+5);g.lineTo(shoulder+.7,legTop+1);g.lineTo(-shoulder-.7,legTop+1);g.closePath();g.fill();
      if(id%4===0){g.fillStyle='#efe0bc';g.fillRect(-shoulder,head+9,shoulder*2,1);}
      if(!back){stroke(g,[[0,head+6],[0,legTop]],'#ffffff38',.6);for(let k=0;k<2;k++)ellipse(g,.8,head+9+k*3,.45,.45,'#e8d9b6');}
      if(id%6===0&&!back){g.fillStyle='#cc9f6b';g.fillRect(-1,head+5,2,7);}
      if(back&&id%3!==0){ellipse(g,0,head+11,3,4.5,'#b58559');stroke(g,[[-2,head+7],[-2,head+14],[2,head+14],[2,head+7]],'#725f49',.7);}
      else if(id%4===1){stroke(g,[[-3,head+6],[3,head+14]],'#cdbb98',.8);g.fillStyle='#8d6e50';g.fillRect(2,head+13,3,4);}
      stroke(g,[[shoulder,head+6],[4.6,head+10],[4.3+swing*1.4,head+14]],coat,2.5);ellipse(g,4.3+swing*1.4,head+14,1,1.3,skin);
      ellipse(g,0,head+2,1.4,2,skin);ellipse(g,0,head-1,3.1,3.6,skin);
      if(side)ellipse(g,2.7,head-.2,1.1,.9,skin);
      g.fillStyle=hair;g.beginPath();g.arc(0,head-1,3.3,Math.PI,Math.PI*2);g.lineTo(3.2,head-1);g.quadraticCurveTo(.5,head-3,-3.2,head+.2);g.fill();
      if(back){ellipse(g,0,head-1,3,3,hair);if(id%4===2)ellipse(g,1,head+2,2.2,2.6,hair);}
      else if(id%4===2){stroke(g,[[-2.8,head-1],[-3,head+4]],hair,1.7);}
      if(id%8===3){ellipse(g,0,head-3,3.8,1.8,'#738977');stroke(g,[[-3,head-2],[4.5,head-2]],'#526c60',1.2);}
      else if(id%8===7){ellipse(g,0,head-3,3.2,2,'#c78867');ellipse(g,0,head-5,1,1,'#ead7ad');}
      if(!back){const eyeX=side?2:1.25;ellipse(g,eyeX,head-.5,.45,.45,'#3a3532');if(!side)ellipse(g,-eyeX,head-.5,.45,.45,'#3a3532');if(id%5===0)stroke(g,[[-2.3,head-.5],[2.3,head-.5]],'#3c4948',.7);}
      if(!day){g.globalCompositeOperation='source-atop';g.fillStyle='#59739028';g.fillRect(-10,-30,20,32);}
      g.restore();
    }
    avatars.set(key,sheet);return sheet;
  }
  function treeSprite(seed,day){
    const variant=seed%24,key=`${variant}:${day}`;if(trees.has(key))return trees.get(key);
    const [c,g]=surface(96,120),conifer=seed%3===0,kind=Math.floor(variant/3)%4;
    const greens=day?['#49755a','#638751','#83a264','#a3b679']:['#29483d','#385c47','#4c7151','#6b8a62'];
    ellipse(g,53,108,34,10,'#112e282a');stroke(g,[[48,108],[47,58]],day?'#79674d':'#544e3e',4);
    for(let i=0;i<5;i++)stroke(g,[[42+i*3,109],[41+i*3,105-i%3]],day?'#7f9863':'#57724c',.8);
    stroke(g,[[49,106],[52,88]],day?'#b09a6d':'#7a7658',1);
    if(conifer){
      for(let tier=0;tier<5;tier++){
        const y=78-tier*12,r=32-tier*5;g.fillStyle=greens[tier%2];g.beginPath();g.moveTo(48,8+tier*10);g.lineTo(48+r,y);g.lineTo(49,y-3);g.lineTo(48-r,y+2);g.closePath();g.fill();
        g.fillStyle=greens[2];g.beginPath();g.moveTo(48,8+tier*10);g.lineTo(46,y-5);g.lineTo(48-r,y+2);g.closePath();g.fill();
        for(let j=0;j<4;j++)stroke(g,[[48-r+j*r*.5,y-2],[48-r+j*r*.5+3,y-4]],greens[3],.7);
      }
    }else{
      stroke(g,[[48,90],[28,53],[22,39]],day?'#887253':'#605842',2);stroke(g,[[47,76],[68,45],[72,32]],day?'#887253':'#605842',2);
      for(let i=0;i<22;i++){
        const angle=i*2.399,rad=6+Math.sqrt(i/22)*23,px=48+Math.cos(angle)*rad,py=44+Math.sin(angle)*rad*(kind===2?1.35:.9),r=11+(seed+i*17)%7;
        ellipse(g,px,py,r,kind===2?r*1.3:r*.9,greens[(i+1)%3]);ellipse(g,px-r*.3,py-r*.35,r*.55,r*.4,greens[3]);
      }
      for(let i=0;i<34;i++){const a=i*2.399,r=Math.sqrt(i/34)*29;ellipse(g,46+Math.cos(a)*r,41+Math.sin(a)*r,1.6,1,greens[(i+2)%4]);}
      if(kind===1)for(let i=0;i<6;i++)stroke(g,[[29+i*7,52],[27+i*7,72+(i%2)*7]],greens[1],1.7);
    }
    trees.set(key,c);return c;
  }
  function create(env){
    let {ctx}=env;const {project,box,quad,lineWorld,tint,state,hash}=env;
    function face(points,colour){ctx.beginPath();points.forEach((p,i)=>{const q=project(...p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);});ctx.closePath();ctx.fillStyle=colour;ctx.fill();}
    function gable(x,y,w,d,z,rise,colour){
      if(d>w){
        face([[x,y,z],[x,y+d,z],[x+w/2,y+d,z+rise],[x+w/2,y,z+rise]],tint(colour,1.2));
        face([[x+w/2,y,z+rise],[x+w/2,y+d,z+rise],[x+w,y+d,z],[x+w,y,z]],colour);
        face([[x,y+d,z],[x+w,y+d,z],[x+w/2,y+d,z+rise]],tint(colour,.7));
        return;
      }
      face([[x,y,z],[x+w,y,z],[x+w,y+d/2,z+rise],[x,y+d/2,z+rise]],tint(colour,1.2));
      face([[x,y+d/2,z+rise],[x+w,y+d/2,z+rise],[x+w,y+d,z],[x,y+d,z]],colour);
      face([[x+w,y,z],[x+w,y+d,z],[x+w,y+d/2,z+rise]],tint(colour,.7));
    }
    function spire(x,y,w,d,z,rise,colour){
      face([[x,y+d,z],[x+w,y+d,z],[x+w/2,y+d/2,z+rise]],colour);
      face([[x+w,y,z],[x+w,y+d,z],[x+w/2,y+d/2,z+rise]],tint(colour,.7));
      face([[x,y,z],[x+w,y,z],[x+w/2,y+d/2,z+rise]],tint(colour,1.2));
    }
    function windows(x,y,w,d,h,colour,step=12){
      if(state.zoom<.2)return;
      for(let z=8;z<h-3;z+=11)for(let u=3;u<w-3;u+=step){
        face([[x+u,y+d+.2,z],[x+u+3,y+d+.2,z],[x+u+3,y+d+.2,z+5],[x+u,y+d+.2,z+5]],colour);
        lineWorld([{x:x+u-.3,y:y+d+.3,z:z-.3},{x:x+u+3.3,y:y+d+.3,z:z-.3}],state.day?'#ddd4bc':'#9caaa1',Math.max(.5,state.zoom*.6));
      }
      for(let z=8;z<h-3;z+=11)for(let v=3;v<d-3;v+=step)face([[x+w+.2,y+v,z],[x+w+.2,y+v+3,z],[x+w+.2,y+v+3,z+5],[x+w+.2,y+v,z+5]],colour);
    }
    function panels(x,y,w,d,z){
      quad(x,y,w,d,z,state.day?'#275d7e':'#1e425b','#8daeb6');
      if(state.zoom>.24){for(let i=1;i<5;i++)lineWorld([{x:x+w*i/5,y,z:z+.1},{x:x+w*i/5,y:y+d,z:z+.1}],'#a4c7cc',Math.max(.4,state.zoom*.45));for(let i=1;i<4;i++)lineWorld([{x,y:y+d*i/4,z:z+.1},{x:x+w,y:y+d*i/4,z:z+.1}],'#a4c7cc',Math.max(.4,state.zoom*.45));}
    }
    function signatureBuilding(n){
      const {x,y,w,d,model}=n,stone=state.day?'#d8c5a4':'#a5a998',glass=state.day?'#4c7a85':'#e0c585';
      if(model==='grand-library'){
        const wall=state.day?'#d4c7ad':'#a4b09d',roof=state.day?'#477b76':'#315d5d',h=38;
        box(x,y,w,d,3,stone);box(x,y,w,d*.83,h,wall);windows(x,y,w,d*.83,h,glass,7);
        gable(x,y,w,d*.83,h,15,roof);
        box(x+w*.23,y+d*.22,w*.54,d*.4,9,'#85a7a8',undefined,h+5);gable(x+w*.23,y+d*.22,w*.54,d*.4,h+14,6,'#acc7bf');
        quad(x+w*.15,y+d*.75,w*.7,d*.25,2,stone);quad(x+w*.2,y+d*.8,w*.6,d*.2,4,stone);
        for(let i=0;i<4;i++){const xx=x+w*(.22+i*.185);box(xx,y+d*.87,w*.045,d*.065,23,stone,undefined,4);box(xx-w*.012,y+d*.86,w*.07,d*.08,2,wall,undefined,27);}
        box(x+w*.15,y+d*.76,w*.7,d*.24,3,stone,undefined,29);
        face([[x+w*.14,y+d,32],[x+w*.86,y+d,32],[x+w*.5,y+d,43]],wall);
        face([[x+w*.43,y+d*.84,4],[x+w*.57,y+d*.84,4],[x+w*.57,y+d*.84,19],[x+w*.5,y+d*.84,23],[x+w*.43,y+d*.84,19]],'#456767');
        for(const u of [.08,.92]){box(x+w*u-w*.025,y+d*.75,w*.05,d*.08,31,stone);gable(x+w*u-w*.04,y+d*.73,w*.08,d*.12,31,5,roof);}
        if(state.zoom>.3){const colours=['#9c6852','#c1a262','#658e8e','#8b6e8a'];
          for(let i=0;i<7;i++)box(x+w+.05,y+d*(.12+i*.085),.35,d*.055,4,colours[i%4],undefined,10);
          face([[x+w*.36,y+d+.15,35],[x+w*.5,y+d+.15,33.5],[x+w*.5,y+d+.15,39],[x+w*.36,y+d+.15,40]],'#f1dfaa');
          face([[x+w*.5,y+d+.15,33.5],[x+w*.64,y+d+.15,35],[x+w*.64,y+d+.15,40],[x+w*.5,y+d+.15,39]],'#d9bd79');
        }
        return true;
      }
      if(model==='town-hall'){
        const wall=state.day?'#d6c29d':'#a3aa9a',roof=state.day?'#577d78':'#3d6864',body=32,tower=n.h-31;
        box(x,y,w,d,body,wall);gable(x-.7,y-.7,w+1.4,d+1.4,body,17,roof);
        windows(x,y,w,d,body,glass,7);
        for(const u of [.07,.93])for(const v of [.1,.9]){box(x+w*u-1,y+d*v-1,2,2,body+10,stone);spire(x+w*u-2,y+d*v-2,4,4,body+10,12,roof);}
        const tx=x+w*.35,ty=y+d*.58,tw=w*.3,td=d*.34;
        box(tx,ty,tw,td,tower,wall);box(tx-1,ty-1,tw+2,td+2,3,stone,undefined,tower-2);spire(tx-1,ty-1,tw+2,td+2,tower+1,30,roof);
        for(let z=18;z<tower-19;z+=20){
          lineWorld([{x:tx,y:ty+td+.2,z},{x:tx+tw,y:ty+td+.2,z}],stone,Math.max(.6,state.zoom));
          lineWorld([{x:tx+tw+.2,y:ty,z},{x:tx+tw+.2,y:ty+td,z}],stone,Math.max(.6,state.zoom));
          for(const u of [.3,.65])face([[tx+tw*u,ty+td+.3,z+4],[tx+tw*(u+.12),ty+td+.3,z+4],[tx+tw*(u+.12),ty+td+.3,z+11],[tx+tw*(u+.06),ty+td+.3,z+13],[tx+tw*u,ty+td+.3,z+11]],'#526862');
        }
        const clock=project(tx+tw/2,ty+td+.3,tower-12),r=Math.min(tw*.36,4.2)*state.zoom;
        ellipse(ctx,clock.x,clock.y,r,r,'#f6e9c9');stroke(ctx,[[clock.x,clock.y-r*.65],[clock.x,clock.y],[clock.x+r*.55,clock.y+r*.15]],'#425d5a',Math.max(.6,state.zoom*.6));
        for(let u=2;u<w-2;u+=5){lineWorld([{x:x+u,y:y+d+.3,z:3},{x:x+u,y:y+d+.3,z:body-1}],stone,Math.max(.6,state.zoom));spire(x+u-.8,y+d-.3,1.6,1.6,body,5,stone);}
        face([[tx+tw*.25,ty+td+.5,0],[tx+tw*.75,ty+td+.5,0],[tx+tw*.75,ty+td+.5,13],[tx+tw*.5,ty+td+.5,17],[tx+tw*.25,ty+td+.5,13]],'#405955');
        lineWorld([{x:tx+tw/2,y:ty+td/2,z:n.h},{x:tx+tw/2,y:ty+td/2,z:n.h+11}],stone,Math.max(.6,state.zoom));
        face([[tx+tw/2,ty+td/2,n.h+11],[tx+tw/2+7,ty+td/2,n.h+9],[tx+tw/2,ty+td/2,n.h+6]],'#c99658');
        return true;
      }
      if(!['solar-lab','grid-control','battery-vault'].includes(model))return false;
      const h=model==='battery-vault'?26:32;
      quad(x,y,w,d,0,state.day?'#b7bca8':'#617766');
      if(model==='battery-vault'){
        for(let i=0;i<3;i++){const xx=x+w*(.04+i*.32);box(xx,y+d*.08,w*.25,d*.84,h,'#a0b6ad','#d4dcca');for(let j=0;j<3;j++)lineWorld([{x:xx+w*.25+.1,y:y+d*(.2+j*.24),z:5},{x:xx+w*.25+.1,y:y+d*(.2+j*.24),z:h-3}],'#567b79',Math.max(.6,state.zoom));}
      }else{
        box(x,y,w,d,h,model==='solar-lab'?'#c3c7a9':'#a5bdb4');windows(x,y,w,d,h,glass,8);
        if(model==='solar-lab')for(let i=0;i<3;i++)panels(x+w*(.05+i*.32),y+d*.08,w*.26,d*.82,h+1);
        else{box(x+w*.15,y+d*.15,w*.7,d*.35,9,'#d4dbcc',undefined,h);panels(x+w*.2,y+d*.2,w*.6,d*.25,h+10);for(let i=0;i<3;i++){box(x+w*(.18+i*.25),y+d*.7,w*.15,d*.15,5,'#768e88',undefined,h);lineWorld([{x:x+w*(.25+i*.25),y:y+d*.77,z:h+5},{x:x+w*(.25+i*.25),y:y+d*.77,z:h+12}],'#cfdbbf',Math.max(.7,state.zoom));}}
      }
      const sign=project(x+w*.5,y+d+.4,18),s=Math.max(2,w*.12)*state.zoom;
      ctx.fillStyle='#e1c05d';ctx.beginPath();ctx.moveTo(sign.x+s*.1,sign.y-s);ctx.lineTo(sign.x-s*.5,sign.y);ctx.lineTo(sign.x,sign.y);ctx.lineTo(sign.x-s*.1,sign.y+s);ctx.lineTo(sign.x+s*.5,sign.y-s*.2);ctx.lineTo(sign.x,sign.y-s*.2);ctx.closePath();ctx.fill();
      return true;
    }
    function signatureService(o){
      if(!['stadium','campus','solar-centre','swimming-pool','football-centre','velodrome','medical-centre','concert-hall'].includes(o.function))return false;
      const {x,y,w,d}=o,stone=state.day?'#d5ccba':'#9ba89a',glass=state.day?'#527e91':'#cbbd89';
      if(o.function==='swimming-pool'){
        quad(x,y,w,d,0,state.day?'#e2d9be':'#829b97');
        box(x+w*.06,y+d*.07,w*.88,d*.15,12,stone);windows(x+w*.06,y+d*.07,w*.88,d*.15,12,glass,8);
        box(x+w*.11,y+d*.3,w*.64,d*.58,1.8,'#cadbd4');quad(x+w*.13,y+d*.32,w*.6,d*.54,2,state.day?'#52bfd4':'#31859d');
        for(let i=1;i<7;i++){const yy=y+d*(.32+i*.54/7);lineWorld([{x:x+w*.13,y:yy,z:2.2},{x:x+w*.73,y:yy,z:2.2}],i%2?'#f8e3a4':'#426c9c',Math.max(.6,state.zoom));}
        for(let i=0;i<7;i++)box(x+w*.75,y+d*(.34+i*.075),w*.045,d*.04,3.5,'#f4eee1');
        for(let i=0;i<3;i++)box(x+w*.84,y+d*(.35+i*.16),w*.09,d*.11,2+i*.8,stone);
        lineWorld([{x:x+w*.18,y:y+d*.3,z:6},{x:x+w*.18,y:y+d*.89,z:6}],'#e7eee3',Math.max(.7,state.zoom));
        return true;
      }
      if(o.function==='football-centre'||o.function==='velodrome'){
        quad(x,y,w,d,0,state.day?'#adc39a':'#4b7254');
        if(o.function==='football-centre'){
          for(let i=0;i<10;i++)quad(x+w*(.08+i*.084),y+d*.12,w*.084,d*.76,.5,i%2?'#64995e':'#70a46b');
          const white=state.day?'#f5efda':'#c9d7be';quad(x+w*.08,y+d*.12,w*.84,d*.006,1,white);quad(x+w*.08,y+d*.88,w*.84,d*.006,1,white);quad(x+w*.5,y+d*.12,w*.004,d*.76,1,white);
          for(const end of [.08,.92])lineWorld([{x:x+w*end,y:y+d*.44,z:0},{x:x+w*end,y:y+d*.44,z:6},{x:x+w*end,y:y+d*.56,z:6},{x:x+w*end,y:y+d*.56,z:0}],white,Math.max(.6,state.zoom));
        }else{
          const ring=(rx,ry,z)=>Array.from({length:49},(_,i)=>[x+w/2+Math.cos(i*Math.PI/24)*w*rx,y+d/2+Math.sin(i*Math.PI/24)*d*ry,z]);
          face(ring(.47,.45,2),state.day?'#b8926c':'#9a886e');face(ring(.34,.29,2.2),state.day?'#82a477':'#4a765e');
          lineWorld(ring(.40,.37,2.5).map(([x,y,z])=>({x,y,z})),'#efe1be',Math.max(.6,state.zoom));
        }
        box(x+w*.12,y+d*.02,w*.76,d*.07,9,stone);return true;
      }
      if(o.function==='medical-centre'){
        quad(x,y,w,d,0,state.day?'#b2c6ae':'#5e7c72');
        for(const [u,v,ww,dd] of [[.08,.12,.28,.76],[.64,.12,.28,.76],[.36,.4,.28,.2]]){box(x+w*u,y+d*v,w*ww,d*dd,30,stone);windows(x+w*u,y+d*v,w*ww,d*dd,30,glass,7);}
        quad(x+w*.19,y+d*.32,w*.06,d*.3,31,'#bd6866');quad(x+w*.13,y+d*.42,w*.18,d*.09,31,'#bd6866');return true;
      }
      if(o.function==='concert-hall'){
        quad(x,y,w,d,0,stone);box(x+w*.12,y+d*.2,w*.76,d*.62,27,state.day?'#c29e82':'#9b8e87');
        gable(x+w*.12,y+d*.2,w*.76,d*.62,27,18,state.day?'#637e8a':'#526777');
        box(x+w*.18,y+d*.84,w*.64,d*.1,15,glass);for(let i=0;i<6;i++)box(x+w*(.19+i*.115),y+d*.94,w*.025,d*.04,15,stone);
        for(let i=0;i<3;i++)box(x+w*(.14-i*.025),y+d*(.95+i*.015),w*(.72+i*.05),d*.018,3-i*.8,stone);return true;
      }
      if(o.function==='stadium'){
        const swap=w<d,L=Math.max(w,d),W=Math.min(w,d),unit=L/165,pt=(u,v,z=0)=>swap?[x+v*unit,y+u*unit,z*unit]:[x+u*unit,y+v*unit,z*unit];
        const sheet=(u,v,ww,dd,z,colour)=>face([pt(u,v,z),pt(u+ww,v,z),pt(u+ww,v+dd,z),pt(u,v+dd,z)],colour);
        const path=(pts,colour,width=.6)=>lineWorld(pts.map(([u,v,z=0])=>{const p=pt(u,v,z);return {x:p[0],y:p[1],z:p[2]};}),colour,Math.max(.5,width*state.zoom*unit));
        const H=W/unit,ring=(inset,z)=>{const r=Math.max(4,20-inset*.25),points=[];for(const [cx,cy,start] of [[165-inset-r,H-inset-r,0],[inset+r,H-inset-r,Math.PI/2],[inset+r,inset+r,Math.PI],[165-inset-r,inset+r,Math.PI*1.5]])for(let i=0;i<=6;i++){const a=start+i*Math.PI/12;points.push(pt(cx+r*Math.cos(a),cy+r*Math.sin(a),z));}return points;};
        sheet(0,0,165,H,0,state.day?'#c5c3b2':'#6c7d72');
        const outer=ring(2,19),bottom=ring(2,2);
        for(let i=0;i<outer.length;i++){const j=(i+1)%outer.length;face([bottom[i],bottom[j],outer[j],outer[i]],tint(stone,.72+(i%4)*.055));}
        const centre=project(...pt(82.5,H/2)),back=[],front=[];
        for(let tier=0;tier<7;tier++){const a=ring(3+tier*1.8,19-tier*2),b=ring(4.8+tier*1.8,17-tier*2);for(let i=0;i<a.length;i++){const j=(i+1)%a.length,poly=[a[i],a[j],b[j],b[i]],p=project(...a[i]);(p.y<centre.y?back:front).push([poly,tier%2?(state.day?'#8d9da8':'#607482'):(state.day?'#c4b29e':'#8b9283')]);}}
        for(const [poly,c]of back)face(poly,c);
        const px=30,py=(H-68)/2;sheet(px-5,py-5,115,78,3,'#51865d');for(let i=0;i<10;i++)sheet(px+i*10.5,py,10.5,68,3.2,i%2?'#538958':'#669c64');
        const white=state.day?'#f3efdb':'#d4ddc7';
        path([[px,py,3.4],[px+105,py,3.4],[px+105,py+68,3.4],[px,py+68,3.4],[px,py,3.4]],white,.35);path([[82.5,py,3.5],[82.5,py+68,3.5]],white,.35);
        const circle=[];for(let i=0;i<=32;i++){const a=i/32*Math.PI*2;circle.push([82.5+Math.cos(a)*9.15,H/2+Math.sin(a)*9.15,3.5]);}path(circle,white,.35);
        for(const end of [0,1]){const gx=px+105*end,sign=end?-1:1;path([[gx,py+13.84,3.5],[gx+sign*16.5,py+13.84,3.5],[gx+sign*16.5,py+54.16,3.5],[gx,py+54.16,3.5]],white,.35);path([[gx,py+24.84,3.5],[gx+sign*5.5,py+24.84,3.5],[gx+sign*5.5,py+43.16,3.5],[gx,py+43.16,3.5]],white,.35);path([[gx,H/2-3.66,3.5],[gx,H/2-3.66,5.94],[gx,H/2+3.66,5.94],[gx,H/2+3.66,3.5]],white,.5);}
        for(const [poly,c]of front)face(poly,c);
        for(const side of [0,H-10]){sheet(24,side,117,9,22,state.day?'#e1e3d9':'#a3b6ae');for(let u=28;u<140;u+=16)path([[u,side+4,22],[u,side+4,28],[u+7,side+4,22]],'#8c9d98',.6);}
        for(const u of [15,150])for(const v of [15,H-15]){path([[u,v,3],[u,v,39]],'#8b9d96',.9);sheet(u-4,v-2,8,4,39,state.day?'#e9e4cc':'#ffe7af');}
        sheet(74,H-5,17,4,8,'#697d81');
      }else if(o.function==='campus'){
        const sx=w/115,sy=d/95,roof=state.day?'#64797b':'#405e63',wall=state.day?'#ccb899':'#9ba99b';
        quad(x,y,w,d,0,state.day?'#b2c095':'#566f52');quad(x+w*.24,y+d*.3,w*.5,d*.45,1,state.day?'#83a56f':'#416347');
        const wing=(u,v,ww,dd,h,colour)=>{const xx=x+u*sx,yy=y+v*sy;box(xx,yy,ww*sx,dd*sy,h,colour||wall);gable(xx,yy,ww*sx,dd*sy,h,8,roof);windows(xx,yy,ww*sx,dd*sy,h,glass,9);};
        wing(5,5,105,17,34);wing(5,22,18,65,29);wing(88,22,22,46,38);wing(71,73,39,17,27,'#b6c8bf');
        quad(x+w*.23,y+d*.47,w*.54,d*.035,2,state.day?'#dfd7bd':'#9da58b');quad(x+w*.445,y+d*.23,w*.03,d*.7,2,state.day?'#dfd7bd':'#9da58b');
        wing(32,76,16,14,22);wing(57,76,16,14,22);box(x+w*.42,y+d*.76,w*.16,d*.08,5,stone,undefined,19);
        for(let i=0;i<7;i++){const xx=x+(29+i*8)*sx;box(xx,y+22*sy,1.4*sx,2*sy,11,stone);lineWorld([{x:xx,y:y+24*sy,z:12},{x:xx+6*sx,y:y+24*sy,z:12}],stone,Math.max(.6,2*state.zoom));}
        box(x+95*sx,y+30*sy,10*sx,14*sy,12,'#a8c6c8',undefined,38);quad(x+96*sx,y+31*sy,8*sx,12*sy,51,'#628f9f');
        for(const [u,v]of [[31,34],[74,34],[31,64],[74,64]])tree(x+u*sx,y+v*sy,13,31+u);
        box(x+w*.47,y+d*.49,4*sx,4*sy,4,stone);spire(x+w*.48,y+d*.5,2*sx,2*sy,4,9,'#818f86');
      }else{
        quad(x,y,w,d,0,state.day?'#aaba95':'#526e55');
        for(let row=0;row<4;row++)for(let col=0;col<3;col++){const xx=x+w*(.04+col*.18),yy=y+d*(.06+row*.22);box(xx,yy,w*.15,d*.16,1.5,'#7e948b');panels(xx,yy,w*.15,d*.16,3);}
        for(let i=0;i<3;i++){box(x+w*.63,y+d*(.08+i*.23),w*.13,d*.16,15,'#b8cab9','#dce0ce');for(let k=0;k<3;k++)lineWorld([{x:x+w*.76,y:y+d*(.1+i*.23+k*.04),z:4},{x:x+w*.76,y:y+d*(.1+i*.23+k*.04),z:12}],'#6a8d84',Math.max(.6,state.zoom));}
        box(x+w*.81,y+d*.1,w*.15,d*.38,22,'#b8c8be');windows(x+w*.81,y+d*.1,w*.15,d*.38,22,glass,6);
        for(let i=0;i<3;i++){const yy=y+d*(.63+i*.12);box(x+w*.81,yy,w*.14,d*.07,8,'#839d96');lineWorld([{x:x+w*.83,y:yy,z:8},{x:x+w*.83,y:yy,z:17},{x:x+w*.92,y:yy,z:17},{x:x+w*.92,y:yy,z:8}],'#ccd4ba',Math.max(.7,state.zoom));}
        const tx=x+w*.57,ty=y+d*.86;box(tx-2,ty-2,4,4,63,'#b2c7bc');const hub=project(tx,ty,66);ellipse(ctx,hub.x,hub.y,2*state.zoom,2*state.zoom,'#dce4d8');for(let i=0;i<3;i++){const a=-Math.PI/2+i*Math.PI*2/3;face([[tx,ty,66],[tx+Math.cos(a)*20,ty,66+Math.sin(a)*20],[tx+Math.cos(a+.14)*16,ty,66+Math.sin(a+.14)*16]],'#e1e7db');}
      }
      return true;
    }
    function tree(x,y,size,seed){
      const p=project(x,y),s=size*state.zoom/42,image=treeSprite(seed,state.day);
      ctx.drawImage(image,p.x-48*s,p.y-108*s,96*s,120*s);
    }
    function person(n,x,y,direction,moving,activity){
      const seed=hash(n.appearance?.seedKey||n.stableId||n.id),p=project(x,y,17),s=state.zoom*.62;
      if(p.x< -20||p.x>innerWidth+20||p.y< -35||p.y>innerHeight+35)return null;
      if(state.zoom<.18){ellipse(ctx,p.x,p.y-2,Math.max(1,state.zoom*3),Math.max(1.5,state.zoom*6),COATS[seed%COATS.length]);}
      else{
        const sheet=avatar(seed,state.day),phase=moving&&!state.paused&&!state.reduced?Math.floor(state.time*9+seed%PHASES)%PHASES:0;
        const dir=Math.abs(direction.x)>Math.abs(direction.y)?(direction.x>=0?1:3):(direction.y>=0?0:2);
        ctx.drawImage(sheet,phase*CELL_W*SPRITE_RATIO,dir*CELL_H*SPRITE_RATIO,CELL_W*SPRITE_RATIO,CELL_H*SPRITE_RATIO,p.x-14*s,p.y-32*s,CELL_W*s,CELL_H*s);
      }
      if(activity&&!moving&&state.zoom>.55){
        const xx=p.x+3*s,yy=p.y-13*s;
        if(activity==='reading'){ctx.fillStyle=state.day?'#f2dfb6':'#c6cfb4';ctx.fillRect(xx-5*s,yy,10*s,6*s);stroke(ctx,[[xx,yy],[xx,yy+6*s]],'#776659',Math.max(.5,s));}
        else if(activity==='training'){ellipse(ctx,p.x+5*s,p.y-2*s,3*s,3*s,'#ddd6ae');stroke(ctx,[[p.x+3*s,p.y-3*s],[p.x+7*s,p.y-1*s]],'#48696b',s);}
        else if(['experiment','maintenance','filming'].includes(activity)){ctx.fillStyle=activity==='filming'?'#344957':'#779faf';ctx.fillRect(xx-3*s,yy,7*s,5*s);ctx.fillStyle='#d8e7d9';ctx.fillRect(xx-1*s,yy+s,3*s,2*s);}
      }
      return {node:n,x:p.x,y:p.y-8*state.zoom,rx:Math.max(4,5*state.zoom),ry:Math.max(7,12*state.zoom),person:true};
    }
    function facade(n,h){
      const {x,y,w,d}=n,seed=n.seed||hash(n.id),detail=state.zoom>.4,close=state.zoom>.8,stone=state.day?'#e6d9bd':'#a4a797',trim=state.day?'#ecdfc5':'#a5b2a4';
      box(x,y,w,d,3,tint(n.color,.67));
      lineWorld([{x,y:y+d+.5,z:h-3},{x:x+w,y:y+d+.5,z:h-3}],trim,Math.max(.6,1.4*state.zoom));
      lineWorld([{x:x+w+.5,y,z:h-3},{x:x+w+.5,y:y+d,z:h-3}],tint(trim,.8),Math.max(.6,1.2*state.zoom));
      if(!detail)return;
      const floors=Math.max(1,Math.floor((h-12)/13)),cols=Math.max(2,Math.floor(w/11)),rows=Math.max(1,Math.floor(d/11));
      for(const side of [0,1]){
        const count=side?rows:cols,length=side?d:w;
        for(let floor=0;floor<floors;floor++)for(let c=0;c<count;c++){
          if(n.model==='college'&&!side&&c>0&&c<count-1)continue;
          const a=4+c*(length-5)/count,ww=Math.min(4.2,(length-5)/count*.52),z=8+floor*13,lit=n.available!==false&&((seed+floor*11+c*7+side)%5)>1,glass=lit?(state.day?'#4f7f88':'#e7c98c'):(state.day?'#869d99':'#405960');
          const pt=(u,v)=>side?{x:x+w+.7,y:y+u,z:v}:{x:x+u,y:y+d+.7,z:v};
          const points=[pt(a,z),pt(a+ww,z),pt(a+ww,z+6),pt(a,z+6)].map(p=>project(p.x,p.y,p.z));
          ctx.fillStyle=glass;ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fill();ctx.strokeStyle=trim;ctx.lineWidth=Math.max(.5,state.zoom*.55);ctx.stroke();
          lineWorld([pt(a-.5,z-.5),pt(a+ww+.5,z-.5)],stone,Math.max(.6,state.zoom));
          if(close){lineWorld([pt(a+ww/2,z),pt(a+ww/2,z+6)],trim,.65*state.zoom);lineWorld([pt(a,z+3.7),pt(a+ww,z+3.7)],trim,.55*state.zoom);}
        }
      }
      if(n.model!=='college'){
        for(const f of [1,Math.max(1,floors-1)]){const z=7+f*13;if(z<h-5)lineWorld([{x,y:y+d+.8,z},{x:x+w,y:y+d+.8,z}],tint(n.color,1.13),Math.max(.6,state.zoom));}
      }
      const dx=x+w*.45,dw=w*.16;
      box(dx-1,y+d+.8,dw+2,2,2,stone);box(dx-2,y+d+2,dw+4,2,1,stone);
      lineWorld([{x:dx,y:y+d+1,z:1},{x:dx,y:y+d+1,z:14},{x:dx+dw,y:y+d+1,z:14},{x:dx+dw,y:y+d+1,z:1}],trim,Math.max(.7,state.zoom));
      lineWorld([{x:dx+dw*.75,y:y+d+1.2,z:6},{x:dx+dw*.75,y:y+d+1.2,z:8}],state.day?'#c7a465':'#dfc48c',Math.max(.7,state.zoom));
      if(w>22&&n.model!=='college'){
        box(x+w*.12,y+d+1,Math.min(8,w*.23),2.4,2.6,'#9b7860',undefined,5);
        for(let k=0;k<3;k++){const p=project(x+w*.14+k*2,y+d+2,9);ellipse(ctx,p.x,p.y,1.5*state.zoom,state.zoom,k%2?'#c7b078':'#8caa68');}
      }
      if(close){
        lineWorld([{x:x+w-.8,y:y+d+.8,z:2},{x:x+w-.8,y:y+d+.8,z:h-2}],tint(n.roof||n.color,.72),1.1*state.zoom);
        if(['manor','town-hall','registry','council','project-council'].includes(n.model))for(const xx of [x+1,x+w-2])box(xx,y+d+.3,1.8,1.5,h-4,stone);
        if(['apartment-tower','laboratory','data-tower','research-institute'].includes(n.model)){
          box(x+w*.13,y+d*.15,w*.25,d*.22,4,'#a3aea7',undefined,h+1);
          for(let k=0;k<3;k++)lineWorld([{x:x+w*.16,y:y+d*(.18+k*.05),z:h+5.2},{x:x+w*.35,y:y+d*(.18+k*.05),z:h+5.2}],'#687c79',.6*state.zoom);
        }
      }
      if(state.zoom>.6&&['cottage','timber-house','townhouse','merchant-house','clock-house','atelier','maker-house','manor'].includes(n.model)){
        const roof=n.roof||'#917d69';
        for(let row=1;row<5;row++){const yy=y+d/2+(d/2+3)*row/5,zz=h+20*(1-row/5);lineWorld([{x:x-2,y:yy,z:zz+.2},{x:x+w+2,y:yy,z:zz+.2}],tint(roof,.82),.65*state.zoom);}
        lineWorld([{x:x-3,y:y+d/2,z:h+20},{x:x+w+3,y:y+d/2,z:h+20}],tint(roof,1.4),1.5*state.zoom);
        if(w>22){const xx=x+w*.28,yy=y+d*.76,zz=h+10;box(xx,yy,5,4,6,stone,undefined,zz);quad(xx+.7,yy+.3,3.6,3.5,zz+6.3,tint(roof,.8));lineWorld([{x:xx+1,y:yy+4.2,z:zz+1},{x:xx+4,y:yy+4.2,z:zz+1}],state.day?'#60818a':'#e6c68d',2*state.zoom);}
      }
      if(n.model==='apartment-tower')for(let floor=1;floor<6;floor++){
        const z=floor*h/6+5;for(let i=0;i<=Math.max(2,Math.floor(w/4));i++){const xx=x+w*i/Math.max(2,Math.floor(w/4));lineWorld([{x:xx,y:y+d+.5,z:z-4},{x:xx,y:y+d+.5,z}],tint(trim,.84),Math.max(.5,.55*state.zoom));}
      }
      if(['town-hall','district-hall','clock-house'].includes(n.model)){
        const z=h+(n.model==='clock-house'?23:20),p=project(x+w*.5,y+d*.7,z),r=4.1*state.zoom;
        ellipse(ctx,p.x,p.y,r,r,state.day?'#f7eed4':'#eddaa6');
        stroke(ctx,[[p.x,p.y-r*.65],[p.x,p.y],[p.x+r*.5,p.y+r*.2]],'#52655f',Math.max(.65,state.zoom*.7));
        if(close)for(let i=0;i<4;i++){const a=i*Math.PI/2;ellipse(ctx,p.x+Math.cos(a)*r*.8,p.y+Math.sin(a)*r*.8,.4*state.zoom,.4*state.zoom,'#728275');}
      }
    }
    function service(o){
      if(state.zoom<.35)return;
      const {x,y,w,d}=o,ink=state.day?'#f0e9ce':'#d4dbbe',glass=state.day?'#5c909d':'#cdbb86';
      if(o.function==='stadium'){
        for(let k=0;k<6;k++)quad(x+w*.19,y+d*(.19+k*.62/6),w*.62,d*.62/6,7.2,k%2?'#5a9c6c':'#68a374');
        const field=[{x:x+w*.19,y:y+d*.19,z:7.5},{x:x+w*.81,y:y+d*.19,z:7.5},{x:x+w*.81,y:y+d*.81,z:7.5},{x:x+w*.19,y:y+d*.81,z:7.5}];lineWorld([...field,field[0]],ink,.75*state.zoom);
        const ring=[];for(let i=0;i<=24;i++){const a=i/24*Math.PI*2;ring.push({x:x+w*.5+Math.cos(a)*w*.09,y:y+d*.5+Math.sin(a)*d*.09,z:7.6});}lineWorld(ring,ink,.7*state.zoom);
        lineWorld([{x:x+w*.5,y:y+d*.19,z:7.7},{x:x+w*.5,y:y+d*.81,z:7.7}],ink,.7*state.zoom);
        for(const side of [.19,.81]){
          lineWorld([{x:x+w*side,y:y+d*.4,z:7.7},{x:x+w*side,y:y+d*.4,z:12},{x:x+w*side,y:y+d*.6,z:12},{x:x+w*side,y:y+d*.6,z:7.7}],ink,Math.max(.6,state.zoom));
          for(let k=0;k<3;k++)lineWorld([{x:x+w*.04,y:y+d*(.025+k*.035+(side===.81?.87:0)),z:13.5},{x:x+w*.96,y:y+d*(.025+k*.035+(side===.81?.87:0)),z:13.5}],k%2?'#b08e7d':'#d4b798',1.4*state.zoom);
        }
        for(const xx of [.07,.93])for(const yy of [.16,.84]){lineWorld([{x:x+w*xx,y:y+d*yy,z:4},{x:x+w*xx,y:y+d*yy,z:27}],'#8d9c94',Math.max(.7,state.zoom));box(x+w*xx-2,y+d*yy-1,4,2,3,ink,undefined,27);}
      }else if(o.function==='campus'){
        for(const side of [0,.76])for(let row=0;row<2;row++)for(let col=0;col<3;col++){
          const xx=x+w*(side+.035),yy=y+d*(.16+col*.26),zz=7+row*9;
          lineWorld([{x:xx+w*.2,y:yy,z:zz},{x:xx+w*.2,y:yy+d*.12,z:zz}],glass,3*state.zoom);
        }
        for(let k=0;k<4;k++)lineWorld([{x:x+w*(.31+k*.1),y:y+d*.3,z:10},{x:x+w*(.31+k*.1),y:y+d*.3,z:19}],glass,2*state.zoom);
        box(x+w*.46,y+d*.27,w*.08,d*.08,4,'#d7c8ab');
        lineWorld([{x:x+w*.5,y:y+d*.36,z:2},{x:x+w*.5,y:y+d*.91,z:2}],'#d6ceb4',3*state.zoom);
      }else if(o.function==='solar-centre'){
        for(let i=0;i<3;i++)for(let k=1;k<5;k++){
          lineWorld([{x:x+w*(.08+i*.3),y:y+d*(.12+k*.15),z:14.3},{x:x+w*(.33+i*.3),y:y+d*(.12+k*.15),z:14.3}],'#a2c0c9',.6*state.zoom);
          lineWorld([{x:x+w*(.08+i*.3+.125),y:y+d*.12,z:14.3},{x:x+w*(.08+i*.3+.125),y:y+d*.87,z:14.3}],'#a2c0c9',.6*state.zoom);
        }
      }else{
        const h=o.function==='arts-centre'?16:o.function==='innovation-centre'||o.function==='media-centre'?22:o.h;
        for(let k=0;k<Math.max(2,Math.floor(w/6));k++){const xx=x+3+k*6;lineWorld([{x:xx,y:y+d+.5,z:5},{x:xx,y:y+d+.5,z:Math.max(8,h-4)}],glass,Math.max(1,2*state.zoom));}
        if(o.function==='media-centre'){const p=project(x+w*.5,y+d*.5,35);ellipse(ctx,p.x,p.y,3.5*state.zoom,2.4*state.zoom,'#d7d5d1');lineWorld([{x:x+w*.5,y:y+d*.5,z:35},{x:x+w*.5+3,y:y+d*.5,z:39}],'#899891',.7*state.zoom);}
        if(o.function==='arts-centre'){box(x+w*.15,y+d+.3,w*.7,2,10,'#835669');for(let k=0;k<5;k++)lineWorld([{x:x+w*(.18+k*.14),y:y+d+1,z:3},{x:x+w*(.18+k*.14),y:y+d+1,z:12}],'#b37687',1.4*state.zoom);}
        if(o.function==='market'){quad(x-1,y+d,w+2,4,h*.65,'#d2af68');for(let k=0;k<5;k++)quad(x+k*w/5,y+d,w/10,4,h*.65+.1,'#f3e6c3');}
      }
    }
    function furniture(o){
      const {x,y}=o;
      if(o.kind==='bench'){
        for(const xx of [x+2,x+16]){box(xx,y,1.5,6,5,'#526058');lineWorld([{x:xx,y,z:2},{x:xx,y:y-1,z:10}],'#526058',Math.max(.6,state.zoom));}
        for(let k=0;k<3;k++)box(x,y+k*2,18,1.4,1.2,k%2?'#b69b73':'#997b58',undefined,5);
        for(let k=0;k<2;k++)lineWorld([{x,y:y-1,z:8+k*2},{x:x+18,y:y-1,z:8+k*2}],'#b69b73',Math.max(.6,1.4*state.zoom));
      }else if(o.kind==='lamp'){
        // From afar a lamp is a pole and its light; the base and lantern boxes appear when zoomed in.
        if(state.zoom>=ORNAMENT_ZOOM)box(x-1.6,y-1.6,3.2,3.2,2,'#56665d');lineWorld([{x,y},{x,y,z:30}],'#64756a',Math.max(.7,1.3*state.zoom));
        if(state.zoom>=ORNAMENT_ZOOM){box(x-2,y-2,4,4,5,state.day?'#ebddad':'#f7dda1',undefined,28);quad(x-3,y-3,6,6,34,'#546b60');}
        if(!state.day){const p=project(x,y,30),radius=18*state.zoom,g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,radius);g.addColorStop(0,'#fbe2a250');g.addColorStop(1,'#fbe2a200');ctx.fillStyle=g;ctx.fillRect(p.x-radius,p.y-radius,radius*2,radius*2);}
      }
    }
    // The renderer draws the static city into an offscreen layer and switches the target context.
    function setContext(next){ctx=next;}
    function place(o){
      const {x,y,activity}=o,stone=state.day?'#d4c5aa':'#798f81',wood=state.day?'#a98259':'#62796a',metal=state.day?'#607f80':'#739793';
      quad(x-6,y-6,12,12,.2,activity==='training'?(state.day?'#9caa81':'#526e55'):stone);
      if(activity==='training'){
        for(const yy of [-4,4])lineWorld([{x:x-5,y:y+yy,z:1},{x:x+5,y:y+yy,z:1}],'#e4dfbf',Math.max(.5,state.zoom));
        for(const xx of [-4,4]){box(x+xx,y-4,.7,.7,6,metal);box(x+xx,y+3,.7,.7,6,metal);lineWorld([{x:x+xx,y:y-4,z:6},{x:x+xx,y:y+4,z:6}],metal,Math.max(1,state.zoom));}
      }else if(activity==='filming'){
        box(x-1,y-1,2,2,5,'#3d5260');box(x-1.5,y-1.5,3,3,2,'#36454d',undefined,5);
        for(const dx of [-4,4]){lineWorld([{x:x+dx,y:y+3,z:0},{x:x+dx,y:y+3,z:9}],metal,Math.max(.6,state.zoom));box(x+dx-2,y+2,4,1.5,2,'#e6d8b4',undefined,8);}
      }else if(activity==='maintenance'||activity==='experiment'){
        box(x-1.5,y-1.5,3,3,3,metal);quad(x-1.4,y-1.4,2.8,2.8,3.2,activity==='maintenance'?'#447f9e':'#b3cbd0');
        if(activity==='maintenance'){for(let i=0;i<3;i++)lineWorld([{x:x-1+i,y:y-1,z:3.3},{x:x-1+i,y:y+1,z:3.3}],'#a7c6cd',Math.max(.4,state.zoom*.5));box(x+3,y-4,1.8,2,4,'#b4c7ad');}
        else{box(x-.5,y-.5,1,1,2,'#8b9f94',undefined,3);lineWorld([{x,y,z:5},{x:x+1,y:y-1,z:8}],'#d8dbc2',Math.max(.7,state.zoom));}
      }else if(activity==='rehearsal'){
        box(x-4,y-4,8,8,.8,wood);for(const dx of [-3,3])box(x+dx,y-3,1,1,3,'#3d5156');lineWorld([{x,y:y-1,z:1},{x,y:y-1,z:6}],metal,Math.max(.7,state.zoom));
      }else{
        box(x-1.5,y-1.5,3,3,2,wood);quad(x-1.8,y-1.8,3.6,3.6,2.3,activity==='play'?'#d6c49f':stone);
        if(activity==='play'){for(let i=0;i<4;i++)for(let j=0;j<4;j++)quad(x-1.4+i*.7,y-1.4+j*.7,.7,.7,2.4,(i+j)%2?'#6b7d70':'#e8ddbc');}
        if(activity==='reading'){box(x+3,y-4,2.5,1.5,4,wood);for(let i=0;i<3;i++)quad(x+3.2,y-3.8,2.1,1.1,1+i,'#d4cfac');}
      }
      // Seats surround the table; their centres agree with the three physical pedestrian nodes.
      for(let k=0;k<3;k++){const a=k*Math.PI*2/3+.2,sx=x+Math.cos(a)*2.04,sy=y+Math.sin(a)*2.04;box(sx-.7,sy-.7,1.4,1.4,1.2,wood);}
    }
    return {tree,person,facade,furniture,service,place,signatureBuilding,signatureService,setContext};
  }
  return {create};
})();
