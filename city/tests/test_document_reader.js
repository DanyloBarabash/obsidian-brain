'use strict';
// DOM integration: run with jsdom on NODE_PATH; production uses only the bundled browser scripts.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),root=path.join(__dirname,'..');
const dom=new JSDOM(fs.readFileSync(path.join(root,'web/index.html'),'utf8'),{url:'http://127.0.0.1:8765/',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window,d=w.document,$=id=>d.getElementById(id),tick=()=>new Promise(r=>setImmediate(r));
w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.HTMLElement.prototype.scrollIntoView=function(){this.scrolled=true;};
let copied='',diagramCalls=0;
w.navigator.clipboard={writeText:async text=>{copied=text;}};
const a={id:'projects/a.md',title:'Довга думка'},b={id:'projects/notes/b.md',title:'Сусідня нотатка'};
const markdown='---\nsecret: metadata\n---\n# Довга думка\n\n## Таблиця\n\n| Ідея | Стан |\n| --- | --- |\n| **Місто** | Готове |\n\n> [!tip] Спробуй\n> Прочитай розділ.\n\n- [x] Уже зроблено\n- [ ] Далі\n\n![Ілюстрація](../attachments/plot.svg)\n\n![[plot.png]]\n\n[[notes/b|До сусіда]] [Розділ](#Таблиця)\n\n```js\nconst a = "[[not a link]]";\n```\n\n```mermaid\ngraph LR\n A --> B\n```\n\n<img src="javascript:alert(1)" onerror="alert(1)"><script>alert(1)</script><iframe src="https://example.org"></iframe>[bad](javascript:alert(1))';
const docs=new Map([[a.id,markdown],[b.id,'# Сусідня нотатка\n\n[[../a|Назад до думки]]']]);
w.fetch=async url=>({ok:docs.has(new URL(url,w.location).searchParams.get('path')),json:async()=>({content:docs.get(new URL(url,w.location).searchParams.get('path'))})});
const append=d.head.append.bind(d.head);d.head.append=node=>{append(node);if(node.src?.endsWith('/vendor/mermaid.min.js')){w.mermaid={initialize:config=>{assert.equal(config.securityLevel,'strict');assert.equal(config.htmlLabels,false,'labels must survive SVG sanitization without foreignObject');},render:async()=>{diagramCalls++;return {svg:'<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L20 20"/><script>alert(1)</script></svg>'};}};queueMicrotask(()=>node.onload());}};
for(const file of ['vendor/marked.min.js','vendor/purify.min.js','document-reader.js'])w.eval(fs.readFileSync(path.join(root,'web',file),'utf8'));
(async()=>{
  await tick();w.CityReader.configure({nodes:()=>[a,b]});
  await w.CityReader.open(a);await tick();
  const body=$('reader-body');
  assert($('document-reader').open);assert.equal(body.querySelectorAll('table').length,1);assert.equal(body.querySelector('td strong').textContent,'Місто');
  assert.equal(body.querySelector('.reader-callout-title').textContent,'Спробуй');assert(body.querySelector('blockquote').textContent.includes('Прочитай розділ.'));
  assert.equal(body.querySelectorAll('input:disabled').length,2);assert.equal(body.querySelector('input').checked,true);
  assert(body.querySelector('img').src.includes('/api/asset?path=..%2Fattachments%2Fplot.svg&note=projects%2Fa.md'));
  assert.equal(body.querySelectorAll('img').length,2);assert.equal(body.querySelectorAll('script,iframe,[onerror]').length,0);assert(!body.innerHTML.includes('secret: metadata'));
  assert(body.querySelector('pre code').textContent.includes('[[not a link]]'));assert.equal(body.querySelector('pre code a'),null);
  assert.equal(diagramCalls,1);assert(body.querySelector('.reader-diagram svg'));assert.equal(body.querySelector('.reader-diagram script'),null);
  assert.equal($('reader-toc').querySelectorAll('button').length,1);$('reader-toc').querySelectorAll('button')[0].click();assert(body.querySelector('h2').scrolled);
  body.querySelector('.reader-code-bar button').click();await tick();assert(copied.includes('[[not a link]]'));
  body.querySelector('.reader-figure').click();assert.equal($('reader-lightbox').hidden,false);assert($('reader-image').querySelector('img'));$('reader-image-close').click();assert($('reader-lightbox').hidden);
  $('reader-source').click();assert(!$('reader-raw').hidden);assert($('reader-body').hidden);assert($('reader-raw').textContent.includes('secret: metadata'));$('reader-source').click();
  const local=[...body.querySelectorAll('a')].find(el=>el.textContent==='До сусіда');local.click();await tick();assert.equal($('reader-title').textContent,b.title);assert(!$('reader-back').disabled);
  $('reader-back').click();await tick();assert.equal($('reader-title').textContent,a.title);
  $('reader-close').click();assert(!$('document-reader').open);
  // A late response from an older document cannot overwrite the page selected afterwards.
  let delayed;w.fetch=url=>new Promise(resolve=>{if(url.includes(encodeURIComponent(a.id)))delayed=resolve;else resolve({ok:true,json:async()=>({content:'# New page'})});});
  const first=w.CityReader.open(a);await w.CityReader.open(b);delayed({ok:true,json:async()=>({content:'# Stale page'})});await first;
  assert.equal($('reader-title').textContent,b.title);assert(body.textContent.includes('New page'));assert(!body.textContent.includes('Stale page'));
  $('reader-close').click();dom.window.close();console.log('Document reader: tables, callouts, checklists, wiki navigation, code, images, diagrams, sanitization, source view, history and stale-response protection pass.');
})().catch(error=>{console.error(error);dom.window.close();process.exitCode=1;});
