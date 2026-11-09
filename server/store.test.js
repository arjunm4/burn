import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createStore} from './store.js';
import {server} from './index.js';
import {Readable} from 'node:stream';
test('approval stores exact override, releases dependency, prevents duplicates and persists',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'purchasing-'));const file=path.join(dir,'test.sqlite');let store=createStore(file);
 try {
  let r=store.mutate('sens','answer',{answer:'no',revision:0});assert.equal(r.status,'choosing');
  r=store.mutate('sens','select',{tier:0,revision:r.revision});assert.equal(r.status,'pending_approval');
  assert.throws(()=>store.mutate('sens','approve',{tier:1,revision:0}),/changed/);
  r=store.mutate('sens','approve',{tier:1,revision:r.revision});assert.equal(r.order.tier,1);assert.equal(store.get('cham').status,'pending_approval');
  assert.throws(()=>store.mutate('sens','approve',{tier:1,revision:r.revision}),/not awaiting/);
  store.close();store=createStore(file);assert.equal(store.get('sens').order.id,r.order.id);assert.equal(store.audit('sens').length,3);
  r=store.mutate('sens','reset',{revision:r.revision});assert.equal(r.answer,null);assert.equal(store.get('cham').status,'waiting');
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('Rev B substitute creates standard draft and invalid input cannot mutate state',()=>{
 const store=createStore(':memory:');try{assert.throws(()=>store.mutate('sens','answer',{answer:'maybe',revision:0}),/yes or no/);assert.equal(store.get('sens').revision,0);const r=store.mutate('sens','answer',{answer:'yes',revision:0});assert.equal(r.blocked,0);assert.equal(r.order.tier,0);assert.equal(r.status,'ordered');}finally{store.close();}
});
test('HTTP API validates mutations and streams completed tool results',async()=>{
 const store=createStore(':memory:');const app=server(null,store);
 const request=(url,options={})=>new Promise(resolve=>{
  const req=Readable.from(options.body?[options.body]:[]);Object.assign(req,{url,method:options.method||'GET',headers:options.headers||{}});
  const chunks=[];const res={headersSent:false,destroyed:false,status:200,writeHead(status){this.status=status;this.headersSent=true;},write(chunk){chunks.push(chunk);},end(chunk){if(chunk)chunks.push(chunk);const text=chunks.join('');resolve({status:this.status,text:async()=>text,json:async()=>JSON.parse(text)});}};
  app.emit('request',req,res);
 });
 try {
  assert.equal((await (await request('/api/requests')).json()).requests.length,7);
  const stream=await request('/api/requests/sens/run',{method:'POST'});const events=(await stream.text()).trim().split('\n').map(JSON.parse);assert.equal(events.at(-1).type,'run.completed');assert.equal(events.filter(e=>e.type==='tool.completed').length,4);
  const mutate=data=>request('/api/requests/sens/answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  assert.equal((await mutate({answer:'no'})).status,409);
  assert.equal((await mutate({answer:'no',revision:0})).status,200);
  assert.equal((await mutate({answer:'yes',revision:0})).status,409);
 }finally{store.close();}
});
test('new demo requests have independent identities and lifecycle state',()=>{
 const store=createStore(':memory:');try{
  assert.throws(()=>store.create({text:''}),/Enter a purchase/);
  const first=store.create({text:'ACS37002 x40 from Digi-Key, standard',requester:'Dana'});
  const second=store.create({text:'ACS37002 x40 from Digi-Key, priority'});
  assert.notEqual(first.id,second.id);assert.equal(first.scenario,'rev-c-demo');assert.equal(first.who,'Dana');
  store.mutate(first.id,'answer',{answer:'no',revision:0});assert.equal(store.get(second.id).status,'needs_answer');
  assert.equal(first.tiers[0].arrivesOn,'2026-11-21');assert.equal(first.neededBy,'2026-11-14');
 }finally{store.close();}
});
