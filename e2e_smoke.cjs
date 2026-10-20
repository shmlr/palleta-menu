'use strict';
// Real Chrome/Chromium e2e check, including a re-visit with saved localStorage and PWA.
const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const root=process.env.TEST_URL||'http://127.0.0.1:8765/';
const entry=new URL('start.html',root).href;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const executablePath=process.env.CHROME_BIN||'/usr/bin/google-chrome';
 const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();
  const appErrors=[];
  page.on('pageerror',e=>appErrors.push(e.message));
  let response=await page.goto(entry,{waitUntil:'networkidle',timeout:30000});
  assert(response?.ok(),'start.html must return success');
  await page.getByRole('heading',{name:'Что приготовить на этой неделе?'}).waitFor();
  const lpImg=page.locator('.lp-referral-logo');
  assert(await lpImg.isVisible(),'original Local Point logo visible on main entry');
  assert.equal(await lpImg.getAttribute('src'),'./assets/local-point-logo.webp');
  assert(await lpImg.evaluate(img=>img.complete&&img.naturalWidth>0),'Local Point logo loads in real Chrome');
  assert.equal(await page.locator('.lp-referral-phone').getAttribute('href'),'tel:+79637940001','telephone is tappable');
  assert((await page.locator('.lp-referral-phone').innerText()).includes('+7 963 794-00-01'),'phone appears in readable format');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,'LP block does not create mobile horizontal overflow');
  const localPoint=await page.locator('.lp-referral-link').getAttribute('href');
  assert(localPoint.startsWith('https://wa.me/79637940001?text='),'verified Local Point contact');
  assert(new URL(localPoint).searchParams.get('text').includes('Паллета'),'LP source tag inside message');
  assert.equal(await page.locator('.lp-contact-icons a').count(),4,'four LP contact channels');
  assert.equal(await page.locator('.lp-icon-call').getAttribute('href'),'tel:+79637940001');
  assert.equal(await page.locator('.lp-icon-tg').getAttribute('href'),'https://t.me/Local_01');
  assert.equal(await page.locator('.lp-icon-max').getAttribute('href'),'https://max.ru/u/f9LHodD0cOLOdqweo6ZD2M-8go71XGKMQN7-aZq8vsAcHJBEE3f3_rRGGqI');
  assert.equal(await page.locator('.lp-referral-phone').evaluate(el=>getComputedStyle(el).textDecorationLine),'none','no phone underline');
  for(const node of await page.locator('.lp-contact-icons a').all())
    assert((await node.boundingBox()).height>=44,'contact hit area >=44px');
  const recipeCardLink=await page.locator('.cross-brand').getAttribute('href');
  assert(recipeCardLink.startsWith('https://berbena.pro/prorecepty?utm_source=palleta_menu'),'PROРЕЦЕПТЫ offer, not generic homepage');
  const icon=await page.locator('link[rel="icon"]').getAttribute('href');
  assert(icon.includes('palleta-favicon-32.png?v=20261014-final'),'expected approved favicon');
  for(const [filename,dim] of [['assets/palleta-favicon-32.png?v=20261014-final',32],['assets/app-icon-192.png?v=20261014-final',192],['assets/app-icon-512.png?v=20261014-final',512]]){
    const reply=await page.request.get(new URL(filename,root).href);
    assert(reply.ok(),filename+' should load');
    const data=await reply.body();
    assert.equal(data.subarray(0,8).toString('hex'),'89504e470d0a1a0a',filename);
    assert.equal(data.readUInt32BE(16),dim,filename+' width');
    assert.equal(data.readUInt32BE(20),dim,filename+' height');
  }
  const icoReply=await page.request.get(new URL('favicon.ico',root).href);
  assert(icoReply.ok(),'favicon.ico accessible');
  assert.equal((await icoReply.body()).readUInt16LE(2),1,'ICO header');

  assert(await page.getByRole('button',{name:'Составить меню'}).isVisible());
  await page.getByRole('button',{name:'Посмотреть пример меню'}).click();
  await page.getByRole('heading',{name:'Семейное меню на 3 дня'}).waitFor();
  assert.equal(await page.locator('#berbena-recipes-referral').count(),0,'no duplicate PROРЕЦЕПТЫ offer in dynamic result');
  assert.equal(await page.locator('a.cross-brand').count(),1,'exactly one compact berbena footer remains');
  const recipeLink=await page.locator('.slot details a[href*="utm_content=recipe_"]').first().getAttribute('href');
  assert(recipeLink.includes('berbena.pro/prorecepty'),'recipe-context link goes to public landing');
  assert(recipeLink.includes('utm_content=recipe_'),'recipe source id passed without implying exact match');
  const slots=await page.locator('.slot').count();
  assert.equal(slots,9,'default 3 days must render 9 planned meals');
  // Family attendance must not shift the main purchase flow off-screen.
  assert(await page.locator('.attendance-panel').isVisible(),'attendance controls shown alongside menu');
  assert.equal(await page.locator('[data-attendance]').count(),9);
  assert.equal(await page.locator('details.meal-attendance-details[open]').count(),0,'portion selectors closed by default');
  await page.locator('[data-attendance-key="0-lunch"] > summary').click();
  await page.locator('[data-attendance="0-lunch"]').selectOption('2');
  assert((await page.locator('[data-attendance="0-lunch"]').inputValue())==='2');
  assert((await page.locator('.slot').first().innerText()).length>10);
  await page.locator('[data-attendance-key="0-lunch"] > summary').click();
  await page.locator('[data-attendance="0-lunch"]').selectOption('4');
  assert.equal(await page.locator('[data-attendance="0-lunch"]').inputValue(),'4');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,'no horizontal scroll after attendance changes at 390px');

  await page.locator('[data-slot="0-lunch"]').selectOption('chicken_soup');
  assert(await page.locator('#outside-store').isVisible(),'external ingredients should have a separate block');
  const wa=page.locator('#whatsapp');
  await wa.waitFor();
  const href=await wa.getAttribute('href');
  assert(href.startsWith('https://wa.me/79882040001?text='),'WhatsApp must point to owner supplied number');
  const payload=new URL(href).searchParams.get('text');
  assert(payload.includes('Список покупок:')&&payload.includes('фактическое наличие'));
  assert(payload.includes('Заявка предварительная.')&&payload.length<3000);
  assert(payload.includes('3 дн.'),'WhatsApp reflects chosen 3-day period');

  const firstBought=page.locator('input.shopping-check').first();
  await firstBought.check();
  const reducedHref=await wa.getAttribute('href');
  assert.notEqual(reducedHref,href,'marking item bought must change WhatsApp URL');
  const reducedText=new URL(reducedHref).searchParams.get('text');
  assert(reducedText.length<payload.length,'bought item must be omitted from WhatsApp payload');
  const boughtName=(await firstBought.getAttribute('aria-label')).replace(/^Куплено: /,'');
  assert(!reducedText.includes('• '+boughtName+' —'),'exact bought SKU must be absent from order text');
  assert((await page.locator('#purchase-pending').innerText()).includes('В заявку:'));
  // Verify persisted purchased state, not only the pantry state, after a real page reload.
  await page.reload({waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Продолжить сохранённое меню'}).click();
  assert(await firstBought.isChecked(),'bought checkbox survives saved menu reload');
  const restoredBoughtHref=await wa.getAttribute('href');
  assert.equal(restoredBoughtHref,reducedHref,'reloaded WhatsApp payload excludes the same bought SKU');
  assert(!new URL(restoredBoughtHref).searchParams.get('text').includes('• '+boughtName+' —'));
  await firstBought.uncheck();
  assert.equal(await wa.getAttribute('href'),href,'unchecking restores original cart and WhatsApp message');
  for(const item of await page.locator('input.shopping-check').all())await item.check();
  assert.equal(await wa.getAttribute('href'),null,'no empty WhatsApp order when everything bought');
  assert.equal(await wa.getAttribute('aria-disabled'),'true');
  for(const item of await page.locator('input.shopping-check').all())await item.uncheck();
  assert.equal(await wa.getAttribute('href'),href,'restoring items restores order link');
  // Alternative packs must update the actual WhatsApp text, and switching back must restore it.
  const selectInShop=page.locator('.panel').filter({has:page.locator('#check-count')}).locator('select[data-ingredient]').first();
  assert(await selectInShop.count()>0,'3-day menu must expose at least one store alternative');
  const originalId=await selectInShop.inputValue();
  const alternative=await selectInShop.locator('option').evaluateAll((opts,current)=>opts.filter(x=>x.value!==current).map(x=>({id:x.value,name:x.textContent.split(' · ')[0]}))[0],originalId);
  assert(alternative?.id,'alternative SKU exists');
  await selectInShop.selectOption(alternative.id);
  const changedHref=await wa.getAttribute('href');
  assert(changedHref&&changedHref!==href,'alternative changes outgoing order URL');
  assert(new URL(changedHref).searchParams.get('text').includes('• '+alternative.name+' —'),'alternative SKU shown in order text');
  await selectInShop.selectOption(originalId);
  assert.equal(await wa.getAttribute('href'),href,'restoring original SKU restores WhatsApp order');
  assert.equal(await page.getByText('Какие SKU стоит проверить').count(),0,'buyer never sees internal SKU checklist');

  const toggle=page.locator('input[data-home]').first();
  const ownedIngredient=await toggle.getAttribute('data-home');
  await toggle.check();
  assert(await page.locator('#at-home').isVisible());
  const own=page.locator('#at-home [data-home]').first();
  assert.equal(await own.getAttribute('data-home'),ownedIngredient);
  assert.equal(await own.isChecked(),true);
  const afterHomeHref=await page.locator('#whatsapp').getAttribute('href');
  const ownedTitle=(await page.locator('#at-home .product label').first().innerText()).trim();
  if(afterHomeHref){
    const ownerText=new URL(afterHomeHref).searchParams.get('text');
    assert(!ownerText.includes('• '+ownedTitle+' —'),'owned product must not be in WhatsApp');
  }else{
    assert.equal(await page.locator('#whatsapp').getAttribute('aria-disabled'),'true','empty order is disabled when all goods are at home');
  }

  for(const forbidden of ['Фарш говяжий','Куриные потроха','Филе куриное','Куриное филе','Куриная грудка'])assert(!payload.includes(forbidden),'meat appeared in WhatsApp: '+forbidden);
  assert(/курин|фарш|мяс/i.test(await page.locator('#outside-store').innerText()));

  await page.reload({waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'Что приготовить на этой неделе?'}).waitFor();
  assert(await page.getByRole('button',{name:'Продолжить сохранённое меню'}).isVisible(),'revisit should allow resume');
  assert.equal(await page.locator('.slot').count(),0,'old meal grid must not be shown on load');
  await page.getByRole('button',{name:'Продолжить сохранённое меню'}).click();
  assert.equal(await page.locator('.slot').count(),9);
  assert(await page.locator('#at-home').isVisible(),'home product persists after reload');
  // The root path must also display home, including after saved browsing session.
  response=await page.goto(root,{waitUntil:'networkidle'});
  assert(response?.ok());
  assert(await page.locator('.lp-referral-logo').isVisible(),'original Local Point logo visible on root homepage');
  assert.equal(await page.locator('.lp-referral-phone').getAttribute('href'),'tel:+79637940001','root phone links to same LP number');
  assert.equal(await page.locator('.lp-referral-link').count(),1,'root page has one LP WhatsApp action');
  await page.getByRole('heading',{name:'Что приготовить на этой неделе?'}).waitFor();
  assert(await page.getByRole('button',{name:'Продолжить сохранённое меню'}).isVisible());
  await page.getByRole('button',{name:'Составить меню'}).click();
  await page.getByRole('heading',{name:'На сколько дней составить меню?'}).waitFor();
  await page.locator('[data-answer="7"]').click();
  await page.getByRole('heading',{name:'На сколько человек готовим?'}).waitFor();
  await page.locator('[data-answer="4"]').click();
  await page.locator('[data-answer="60"]').click();
  await page.locator('[data-answer="12000"]').click();
  await page.locator('#next').click();
  await page.getByRole('heading',{name:'Семейное меню на 7 дней'}).waitFor();
  assert.equal(await page.locator('.slot').count(),21);
  assert.equal(await page.locator('#at-home').count(),0,'new menu clears home flags');
  // One family chooses brands and sorts after selecting a budget.
  async function ensureInBasket(input,recipesToTry,meal){
    if(await page.locator(input).count())return;
    for(let day=0;day<7;day++)for(const id of recipesToTry){
      const option=page.locator('[data-slot="'+day+'-'+meal+'"] option[value="'+id+'"]');
      if(await option.count()){
        await page.locator('[data-slot="'+day+'-'+meal+'"]').selectOption(id);
        if(await page.locator(input).count())return;
      }
    }
    assert.equal(await page.locator(input).count(),1,'ingredient must be part of the chosen menu: '+input);
  }
  await ensureInBasket('[data-wish="milk"]',['rice_porridge','pancakes','omelet_greens','omelet_zucchini'],'breakfast');
  await ensureInBasket('[data-wish="tomato"]',['vegetable_soup','chicken_potato_stew','tomato_egg_soup','mince_rice'],'lunch');
  const milkWish=page.locator('[data-wish="milk"]');
  const tomatoWish=page.locator('[data-wish="tomato"]');
  assert(await milkWish.count()===1&&await tomatoWish.count()===1,'milk and tomatoes appear in selected menu');
  assert(await page.locator('#wish-list-milk option[value*="Вкуснотеево"]').count()===1,'existing Vkusnoteevo can be requested without unit conversion');
  await milkWish.fill('Молоко Вкуснотеево 3,2%, 950 г');
  await tomatoWish.fill('Помидоры черри');
  await tomatoWish.press('Tab');
  const wishedText=new URL(await page.locator('#whatsapp').getAttribute('href')).searchParams.get('text');
  assert(wishedText.includes('Молоко: хочу «Молоко Вкуснотеево 3,2%, 950 г»'),'Vkusnoteevo request in real WhatsApp text');
  assert(wishedText.includes('Помидоры: хочу «Помидоры черри»'),'cherry tomato request in real WhatsApp text: '+wishedText.slice(0,1700));
  assert(!wishedText.includes('• Молоко Дарман')&&!wishedText.includes('• Помидоры Новичок'),'original milk/tomato not silently ordered');
  assert(wishedText.includes('Ориентир бюджета на товары Паллеты'),'budget reaches WhatsApp for staff');
  assert((await page.locator('#budget-progress').innerText()).includes('нельзя подтвердить'),'no false budget confirmation with stale prices');
  await page.reload({waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Продолжить сохранённое меню'}).click();
  assert.equal(await page.locator('[data-wish="milk"]').inputValue(),'Молоко Вкуснотеево 3,2%, 950 г');
  assert.equal(await page.locator('[data-wish="tomato"]').inputValue(),'Помидоры черри');
  assert.equal(new URL(await page.locator('#whatsapp').getAttribute('href')).searchParams.get('text'),wishedText,'saved wishlist and outgoing WhatsApp remain identical');
  // The purchased and pantry checkboxes still take precedence over any wishlist.
  const tomatoCheck=page.locator('.product').filter({has:page.locator('[data-wish="tomato"]')}).locator('.shopping-check');
  await tomatoCheck.check();
  assert(!new URL(await page.locator('#whatsapp').getAttribute('href')).searchParams.get('text').includes('Помидоры: хочу'),'bought product and its wish must be absent');
  await tomatoCheck.uncheck();
  assert.equal(new URL(await page.locator('#whatsapp').getAttribute('href')).searchParams.get('text'),wishedText,'unchecking returns wanted cherry tomatoes');
  await page.getByRole('button',{name:'В выходные обед-пикник'}).click();
  assert((await page.locator('[data-attendance="5-lunch"]').inputValue())==='picnic');
  assert((await page.locator('[data-attendance="6-lunch"]').inputValue())==='picnic');
  assert((await page.locator('#app').innerText()).includes('19 из 19 домашних блюд'),'weekend picnic excludes cooking without inventing food');
  await page.getByRole('button',{name:'Пропустить обеды в будни'}).click();
  assert((await page.locator('[data-attendance="5-lunch"]').inputValue())==='picnic','weekday preset must retain picnic');
  assert((await page.locator('#app').innerText()).includes('14 из 14 домашних блюд'),'weekday and picnic presets compose');
  await page.getByRole('button',{name:'Все едят дома'}).click();
  assert((await page.locator('#app').innerText()).includes('21 из 21 домашних блюд'));
  const fs=require('node:fs');
  const shots='/tmp/palleta-mobile-preview';
  fs.mkdirSync(shots,{recursive:true});
  for(const width of [390,360]){
    await page.setViewportSize({width,height:844});
    const overflow=await page.evaluate(()=>{
      const vw=window.innerWidth;
      return {view:vw,scroll:document.documentElement.scrollWidth, offenders:[...document.querySelectorAll('body *')].map(el=>{
        const rect=el.getBoundingClientRect();
        return {tag:el.tagName,cls:el.className?.toString().slice(0,100),id:el.id,left:Math.round(rect.left),right:Math.round(rect.right),width:Math.round(rect.width)};
      }).filter(x=>x.right>vw+1&&x.width>0).slice(0,18)};
    });
    if(overflow.scroll>width+1)console.error('MOBILE OVERFLOW DETAIL',JSON.stringify(overflow));
    assert.equal(overflow.scroll<=width+1,true,'no horizontal scroll at '+width+'px');
    assert(await page.locator('.lp-referral-logo').isVisible(),'Local Point logo at '+width+'px');
    assert(await page.locator('.lp-referral-link').isVisible(),'Local Point CTA at '+width+'px');
    assert.equal(await page.locator('.lp-contact-icons a').count(),4,'all four contact icons at '+width+'px');
    assert.equal(await page.locator('.lp-referral-phone').evaluate(el=>getComputedStyle(el).textDecorationLine),'none');
    assert(await page.locator('[data-attendance-key="5-lunch"] summary').isVisible(),'meal settings accessible at '+width+'px');
    await page.locator('.attendance-panel').scrollIntoViewIfNeeded();
    await page.screenshot({path:shots+'/attendance-'+width+'.png'});
    const firstAttendance=page.locator('[data-attendance-key="0-breakfast"]');
    if(!(await firstAttendance.evaluate(el=>el.open)))
      await firstAttendance.locator('summary').click();
    assert(await firstAttendance.evaluate(el=>el.open),'attendance picker open for visual screenshot');
    await page.locator('.slot').first().screenshot({path:shots+'/meal-'+width+'.png'});
    await page.locator('.lp-referral').screenshot({path:shots+'/local-point-'+width+'.png'});
  }

  await page.screenshot({path:'/tmp/palleta-home-test.png',fullPage:true});
  assert.deepEqual(appErrors,[],'no client-side JS errors');
  console.log('PASS real Chrome: 3/7-day planner, pantry exclusions, saved pantry, WhatsApp');
  await context.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
