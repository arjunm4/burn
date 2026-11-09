import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createStore} from './store.js';
import {server} from './index.js';
import {Readable} from 'node:stream';
import {analyze} from './agent/index.js';
process.env.AGENT_OFFLINE='1';
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
  const stream=await request('/api/requests/sens/run',{method:'POST'});const events=(await stream.text()).trim().split('\n').map(JSON.parse);assert.equal(events.at(-1).type,'run.completed');assert.equal(events.filter(e=>e.type==='tool.completed').length,5);
  const mutate=data=>request('/api/requests/sens/answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  assert.equal((await mutate({answer:'no'})).status,409);
  assert.equal((await mutate({answer:'no',revision:1})).status,200);
  assert.equal((await mutate({answer:'yes',revision:0})).status,409);
 }finally{store.close();}
});
test('new demo requests have independent identities and lifecycle state',()=>{
 const store=createStore(':memory:');try{
  assert.throws(()=>store.create({text:''}),/Enter a purchase/);
  const first=store.create({text:'ACS37002 x40 from Digi-Key, standard',requester:'Dana'});
  const second=store.create({text:'ACS37002 x40 from Digi-Key, priority'});
  assert.notEqual(first.id,second.id);assert.equal(first.scenario,'rev-c-demo');assert.equal(first.who,'Dana');
  assert.throws(()=>store.mutate(first.id,'answer',{answer:'no',revision:0}),/Complete analysis/);assert.equal(store.get(second.id).status,'needs_answer');
  assert.equal(first.tiers[0].arrivesOn,'2026-11-21');assert.equal(first.neededBy,'2026-11-14');
 }finally{store.close();}
});

test('agent results persist trusted catalog facts and choice aliases',async()=>{
 const store=createStore(':memory:');try{
  const r=store.create({text:'ACS37002 x40 from Digi-Key, expedited'});
  const result=await analyze(r);const saved=store.finishAnalysis(r.id,0,result);
  assert.equal(saved.asked,2);assert.equal(saved.analysis.planner,'fallback');assert.equal(saved.question.id,'revb');
  assert.equal(store.mutate(r.id,'answer',{revision:saved.revision,choiceId:'revb_no'}).status,'choosing');
  assert.throws(()=>store.finishAnalysis(r.id,0,result),/changed during analysis/);
 }finally{store.close();}
});
test('unknown catalog parts cannot bypass analysis to create orders',async()=>{
 const store=createStore(':memory:');try{
  const r=store.create({text:'Unobtainium widget x2'});const result=await analyze(r);
  const saved=store.finishAnalysis(r.id,0,result);assert.equal(saved.status,'unsupported');assert.equal(saved.question,null);
  assert.throws(()=>store.mutate(r.id,'answer',{revision:saved.revision,answer:'yes'}),/not awaiting/);
  assert.throws(()=>store.mutate(r.id,'select',{revision:saved.revision,tier:0}),/not awaiting/);
  assert.equal(store.get(r.id).order,null);
 }finally{store.close();}
});
test('matched non-sensor requests use their catalog costs and skip Rev B question',async()=>{
 const store=createStore(':memory:');try{
  const r=store.create({text:'Scope probes x3'});const saved=store.finishAnalysis(r.id,0,await analyze(r));
  assert.equal(saved.catalogId,'probe');assert.equal(saved.status,'choosing');assert.equal(saved.tiers.length,1);
  const ordered=store.mutate(r.id,'select',{revision:saved.revision,tier:0});assert.equal(ordered.order.tier,0);
 }finally{store.close();}
});
test('parsed purchase identity agrees with approval and immutable draft',async()=>{
 const store=createStore(':memory:');try{
  const r=store.create({text:'ACS37002 x2 from Mouser, expedited'});const saved=store.finishAnalysis(r.id,0,await analyze(r));
  assert.equal(saved.qty,2);assert.equal(saved.part,'ACS37002 sensors × 2');
  let next=store.mutate(r.id,'answer',{revision:saved.revision,answer:'no'});
  next=store.mutate(r.id,'select',{revision:next.revision,tier:2});next=store.mutate(r.id,'approve',{revision:next.revision,tier:2});
  assert.equal(next.order.qty,2);assert.equal(next.order.vendor,'Mouser');assert.equal(next.order.part,next.part);assert.equal(next.order.shipping.price,1200);
  assert.equal(store.get('cham').status,'waiting');
 }finally{store.close();}
});
test('an approved catalog-sized replacement purchase fulfills matching project dependency',async()=>{
 const store=createStore(':memory:');try{
  const r=store.create({text:'ACS37002 x40 from Digi-Key, expedited'});let next=store.finishAnalysis(r.id,0,await analyze(r));
  next=store.mutate(r.id,'answer',{revision:next.revision,answer:'no'});next=store.mutate(r.id,'select',{revision:next.revision,tier:2});
  next=store.mutate(r.id,'approve',{revision:next.revision,tier:2});
  const chamber=store.get('cham');assert.equal(chamber.status,'pending_approval');assert.equal(chamber.dep,r.id);assert.equal(store.snapshot().resolvedBy.cham,r.pr);
 }finally{store.close();}
});
