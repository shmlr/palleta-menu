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
  assert(await page.getByRole('button',{name:'Составить меню'}).isVisible());
  await page.getByRole('button',{name:'Посмотреть пример меню'}).click();
  await page.getByRole('heading',{name:'Семейное меню на 7 дней'}).waitFor();
  const slots=await page.locator('.slot').count();
  assert.equal(slots,21,'must render 21 planned meals');
  const wa=page.locator('#whatsapp');
  await wa.waitFor();
  const href=await wa.getAttribute('href');
  assert(href.startsWith('https://wa.me/79882040001?text='),'WhatsApp must point to owner supplied number');
  const payload=decodeURIComponent(new URL(href).searchParams.get('text'));
  assert(payload.includes('Список покупок:')&&payload.includes('фактическое наличие'));
  assert(payload.includes('Заявка предварительная.')&&payload.length<3000);

  await page.reload({waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'Что приготовить на этой неделе?'}).waitFor();
  assert(await page.getByRole('button',{name:'Продолжить сохранённое меню'}).isVisible(),'revisit should allow resume');
  assert.equal(await page.locator('.slot').count(),0,'old meal grid must not be shown on load');
  await page.getByRole('button',{name:'Продолжить сохранённое меню'}).click();
  assert.equal(await page.locator('.slot').count(),21);
  // The root path must also display home, including after saved browsing session.
  response=await page.goto(root,{waitUntil:'networkidle'});
  assert(response?.ok());
  await page.getByRole('heading',{name:'Что приготовить на этой неделе?'}).waitFor();
  assert(await page.getByRole('button',{name:'Продолжить сохранённое меню'}).isVisible());
  await page.getByRole('button',{name:'Составить меню'}).click();
  await page.getByRole('heading',{name:'На сколько человек готовим?'}).waitFor();
  await page.screenshot({path:'/tmp/palleta-home-test.png',fullPage:true});
  assert.deepEqual(appErrors,[],'no client-side JS errors');
  console.log('PASS real Chrome: landing + resume + WhatsApp link + 21 meals + questionnaire');
  await context.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
