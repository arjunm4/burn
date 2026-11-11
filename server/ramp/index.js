import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {randomUUID, createHmac, timingSafeEqual} from 'node:crypto';

export function signWebhook(body, secret) { return createHmac('sha256', secret).update(body).digest('hex'); }
export function verifyWebhook(body, signature, secret) {
  if (!secret || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(signWebhook(body, secret), 'hex'));
}
const no = (reason, capability) => ({ok: false, reason, ...(capability ? {capability} : {})});
const text = value => typeof value === 'string' && value.trim().length > 0;
const capabilities = enabled => ({purchaseRequests: enabled, vaultCards: enabled, itemReceipts: false, webhooks: enabled});

export function createRampClient({mode = 'mock', filename = 'data/orders.sqlite', webhookUrl, webhookSecret = process.env.RAMP_WEBHOOK_SECRET, fetchImpl = fetch} = {}) {
  if (!['mock', 'sandbox'].includes(mode)) throw Error('Unknown Ramp mode');
  if (mode === 'sandbox') {
    // Explicitly unavailable until individual operations are verified in the target business.
    // Do not make an unverified external financial call just because credentials exist.
    const unavailable = async () => no('Ramp sandbox integration is not verified; use the declared mock adapter', 'sandbox');
    return {describe: () => ({mode, capabilities: capabilities(false)}), createRequest: unavailable, getRequest: unavailable,
      issueCard: unavailable, book: unavailable, onEvent: () => {}, close: () => {}};
  }
  if (webhookUrl && !webhookSecret) throw Error('A secret is required for mock HTTP webhook delivery');
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), {recursive: true});
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS ramp_mock_records(kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(kind,id));
    CREATE TABLE IF NOT EXISTS ramp_mock_keys(kind TEXT NOT NULL, key TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(kind,key));
    CREATE TABLE IF NOT EXISTS ramp_mock_events(id TEXT PRIMARY KEY, body TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0);`);
  let handler;
  const get = (kind,id) => { const row=db.prepare('SELECT body FROM ramp_mock_records WHERE kind=? AND id=?').get(kind,id);return row ? JSON.parse(row.body) : null; };
  const put = (kind,id,body) => db.prepare('INSERT INTO ramp_mock_records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body').run(kind,id,JSON.stringify(body));
  const keyId = (kind,key) => key ? db.prepare('SELECT id FROM ramp_mock_keys WHERE kind=? AND key=?').get(kind,key)?.id : null;
  const keySave = (kind,key,id) => {if(key)db.prepare('INSERT INTO ramp_mock_keys VALUES(?,?,?)').run(kind,key,id);};
  function tx(fn) {db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}}
  function emit(type,payload) {
    const event={id:randomUUID(),type,payload,created_at:new Date().toISOString()};
    db.prepare('INSERT INTO ramp_mock_events(id,body) VALUES(?,?)').run(event.id,JSON.stringify(event));return event;
  }
  async function deliver(event) {
    try {
      if (webhookUrl) {
        const body=JSON.stringify(event);
        const response=await fetchImpl(webhookUrl,{method:'POST',headers:{'Content-Type':'application/json','X-Ramp-Signature':signWebhook(body,webhookSecret)},body,signal:AbortSignal.timeout(10000)});
        if(!response.ok)return no(`Webhook HTTP ${response.status}`);
      } else if(handler) await handler(structuredClone(event));
      else return no('No webhook receiver configured');
      db.prepare('UPDATE ramp_mock_events SET delivered=1 WHERE id=?').run(event.id);return {ok:true};
    }catch{return no('Webhook delivery failed; event remains available for replay');}
  }
  const allEvents=()=>db.prepare('SELECT body FROM ramp_mock_events ORDER BY rowid').all().map(row=>JSON.parse(row.body));
  async function createRequest(req = {}) {
    if(!text(req.request_owner_id)||!text(req.spend_program_id)||!text(req.currency)||!text(req.specHash)||!Number.isInteger(req.decisionRevision))return no('Incomplete purchase request');
    const key=req.idempotencyKey || req.orderId;
    return tx(()=>{
      const existing=keyId('request',key);
      if(existing){const old=get('request',existing);if(old.specHash!==req.specHash||old.decisionRevision!==req.decisionRevision)return no('Idempotency key belongs to a different decision');return {ok:true,requestId:existing,status:old.status};}
      const id=randomUUID();
      put('request',id,{...structuredClone(req),attachments:(req.attachments||[]).map(a=>({name:a.name,mime:a.mime,bytes:Buffer.from(a.bytes).toString('base64')})),id,status:'PENDING',created_at:new Date().toISOString()});keySave('request',key,id);
      return {ok:true,requestId:id,status:'PENDING'};
    });
  }
  async function getRequest(id) {
    const req=get('request',id);return req ? {status:req.status,specHash:req.specHash,decisionRevision:req.decisionRevision,approvedAt:req.approvedAt,requestId:id} : no('Request not found');
  }
  async function issueCard(card={}) {
    if(!text(card.orderId)||!text(card.user_id)||!Number.isSafeInteger(card.limitCents)||card.limitCents<=0||!Array.isArray(card.allowed_vendors)||!card.allowed_vendors.length||!card.allowed_vendors.every(text)||!Number.isFinite(Date.parse(card.lock_date))||Date.parse(card.lock_date)<=Date.now())return no('Invalid or expired card restrictions','vaultCards');
    return tx(()=>{
      const existing=keyId('card',card.orderId);
      if(existing){const old=get('card',existing);if(old.spending_restrictions.limit!==card.limitCents||JSON.stringify(old.allowed_vendors)!==JSON.stringify(card.allowed_vendors)||old.lock_date!==card.lock_date)return no('Order already has different card restrictions','vaultCards');return {ok:true,cardId:existing,last4:old.last4,credentialRef:old.credentialRef};}
      const id=randomUUID(),credentialRef='mock-vault:'+randomUUID();
      const value={id,user_id:card.user_id,orderId:card.orderId,spending_restrictions:{interval:'TOTAL',limit:card.limitCents},transaction_amount_limit:card.limitCents,allowed_vendors:card.allowed_vendors,lock_date:card.lock_date,last4:'4242',credentialRef,spentCents:0};
      put('card',id,value);keySave('card',card.orderId,id);return {ok:true,cardId:id,last4:'4242',credentialRef};
    });
  }
  async function book(txnId,doc={}) {
    return tx(()=>{
      const txn=get('transaction',txnId);if(!txn)return no('Transaction not found');
      const old=get('booking',txnId)||{};
      if(doc.receipt){if(!text(doc.receipt.name)||!doc.receipt.bytes)return no('Invalid receipt');old.receipt={name:doc.receipt.name,bytes:Buffer.from(doc.receipt.bytes).toString('base64')};}
      if(doc.memo!==undefined)old.memo=doc.memo;
      if(doc.coding!==undefined)old.coding=structuredClone(doc.coding);
      put('booking',txnId,old);return {ok:true};
    });
  }
  async function statusChange(id,status,{deliverEvent=true}={}) {
    const result=tx(()=>{
      const req=get('request',id);if(!req)return no('Request not found');
      if(req.status===status)return {ok:true,event:null};
      if(req.status!=='PENDING')return no('Request already has a terminal decision');
      req.status=status;if(status==='APPROVED')req.approvedAt=new Date().toISOString();put('request',id,req);
      return {ok:true,event:emit('unified_requests.'+status.toLowerCase(),{id,requestId:id,status,specHash:req.specHash,decisionRevision:req.decisionRevision})};
    });
    if(result.event&&deliverEvent)result.delivery=await deliver(result.event);
    return result;
  }
  async function charge(cardId,amountCents,{vendor='xometry',idempotencyKey,deliverEvent=true}={}) {
    const result=tx(()=>{
      const oldId=keyId('charge',idempotencyKey);
      if(oldId){const old=get('transaction',oldId);return old.card_id===cardId&&old.amount===amountCents?{ok:true,transactionId:oldId}:no('Charge key conflict');}
      const card=get('card',cardId);
      if(!card)return no('Card not found');
      if(!Number.isSafeInteger(amountCents)||amountCents<=0||amountCents+card.spentCents>card.spending_restrictions.limit)return no('Card amount limit exceeded');
      if(Date.parse(card.lock_date)<=Date.now()||!card.allowed_vendors.some(v=>v.toLowerCase()===vendor.toLowerCase()))return no('Card expired or vendor not allowed');
      const id=randomUUID();card.spentCents+=amountCents;put('card',cardId,card);
      put('transaction',id,{id,card_id:cardId,amount:amountCents,merchant_name:vendor,orderId:card.orderId,status:'CLEARED'});keySave('charge',idempotencyKey,id);
      return {ok:true,transactionId:id,event:emit('transactions.cleared',{id,transactionId:id,cardId,card_id:cardId,amount:amountCents,orderId:card.orderId})};
    });
    if(result.event&&deliverEvent)await deliver(result.event);
    return result.ok ? result.transactionId : result;
  }
  return {describe:()=>({mode,capabilities:capabilities(true)}),createRequest,getRequest,issueCard,book,
    onEvent:fn=>{handler=fn;},close:()=>db.close(),
    simulate:async()=>({approve:(id,options)=>statusChange(id,'APPROVED',options),reject:(id,options)=>statusChange(id,'REJECTED',options),
      cancel:(id,options)=>statusChange(id,'CANCELLED',options),charge,
      events:allEvents,replay:async ids=>Promise.all(ids.map(id=>{const event=allEvents().find(e=>e.id===id);return event?deliver(event):no('Event not found');})),
      inspect:(kind,id)=>get(kind,id)})};
}
