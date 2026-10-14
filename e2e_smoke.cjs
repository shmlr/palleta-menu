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
  const slots=await page.locator('.slot').count();
  assert.equal(slots,9,'default 3 days must render 9 planned meals');
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
  const toggle=page.locator('input[data-home]').first();
  const ownedIngredient=await toggle.getAttribute('data-home');
  await toggle.check();
  assert(await page.locator('#at-home').isVisible());
  const own=page.locator('#at-home [data-home]').first();
  assert.equal(await own.getAttribute('data-home'),ownedIngredient);
  assert.equal(await own.isChecked(),true);
  const ownerText=new URL(await page.locator('#whatsapp').getAttribute('href')).searchParams.get('text');
  const ownedTitle=(await page.locator('#at-home .product b').first().innerText()).trim();
  assert(!ownerText.includes('• '+ownedTitle+' —'),'owned product must not be in WhatsApp');

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
  await page.screenshot({path:'/tmp/palleta-home-test.png',fullPage:true});
  assert.deepEqual(appErrors,[],'no client-side JS errors');
  console.log('PASS real Chrome: 3/7-day planner, pantry exclusions, saved pantry, WhatsApp');
  await context.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
