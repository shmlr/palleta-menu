const fs=require('fs'),vm=require('vm'),assert=require('assert');const basedir=__dirname+'/';const core=require('./core.js');const p=JSON.parse(fs.readFileSync(basedir+'products.json')),r=JSON.parse(fs.readFileSync(basedir+'recipes.json'));
function run(saved=null){const elems={};const storage={data:saved,getItem(){return this.data},setItem(key,value){this.data=value}};const app={html:'',_cache:{},get innerHTML(){return this.html},set innerHTML(v){this.html=v;this._cache={}},querySelectorAll(sel){if(this._cache[sel])return this._cache[sel];if(sel==='[data-answer]')return this._cache[sel]= [...this.html.matchAll(/data-answer="([^"]+)"/g)].map(m=>({dataset:{answer:m[1]},set onclick(f){this.on=f},click(){this.on?.()}}));if(sel==='[data-slot]'||sel==='[data-ingredient]')return [];return []}};const document={getElementById:id=>id==='app'?app:(elems[id]??={id,click(){this.onclick?.()}})};const fetch=async url=>({ok:true,json:async()=>url.includes('products')?p:r});const ctx={window:{PalletaCore:core,fetch,scrollTo(){},prompt(){},localStorage:storage},document,navigator:{clipboard:{writeText:async()=>{}}},fetch,console};vm.runInNewContext(fs.readFileSync(basedir+'app.js','utf8'),ctx);return {app,document,storage};}
(async()=>{const t=run();await new Promise(resolve=>setImmediate(resolve));assert(t.app.innerHTML.includes('Что приготовить на этой неделе?'),t.app.innerHTML.slice(0,400));assert(t.app.innerHTML.includes('Составить меню'));t.document.getElementById('start-menu').click();assert(t.app.innerHTML.includes('На сколько дней составить меню?'));function answer(v){const el=t.app.querySelectorAll('[data-answer]').find(x=>x.dataset.answer===String(v));assert(el,'missing option '+v);el.click();}answer(3);assert(t.app.innerHTML.includes('На сколько человек'));answer(4);console.log('SECOND QUESTION',t.app.html.slice(0,900));answer(60);answer(12000);t.document.getElementById('next').click();assert(t.app.innerHTML.includes('Семейное меню на 3 дня'));assert.strictEqual((t.app.innerHTML.match(/class="slot"/g)||[]).length,9);assert(t.app.innerHTML.includes('Список покупок в Паллете'));assert(t.app.innerHTML.includes('Дома или купить отдельно'));assert(t.app.innerHTML.includes('Учтена в группе «Рынок 2»'));assert(t.app.innerHTML.includes('shopping-check'));assert(t.app.innerHTML.includes('data-home='));assert(!t.app.innerHTML.includes('вес. позиции'));assert(t.app.innerHTML.includes('лоток 30 шт.'));assert(t.app.innerHTML.includes('Заменить на аналог'));assert(t.app.innerHTML.includes('id="whatsapp"'));assert(t.app.innerHTML.includes('https://wa.me/79882040001?text='));assert(t.app.innerHTML.includes('Отправить список в WhatsApp'));assert(t.app.innerHTML.includes('Справочная сумма по'));assert(t.app.innerHTML.includes('Клубная цена на 13.10.2026'));assert(t.app.innerHTML.includes('≈'));console.log('PASS: homepage, onboarding, dated club price and 21-slot result');
t.document.getElementById('home-from-result').click();
assert(t.app.innerHTML.includes('Продолжить сохранённое меню'));
t.document.getElementById('continue-menu').click();
assert(t.app.innerHTML.includes('Семейное меню на 3 дня'));
const revisit=run(t.storage.data);
await new Promise(resolve=>setImmediate(resolve));
assert(revisit.app.innerHTML.includes('Что приготовить на этой неделе?'),'on reload always show home');
assert(revisit.app.innerHTML.includes('Продолжить сохранённое меню'),'saved plan accessible');
assert(!revisit.app.innerHTML.includes('class="slot"'),'do not auto-open old menu');
revisit.document.getElementById('continue-menu').click();
assert(revisit.app.innerHTML.includes('Семейное меню на 3 дня'));
console.log('PASS: 3-day menu persists and loads via home');
const seven=run();await new Promise(resolve=>setImmediate(resolve));
seven.document.getElementById('start-menu').click();
const pick=v=>{const el=seven.app.querySelectorAll('[data-answer]').find(x=>x.dataset.answer===String(v));assert(el);el.click();};
pick(7);pick(4);pick(60);pick(12000);seven.document.getElementById('next').click();
assert(seven.app.innerHTML.includes('Семейное меню на 7 дней'));
assert.strictEqual((seven.app.innerHTML.match(/class="slot"/g)||[]).length,21);
console.log('PASS: 7-day selection renders 21 meals');
})();
// PWA installation and local checklist contract: offline assets and install metadata must exist.
const index=fs.readFileSync(basedir+'index.html','utf8');
const manifest=JSON.parse(fs.readFileSync(basedir+'manifest.webmanifest','utf8'));
const sw=fs.readFileSync(basedir+'sw.js','utf8');
assert(index.includes('rel="manifest"'));
assert(manifest.display==='standalone');
assert(manifest.icons.length>=2);
assert(sw.includes('products.json')&&sw.includes('recipes.json'));
assert(fs.readFileSync(basedir+'app.js','utf8').includes('shopping-check'));
console.log('PASS: installable application, offline cache, local shopping checklist');

assert(fs.readFileSync(basedir+'app.js','utf8').includes('Учтена в группе «Рынок 2»'));

const tabIcon=fs.readFileSync(basedir+'assets/palleta-favicon-32.png');
const pwa192=fs.readFileSync(basedir+'assets/app-icon-192.png');
const pwa512=fs.readFileSync(basedir+'assets/app-icon-512.png');
const ico=fs.readFileSync(basedir+'favicon.ico');
for(const [x,side] of [[tabIcon,32],[pwa192,192],[pwa512,512]]){
 assert.deepStrictEqual([...x.subarray(0,8)],[137,80,78,71,13,10,26,10]);
 assert.strictEqual(x.readUInt32BE(16),side);
 assert.strictEqual(x.readUInt32BE(20),side);
}
assert.strictEqual(ico.readUInt16LE(2),1);
assert(index.includes('palleta-favicon-32.png?v=20261014-final'));
assert(manifest.icons.some(x=>x.sizes==='192x192')&&manifest.icons.some(x=>x.sizes==='512x512'));
assert(sw.includes('favicon.ico'));
console.log('PASS: approved Palleta favicon and PWA icon dimensions');
