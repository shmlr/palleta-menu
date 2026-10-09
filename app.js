'use strict';
(() => {
const $=document.getElementById('app');
let catalog,recipes,products,ingredients,state={step:0,a:{excl:[]},seed:1,chosen:{}};
const DAYS=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const QUESTIONS=[
{id:'people',q:'Сколько человек будет ужинать?',options:[['1',1],['2',2],['3',3],['4',4],['5',5],['6',6]],cols:true},
{id:'time',q:'Сколько времени готовы потратить на ужин?',options:[['До 30 минут',30],['До 45 минут',45],['До 60 минут',60],['Без ограничения',999]]},
{id:'budget',q:'Какой ориентир бюджета на 7 ужинов?',options:[['До 3 000 ₽',3000],['До 5 000 ₽',5000],['До 8 000 ₽',8000],['Без ограничения',0]]},
{id:'excl',q:'Какие блюда исключить?',options:[['Рыбу','fish'],['Молочные','dairy'],['С глютеном','gluten']],multi:true}
];
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>Number(n).toLocaleString('ru-RU',{maximumFractionDigits:2,minimumFractionDigits:2})+' ₽';
const qfmt=n=>Number(Number(n).toFixed(3)).toLocaleString('ru-RU');
const rdate=x=>x?new Date(x).toLocaleString('ru-RU'):'неизвестно';
function recent(s,maxMinutes){let time=Date.parse(s||'');return Number.isFinite(time)&&Date.now()>=time&&Date.now()-time<=maxMinutes*60000}
function stockStatus(p){
 if(!recent(p.availability_checked_at,catalog.stock_freshness_minutes))return 'unknown';
 if(p.availability==='in_stock'&&Number.isFinite(p.stock_quantity)&&p.stock_quantity>0)return 'in_stock';
 if(p.availability==='out_of_stock'||(p.availability==='in_stock'&&p.stock_quantity===0))return 'out_of_stock';
 return 'unknown';
}
function currentPrice(p){return p.price_source==='current_retail' && recent(p.price_as_of,catalog.price_freshness_hours*60)}
function usable(p,ing){return p&&p.compatible_with_recipe!==false&&p.unit===ing.unit&&Number.isFinite(p.pack_size)&&p.pack_size>0}
function choose(ingId){
 const ing=ingredients[ingId],options=ing.product_ids.map(id=>products[id]).filter(p=>usable(p,ing));
 const available=options.filter(p=>stockStatus(p)==='in_stock');
 const possible=options.filter(p=>stockStatus(p)!=='out_of_stock');
 const chosen=state.chosen[ingId];
 if(chosen&&possible.some(p=>p.id===chosen))return products[chosen];
 // Never prefer an unknown-stock item over one confirmed in stock.
 return available[0]||possible[0]||null;
}
function recipeAvailable(r){return Object.keys(r.ingredients_per_person).every(k=>choose(k)!==null)}
function rng(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function plan(){
 const a=state.a,f=rng(state.seed);
 const pool=recipes.filter(r=>r.minutes<=a.time&&!r.tags.some(tag=>a.excl.includes(tag))&&recipeAvailable(r));
 const shuffled=pool.map(r=>[f(),r]).sort((a,b)=>a[0]-b[0]).map(pair=>pair[1]);
 return {pool:shuffled,menu:shuffled.length?Array.from({length:7},(_,i)=>shuffled[i%shuffled.length]):[]};
}
function basket(menu){
 const need={};menu.forEach(r=>Object.entries(r.ingredients_per_person).forEach(([id,qty])=>need[id]=(need[id]||0)+qty*state.a.people));
 const items=Object.entries(need).map(([id,required])=>{
  const ing=ingredients[id],p=choose(id);if(!p)return {id,ing,p:null};
  const packs=Math.ceil(required/p.pack_size-1e-9);
  const qty=Number((packs*p.pack_size).toFixed(4));
  const priceKnown=Number.isFinite(p.price)&&p.price>=0;
  const cost=priceKnown?packs*(p.pricing_mode==='by_pack'?p.price:p.price*p.pack_size):null;
  return {id,ing,p,packs,qty,priceKnown,cost,isCurrent:currentPrice(p),stock:stockStatus(p)};
 });
 items.sort((a,b)=>a.ing.name.localeCompare(b.ing.name,'ru'));
 return {items,priced:items.filter(i=>i.priceKnown).length,totalKnown:items.reduce((sum,i)=>sum+(i.cost||0),0),allCurrent:items.every(i=>i.priceKnown&&i.isCurrent),allInStock:items.every(i=>i.stock==='in_stock')};
}
function replacementCount(r){return Object.keys(r.ingredients_per_person).filter(id=>!choose(id)).length}
function renderQuestion(){
 const q=QUESTIONS[state.step];let h=`<div class="bar"><span style="width:${state.step/QUESTIONS.length*100}%"></span></div><h1>${esc(q.q)}</h1>`;
 if(q.id==='budget')h+='<p class="muted">Пока бюджет ориентировочный: нельзя проверить его по неполному или устаревшему прайсу.</p>';
 h+=`<div class="choices${q.cols?' cols':''}">`;
 for(const [label,v] of q.options){
 const selected=q.multi?state.a.excl.includes(v):state.a[q.id]===v;
 h+=`<button class="choice${selected?' selected':''}" data-answer="${esc(v)}">${esc(label)}</button>`;
 }
 h+='</div>';
 if(q.multi)h+='<button class="btn" id="next">Собрать меню</button>';
 if(state.step)h+='<button class="btn secondary" id="back">Назад</button>';
 $.innerHTML=h;
 $.querySelectorAll('[data-answer]').forEach(b=>b.addEventListener('click',()=>{
 let v=b.dataset.answer;
 if(q.multi){let i=state.a.excl.indexOf(v);i<0?state.a.excl.push(v):state.a.excl.splice(i,1)}
 else{state.a[q.id]=Number(v);state.step++}
 render();
 }));
 if(q.multi)document.getElementById('next').onclick=()=>{state.step++;render()};
 if(state.step>0){let back=document.getElementById('back');if(back)back.onclick=()=>{state.step--;render()}}
}
function suggestion(p,ing){let label=p.name+(stockStatus(p)==='in_stock'?' · есть по последней сверке':' · наличие не подтверждено');return esc(label)}
function cartText(b){
 let txt=`Заявка на уточнение корзины · Паллета\n7 ужинов на ${state.a.people} чел.\n`;
 for(const i of b.items)txt+=`${i.p?i.p.name:i.ing.name} — ${i.p?qfmt(i.qty)+' '+i.p.unit:'нет подтвержденной замены'}${i.p?.sku_code?' ['+i.p.sku_code+']':''}\n`;
 txt+='\nЦена и наличие НЕ подтверждены на сегодня. Прошу проверить корзину, возможные замены, итог и условия доставки.';
 return txt;
}
function renderResult(){
 const {pool,menu}=plan();
 if(!menu.length){$.innerHTML='<div class="note"><b>Нет подходящих блюд.</b> При заданных ограничениях и данных об отсутствии товаров нельзя собрать меню. Измените условия или обновите ассортимент.</div><button class="btn" id="restart">Изменить условия</button>';document.getElementById('restart').onclick=()=>{state.step=0;render()};return}
 const b=basket(menu);const unknown=b.items.filter(i=>i.stock==='unknown').length;
 const missingPrice=b.items.filter(i=>!i.priceKnown).length;
 const outdated=b.items.filter(i=>i.priceKnown&&!i.isCurrent).length;
 let h='<div class="bar"><span style="width:100%"></span></div><h1>Ваше меню на неделю</h1>';
 h+='<div class="note"><b>Предварительный подбор.</b> Подключение к 1С не настроено. Наличие большинства товаров неизвестно. Цены ниже исторические или из ранее согласованных ценников.</div>';
 h+=`<p class="muted">7 ужинов · ${state.a.people} чел. · ${pool.length} подходящих различных блюд</p>`;
 menu.forEach((r,i)=>h+=`<div class="day"><b>${DAYS[i]}</b><span>${esc(r.name)}</span><small>${r.minutes} мин</small></div>`);
 if(pool.length<7)h+='<p class="muted">Подходящих блюд меньше семи, поэтому некоторые повторяются. Время приготовления и исключения соблюдены.</p>';
 h+='<div class="panel"><h2>Продуктовая корзина</h2>';
 h+=`<div class="value">${b.priced?money(b.totalKnown):'Сумма неизвестна'}</div>`;
 h+=`<p class="muted">${b.priced?'Только сумма '+b.priced+' позиций по последним известным ценам, НЕ текущая стоимость заказа.':'Нет подтверждённых цен.'}</p>`;
 h+=`<p class="small">Непроверенное наличие: ${unknown} поз. · Без цены: ${missingPrice} поз. · Устаревшие известные цены: ${outdated} поз.</p>`;
 if(state.a.budget)h+=`<p class="small">Ориентир бюджета: ${money(state.a.budget)}. ${b.allCurrent?'Текущий итог можно сопоставить с бюджетом после проверки остатков.':'Сравнивать с бюджетом пока нельзя.'}</p>`;
 h+='</div><div class="panel"><h2>Ингредиенты и замены</h2>';
 b.items.forEach(i=>{
 const {ing,p}=i;
 h+=`<div class="product"><div class="product-head"><b>${esc(ing.name)}</b><span class="amount">${i.priceKnown?money(i.cost):'Цена неизвестна'}</span></div>`;
 if(p){h+=`<div>${esc(p.name)} <span class="label">${i.stock==='in_stock'?'наличие подтверждено':'наличие уточнить'}</span></div>`;
 h+=`<div class="small">В корзине: ${qfmt(i.qty)} ${esc(p.unit)} (${i.packs} × ${qfmt(p.pack_size)} ${esc(p.unit)})${p.sku_code?' · код '+esc(p.sku_code):''}</div>`;
 if(i.priceKnown)h+=`<div class="small">${i.isCurrent?'Актуальная цена по файлу':'Цена не проверена сегодня'} · источник ${esc(p.price_as_of||'неизвестен')}</div>`;
 }else h+='<p class="warning">Нет доступной замены в текущем каталоге</p>';
 const valid=ing.product_ids.map(id=>products[id]).filter(p=>usable(p,ing)&&stockStatus(p)!=='out_of_stock');
 if(valid.length>1){h+=`<label class="small" for="sel-${esc(ing.id)}">Выбрать вариант (без гарантии наличия)</label><select id="sel-${esc(ing.id)}" data-ing="${esc(ing.id)}">`;
 valid.forEach(x=>h+=`<option value="${esc(x.id)}"${x.id===p?.id?' selected':''}>${suggestion(x,ing)}</option>`);
 h+='</select>'}
 const incompatible=ing.product_ids.map(id=>products[id]).filter(x=>x&&!usable(x,ing));
 if(incompatible.length)h+=`<p class="small">Другие варианты требуют ручной проверки фасовки: ${incompatible.map(x=>esc(x.name)).join('; ')}.</p>`;
 h+=`<details><summary class="small">Что ещё можно рассмотреть</summary><p class="small">[Возможная замена, не подтверждённый товар Паллеты] ${esc(ing.substitution_hint)}</p></details>`;
 h+='</div>';
 });h+='</div>';
 h+='<button class="btn" id="copy">Скопировать заявку на уточнение</button><button class="btn secondary" id="shuffle">Другое меню</button><button class="btn secondary" id="restart">Изменить условия</button>';
 h+='<details class="panel"><summary>Откуда товары и цены</summary><p class="small">Fresh: историческая средняя по 31-дневной выгрузке на 24.09.2026. Makfa, Злато и Вкуснотеево: рабочие цены от 05.10.2026. Нет актуального файла остатков. Магазин должен подтвердить цену и наличие перед оформлением.</p></details>';
 $.innerHTML=h;
 $.querySelectorAll('[data-ing]').forEach(sel=>sel.onchange=()=>{state.chosen[sel.dataset.ing]=sel.value;renderResult()});
 document.getElementById('copy').onclick=async()=>{let t=cartText(b);try{await navigator.clipboard.writeText(t);document.getElementById('copy').textContent='Заявка скопирована'}catch(e){let ta=document.createElement('textarea');ta.value=t;document.body.append(ta);ta.select();try{document.execCommand('copy');document.getElementById('copy').textContent='Заявка скопирована'}catch(_){window.prompt('Скопируйте заявку:',t)}ta.remove()}};
 document.getElementById('shuffle').onclick=()=>{state.seed++;window.scrollTo(0,0);renderResult()};
 document.getElementById('restart').onclick=()=>{state.step=0;state.chosen={};window.scrollTo(0,0);render()};
}
function render(){state.step<QUESTIONS.length?renderQuestion():renderResult()}
async function init(){
 try{
 const [c,r]=await Promise.all(['products.json','recipes.json'].map(async file=>{const res=await fetch('./'+file,{cache:'no-store'});if(!res.ok)throw Error(`${file}: HTTP ${res.status}`);return res.json()}));
 if(!c?.products?.length||!r?.recipes?.length)throw Error('Пустой каталог или база рецептов');
 catalog=c;recipes=r.recipes;products=Object.fromEntries(c.products.map(p=>[p.id,p]));ingredients=Object.fromEntries(c.ingredients.map(ing=>[ing.id,ing]));
 for(let recipe of recipes)for(let key of Object.keys(recipe.ingredients_per_person))if(!ingredients[key])throw Error('Неизвестный ингредиент: '+key);
 render();
 }catch(e){$.innerHTML='<div class="note"><b>Каталог не загрузился.</b> Проверьте публикацию всех файлов и попробуйте обновить страницу. <div class="small">'+esc(e.message)+'</div></div><button class="btn" id="retry">Повторить</button>';document.getElementById('retry').onclick=init}
}
init();
})();