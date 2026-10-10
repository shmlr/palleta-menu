const fs=require('fs'),assert=require('assert'),C=require('./core.js');
const base=JSON.parse(fs.readFileSync(__dirname+'/products.json','utf8'));
const rs=JSON.parse(fs.readFileSync(__dirname+'/recipes.json','utf8')).recipes;
const prefs={people:4,time:60,budget:12000,excl:[]};
function clone(){return structuredClone(base)};
const now=Date.now(),stamp=new Date(now-5*60000).toISOString();
function check(c){const cc=C.normalize(c);C.checkRecipes(rs,cc);return cc}
let c=check(clone());let r=C.plan(c,rs,prefs,{now});
assert.strictEqual(r.totalSlots,21);assert.strictEqual(r.filled,21);assert(!r.basket.allStock);assert.strictEqual(r.basket.confirmedTotal,null);
assert.strictEqual(rs.filter(x=>x.meal==='breakfast').length,12);
assert.strictEqual(rs.filter(x=>x.meal==='lunch').length,14);
assert.strictEqual(rs.filter(x=>x.meal==='dinner').length,16);
console.log('PASS: 42 recipes, three meals, 21 tentative slots, unknown stock never verified');
let all=clone();all.products.forEach(p=>{p.availability='in_stock';p.availability_checked_at=stamp;p.stock_quantity=1000;p.price=100;p.price_source='current_club';p.price_type='Оптовая, RUB';p.price_as_of=stamp});
c=check(all);r=C.plan(c,rs,prefs,{now});assert.strictEqual(r.filled,21);assert.strictEqual(r.basket.allStock,true);assert.strictEqual(r.basket.allCurrent,true);assert(Number.isFinite(r.basket.confirmedTotal));
console.log('PASS: fresh stock + club prices allow cardholder basket amount');
let ordinary=clone();ordinary.products.forEach(p=>{p.availability='in_stock';p.availability_checked_at=stamp;p.stock_quantity=1000;p.price=100;p.price_source='current_retail';p.price_type='Розничная, RUB';p.price_as_of=stamp});
c=check(ordinary);r=C.plan(c,rs,prefs,{now});assert.strictEqual(r.basket.confirmedTotal,null);assert.strictEqual(r.basket.allCurrent,false);
console.log('PASS: ordinary retail is not accepted as a club price');
let absent=clone();absent.products.forEach(p=>{p.availability='out_of_stock';p.availability_checked_at=stamp;p.stock_quantity=0});
c=check(absent);r=C.plan(c,rs,prefs,{now});assert.strictEqual(r.filled,0);assert.strictEqual(r.basket.items.length,0);
console.log('PASS: all unavailable -> empty slots, not imaginary order');
let noFish=clone();for(const p of noFish.products){p.availability='in_stock';p.availability_checked_at=stamp;p.stock_quantity=1000;if(p.ingredient==='fish'){p.availability='out_of_stock';p.stock_quantity=0}}
c=check(noFish);r=C.plan(c,rs,prefs,{now});assert.strictEqual(r.filled,21);assert(r.slots.every(s=>!s.recipe||!s.recipe.tags.includes('fish')));
console.log('PASS: recipe replacement when white fish completely out of stock');
let restricted=clone();restricted.products.forEach(p=>{p.availability='in_stock';p.availability_checked_at=stamp;p.stock_quantity=1000});
c=check(restricted);r=C.plan(c,rs,{...prefs,excl:['fish','gluten','dairy','eggs']},{now});assert(r.filled<21);assert(r.slots.every(s=>!s.recipe||s.recipe.tags.every(t=>!['fish','gluten','dairy','eggs'].includes(t))));
console.log('PASS: exclusions strictly obeyed');
let onePack=clone();onePack.products.forEach(p=>{p.availability='in_stock';p.availability_checked_at=stamp;p.stock_quantity=1000});
const eggs=onePack.products.find(p=>p.id==='eggs_co_10');eggs.stock_quantity=1;
c=check(onePack);r=C.plan(c,rs,prefs,{now});const eg=r.basket.items.filter(x=>x.p.id==='eggs_co_10');assert((eg[0]?.packs||0)<=1);assert(!r.basket.shortages.length);
console.log('PASS: weekly sum never exceeds 1 egg package in stock');
const mix=clone();const egg=mix.products.find(p=>p.id==='eggs_co_10');egg.availability='in_stock';egg.availability_checked_at=stamp;egg.stock_quantity=1;
c=check(mix);const alloc=C.allocateIngredient(c.byIngredient.eggs,12,c,{},now);assert.strictEqual(alloc.alloc.length,1);assert.strictEqual(alloc.alloc[0].packs,1);assert(alloc.short>0);
console.log('PASS: packing math and shortage detection for 12 eggs / 10 eggs available');
// Incompatible grams of Vkusnoteevo must never be used as a liter substitute.
let milk=c.byIngredient.milk;const candidates=milk.product_ids.map(id=>c.byProduct[id]).filter(p=>C.validProduct(p,milk));assert.strictEqual(candidates.length,1);assert.strictEqual(candidates[0].id,'darman_milk_1l');
console.log('PASS: mass-to-volume substitution blocked');
console.log('ALL CORE TESTS PASS');