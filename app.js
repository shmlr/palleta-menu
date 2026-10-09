'use strict';
(() => {
const $=document.getElementById('app');
const C=window.PalletaCore;
if(!C){$.textContent='Ошибка загрузки расчётного модуля. Обновите страницу.';return;}
const esc=x=>String(x??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const money=n=>Number(n).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
const qfmt=n=>Number(Number(n).toFixed(3)).toLocaleString('ru-RU');
const STATUS={in_stock:'подтверждено по выгрузке',unknown:'остаток уточняется',out_of_stock:'нет по выгрузке'};
let catalog,recipes,step=0,seed=1,fixed={},chosen={},prefs={people:4,time:60,budget:0,excl:[]},lastPlan;
const Q=[
 {key:'people',name:'На сколько человек готовим?',choices:[['1',1],['2',2],['3',3],['4',4],['5',5],['6',6]],cols:true},
 {key:'time',name:'Максимальное время на одно блюдо?',choices:[['До 30 минут',30],['До 45 минут',45],['До 60 минут',60],['Без ограничения',999]]},
 {key:'budget',name:'Ориентир бюджета на 21 блюдо?',choices:[['До 5 000 ₽',5000],['До 8 000 ₽',8000],['До 12 000 ₽',12000],['Без ограничения',0]]},
 {key:'excl',name:'Что исключить из меню?',choices:[['Рыбу','fish'],['Молочные продукты','dairy'],['Глютенсодержащие ингредиенты','gluten'],['Яйца','eggs']],multi:true}
];
function explainSource(){const latest=[...catalog.products].filter(x=>x.availability_checked_at).map(x=>Date.parse(x.availability_checked_at)).filter(Number.isFinite);const when=latest.length?new Date(Math.max(...latest)).toLocaleString('ru-RU'):'нет подтверждённых выгрузок';return when;}
function renderQuestion(){
 const q=Q[step];let h=`<div class="bar"><span style="width:${step/Q.length*100}%"></span></div><h1>${esc(q.name)}</h1>`;
 if(q.key==='budget')h+='<p class="muted">Бюджет можно проверить только при полных актуальных розничных ценах и остатках. При неполных данных это пожелание, не гарантированный предел.</p>';
 h+=`<div class="choices${q.cols?' cols':''}">`;
 for(const [label,val] of q.choices){const marked=q.multi?prefs.excl.includes(val):prefs[q.key]===val;h+=`<button class="choice${marked?' selected':''}" data-answer="${esc(val)}" aria-pressed="${marked?'true':'false'}">${esc(label)}</button>`;}
 h+='</div>';
 if(q.multi)h+='<button class="btn" id="next">Собрать 21 блюдо</button>';
 if(step)h+='<button class="btn secondary" id="back">Назад</button>';
 $.innerHTML=h;
 $.querySelectorAll('[data-answer]').forEach(b=>b.onclick=()=>{const value=b.dataset.answer;
  if(q.multi){if(prefs.excl.includes(value))prefs.excl=prefs.excl.filter(x=>x!==value);else prefs.excl.push(value);} else {prefs[q.key]=Number(value);step++;}
  fixed={};render();
 });
 if(q.multi)document.getElementById('next').onclick=()=>{step=Q.length;render()};
 if(step)document.getElementById('back').onclick=()=>{step--;render()};
}
function renderRecipeDetails(r){return `<details><summary class="small">Как готовить и состав на порцию</summary><p class="small">${Object.entries(r.ingredients_per_person).map(([id,v])=>`${esc(catalog.byIngredient[id].name)} ${qfmt(v)} ${esc(catalog.byIngredient[id].unit)}`).join(' · ')}</p><ol>${r.steps.map(t=>`<li class="small">${esc(t)}</li>`).join('')}</ol><p class="small">${esc(r.pantry_note)}</p></details>`;}
function alternativesFor(slot){
 const recipesForMeal=recipes.filter(r=>r.meal===slot.meal&&r.minutes<=prefs.time&&!r.tags.some(t=>prefs.excl.includes(t)));
 // Availability across the entire selected week's cart is checked by the planner when a user chooses an alternative.
 return recipesForMeal.filter(r=>r.id!==slot.recipe?.id).sort((a,b)=>a.name.localeCompare(b.name,'ru'));
}
function basketText(result){
 let t=`Паллета. Заявка на проверку корзины\n7 дней, завтрак / обед / ужин, на ${prefs.people} чел.\n`;
 for(const slot of result.slots)t+=`${C.DAYS[slot.day]} ${C.MEAL_NAMES[slot.meal]}: ${slot.recipe?slot.recipe.name:'НЕ ПОДОБРАНО'}\n`;
 t+='\nПредварительная продуктовая корзина:\n';
 for(const it of result.basket.items)t+=`• ${it.p.name} — ${qfmt(it.quantity)} ${it.p.unit} (${it.packs} ед. по ${qfmt(it.p.pack_size)} ${it.p.unit})${it.p.sku_code?' [код '+it.p.sku_code+']':''}; наличие ${STATUS[it.stock]}; цена ${it.priceCurrent?'по текущему файлу':'не подтверждена сегодня'}\n`;
 if(result.basket.shortages.length)t+='\nНЕ ХВАТАЕТ: '+result.basket.shortages.map(x=>x.name||x.id).join(', ')+'\n';
 t+='\nПожалуйста, проверьте цены, фактические остатки, возможные замены и условия доставки. Сумма не является подтверждённым заказом.';
 return t;
}
function renderResult(message=''){
 lastPlan=C.plan(catalog,recipes,prefs,{seed,fixed,selected:chosen});
 const p=lastPlan,b=p.basket;
 let h='<div class="bar"><span style="width:100%"></span></div><h1>Семейное меню на 7 дней</h1>';
 h+=`<p class="muted">${prefs.people} чел. · завтрак, обед и ужин · ${p.filled} из ${p.totalSlots} блюд подобрано · ${recipes.length} редакционных рецептов</p>`;
 if(message)h+=`<div class="note">${esc(message)}</div>`;
 const inStock=catalog.products.filter(x=>C.availability(x,catalog)==='in_stock').length;
 h+=`<div class="note"><b>${inStock?'Часть остатков подтверждена':'Данных 1С о текущих остатках пока нет'}.</b> Каталог автоматически подхватывается из products.json при открытии сайта. Последняя сверка: ${esc(explainSource())}. ${inStock?'Товары с устаревшими отметками показываются как неизвестные.':'Пока выбор предварительный, а не обещание наличия или цены.'}</div>`;
 let day=-1;
 for(const slot of p.slots){
   if(slot.day!==day){day=slot.day;h+=`<div class="panel"><h2 class="dayheading">${C.DAYS[day]} · день ${day+1}</h2>`;}
   h+=`<div class="slot"><div class="slot-head"><strong>${C.MEAL_NAMES[slot.meal]}</strong><span>${slot.recipe?esc(slot.recipe.name):'<span class="error">Блюдо не подобрано</span>'}</span></div>`;
   if(slot.recipe){h+=`<div class="small">${slot.recipe.minutes} мин · редакционный рецепт</div>`;h+=renderRecipeDetails(slot.recipe);}else h+=`<p class="small warning">${esc(slot.reason)}. Обновите остатки или снимите ограничения.</p>`;
   const options=alternativesFor(slot);
   if(options.length){h+=`<div class="grid-actions"><select class="slotselect" aria-label="Заменить ${C.MEAL_NAMES[slot.meal].toLowerCase()} дня ${slot.day+1}" data-slot="${esc(slot.key)}"><option value="">Заменить блюдо…</option>`;
     for(const x of options)h+=`<option value="${esc(x.id)}">${esc(x.name)} · ${x.minutes} мин</option>`;
     h+='</select></div>';
   }
   h+='</div>';
   if((p.slots.indexOf(slot)+1)%3===0)h+='</div>';
 }
 h+='<div class="panel"><h2>Единая корзина на неделю</h2>';
 const currentConfirm=b.confirmedTotal!==null;
 h+=`<div class="value">${currentConfirm?money(b.confirmedTotal):'Полный итог пока неизвестен'}</div>`;
 h+=`<p class="muted">${currentConfirm?'Все включённые позиции покрыты свежими остатками и актуальными розничными ценами. Окончательный чек подтвердит магазин.':'Последние известные суммы отдельных позиций: '+money(b.referenceAmount)+'. Это НЕ стоимость заказа: часть цен исторические либо отсутствует.'}</p>`;
 h+=`<p class="small">Позиции: ${b.items.length} · Без свежего остатка: ${b.items.filter(x=>x.stock!=='in_stock').length} · Без свежей цены: ${b.items.filter(x=>!x.priceCurrent).length} · Нехватка: ${b.shortages.length}</p>`;
 if(p.filled<p.totalSlots)h+=`<p class="error">${p.totalSlots-p.filled} блюд не подобрано: в каталоге нет подтверждённых подходящих сочетаний при ваших ограничениях.</p>`;
 if(prefs.budget){h+=`<p class="small">Бюджет: ${money(prefs.budget)}. ${currentConfirm?b.confirmedTotal<=prefs.budget?'Собранная корзина укладывается в бюджет по данным последней выгрузки.':'Внимание: корзина превышает выбранный бюджет.':'Проверка бюджета заблокирована неполными данными.'}</p>`;}
 h+='</div><div class="panel"><h2>Товары и допустимые замены</h2>';
 for(const it of b.items){const opts=(it.ing.product_ids||[]).map(id=>catalog.byProduct[id]).filter(x=>C.validProduct(x,it.ing)&&C.availability(x,catalog)!=='out_of_stock');
 h+=`<div class="product"><div class="product-head"><b>${esc(it.ing.name)}</b><span class="amount">${it.priceCurrent?money(it.cost):'цену уточнить'}</span></div>`;
 h+=`<p class="small">${esc(it.p.name)} · ${it.packs} ${it.p.pricing_mode==='by_pack'?'уп.':'вес. позиции'} · ${qfmt(it.quantity)} ${esc(it.p.unit)} · ${esc(STATUS[it.stock])}${it.p.sku_code?' · код '+esc(it.p.sku_code):''}</p>`;
 if(it.priceKnown&&!it.priceCurrent)h+=`<p class="small">Последняя известная стоимость ${money(it.cost)} · не текущая цена</p>`;
 if(opts.length>1){h+=`<label class="small" for="select-${esc(it.ingredient)}">Другая фасовка или марка</label><select id="select-${esc(it.ingredient)}" data-ingredient="${esc(it.ingredient)}">`;
 for(const op of opts)h+=`<option value="${esc(op.id)}" ${op.id===it.p.id?'selected':''}>${esc(op.name)} · ${esc(STATUS[C.availability(op,catalog)])}</option>`;
 h+='</select>';
 }
 h+='</div>';
 }
 if(!b.items.length)h+='<p class="small">Составить корзину не удалось.</p>';
 h+='</div>';
 h+='<div class="panel"><h2>Какие SKU стоит проверить</h2><p class="small">Это рекомендации для сверки в 1С, а не утверждение, что товаров нет в магазине.</p>';
 const uncovered=catalog.ingredients.filter(i=>!(i.product_ids||[]).some(id=>{const pr=catalog.byProduct[id];return C.validProduct(pr,i)&&C.availability(pr,catalog)==='in_stock';}));
 const important=uncovered.slice(0,10);
 for(const i of important)h+=`<div class="product"><b>${esc(i.name)}</b><div class="small">${esc(i.substitution_hint||'Проверить подходящий SKU и актуальное наличие')}</div></div>`;
 h+='<p class="small">Идеи завтраков из публичного демо berbena.pro, ещё не сопоставленные с ассортиментом: овсяные хлопья, бананы, семена чиа, кокосовое молоко. Они не включены в заказ.</p></div>';
 h+='<button class="btn" id="copy">Скопировать заявку на проверку</button><button class="btn secondary" id="shuffle">Другое сочетание блюд</button><button class="btn secondary" id="restart">Изменить условия</button>';
 h+='<p class="muted">* Соль, вода и специи для многих рецептов не включены в продуктовую корзину; порции носят редакционный характер. Аллергенная безопасность не проверена, фильтры не заменяют изучение состава товара.</p>';
 $.innerHTML=h;
 $.querySelectorAll('[data-slot]').forEach(sel=>sel.onchange=()=>{if(!sel.value)return;const orig=fixed[sel.dataset.slot];fixed[sel.dataset.slot]=sel.value;const check=C.plan(catalog,recipes,prefs,{seed,fixed,selected:chosen});
  const target=check.slots.find(s=>s.key===sel.dataset.slot);
  if(!target?.recipe){if(orig===undefined)delete fixed[sel.dataset.slot];else fixed[sel.dataset.slot]=orig;renderResult('Выбранное блюдо не удаётся обеспечить в рамках доступных запасов. Предложите другую замену.');}
  else renderResult('Блюдо заменено. Корзина пересчитана; при ограниченных остатках другие блюда тоже могут измениться.');
 });
 $.querySelectorAll('[data-ingredient]').forEach(sel=>sel.onchange=()=>{chosen[sel.dataset.ingredient]=sel.value;renderResult('Товар заменён. Итог и остатки пересчитаны для всей недели.');});
 document.getElementById('copy').onclick=async()=>{const t=basketText(lastPlan),btn=document.getElementById('copy');try{await navigator.clipboard.writeText(t);btn.textContent='Заявка скопирована';}catch(e){const ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();if(document.execCommand('copy'))btn.textContent='Заявка скопирована';else window.prompt('Скопируйте заявку:',t);ta.remove();}};
 document.getElementById('shuffle').onclick=()=>{seed++;fixed={};window.scrollTo(0,0);renderResult();};
 document.getElementById('restart').onclick=()=>{step=0;fixed={};chosen={};window.scrollTo(0,0);render();};
}
function render(){step<Q.length?renderQuestion():renderResult();}
async function init(){
 try{
  if(!window.fetch)throw Error('Браузер не поддерживает загрузку каталога');
  const [p,r]=await Promise.all(['products.json','recipes.json'].map(async f=>{const ans=await fetch('./'+f+'?v=4',{cache:'no-store'});if(!ans.ok)throw Error(f+': HTTP '+ans.status);return ans.json();}));
  catalog=C.normalize(p);recipes=r.recipes;C.checkRecipes(recipes,catalog);if(recipes.length===0)throw Error('Нет рецептов');render();
 }catch(e){$.innerHTML=`<div class="note"><b>Не удалось загрузить каталог.</b><div class="small">${esc(e.message)}</div></div><button class="btn" id="retry">Повторить</button>`;document.getElementById('retry').onclick=init;}
}
init();
})();