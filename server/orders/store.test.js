import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createOrderStore} from './store.js';

const fields = {material: 'Al6061', finish: 'raw', tolerance: 'standard', quantity: 2, revision: 'A', inspection: 'standard', shipTo: 'Lab'};
function ready(store, approved = true) {
  let o = store.create({name: 'Bracket', cadHash: 'abc'});
  o = store.update(o.id, o.revision, {state: 'resolving'});
  o = store.update(o.id, o.revision, {state: 'recommended',
    spec: Object.entries(fields).map(([key,value]) => ({key,value,provenance:'engineer'})),
    quote: {quoteId:'q1',vendor:'xometry',completeness:'complete',options:[{tier:'Standard',priceCents:10000}]},
    decision: {snapshotHash:'snap',options:[{tier:'Standard',admissible:true}]}, decisionRevision: 1});
  o = store.freeze(o.id,o.revision,{partName:'Bracket',cadHash:'abc',fields,vendor:'xometry',quoteId:'q1',tier:'Standard',priceCents:10000,currency:'USD',total:{includesTax:true,includesShipping:true,varianceCents:0}});
  o = store.recordRamp(o.id,o.revision,{requestId:'r-'+o.id,approvalStatus:'PENDING'});
  o = store.update(o.id,o.revision,{state:'requested'});
  if (approved) {
    o = store.recordRamp(o.id,o.revision,{approvalStatus:'APPROVED',cardId:'c-'+o.id,paymentState:'issued'});
    o = store.update(o.id,o.revision,{state:'approved'});
  }
  return o;
}
const conflict = fn => assert.throws(fn,e=>e.status===409);

test('audit history omits CAD bodies and vault credential handles',()=>{
  const s=createOrderStore({filename:':memory:'});
  try {
    let o=s.create({name:'Private part'});
    o=s.update(o.id,o.revision,{context:{cad:{fileName:'part.step',bytes:'private-cad-body'}}});
    o=s.recordRamp(o.id,o.revision,{credentialRef:'private-vault-handle',cardLast4:'4242'});
    const history=JSON.stringify(s.events(o.id));
    assert.ok(!history.includes('private-cad-body'));assert.ok(!history.includes('private-vault-handle'));
    assert.ok(history.includes('part.step'));assert.ok(history.includes('4242'));
    assert.equal(s.get(o.id).ramp.credentialRef,'private-vault-handle');
  }finally{s.close();}
});

test('revision checks, immutable freeze, and no generic placement bypass',()=>{
  const s=createOrderStore({filename:':memory:'});
  try {
    const o=ready(s);
    conflict(()=>s.update(o.id,o.revision-1,{state:'cancelled'}));
    conflict(()=>s.update(o.id,o.revision,{state:'placed'}));
    conflict(()=>s.update(o.id,o.revision,{quote:{}}));
    assert.throws(()=>s.update(o.id,o.revision,{specHash:'forged'}));
    assert.equal(s.get(o.id).state,'approved');
  } finally {s.close();}
});
test('atomic duplicate event and failure rollback preserve retryability',()=>{
  const s=createOrderStore({filename:':memory:'});
  try {
    const o=ready(s,false);
    assert.throws(()=>s.processEvent('ramp','evt',()=>{s.recordRamp(o.id,o.revision,{approvalStatus:'APPROVED'});throw Error('crash');}));
    assert.equal(s.seenEvent('ramp','evt'),false);
    assert.equal(s.get(o.id).ramp.approvalStatus,'PENDING');
    const accept=()=>{let r=s.get(o.id);r=s.recordRamp(r.id,r.revision,{approvalStatus:'APPROVED'});return s.update(r.id,r.revision,{state:'approved'});};
    assert.equal(s.processEvent('ramp','evt',accept).duplicate,false);
    const rev=s.get(o.id).revision;
    assert.equal(s.processEvent('ramp','evt',()=>{throw Error('must not run');}).duplicate,true);
    assert.equal(s.get(o.id).revision,rev);
  } finally {s.close();}
});
test('superseded request cannot approve, even with a later-arriving event',()=>{
  const s=createOrderStore({filename:':memory:'});
  try {let o=ready(s,false);o=s.update(o.id,o.revision,{state:'superseded'});conflict(()=>s.recordRamp(o.id,o.revision,{approvalStatus:'APPROVED'}));}finally{s.close();}
});
test('out-of-order pending approval and issued-card events cannot regress terminal facts',()=>{
  const s=createOrderStore({filename:':memory:'});
  try {
    let o=ready(s);
    conflict(()=>s.recordRamp(o.id,o.revision,{approvalStatus:'PENDING'}));
    o=s.recordRamp(o.id,o.revision,{paymentState:'charged',transactionIds:['t1']});
    conflict(()=>s.recordRamp(o.id,o.revision,{paymentState:'issued'}));
    assert.equal(s.get(o.id).paymentState,'charged');
    assert.equal(s.get(o.id).ramp.approvalStatus,'APPROVED');
  }finally{s.close();}
});
test('unknown result blocks another checkout and requires reconciliation',()=>{
  const s=createOrderStore({filename:':memory:'});
  try {
    const o=ready(s),a=s.beginPlacement(o.id,o.revision);
    conflict(()=>s.beginPlacement(o.id,s.get(o.id).revision));
    let r=s.endPlacement(a.id,'unknown',{reason:'lost connection'});
    conflict(()=>s.beginPlacement(o.id,r.revision));
    r=s.reconcile(o.id,{vendorOrderId:'vendor-1'});
    assert.equal(r.state,'placed');conflict(()=>s.beginPlacement(o.id,r.revision));
    assert.equal(s.attempts(o.id).length,1);
  } finally{s.close();}
});
test('restart mid-placement recovers uncertainty and retains the attempt',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'burn-order-'));const filename=path.join(dir,'db.sqlite');
  let s=createOrderStore({filename});
  try {
    const o=ready(s);s.beginPlacement(o.id,o.revision);s.close();s=createOrderStore({filename});
    assert.equal(s.get(o.id).state,'placement_unknown');assert.equal(s.attempts(o.id)[0].outcome,'unknown');
    conflict(()=>s.beginPlacement(o.id,s.get(o.id).revision));
    assert.equal(s.reconcile(o.id,{vendorOrderId:'existing-order'}).state,'placed');
  }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
test('booking retries never modify placement and transaction IDs deduplicate',()=>{
  const s=createOrderStore({filename:':memory:'});
  try {
    const o=ready(s),a=s.beginPlacement(o.id,o.revision);
    let r=s.endPlacement(a.id,'succeeded',{vendorOrderId:'vendor-1'});
    for(const bookingState of ['failed','receipt_attached','memo_added','coded'])r=s.recordRamp(o.id,r.revision,{bookingState,paymentState:'charged',transactionIds:['t1','t1']});
    assert.equal(r.state,'placed');assert.deepEqual(r.ramp.transactionIds,['t1']);assert.equal(s.attempts(o.id).length,1);
  }finally{s.close();}
});
test('separate orders may share a spec without sharing purchase identity',()=>{
  const s=createOrderStore({filename:':memory:'});
  try{const a=ready(s),b=ready(s);assert.equal(a.specHash,b.specHash);assert.notEqual(a.id,b.id);assert.notEqual(s.beginPlacement(a.id,a.revision).id,s.beginPlacement(b.id,b.revision).id);}finally{s.close();}
});
