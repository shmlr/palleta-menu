'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..');
const C=require('../core.js');
const catalog=C.normalize(JSON.parse(fs.readFileSync(path.join(ROOT,'products.json'),'utf8')));
const recipes=JSON.parse(fs.readFileSync(path.join(ROOT,'recipes.json'),'utf8')).recipes;
const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const source=fs.readFileSync(path.join(__dirname,'app.js'),'utf8');
assert(recipes.length>=40,'must use existing production editorial catalogue');
C.checkRecipes(recipes,catalog);
assert.equal(new Set(recipes.map(x=>x.id)).size,recipes.length,'recipe IDs must be unique');
assert(html.includes('../core.js')&&html.includes('./app.js'),'scripts linked');
assert(!html.includes('recipe-studio/recipe_candidates'),'unverified recipe drafts are not published');
assert(html.includes('name="robots" content="noindex,nofollow"'));
assert(source.includes('localStorage')&&source.includes('data-fav')&&source.includes('data-cookdays'));
assert(source.includes('data-repeat')&&source.includes('data-home'));
assert(source.includes('b.confirmedTotal!==null'),'never present historical prices as live');
assert(source.includes("brand==='berbena'"),'brand mode exists');
new vm.Script(source,{filename:'recipe-studio/app.js'});
for(const days of [3,7]){
 const p=C.plan(catalog,recipes,{days,people:4,time:999,excl:[]},{atHome:['potato']});
 assert.equal(p.totalSlots,days*3);
 assert.equal(p.filled,p.totalSlots);
 assert.equal(p.basket.confirmedTotal,null,'historical prices cannot form confirmed total');
 assert(!p.basket.items.some(it=>it.ingredient==='potato'),'pantry items excluded from retail basket');
 assert(p.basket.homeItems.some(it=>it.ingredient==='potato'));
 assert(!p.basket.items.some(it=>it.p.sold_in_palleta===false),'meat must not leak into store basket');
}
const N=require('./nutrition.js');
assert(html.includes('./nutrition.js'),'nutrition loaded for berbena mode');
assert.equal(Object.keys(N.editorial).length,catalog.ingredients.length,'nutrition entries map exactly to all currently supported ingredients');
for(const item of catalog.ingredients){
 const n=N.editorial[item.id];
 assert(n,'missing calorie reference: '+item.id);
 assert.equal(n.unit,item.unit,'unit mismatch for '+item.id);
 assert(n.kcal_per_100g>0&&n.grams_per_unit>0,'invalid editorial nutrition value');
}
for(const recipe of recipes){
 const n=N.estimate(recipe,catalog);
 assert(Number.isFinite(n.kcal),'calories unavailable for '+recipe.id);
 assert.equal(n.status,'unverified_editorial_estimate');
 assert.equal(n.kcal%10,0,'avoid false precision');
}
const eggRecipe=recipes.find(x=>x.id==='egg_tomato');
const eggEstimate=N.estimate(eggRecipe,catalog);
assert.equal(eggEstimate.kcal,Math.round(eggEstimate.unrounded_kcal/10)*10);
assert.equal(N.estimate({...eggRecipe,ingredients_per_person:{...eggRecipe.ingredients_per_person,missing:0.1}},catalog).kcal,null,'unknown ingredients must not be assumed zero');
const unitMismatch=structuredClone(catalog);unitMismatch.byIngredient={...unitMismatch.byIngredient,eggs:{...unitMismatch.byIngredient.eggs,unit:'kg'}};
assert.equal(N.estimate(eggRecipe,unitMismatch).kcal,null,'unit mismatch must block calculation');
assert(source.includes("if(brand==='palleta')view='plan'"),'Palleta hides cook/catalog');
assert(source.includes("if(brand==='palleta')h+=planHtml()"),'brand router');
assert(source.includes('Калорийность неизвестна'),'unknown calorie state');

const first=recipes.find(r=>r.meal==='breakfast');
const pinned=C.plan(catalog,recipes,{days:3,people:4,time:999,excl:[]},{fixed:{'0-breakfast':first.id,'1-breakfast':first.id}});
assert.equal(pinned.slots[0].recipe.id,first.id);
assert.equal(pinned.slots[3].recipe.id,first.id);
console.log('PASS recipe-studio: calorie coverage and uncertainty, separate brand modes, basket, 3/7 days');