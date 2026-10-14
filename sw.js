'use strict';
const CACHE='palleta-offline-v1-20261014-home';
const SHELL=['./','./index.html','./app.js','./core.js','./products.json','./recipes.json','./manifest.webmanifest','./assets/app-icon-192.png','./assets/app-icon-512.png','./assets/palleta-logo.webp'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('palleta-offline-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const req=event.request;if(req.method!=='GET'||new URL(req.url).origin!==self.location.origin)return;
 event.respondWith(fetch(req).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(req,copy)));}return response;}).catch(async()=>{const cached=await caches.match(req,{ignoreSearch:true});return cached||new Response('Нет подключения. Подключитесь к интернету для первой загрузки.',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});}));
});
