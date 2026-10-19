'use strict';
(function () {
  const root=document.getElementById('root');
  const C=window.PalletaCore;
  if(!root||!C){if(root)root.textContent='Не удалось загрузить модуль расчётов';return;}
  const esc=x=>String(x==null?'':x).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const qty=n=>Number(Number(n).toFixed(3)).toLocaleString('ru-RU');
  const price=n=>Number(n).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
  const KEY='recipe-studio-v1';
  const MEALS=C.MEALS;
  const names=C.MEAL_NAMES;
  let catalog=null,recipes=[],byId={},brand=new URLSearchParams(location.search).get('brand')==='berbena'?'berbena':'palleta';
  let view=brand==='berbena'?'catalog':'plan';
  let prefs={days:3,people:4,time:999,excl:[]},seed=1,fixed={},pantry=new Set(),favorites=new Set();
  let filter='all',search='',onlyFavorites=false,activeId=null,cookIndex=0,cookDays=1,alertText='';
  const allowedBrand=x=>x==='berbena'?'berbena':'palleta';
  function load(){
    try {
      const s=JSON.parse(localStorage.getItem(KEY)||'null');if(!s||typeof s!=='object')return;
      if([3,7].includes(s.days))prefs.days=s.days;
      if(Number.isInteger(s.people)&&s.people>=1&&s.people<=6)prefs.people=s.people;
      if(Number.isInteger(s.seed)&&s.seed>=1&&s.seed<=9999)seed=s.seed;
      if(Array.isArray(s.favorites))favorites=new Set(s.favorites.filter(id=>!!byId[id]));
      if(Array.isArray(s.pantry))pantry=new Set(s.pantry.filter(id=>!!catalog.byIngredient[id]));
      if(s.fixed&&typeof s.fixed==='object')for(const [key,id] of Object.entries(s.fixed)){
        if(/^[0-6]-(breakfast|lunch|dinner)$/.test(key)&&byId[id])fixed[key]=id;
      }
    }catch(e){/* Ignore corrupted local settings. */}
  }
  function save(){
    try{localStorage.setItem(KEY,JSON.stringify({days:prefs.days,people:prefs.people,seed,favorites:[...favorites],pantry:[...pantry],fixed}));}catch(e){/* Storage may be disabled. */}
  }
  function navigation(){
    if(brand==='palleta')return '';
    return '<div class="tabs" aria-label="Разделы">'+
      '<button type="button" data-view="catalog" aria-pressed="'+(view==='catalog')+'">Рецепты</button>'+
      '<button type="button" data-view="favorites" aria-pressed="'+(view==='favorites')+'">Избранное ('+favorites.size+')</button>'+
      '</div>';
  }
  function kcalBadge(r){
    const nutrition=window.BerbenaNutrition?.estimate(r,catalog);
    return nutrition?.kcal!==null&&Number.isFinite(nutrition?.kcal)?
      '<span class="pill">[Unverified] ≈ '+nutrition.kcal+' ккал/порция</span>':
      '<span class="pill">Калорийность не рассчитана</span>';
  }
  function render(){
    document.body.classList.toggle('berbena',brand==='berbena');
    document.querySelectorAll('[data-brand]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.brand===brand)));
    if(brand==='palleta')view='plan';
    else if(view==='plan')view='catalog';
    if(view==='cook'&&brand==='berbena')return renderCook();
    let h='<section class="hero"><h1>'+(brand==='berbena'?'Готовить дома проще':'Что приготовить на этой неделе?')+'</h1><p>'+
      (brand==='berbena'?'Рецепты, ориентировочные калории и готовка по шагам. Платный каталог PROРЕЦЕПТОВ сюда пока не загружен.':
      'Меню на 3 или 7 дней, продукты дома и предварительный список покупок. Цены и наличие подтверждает магазин.')+
      '</p>'+(brand==='palleta'?'<div class="actions"><a class="mini secondary" href="../start.html">← Основное меню Паллеты</a></div>':'')+'</section>';
    h+=navigation();
    if(alertText){h+='<div role="status" class="note">'+esc(alertText)+'</div>';alertText='';}
    if(brand==='palleta')h+=planHtml();
    else h+=libraryHtml();
    root.innerHTML=h;save();
    if(view==='catalog'||view==='favorites')drawCards();
  }
  function libraryHtml(){
    return '<section class="panel"><h2>'+(view==='favorites'?'Избранные рецепты':'Каталог рецептов')+'</h2>'+
      '<div class="controls"><label>Название блюда<input id="search" type="search" autocomplete="off" placeholder="Например, суп или картофель" value="'+esc(search)+'"></label>'+
      '<label>Тип блюда<select id="meal-filter"><option value="all">Все блюда</option>'+
      MEALS.map(m=>'<option value="'+m+'"'+(filter===m?' selected':'')+'>'+esc(names[m])+'</option>').join('')+
      '</select></label></div><p class="muted">В базе '+recipes.length+' редакционных рецепта. [Unverified] Калорийность ориентировочная, без проверки точной номенклатуры, рецептур и аллергенов.</p>'+
      '<div id="cards" class="recipegrid"></div></section>';
  }
  function drawCards(){
    const cards=document.getElementById('cards');if(!cards)return;
    const term=search.trim().toLocaleLowerCase('ru');
    const matches=recipes.filter(r=>(filter==='all'||r.meal===filter)&&
      (view!=='favorites'||favorites.has(r.id))&&
      (r.name.toLocaleLowerCase('ru').includes(term)||(catalog.byIngredient&&Object.keys(r.ingredients_per_person).some(id=>(catalog.byIngredient[id]?.name||'').toLocaleLowerCase('ru').includes(term)))));
    const ordered=[...matches].sort((a,b)=>Number(favorites.has(b.id))-Number(favorites.has(a.id))||a.name.localeCompare(b.name,'ru'));
    cards.innerHTML=ordered.map(r=>
      '<article class="card"><div class="recipe-title"><h3>'+esc(r.name)+'</h3>'+
      '<button class="heart" data-fav="'+esc(r.id)+'" type="button" aria-label="'+(favorites.has(r.id)?'Удалить из избранного':'Добавить в избранное')+'" aria-pressed="'+favorites.has(r.id)+'">'+(favorites.has(r.id)?'♥':'♡')+'</button></div>'+
      '<div class="recipe-meta">'+esc(names[r.meal])+' · '+r.minutes+' мин · '+Object.keys(r.ingredients_per_person).length+' ингредиентов</div>'+kcalBadge(r)+
      '<p class="muted">'+esc(Object.keys(r.ingredients_per_person).map(id=>catalog.byIngredient[id]?.name||id).slice(0,5).join(', '))+'</p>'+
      '<div class="actions"><button class="mini" data-open="'+esc(r.id)+'" type="button">Готовить по шагам</button></div></article>'
    ).join('')||'<p class="muted">Подходящие рецепты не найдены. Измените запрос или фильтр.</p>';
  }
  function getPlan(){return C.plan(catalog,recipes,prefs,{seed,fixed,atHome:[...pantry]});}
  function checkFixed(key,id){
    const old=fixed[key];fixed[key]=id;
    const result=getPlan(),slot=result.slots.find(s=>s.key===key);
    if(!slot||slot.recipe?.id!==id){
      if(old===undefined)delete fixed[key];else fixed[key]=old;
      alertText='Это блюдо пока нельзя поставить в выбранный день при действующих ограничениях и данных каталога.';
      return false;
    }
    return true;
  }
  function palletaReferralHtml(){
    const recipeUrl="https://berbena.pro/prorecepty?utm_source=palleta_menu&utm_medium=referral&utm_campaign=recipes_to_berbena";
    const localPointContact="https://wa.me/79637940001?text=%D0%97%D0%B4%D1%80%D0%B0%D0%B2%D1%81%D1%82%D0%B2%D1%83%D0%B9%D1%82%D0%B5!%20%D0%A3%D0%B2%D0%B8%D0%B4%D0%B5%D0%BB%20%D0%BC%D0%B5%D0%BD%D1%8E%20%D0%BD%D0%B0%20%D0%BD%D0%B5%D0%B4%D0%B5%D0%BB%D1%8E%20%D0%B2%20%D0%BF%D1%80%D0%B8%D0%BB%D0%BE%D0%B6%D0%B5%D0%BD%D0%B8%D0%B8%20%C2%AB%D0%9F%D0%B0%D0%BB%D0%BB%D0%B5%D1%82%D0%B0%C2%BB.%20%D0%A5%D0%BE%D1%87%D1%83%20%D0%BE%D0%B1%D1%81%D1%83%D0%B4%D0%B8%D1%82%D1%8C%20%D0%BF%D0%BE%D1%85%D0%BE%D0%B6%D0%B8%D0%B9%20%D1%86%D0%B8%D1%84%D1%80%D0%BE%D0%B2%D0%BE%D0%B9%20%D0%B8%D0%BD%D1%81%D1%82%D1%80%D1%83%D0%BC%D0%B5%D0%BD%D1%82%20%D0%B4%D0%BB%D1%8F%20%D0%BC%D0%BE%D0%B5%D0%B3%D0%BE%20%D0%BC%D0%B0%D0%B3%D0%B0%D0%B7%D0%B8%D0%BD%D0%B0%20%D0%B8%D0%BB%D0%B8%20%D0%B1%D0%B8%D0%B7%D0%BD%D0%B5%D1%81%D0%B0.";
    return '<section class="panel" id="berbena-recipes"><h2>Больше идей и рецептов</h2>'+
      '<p>PROРЕЦЕПТЫ на berbena.pro: отдельная коллекция из 120 блюд, инструкции и настройка порций. Доступ 590 ₽ без подписки.</p>'+
      '<a class="btn secondary" href="'+esc(recipeUrl)+'" target="_blank" rel="noopener noreferrer">Открыть PROРЕЦЕПТЫ на berbena.pro ↗</a>'+
      '<p class="muted">Коллекция berbena отличается от списка блюд в меню Паллеты.</p></section>'+
      '<section class="panel" id="local-point-contact"><div class="pill">Для бизнеса · Local Point</div>'+
      '<h2>Хотите похожее меню для своего магазина?</h2><p>Обсудите идею веб-инструмента с Local Point.</p>'+
      '<a class="btn secondary" href="'+esc(localPointContact)+'" target="_blank" rel="noopener noreferrer">Написать Local Point в WhatsApp ↗</a></section>';
  }
  function planHtml(){
    const p=getPlan();
    let h='<section class="panel"><h2>Меню на '+prefs.days+' '+(prefs.days===3?'дня':'дней')+'</h2>'+
      '<div class="controls"><label>Период<select id="days"><option value="3"'+(prefs.days===3?' selected':'')+'>3 дня</option><option value="7"'+(prefs.days===7?' selected':'')+'>7 дней</option></select></label>'+
      '<label>Человек<select id="people">'+[1,2,3,4,5,6].map(n=>'<option value="'+n+'"'+(prefs.people===n?' selected':'')+'>'+n+'</option>').join('')+'</select></label></div>'+
      '<p class="muted">Подобрано '+p.filled+' из '+p.totalSlots+' блюд. Для меню доступна замена блюда и повтор на следующий день.</p>'+
      '<div class="actions"><button class="mini secondary" type="button" data-shuffle="1">Новое сочетание</button></div>';
    let day=-1;
    for(const s of p.slots){
      if(s.day!==day){if(day!==-1)h+='</section>';day=s.day;h+='<section class="card"><h3 class="dayhead">'+esc(C.DAYS[day])+' · День '+(day+1)+'</h3>';}
      h+='<div class="meal"><strong>'+esc(names[s.meal])+'</strong><div><b>'+esc(s.recipe?.name||'Блюдо не подобрано')+'</b>'+
        (s.recipe?'<div class="muted">'+s.recipe.minutes+' мин</div>':'<div class="muted">'+esc(s.reason)+'</div>')+'</div>';
      h+='<div class="row">';
      if(s.recipe){
        if(day<prefs.days-1)h+='<button type="button" class="mini secondary" data-repeat="'+esc(s.key)+'">Повторить завтра</button>';
      }
      h+='</div>';
      h+='<select aria-label="Заменить '+esc(names[s.meal])+' дня '+(day+1)+'" data-slot="'+esc(s.key)+'"><option value="">Заменить блюдо…</option>'+
        recipes.filter(r=>r.meal===s.meal).map(r=>'<option value="'+esc(r.id)+'">'+esc(r.name)+'</option>').join('')+'</select>';
      h+='</div>';
    }
    if(day!==-1)h+='</section>';
    h+='</section>';
    h+=pantryHtml();
    h+=basketHtml(p);
    h+=palletaReferralHtml();
    return h;
  }
  function pantryHtml(){
    return '<section class="panel"><h2>Что уже есть дома?</h2>'+
      '<p class="muted">Отмеченные ингредиенты исключаются из списка покупок, но остаются в рецептах. Это отметка наличия, не подтверждение количества.</p>'+
      '<div class="pantry">'+catalog.ingredients.map(i=>'<label><input type="checkbox" data-home="'+esc(i.id)+'"'+(pantry.has(i.id)?' checked':'')+'><span>'+esc(i.name)+'</span></label>').join('')+'</div></section>';
  }
  function basketHtml(p){
    const b=p.basket;
    let h='<section class="panel"><h2>Предварительный список покупок</h2>';
    for(const it of b.items){
      h+='<div class="shopping"><div><strong>'+esc(it.ing.name)+'</strong><div class="muted">'+esc(it.p.name)+' · '+
      (it.stock==='in_stock'?'остаток подтверждён':'остаток уточняется')+'</div></div><strong>'+qty(it.quantity)+' '+esc(it.p.unit)+'</strong></div>';
    }
    if(b.externalItems.length){h+='<h3>Дома или купить отдельно</h3>';for(const it of b.externalItems)h+='<div class="shopping"><div>'+esc(it.ing.name)+'</div><strong>'+qty(it.quantity)+' '+esc(it.p.unit)+'</strong></div>';}
    if(b.homeItems.length){h+='<h3>Уже есть дома</h3>';for(const it of b.homeItems)h+='<div class="shopping"><div>'+esc(it.ing.name)+'</div><strong>'+qty(it.quantity)+' '+esc(it.ing.unit)+'</strong></div>';}
    if(b.confirmedTotal!==null)h+='<p class="amount">Сумма по подтверждённым клубным ценам и остаткам: '+price(b.confirmedTotal)+'</p>';
    else h+='<div class="note">Точную стоимость корзины пока назвать нельзя: нужны свежие клубные цены и остатки из 1С. Это не онлайн-заказ и не резерв.</div>';
    if(b.shortages.length)h+='<div class="note">Часть ингредиентов не обеспечена подтверждённым ассортиментом: '+esc(b.shortages.map(x=>x.name).join(', '))+'</div>';
    h+='<p class="muted">Мясо, отсутствующее в ассортименте магазина, не включается в магазинную корзину.</p>';
    return h+'<div class="actions"><button type="button" class="mini secondary" data-print="1">Распечатать</button></div></section>';
  }
  function renderCook(){
    const r=byId[activeId];if(!r){view='catalog';render();return;}
    const total=r.steps.length;
    cookIndex=Math.max(0,Math.min(total-1,cookIndex));
    const people=prefs.people*cookDays;
    const n=window.BerbenaNutrition?.estimate(r,catalog);
    const hasKcal=Number.isFinite(n?.kcal);
    const kcalHtml=hasKcal?'<section class="panel" aria-label="Калорийность"><h2>[Unverified] ≈ '+n.kcal+' ккал на порцию</h2>'+ 
      '<p class="muted">≈ '+(Math.round(n.unrounded_kcal*people/10)*10)+' ккал на весь объём ('+people+' порц.). Расчёт по типовым исходным ингредиентам, <strong>не подтверждён</strong> для конкретных продуктов и готового блюда. Не является пищевой маркировкой или медицинской рекомендацией.</p></section>':
      '<div class="note">Калорийность неизвестна: для одного или нескольких ингредиентов нет совместимых данных.</div>';
    const h='<div class="actions"><button type="button" class="mini secondary" data-back="1">← Вернуться</button></div>'+
      '<section class="hero"><div class="pill">'+esc(names[r.meal])+' · '+r.minutes+' мин</div><h1>'+esc(r.name)+'</h1>'+
      '<p>Порции: '+prefs.people+' чел. × '+cookDays+' '+(cookDays===1?'день':'дня')+'</p>'+ 
      '<div class="controls"><label>Человек<select id="cook-people">'+[1,2,3,4,5,6].map(x=>'<option value="'+x+'"'+(prefs.people===x?' selected':'')+'>'+x+'</option>').join('')+'</select></label></div>'+
      '<div class="actions"><button type="button" class="mini secondary" data-cookdays="1" aria-pressed="'+(cookDays===1)+'">На один день</button>'+
      '<button type="button" class="mini secondary" data-cookdays="2" aria-pressed="'+(cookDays===2)+'">На два дня</button></div></section>'+
      (cookDays===2?'<div class="note">Количество продуктов удвоено. Срок и условия безопасного хранения зависят от блюда. Не оставляйте готовую еду при комнатной температуре и проверяйте правила охлаждения и разогрева.</div>':'')+
      kcalHtml+'<section class="panel"><h2>Продукты</h2>'+
      Object.entries(r.ingredients_per_person).map(([id,n])=>'<div class="shopping"><div>'+esc(catalog.byIngredient[id]?.name||id)+'</div><strong>'+qty(n*people)+' '+esc(catalog.byIngredient[id]?.unit||'')+'</strong></div>').join('')+
      '<p class="muted">'+esc(r.pantry_note||'Дополнительные соль, вода и специи могут не входить в список.')+'</p></section>'+
      '<section class="panel"><h2>Готовим по шагам</h2><div class="muted">Шаг '+(cookIndex+1)+' из '+total+'</div>'+
      '<div class="progress" role="progressbar" aria-valuenow="'+(cookIndex+1)+'" aria-valuemin="1" aria-valuemax="'+total+'"><span style="width:'+Math.round((cookIndex+1)*100/total)+'%"></span></div>'+
      '<div class="cook-step">'+esc(r.steps[cookIndex])+'</div>'+
      '<div class="actions"><button type="button" class="mini secondary" data-prev="1"'+(cookIndex===0?' disabled':'')+'>← Назад</button>'+
      '<button type="button" class="mini" data-next="1">'+(cookIndex===total-1?'Готово ✓':'Следующий шаг →')+'</button></div>'+
      '</section><p class="muted">Рецепты редакционные и требуют проверки пропорций и аллергенов перед приготовлением.</p>';
    root.innerHTML=h;
  }
  document.querySelectorAll('[data-brand]').forEach(button=>button.onclick=()=>{brand=allowedBrand(button.dataset.brand);view=brand==='berbena'?'catalog':'plan';activeId=null;const url=new URL(location.href);url.searchParams.set('brand',brand);history.replaceState(null,'',url);render();});
  root.addEventListener('click',e=>{
    const el=e.target.closest('button');if(!el||!root.contains(el))return;
    if(el.dataset.view){view=el.dataset.view;render();return;}
    if(el.dataset.fav){const id=el.dataset.fav;if(favorites.has(id))favorites.delete(id);else favorites.add(id);save();render();return;}
    if(el.dataset.open&&brand==='berbena'){activeId=el.dataset.open;returnView=view;view='cook';cookIndex=0;cookDays=1;render();return;}
    if(el.dataset.repeat){
      const [day,meal]=el.dataset.repeat.split('-');const s=getPlan().slots.find(x=>x.key===el.dataset.repeat);
      if(s?.recipe&&Number(day)<prefs.days-1){const key=(Number(day)+1)+'-'+meal;if(checkFixed(key,s.recipe.id))alertText='Блюдо повторено на следующий день. Для приготовления за один раз проверьте безопасное хранение.';render();}return;
    }
    if(el.dataset.shuffle){seed+=1;fixed={};render();return;}
    if(el.dataset.cookdays){cookDays=Number(el.dataset.cookdays)===2?2:1;render();return;}
    if(el.dataset.prev){cookIndex=Math.max(0,cookIndex-1);render();return;}
    if(el.dataset.next){if(cookIndex<byId[activeId].steps.length-1){cookIndex++;render();}else{view=returnView;render();}return;}
    if(el.dataset.back){view=returnView;render();return;}
    if(el.dataset.print){window.print();return;}
  });
  let returnView='catalog';
  root.addEventListener('change',e=>{
    const el=e.target;
    if(el.id==='meal-filter'){filter=el.value;drawCards();return;}
    if(el.id==='days'){prefs.days=Number(el.value)===7?7:3;fixed={};render();return;}
    if(el.id==='people'||el.id==='cook-people'){prefs.people=Math.max(1,Math.min(6,Number(el.value)||4));render();return;}
    if(el.dataset.home){if(el.checked)pantry.add(el.dataset.home);else pantry.delete(el.dataset.home);render();return;}
    if(el.dataset.slot&&el.value){checkFixed(el.dataset.slot,el.value);render();return;}
  });
  root.addEventListener('input',e=>{if(e.target.id==='search'){search=e.target.value;drawCards();}});
  (async()=>{
    try{
      const results=await Promise.all(['../products.json','../recipes.json'].map(async path=>{
        const r=await fetch(path,{cache:'no-store'});if(!r.ok)throw Error(path+' HTTP '+r.status);return r.json();
      }));
      catalog=C.normalize(results[0]);recipes=results[1].recipes;
      if(!Array.isArray(recipes)||!recipes.length)throw Error('Нет рецептов');
      C.checkRecipes(recipes,catalog);
      byId=Object.fromEntries(recipes.map(r=>[r.id,r]));
      load();render();
    }catch(error){root.innerHTML='<section class="note"><strong>Данные недоступны.</strong><p>'+esc(error.message)+'</p><p>Откройте приложение через веб-сервер: локальный файл без HTTP может блокировать загрузку JSON.</p></section>';}
  })();
})();