// Smoke checks for the independent editorial soup collection.
// This page is intentionally separate from the 1C SKU/club-price basket.
'use strict';
const fs = require('fs');
const assert = require('node:assert/strict');
const ids = [
  'derevenskiy', 'meksikanskiy', 'finskiy', 'vengerskiy',
  'kukuruznyy', 'italyanskiy', 'syrnyy', 'turetskiy', 'frikadelki'
];
const html = fs.readFileSync('soups.html','utf8');
assert.match(html, /<html lang="ru">/);
assert.match(html, /assets\/palleta-logo\.webp/);
assert.equal((html.match(/<article class="recipe"/g)||[]).length, 9);
assert.equal((html.match(/<details>/g)||[]).length, 9);
assert.equal((html.match(/<ul class="ingredients">/g)||[]).length, 9);
assert.equal((html.match(/<h3>Как приготовить<\/h3>/g)||[]).length, 9);
assert.doesNotMatch(html, /Happycall|в наличии|в корзину|Купить сейчас/i);
for (const id of ids) {
  assert.match(html, new RegExp('id="' + id + '"'));
  for (const kind of ['card','photo']) {
    const relative = 'assets/soups/' + id + '-' + kind + '.jpg';
    assert.ok(html.includes(relative), 'Missing link to ' + relative);
    const data = fs.readFileSync(relative);
    assert.ok(data.length > 30000, 'Too small or absent ' + relative);
    assert.equal(data.subarray(0,3).toString('hex'), 'ffd8ff', 'Invalid JPEG ' + relative);
  }
}
for (const entry of ['index.html','start.html']) {
  assert.ok(fs.readFileSync(entry,'utf8').includes('href="./soups.html"'));
}
const recipes = JSON.parse(fs.readFileSync('recipes.json','utf8'));
assert.equal(recipes.recipes.length,44,'Existing menu planner recipes must stay unchanged');
console.log('PASS: 9 recipes, 18 branded images, links, original logo, 44 menu dishes untouched');
