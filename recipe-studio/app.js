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
  let catalog=null,recipes=[],byId={},view='catalog',brand=new URLSearchParams(location.search).get('brand')==='berbena'?'berbena':'palleta';
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
    return '<div class="tabs" aria-label="Разделы">'+
      '<button type="button" data-view="catalog" aria-pressed="'+(view==='catalog')+'">Рецепты</button>'+
      '<button type="button" data-view="plan" aria-pressed="'+(view==='plan')+'">Меню на неделю</button>'+
      '<button type="button" data-view="favorites" aria-pressed="'+(view==='favorites')+'">Избранное ('+favorites.size+')</button>'+
      '</div>';
  }
  function render(){
    document.body.classList.toggle('berbena',brand==='berbena');
    document.querySelectorAll('[data-brand]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.brand===brand)));
    if(view==='cook')return renderCook();
    let h='<section class="hero"><h1>'+(brand==='berbena'?'Готовить дома проще':'Что приготовить на этой неделе?')+'</h1><p>'+
      (brand==='berbena'?'Прототип интерфейса для PROРЕЦЕПТОВ. Здесь только общие редакционные рецепты, не закрытый платный каталог.':
      'Рецепты, семейное меню и предварительный список покупок. Клубные цены и наличие должны быть подтверждены магазином.')+
      '</p><div class="actions"><a class="mini secondary" href="../start.html">← Основное меню Паллеты</a></div></section>';
    h+=navigation();
    if(alertText){h+='<div role="status" class="note">'+esc(alertText)+'</div>';alertText='';}
    if(view==='plan')h+=planHtml();
    else h+=libraryHtml();
    root.innerHTML=h;save();
    if(view==='catalog'||view==='favorites')drawCards();
  }
  function libraryHtml(){
    return '<section class="panel"><h2>'+(view==='favorites'?'Избранные рецепты':'Каталог рецептов')+'</h2>'+
      '<div class="controls"><label>Название блюда<input id="search" type="search" autocomplete="off" placeholder="Например, суп или картофель" value="'+esc(search)+'"></label>'+
      '<label>Тип блюда<select id="meal-filter"><option value="all">Все блюда</option>'+
      MEALS.map(m=>'<option value="'+m+'"'+(filter===m?' selected':'')+'>'+esc(names[m])+'</option>').join('')+
      '</select></label></div><p class="muted">В базе '+recipes.length+' редакционных рецепта. Состав, порции и аллергены требуют индивидуальной проверки.</p>'+
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
      '<div class="recipe-meta">'+esc(names[r.meal])+' · '+r.minutes+' мин · '+Object.keys(r.ingredients_per_person).length+' ингредиентов</div>'+
      '<p class="muted">'+esc(Object.keys(r.ingredients_per_person).map(id=>catalog.byIngredient[id]?.name||id).slice(0,5).join(', '))+'</p>'+
      '<div class="actions"><button class="mini" data-open="'+esc(r.id)+'" type="button">Готовить</button>'+
      '<button class="mini secondary" data-add="'+esc(r.id)+'" type="button">В меню</button></div></article>'
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
        h+='<button type="button" class="mini secondary" data-open="'+esc(s.recipe.id)+'">Готовить</button>'+
          '<button type="button" class="mini secondary" data-fav="'+esc(s.recipe.id)+'" aria-pressed="'+favorites.has(s.recipe.id)+'">'+(favorites.has(s.recipe.id)?'♥ В избранном':'♡ Избранное')+'</button>';
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
    return h;
  }
  function pantryHtml(){
    return '<section class="panel"><h2>Что уже есть дома?</h2>'+
      '<p class="muted">Отмеченные ингредиенты исключаются из списка покупок, но остаются в рецептах. Это отметка наличия, не подтверждение количества.</p>'+
      '<div class="pantry">'+catalog.ingredients.map(i=>'<label><input type="checkbox" data-home="'+esc(i.id)+'"'+(pantry.has(i.id)?' checked':'')+'><span>'+esc(i.name)+'</span></label>').join('')+'</div></section>';
  }
  function basketHtml(p){
    let h='<section class="panel"><h2>'+(brand==='berbena'?'Ингредиенты на весь период':'Предварительный список покупок')+'</h2>';
    if(brand==='berbena'){
      const amounts=C.aggregate(p.slots.map(s=>s.recipe),prefs.people);
      for(const [id,n] of Object.entries(amounts)){const ing=catalog.byIngredient[id];h+='<div class="shopping"><div><strong>'+esc(ing?.name||id)+'</strong><div class="muted">'+(pantry.has(id)?'Уже есть дома':'Подготовить или купить')+'</div></div><strong>'+qty(n)+' '+esc(ing?.unit||'')+'</strong></div>';}
      h+='<p class="muted">Цены и магазинные остатки здесь намеренно не показываются.</p>';
    }else{
      const b=p.basket;
      for(const it of b.items)h+='<div class="shopping"><div><strong>'+esc(it.ing.name)+'</strong><div class="muted">'+esc(it.p.name)+' · '+(it.stock==='in_stock'?'остаток подтверждён':'остаток уточняется')+'</div></div><strong>'+qty(it.quantity)+' '+esc(it.p.unit)+'</strong></div>';
      if(b.externalItems.length){h+='<h3>Дома или купить отдельно</h3>';for(const it of b.externalItems)h+='<div class="shopping"><div>'+esc(it.ing.name)+'</div><strong>'+qty(it.quantity)+' '+esc(it.p.unit)+'</strong></div>';}
      if(b.homeItems.length){h+='<h3>Уже есть дома</h3>';for(const it of b.homeItems)h+='<div class="shopping"><div>'+esc(it.ing.name)+'</div><strong>'+qty(it.quantity)+' '+esc(it.ing.unit)+'</strong></div>';}
      if(b.confirmedTotal!==null)h+='<p class="amount">Сумма по подтверждённым клубным ценам и остаткам: '+price(b.confirmedTotal)+'</p>';
      else h+='<div class="note">Точную стоимость корзины пока назвать нельзя: нужны свежие клубные цены и остатки из 1С. Это не онлайн-заказ и не резерв.</div>';
      if(b.shortages.length)h+='<div class="note">Часть ингредиентов не обеспечена подтверждённым ассортиментом: '+esc(b.shortages.map(x=>x.name).join(', '))+'</div>';
      h+='<p class="muted">Мясо, отсутствующее в ассортименте магазина, не включается в магазинную корзину.</p>';
    }
    return h+'<div class="actions"><button type="button" class="mini secondary" data-print="1">Распечатать</button></div></section>';
  }
  function renderCook(){
    const r=byId[activeId];if(!r){view='catalog';render();return;}
    const total=r.steps.length;
    cookIndex=Math.max(0,Math.min(total-1,cookIndex));
    const people=prefs.people* cookDays;
    const h='<div class="actions"><button type="button" class="mini secondary" data-back="1">← Вернуться</button></div>'+
      '<section class="hero"><div class="pill">'+esc(names[r.meal])+' · '+r.minutes+' мин</div><h1>'+esc(r.name)+'</h1>'+
      '<p>Порции: '+prefs.people+' чел. × '+cookDays+' '+(cookDays===1?'день':'дня')+'</p>'+
      '<div class="actions"><button type="button" class="mini secondary" data-cookdays="1" aria-pressed="'+(cookDays===1)+'">На один день</button>'+
      '<button type="button" class="mini secondary" data-cookdays="2" aria-pressed="'+(cookDays===2)+'">На два дня</button></div></section>'+
      (cookDays===2?'<div class="note">Количество продуктов удвоено. Срок и условия безопасного хранения зависят от блюда. Не оставляйте готовую еду при комнатной температуре и проверяйте правила охлаждения и разогрева.</div>':'')+
      '<section class="panel"><h2>Продукты</h2>'+
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
  document.querySelectorAll('[data-brand]').forEach(button=>button.onclick=()=>{brand=allowedBrand(button.dataset.brand);render();});
  root.addEventListener('click',e=>{
    const el=e.target.closest('button');if(!el||!root.contains(el))return;
    if(el.dataset.view){view=el.dataset.view;render();return;}
    if(el.dataset.fav){const id=el.dataset.fav;if(favorites.has(id))favorites.delete(id);else favorites.add(id);save();render();return;}
    if(el.dataset.open){activeId=el.dataset.open;returnView=view;view='cook';cookIndex=0;cookDays=1;render();return;}
    if(el.dataset.add){const r=byId[el.dataset.add];if(r){const key='0-'+r.meal;if(checkFixed(key,r.id)){view='plan';alertText='Блюдо добавлено на первый день выбранного меню.';}render();}return;}
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
    if(el.id==='people'){prefs.people=Math.max(1,Math.min(6,Number(el.value)||4));render();return;}
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