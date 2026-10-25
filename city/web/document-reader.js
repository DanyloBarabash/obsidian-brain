/* The city's reading room: local Markdown, illustrations and diagrams. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id),escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const parser=new marked.Marked({gfm:true,breaks:false});
  parser.use({extensions:[{name:'wikilink',level:'inline',start:s=>s.search(/!?\[\[/),tokenizer(s){
    const m=/^(!?)\[\[([^\]\n]+)\]\]/.exec(s);if(m)return {type:'wikilink',raw:m[0],embed:!!m[1],value:m[2]};
  },renderer(t){const [target,...alias]=t.value.split('|'),label=alias.join('|')||target.split('/').pop();
    return t.embed?`<img src="${escape(target)}" alt="${escape(label)}">`:`<a href="${escape(target)}" data-wiki="true">${escape(label)}</a>`;
  }}]});
  let options={nodes:()=>[]},current=null,raw='',request=0,history=[],returnFocus=null,imageFocus=null,mermaidPromise=null,diagramId=0;
  const clean=s=>s.replace(/^\uFEFF/,'').replace(/^---\s*\n[\s\S]*?\n---(?:\s*\n|$)/,'').trim();
  function normalize(s){const parts=[];for(const p of s.split('/')){if(p==='..')parts.pop();else if(p&&p!=='.')parts.push(p);}return parts.join('/');}
  function resolve(target,node){
    let path;try{path=decodeURIComponent(target.split('#')[0]);}catch{return null;}
    if(!path)return node;
    const nodes=options.nodes().filter(n=>n.available!==false),relative=normalize((node.id.includes('/')?node.id.slice(0,node.id.lastIndexOf('/')+1):'')+path);
    for(const id of [relative,path.replace(/^\//,'')]){const found=nodes.find(n=>n.id===id||n.id===id+'.md');if(found)return found;}
    const needle=path.replace(/\.md$/i,'').toLocaleLowerCase(),matches=nodes.filter(n=>n.id.replace(/\.md$/i,'').split('/').pop().toLocaleLowerCase()===needle||n.title.toLocaleLowerCase()===needle);
    return matches.length===1?matches[0]:null;
  }
  function jump(anchor){
    let label;try{label=decodeURIComponent(anchor.replace(/^#/,''));}catch{return;}
    const heading=[...$('reader-body').querySelectorAll('h1,h2,h3,h4,h5,h6')].find(h=>h.id===label||h.textContent.toLocaleLowerCase()===label.toLocaleLowerCase()||h.textContent.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'')===label.toLocaleLowerCase());
    heading?.scrollIntoView({block:'start'});
  }
  function imageSource(value,node){
    if(!value)return null;
    if(/^https:\/\//i.test(value))return value;
    if(/^data:image\/(png|jpeg|gif|webp);base64,/i.test(value))return value;
    if(/^[a-z][a-z\d+.-]*:/i.test(value)||value.startsWith('//'))return null;
    let path;try{path=decodeURIComponent(value);}catch{return null;}
    return `/api/asset?path=${encodeURIComponent(path.replace(/^\//,''))}&note=${encodeURIComponent(node.id)}`;
  }
  function render(container,text,node,{compact=false}={}){
    const template=document.createElement('template');
    template.innerHTML=DOMPurify.sanitize(parser.parse(clean(text)),{USE_PROFILES:{html:true},FORBID_TAGS:['style','form','button'],FORBID_ATTR:['id','name'],ADD_ATTR:['data-wiki']});
    const content=template.content;
    for(const input of content.querySelectorAll('input')){if(input.type!=='checkbox')input.remove();else{input.disabled=true;input.removeAttribute('name');}}
    for(const a of content.querySelectorAll('a')){
      const href=a.getAttribute('href')||'';
      if(/^https?:\/\//i.test(href)||/^mailto:/i.test(href)){a.target='_blank';a.rel='noopener noreferrer';}
      else if(/^[a-z][a-z\d+.-]*:/i.test(href)||href.startsWith('//')){a.removeAttribute('href');}
      else{a.href='#';a.onclick=e=>{e.preventDefault();const target=resolve(href,node);if(target)open(target,{anchor:href.includes('#')?href.slice(href.indexOf('#')):'',push:true});else message('Це посилання не має однозначного документа у Brain.');};}
    }
    for(const img of content.querySelectorAll('img')){
      const src=imageSource(img.getAttribute('src')||'',node),alt=img.alt||'Ілюстрація';
      img.removeAttribute('srcset');img.removeAttribute('style');img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';
      if(!src){img.replaceWith(document.createTextNode(`[${alt}: формат зображення недоступний]`));continue;}
      img.src=src;
      const figure=document.createElement('figure'),button=document.createElement('button');button.type='button';button.className='reader-figure';button.setAttribute('aria-label','Збільшити ілюстрацію: '+alt);
      img.replaceWith(figure);button.append(img);figure.append(button);button.onclick=()=>{if(compact)open(node);else zoomImage(img);};
      img.onerror=()=>{const p=document.createElement('span');p.className='reader-image-error';p.textContent='Не вдалося завантажити: '+alt;button.replaceWith(p);};
      if(img.alt){const caption=document.createElement('figcaption');caption.textContent=img.alt;figure.append(caption);}
    }
    for(const table of content.querySelectorAll('table')){const wrap=document.createElement('div');wrap.className='reader-table';wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','Таблиця — прокручується горизонтально');table.replaceWith(wrap);wrap.append(table);}
    for(const quote of content.querySelectorAll('blockquote')){
      const first=quote.querySelector('p'),m=first&&/^\[!(\w+)\]([+-])?\s*(.*)/.exec(first.textContent);
      if(!m)continue;quote.classList.add('reader-callout');quote.dataset.type=m[1].toLowerCase();
      const labels={note:'✧ Нотатка',tip:'✦ Підказка',info:'◈ До відома',warning:'△ Зверни увагу',important:'◆ Важливо',success:'✓ Готово',quote:'❝ Цитата',question:'? Питання'};
      const title=document.createElement('strong');title.className='reader-callout-title';title.textContent=m[3]||labels[quote.dataset.type]||m[1];
      const firstText=first.firstChild;if(firstText?.nodeType===3)firstText.textContent=firstText.textContent.replace(/^\[!\w+\][+-]?[^\n]*/,'');
      quote.prepend(title);
    }
    for(const pre of content.querySelectorAll('pre')){
      const code=pre.querySelector('code');if(!code)continue;
      if(code.classList.contains('language-mermaid')&&!compact){const figure=document.createElement('figure');figure.className='reader-diagram';figure.dataset.source=code.textContent;figure.textContent='Малюємо схему…';pre.replaceWith(figure);continue;}
      if(compact)continue;
      const frame=document.createElement('div');frame.className='reader-code';const bar=document.createElement('div');bar.className='reader-code-bar';
      const lang=document.createElement('span');lang.textContent=code.className.replace('language-','')||'Текст';const copy=document.createElement('button');copy.textContent='Копіювати';copy.type='button';
      copy.onclick=async()=>{try{await navigator.clipboard.writeText(code.textContent);copy.textContent='Скопійовано ✓';}catch{copy.textContent='Виділи код для копіювання';}};
      bar.append(lang,copy);pre.replaceWith(frame);frame.append(bar,pre);
    }
    container.replaceChildren(content);
    if(!compact){const first=container.firstElementChild;if(first?.tagName==='H1'&&first.textContent.trim()===node.title.trim())first.remove();drawDiagrams(container);}
  }
  function loadMermaid(){
    if(!mermaidPromise)mermaidPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/vendor/mermaid.min.js';script.onload=()=>resolve(window.mermaid);script.onerror=()=>{mermaidPromise=null;reject(Error('diagram library unavailable'));};document.head.append(script);});
    return mermaidPromise;
  }
  async function drawDiagrams(container){
    const diagrams=[...container.querySelectorAll('.reader-diagram')];if(!diagrams.length)return;
    let mermaid;try{mermaid=await loadMermaid();}catch{for(const f of diagrams)diagramFallback(f);return;}
    const day=document.body.classList.contains('day');
    mermaid.initialize({startOnLoad:false,securityLevel:'strict',suppressErrorRendering:true,maxTextSize:50000,maxEdges:500,theme:day?'neutral':'dark',look:'classic',htmlLabels:false,flowchart:{htmlLabels:false},fontFamily:'-apple-system, sans-serif'});
    for(const figure of diagrams){
      if(!figure.isConnected)continue;
      try{const {svg}=await mermaid.render('reader-diagram-'+(++diagramId),figure.dataset.source);
        if(!figure.isConnected)continue;
        figure.innerHTML=DOMPurify.sanitize(svg,{USE_PROFILES:{svg:true,svgFilters:true},FORBID_TAGS:['foreignObject','a','image','use']});
        const button=document.createElement('button');button.className='reader-diagram-zoom';button.textContent='⤢ Збільшити схему';button.onclick=()=>zoomDiagram(figure);figure.append(button);
      }catch{diagramFallback(figure);}
    }
  }
  function diagramFallback(figure){const pre=document.createElement('pre');pre.textContent=figure.dataset.source;const label=document.createElement('figcaption');label.textContent='Не вдалося намалювати схему — показуємо її текст.';figure.replaceChildren(pre,label);}
  function showImage(element){imageFocus=document.activeElement;$('reader-image').replaceChildren(element);$('reader-lightbox').hidden=false;document.querySelector('.reader-layout').inert=true;document.querySelector('.reader-toolbar').inert=true;$('reader-image-close').focus();}
  function closeImage(){$('reader-lightbox').hidden=true;document.querySelector('.reader-layout').inert=false;document.querySelector('.reader-toolbar').inert=false;imageFocus?.focus();}
  function zoomImage(img){showImage(img.cloneNode());}
  function zoomDiagram(figure){const svg=figure.querySelector('svg');if(svg)showImage(svg.cloneNode(true));}
  function message(text){$('reader-status').textContent=text;}
  function outline(){
    const toc=$('reader-toc');toc.replaceChildren();const headings=[...$('reader-body').querySelectorAll('h1,h2,h3')];
    for(const [i,h] of headings.entries()){h.id='reader-section-'+i;const b=document.createElement('button');b.className='reader-toc-item level-'+h.tagName.slice(1);b.textContent=h.textContent;b.onclick=()=>h.scrollIntoView({block:'start'});toc.append(b);}
    if(!headings.length)toc.textContent='Документ без розділів';
  }
  function progress(){const scroller=$('reader-scroll'),max=scroller.scrollHeight-scroller.clientHeight;$('reader-progress-bar').style.width=(max>0?Math.min(100,scroller.scrollTop/max*100):100)+'%';
    const headings=[...$('reader-body').querySelectorAll('h1,h2,h3')],buttons=[...$('reader-toc').querySelectorAll('button')];let active=0;
    headings.forEach((h,i)=>{if(h.getBoundingClientRect().top<scroller.getBoundingClientRect().top+150)active=i;});buttons.forEach((b,i)=>{b.classList.toggle('active',i===active);if(i===active)b.setAttribute('aria-current','location');else b.removeAttribute('aria-current');});
  }
  async function open(node,{anchor='',push=true}={}){
    const dialog=$('document-reader');
    if(node.available===false||node.derived)return;
    if(current?.id===node.id&&dialog.open){if($('reader-raw').hidden===false)toggleSource();if(anchor)jump(anchor);return;}
    if(push&&current&&dialog.open)history.push({node:current,scroll:$('reader-scroll').scrollTop});
    current=node;const version=++request;
    if(!dialog.open){returnFocus=document.activeElement;dialog.showModal();}
    $('reader-back').disabled=!history.length;$('reader-source').disabled=true;$('reader-title').textContent=node.title;$('reader-kicker').textContent=node.knowledgeScope==='library'?'ЗАГАЛЬНА БІБЛІОТЕКА':'ДОКУМЕНТ ІЗ МІСТА';
    $('reader-meta').textContent=node.id;raw='';$('reader-raw').hidden=true;$('reader-body').hidden=false;$('reader-source').setAttribute('aria-pressed','false');$('reader-source').textContent='Markdown';$('reader-outline').hidden=false;
    $('reader-body').replaceChildren();$('reader-toc').replaceChildren();$('reader-scroll').scrollTop=0;$('reader-progress-bar').style.width='0%';message('Відкриваємо сторінки…');
    try{const response=await fetch('/api/note?path='+encodeURIComponent(node.id));if(!response.ok)throw Error();const data=await response.json();if(version!==request||!dialog.open)return;
      raw=data.content;$('reader-source').disabled=false;const words=clean(raw).split(/\s+/).filter(Boolean).length;
      $('reader-meta').textContent=`${Math.max(1,Math.ceil(words/200))} хв читання · ${words.toLocaleString('uk')} слів · ${node.id}`;
      message('');render($('reader-body'),raw,node);outline();if(anchor)jump(anchor);progress();
    }catch{if(version===request)message('Не вдалося прочитати документ. Закрий і відкрий його знову.');}
  }
  function toggleSource(){const source=$('reader-raw').hidden;$('reader-raw').textContent=raw;$('reader-raw').hidden=!source;$('reader-body').hidden=source;$('reader-outline').hidden=source;$('reader-source').setAttribute('aria-pressed',String(source));$('reader-source').textContent=source?'Оформлений вигляд':'Markdown';progress();}
  function close(){++request;closeImage();$('document-reader').close();history=[];current=null;returnFocus?.focus();}
  document.addEventListener('DOMContentLoaded',()=>{
    $('reader-close').onclick=close;$('reader-source').onclick=toggleSource;$('reader-scroll').addEventListener('scroll',progress,{passive:true});
    $('reader-back').onclick=async()=>{const previous=history.pop();if(previous){await open(previous.node,{push:false});$('reader-scroll').scrollTop=previous.scroll;progress();}};
    $('reader-image-close').onclick=closeImage;
    $('reader-lightbox').onclick=e=>{if(e.target===$('reader-lightbox'))$('reader-image-close').click();};
    $('document-reader').addEventListener('cancel',e=>{e.preventDefault();if(!$('reader-lightbox').hidden)$('reader-image-close').click();else close();});
    $('document-reader').addEventListener('keydown',e=>e.stopPropagation());
    $('reader-body').addEventListener('load',progress,true);
  });
  window.CityReader={open,render,configure(value){options={...options,...value};},isOpen:()=>$('document-reader').open};
})();
