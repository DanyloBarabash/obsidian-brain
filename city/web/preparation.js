/* Preparation describes the staged model; it never replaces the visible map. */
'use strict';
let preparationRequest=0;
function closePreparation(){preparationRequest++;document.getElementById('preparation').hidden=true;document.getElementById('show-preparation').setAttribute('aria-expanded','false');}
async function showPreparation(){
  closeNote();closeHistory();
  const panel=document.getElementById('preparation');panel.hidden=false;
  document.getElementById('show-preparation').setAttribute('aria-expanded','true');
  const request=++preparationRequest;
  document.getElementById('preparation-summary').textContent='Перевіряємо нову основу міста…';
  try{
    const response=await fetch('/api/preparation');if(!response.ok)throw Error('preparation');
    const data=await response.json();if(request!==preparationRequest)return;
    document.getElementById('preparation-title').textContent=data.safeToRebuild?'Правила об’єднано.':'Готуємо нову основу.';
    document.getElementById('preparation-summary').textContent=data.safeToRebuild?'Спільні перевірки нової моделі пройдено. Земля, будинки, мешканці й служби працюють як одна система.':data.evidenceCurrent?'Компоненти об’єднано; частина спільних перевірок ще потребує уваги.':'Компоненти об’єднано. Потрібні актуальні спільні перевірки цієї версії.';
    document.getElementById('preparation-count').textContent=`${data.verifiedRules} / ${data.totalRules}`;
    document.getElementById('preparation-progress').value=data.verifiedRules;
    document.getElementById('preparation-tests').textContent=data.evidenceCurrent?`${data.testsRun} перевірок · ${data.liveDataAudit.passed?'дані твого Brain узгоджені':'є питання до поточних даних'}`:'Готовність підтвердиться після завершення перевірок.';
    const groups=document.getElementById('preparation-groups');groups.replaceChildren();
    for(const [title,start,end] of [['Дані й пам’ять',1,7],['Ріст і забудова',8,14],['Вулиці й транспорт',15,21],['Мешканці та служби',22,28],['Природа й архітектура',29,33],['Час і узгодженість',34,38],['Мережі й вода',39,46],['Європейське місто',47,54],['Живе місто',55,61],['Кластери й центр',62,66]]){
      const rules=data.rules.slice(start-1,end),section=document.createElement('details');section.className='preparation-group';
      const heading=document.createElement('summary'),name=document.createElement('span'),count=document.createElement('small');name.textContent=title;count.textContent=`${rules.filter(r=>r.status==='verified').length} / ${rules.length}`;heading.append(name,count);section.append(heading);
      for(const rule of rules){const row=document.createElement('div');row.className='preparation-rule';const check=document.createElement('span');check.textContent=rule.status==='verified'?'✓':'○';check.className=rule.status==='verified'?'checked':'';check.setAttribute('aria-label',rule.status==='verified'?'Перевірено в моделі':'Інтегровано, перевірка очікується');const label=document.createElement('span');label.textContent=rule.title;row.append(check,label);section.append(row);}
      groups.append(section);
    }
    const scale=document.getElementById('preparation-scale');scale.replaceChildren();
    if(!data.benchmarks.length){const p=document.createElement('p');p.className='history-caption';p.textContent='Перевірки великих міст ще не завершені.';scale.append(p);}
    for(const benchmark of data.benchmarks){const row=document.createElement('div');row.className='preparation-scale-row';const label=document.createElement('span'),value=document.createElement('span');label.textContent=`${benchmark.sources.toLocaleString('uk')} нотаток`;value.textContent=benchmark.auditErrors.length?'Потребує уваги':'Дані й логіку перевірено';row.append(label,value);scale.append(row);}
  }catch{if(request===preparationRequest){document.getElementById('preparation-summary').textContent='Підготовка тимчасово недоступна. Поточне місто можна продовжувати досліджувати.';}}
}
document.getElementById('show-preparation').onclick=()=>{document.getElementById('preparation').hidden?showPreparation():closePreparation();};
document.getElementById('close-preparation').onclick=closePreparation;
