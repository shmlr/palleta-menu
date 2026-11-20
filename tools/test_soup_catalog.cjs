'use strict';
// Editorial integration tests: recipe visibility, meal planning, and safe shopping lists.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const C=require('../core.js');
const recipes=JSON.parse(fs.readFileSync('recipes.json','utf8')).recipes;
const raw=JSON.parse(fs.readFileSync('products.json','utf8'));
const catalog=C.normalize(raw);
const soupIds=['derevenskiy','meksikanskiy','finskiy','vengerskiy','kukuruznyy','italyanskiy','syrnyy','turetskiy','frikadelki'].map(x=>'soup_'+x);
assert.equal(recipes.length,53,'44 original recipes plus nine distinct soups');
assert.equal(new Set(recipes.map(r=>r.id)).size,53,'duplicate recipe IDs');
assert.equal(raw.products.length,30,'unverified ingredients must not generate fictitious products');
C.checkRecipes(recipes,catalog);
const newIngredients=raw.ingredients.filter(i=>i.assortment_status==='unverified_not_in_public_catalog');
assert.equal(newIngredients.length,21);
assert(newIngredients.every(i=>i.sold_in_palleta===false&&i.product_ids.length===0),'unmapped ingredients cannot be put into store order');
for(const id of soupIds){
 const r=recipes.find(x=>x.id===id);
 assert(r,'missing '+id);
 assert.equal(r.meal,'lunch');
 assert.equal(r.steps.length,5);
 assert(r.minutes>0);
 const result=C.plan(catalog,recipes,{days:3,people:4,time:150,excl:[]},{fixed:{'0-lunch':id},seed:21});
 const lunch=result.slots.find(x=>x.key==='0-lunch');
 assert.equal(lunch.recipe?.id,id,id+' can be selected in 3-day menu');
 assert.equal(result.basket.shortages.length,0,'no unmet store requirement for '+id);
 for(const item of result.basket.externalItems){
  if(item.unmapped){
   assert.equal(item.p,null,'unmapped external need cannot have a fake SKU');
   assert.equal(item.stock,'unknown');
   assert.equal(item.priceCurrent,false);
  }
 }
 assert(result.basket.items.every(x=>x.p.sold_in_palleta!==false));
}
const finn=recipes.find(x=>x.id==='soup_finskiy');
const required=C.aggregate([finn],4);
const basket=C.basket(required,catalog);
assert(basket.externalItems.some(x=>x.ingredient==='red_fish'&&x.p===null&&x.quantity===.3));
assert(basket.externalItems.some(x=>x.ingredient==='cream20'&&x.p===null&&x.quantity===.2));
assert(!basket.items.some(x=>x.ingredient==='red_fish'||x.ingredient==='cream20'));
const home=C.basket(required,catalog,{},Date.now(),['red_fish']);
assert(home.homeItems.some(x=>x.ingredient==='red_fish'));
assert(!home.externalItems.some(x=>x.ingredient==='red_fish'));
const goulash=recipes.find(x=>x.id==='soup_vengerskiy');
assert(goulash.minutes>=90,'slow-cooked beef cannot be advertised as 40-minute soup');
console.log('PASS: 53 recipes, nine selectable soups, explicit unverified external needs, no invented SKUs/prices');
