'use strict';
// Article market: the local Brain Reader stocks it; the city only shows stalls and forwards choices.
const MARKET_POLL_MS=60000,MARKET_BATCH=12,MARKET_DESCRIBE_POLL_MS=8000,MARKET_READER_COMMAND='uv run --with fastembed python3 reader/server.py';
const marketKinds={save:'У мозку',like:'Подобається',dislike:'Не цікаво',hide:'Сховано'};
let marketOpen=false,marketLimit=MARKET_BATCH;
function marketAgo(seconds){if(!seconds)return 'дата невідома';const h=(Date.now()/1000-seconds)/3600;return h<1?`${Math.max(1,Math.round(h*60))} хв тому`:h<48?`${Math.round(h)} год тому`:`${Math.round(h/24)} дн тому`;}
async function marketPost(path,body){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error(r.status===503?'Brain Reader не запущено':`${r.status}`);return r.json();}
function ware(item){
  const row=document.createElement('div');row.className='ware';
  const link=document.createElement('a');link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=item.title;
  // Articles are read in the city's reader; the first-source link stays in the reader's header.
  link.onclick=e=>{if(typeof CityReader==='undefined')return;e.preventDefault();CityReader.open({id:`market/${item.id}`,title:item.title,article:item.id});};
  const meta=document.createElement('small');
  meta.textContent=[item.sourceLabel,marketAgo(item.published),item.score!=null?`${Math.round(item.score*100)}%`:'',item.explore?'розвідка':'',item.why?.length?`через: ${item.why.join(', ')}`:''].filter(Boolean).join(' · ');
  const about=document.createElement('p');about.className='about';about.textContent=item.about||item.summary||'';
  const deal=document.createElement('div');deal.className='deal';
  const act=async(action)=>{try{if(action==='save')toast('Несемо статтю в мозок…');const result=await marketPost('/api/market/act',{id:item.id,action});row.classList.add('gone');deal.replaceChildren(document.createTextNode(marketKinds[action]));if(result.note)toast(`У Бібліотеці знань: ${result.note}`);
    // Every kept article gets a library shelf right away; the choice can change later in the library.
    if(action==='like'||(action==='save'&&result.note)){await loadLibrary();const target=action==='save'?{path:result.note}:{id:item.id};
      const pick=async shelf=>{try{const r=await marketPost('/api/library/shelve',{...target,shelf});deal.replaceChildren(document.createTextNode(`${marketKinds[action]} · полиця «${r.shelf}»`));}catch(error){toast(`Не вдалося поставити на полицю: ${error.message}`);}};
      deal.append(shelfPicker('',pick));}}catch(error){toast(`Не вдалося: ${error.message}`);}};
  for(const [action,label,title] of [['save','Взяти в мозок','Зберегти статтю в Brain'],['like','👍','Більше такого'],['dislike','👎','Менше такого'],['hide','✕','Прибрати без оцінки']]){
    const b=document.createElement('button');b.textContent=label;b.title=title;if(action==='save')b.className='take';b.onclick=()=>act(action);deal.append(b);}
  row.append(link,meta,...(about.textContent?[about]:[]),deal);return row;}
function marketSection(title,nodes){const head=document.createElement('div');head.className='section-title';head.textContent=title;return [head,...nodes];}
async function loadMarket(){
  let data;try{const r=await fetch(`/api/market?limit=${marketLimit}`);if(!r.ok)throw Error();data=await r.json();}catch{$('market-count').textContent='Ринок недоступний';return null;}
  $('market-count').textContent=data.offline?'Зачинено · запусти Brain Reader':`${data.new} нових статей · привіз ${data.lastFetch?marketAgo(data.lastFetch):'ще не було'}`;
  return data;}
async function renderMarket(){
  const data=await loadMarket();if(!marketOpen)return;
  if(!data){$('market-summary').textContent='Не вдалося зв’язатися з містом.';$('market-stalls').replaceChildren();return;}
  if(data.offline){$('market-summary').textContent='Ринок зачинено: Brain Reader не запущено. Запусти його з кореня репозиторію:';const code=document.createElement('code');code.textContent=MARKET_READER_COMMAND;$('market-stalls').replaceChildren(code);return;}
  if(data.setup){$('market-summary').textContent='Постачальників ще не обрано. Відкрий Brain Reader і вибери теми та джерела.';const a=document.createElement('a');a.className='text-button';a.href=data.reader||'http://127.0.0.1:8766';a.target='_blank';a.rel='noopener noreferrer';a.textContent='Відкрити Brain Reader ↗';$('market-stalls').replaceChildren(a);return;}
  $('market-summary').textContent=`Добірка на сьогодні: ${stallCount(data)} статей за твоїми вподобаннями${data.refreshing?' · агент саме везе новий товар':''}${data.describing?' · агент дописує описи':''}. «Взяти в мозок» кладе статтю в Бібліотеку знань; 👍 / 👎 вчать, що привозити далі.`;
  const stalls=data.stalls.flatMap(stall=>marketSection(`${stall.name.toUpperCase()} · ${stall.items.length}`,stall.items.map(ware)));
  if(!stalls.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='Прилавки порожні. Агент привезе нове з наступним оновленням.';stalls.push(empty);}
  if(data.more){const more=document.createElement('button');more.className='text-button';more.textContent='Завантажити ще';more.onclick=()=>{marketLimit+=MARKET_BATCH;renderMarket();};stalls.push(more);}
  $('market-stalls').replaceChildren(...stalls);
  clearTimeout(renderMarket.timer);if(data.describing||data.refreshing)renderMarket.timer=setTimeout(()=>marketOpen&&renderMarket(),MARKET_DESCRIBE_POLL_MS);}
function stallCount(data){return data.stalls.reduce((sum,stall)=>sum+stall.items.length,0);}
function openMarket(){closeNote();closeHistory();if(typeof focusMarket==='function')focusMarket();marketOpen=true;$('market').hidden=false;renderMarket();}
function closeMarket(){marketOpen=false;$('market').hidden=true;}
$('open-market').onclick=openMarket;$('close-market').onclick=closeMarket;
$('market-link').onsubmit=async(event)=>{event.preventDefault();const input=$('market-url');toast('Несемо посилання в мозок…');
  try{const result=await marketPost('/api/market/link',{url:input.value.trim()});input.value='';toast(result.duplicate?`Уже в мозку: ${result.note}`:`У Бібліотеці знань: ${result.note}`);}catch(error){toast(`Не вдалося: ${error.message}`);}};
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMarket();});
loadMarket();setInterval(loadMarket,MARKET_POLL_MS);
