import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRampClient,verifyWebhook} from './index.js';
const request=(orderId='o1')=>({orderId,request_owner_id:'u1',spend_program_id:'p1',currency:'USD',name:'Bracket',specHash:'hash',decisionRevision:1,attachments:[]});
const card=()=>({user_id:'u1',limitCents:10000,allowed_vendors:['xometry'],lock_date:'2099-01-01',orderId:'o1'});

test('persistent request/card idempotency and independent booking retries',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'burn-ramp-')),filename=path.join(dir,'db.sqlite');let r=createRampClient({filename});
  try{
    const req=await r.createRequest(request()),c=await r.issueCard(card());
    assert.equal((await r.createRequest(request())).requestId,req.requestId);
    assert.notEqual((await r.createRequest(request('o2'))).requestId,req.requestId);
    r.close();r=createRampClient({filename});
    assert.equal((await r.issueCard(card())).cardId,c.cardId);
    assert.equal((await r.issueCard({...card(),limitCents:20000})).ok,false);
    const sim=await r.simulate();await sim.approve(req.requestId,{deliverEvent:false});
    assert.equal((await r.getRequest(req.requestId)).status,'APPROVED');
    const txn=await sim.charge(c.cardId,10000,{idempotencyKey:'charge1',deliverEvent:false});
    assert.equal(await sim.charge(c.cardId,10000,{idempotencyKey:'charge1',deliverEvent:false}),txn);
    assert.equal((await sim.charge(c.cardId,1)).ok,false);
    assert.equal((await r.book('missing',{memo:'x'})).ok,false);
    for(let i=0;i<2;i++)assert.equal((await r.book(txn,{receipt:{name:'r.pdf',bytes:Buffer.from('receipt')},memo:'bracket',coding:{project:'test'}})).ok,true);
    assert.equal(sim.inspect('card',c.cardId).spentCents,10000);
    assert.equal(sim.events().filter(e=>e.type==='transactions.cleared').length,1);
  }finally{r.close();rmSync(dir,{recursive:true,force:true});}
});
test('signed HTTP webhook travels through receiver and supports duplicate/out-of-order replay',async()=>{
  const received=[],secret='test-secret';
  const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;assert.equal(verifyWebhook(body,req.headers['x-ramp-signature'],secret),true);received.push(JSON.parse(body));res.end('ok');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const r=createRampClient({filename:':memory:',webhookUrl:`http://127.0.0.1:${server.address().port}/hook`,webhookSecret:secret});
  try{
    const sim=await r.simulate(),a=await r.createRequest(request('a')),b=await r.createRequest(request('b'));
    await sim.approve(a.requestId);await sim.reject(b.requestId);
    const events=sim.events();await sim.replay([events[1].id,events[0].id,events[0].id]);
    assert.deepEqual(received.map(e=>e.id),[events[0].id,events[1].id,events[1].id,events[0].id,events[0].id]);
    assert.equal((await r.getRequest(a.requestId)).status,'APPROVED');
    assert.equal(verifyWebhook('changed',received[0].id,secret),false);
  }finally{r.close();await new Promise(resolve=>server.close(resolve));}
});
test('delivery failure retains event for replay without reverting authoritative approval',async()=>{
  const r=createRampClient({filename:':memory:'});
  try{const req=await r.createRequest(request()),sim=await r.simulate();r.onEvent(()=>{throw Error('offline');});
    const result=await sim.approve(req.requestId);assert.equal(result.delivery.ok,false);assert.equal((await r.getRequest(req.requestId)).status,'APPROVED');
    const seen=[];r.onEvent(e=>{seen.push(e);});await sim.replay(sim.events().map(e=>e.id));assert.equal(seen.length,1);
    assert.equal((await sim.reject(req.requestId)).ok,false);
  }finally{r.close();}
});
test('mock enforces merchant and cumulative spend controls; sandbox fails explicitly',async()=>{
  const r=createRampClient({filename:':memory:'});
  try{const c=await r.issueCard(card()),sim=await r.simulate();assert.equal((await sim.charge(c.cardId,10,{vendor:'other'})).ok,false);
    assert.equal(typeof await sim.charge(c.cardId,6000),'string');assert.equal((await sim.charge(c.cardId,5000)).ok,false);
  }finally{r.close();}
  const sandbox=createRampClient({mode:'sandbox'});assert.equal(sandbox.describe().capabilities.vaultCards,false);assert.equal((await sandbox.issueCard(card())).ok,false);
});
