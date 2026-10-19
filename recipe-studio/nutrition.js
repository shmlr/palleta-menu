'use strict';
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.BerbenaNutrition=api;
})(typeof window!=='undefined'?window:globalThis,function(){
 /*
   РЕДАКЦИОННЫЕ ПРИБЛИЖЕНИЯ, НЕ ПРОВЕРЕННЫЕ ПО FDC ID:
   kcal_per_100g и граммовки условны, это не сведения с этикеток.
   Базовый метод: энергоценность на 100 г съедобной части × масса / 100.
   https://fdc.nal.usda.gov/Foundation_Foods_Documentation/
   Значения сверять по конкретным ингредиентам, состоянию продукта
   (сырой / сухой) и фактическому весу перед публичной публикацией.
 */
 const editorial={
   chicken: {kcal_per_100g:120,unit:'кг',grams_per_unit:1000,example:'Куриная грудка сырая без кожи'},
   mince: {kcal_per_100g:250,unit:'кг',grams_per_unit:1000,example:'Фарш говяжий, жирность не уточнена'},
   fish: {kcal_per_100g:82,unit:'кг',grams_per_unit:1000,example:'Белая нежирная рыба сырая'},
   rice: {kcal_per_100g:360,unit:'кг',grams_per_unit:1000,example:'Рис сухой'},
   flour: {kcal_per_100g:364,unit:'кг',grams_per_unit:1000,example:'Мука пшеничная сухая'},
   lentil: {kcal_per_100g:353,unit:'кг',grams_per_unit:1000,example:'Чечевица сухая'},
   noodles: {kcal_per_100g:370,unit:'кг',grams_per_unit:1000,example:'Лапша сухая'},
   eggs: {kcal_per_100g:143,unit:'шт',grams_per_unit:50,example:'Яйцо куриное: 50 г съедобной части на шт.'},
   milk: {kcal_per_100g:60,unit:'л',grams_per_unit:1030,example:'Молоко около 3% жирности'},
   cottage: {kcal_per_100g:121,unit:'кг',grams_per_unit:1000,example:'Творог средней жирности'},
   oil: {kcal_per_100g:884,unit:'л',grams_per_unit:920,example:'Подсолнечное масло, плотность 0,92 кг/л'},
   potato: {kcal_per_100g:77,unit:'кг',grams_per_unit:1000,example:'Картофель сырой, без кожуры'},
   onion: {kcal_per_100g:40,unit:'кг',grams_per_unit:1000,example:'Лук сырой'},
   carrot: {kcal_per_100g:41,unit:'кг',grams_per_unit:1000,example:'Морковь сырая'},
   tomato: {kcal_per_100g:18,unit:'кг',grams_per_unit:1000,example:'Помидоры сырые'},
   pepper: {kcal_per_100g:31,unit:'кг',grams_per_unit:1000,example:'Перец сладкий сырой'},
   zucchini: {kcal_per_100g:17,unit:'кг',grams_per_unit:1000,example:'Кабачки сырые'},
   pumpkin: {kcal_per_100g:26,unit:'кг',grams_per_unit:1000,example:'Тыква сырая'},
   greens: {kcal_per_100g:36,unit:'пучок',grams_per_unit:40,example:'Смешанная зелень: условный пучок 40 г'},
   offal: {kcal_per_100g:120,unit:'кг',grams_per_unit:1000,example:'Куриные потроха, усреднение не проверено'}
 };
 const methodology='https://fdc.nal.usda.gov/Foundation_Foods_Documentation/';
 function estimate(recipe,catalog){
   if(!recipe||!recipe.ingredients_per_person||!catalog?.byIngredient)return {kcal:null,reason:'invalid_recipe'};
   let total=0;const used=[];
   for(const [id,amount]of Object.entries(recipe.ingredients_per_person)){
     const v=editorial[id],ing=catalog.byIngredient[id];
     if(!v||!ing||ing.unit!==v.unit||!Number.isFinite(amount)||amount<=0||
        !Number.isFinite(v.kcal_per_100g)||!Number.isFinite(v.grams_per_unit)){
       return {kcal:null,reason:'missing_or_incompatible_nutrition',ingredient:id};
     }
     const component=amount*v.grams_per_unit*v.kcal_per_100g/100;
     total+=component;
     used.push({ingredient:id,unrounded_kcal:component});
   }
   if(!used.length)return {kcal:null,reason:'no_ingredients'};
   return {
     kcal:Math.round(total/10)*10,
     unrounded_kcal:total,
     status:'unverified_editorial_estimate',
     ingredient_count:used.length,
     methodology
   };
 }
 return {estimate,editorial,methodology};
});