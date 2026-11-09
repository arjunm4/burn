import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {decisions, deriveDecisions, ORDER_DATE, arrivalDate} from '../src/decisions.js';
import {openQuestionFor} from './agent/tools.js';
export class AppError extends Error { constructor(message, status=400) {super(message);this.status=status;} }
export function createStore(filename=process.env.PURCHASING_DB || 'data/purchasing.sqlite') {
  if (filename !== ':memory:') mkdirSync(path.dirname(filename),{recursive:true});
  const db=new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, at TEXT NOT NULL, action TEXT NOT NULL, body TEXT NOT NULL)');
  const save=r=>db.prepare('INSERT OR REPLACE INTO requests VALUES (?,?)').run(r.id,JSON.stringify(r));
  const all=()=>db.prepare('SELECT body FROM requests ORDER BY rowid').all().map(row=>JSON.parse(row.body));
  const get=id=>{const row=db.prepare('SELECT body FROM requests WHERE id=?').get(id);if(!row)throw new AppError('Request not found',404);return JSON.parse(row.body);};
  const audit=(r,action)=>db.prepare('INSERT INTO audit VALUES (?,?,?,?,?)').run(randomUUID(),r.id,new Date().toISOString(),action,JSON.stringify(r));
  const draft=(r,tier)=>{r.status='ordered';r.selectedTier=tier;r.approvedTier=tier;r.order={id:'PO-'+randomUUID().slice(0,8),tier,status:'draft',part:r.part,qty:r.qty??null,vendor:r.vendor??null,shipping:{...r.tiers[tier]},createdAt:new Date().toISOString()};};
  if (!all().length) {
    for(const decision of deriveDecisions()) {
      const {tiers, rec, cheapest, premium, avoided, done, waitingOn, kind,...raw}=decision;
      const r={...raw,asked:decision.id==='sens'?0:raw.asked,orderDate:ORDER_DATE,neededBy:arrivalDate(Math.min(...tiers.map(t=>t.days))+raw.slack),tiers:decisions.find(d=>d.id===decision.id).tiers.map(t=>({...t,arrivesOn:arrivalDate(t.days)})),status:decision.id==='sens'?'needs_answer':kind==='wait'?'waiting':kind==='need'?'pending_approval':'ordered',answer:null,selectedTier:rec.i,approvedTier:null,revision:0,order:null};
      if(r.status==='ordered')draft(r,rec.i);save(r);
    }
  }
  function create(input={}) {
    if(typeof input.text!=='string'||!input.text.trim()||input.text.length>2000)throw new AppError('Enter a purchase request (up to 2000 characters)');
    if(input.requester!==undefined&&(typeof input.requester!=='string'||input.requester.length>120))throw new AppError('Invalid requester');
    const base=structuredClone(decisions[0]);
    const r={...base,id:'req-'+randomUUID(),pr:'PR-'+randomUUID().slice(0,8).toUpperCase(),text:input.text.trim(),who:input.requester?.trim()||base.who,asked:0,orderDate:ORDER_DATE,neededBy:arrivalDate(5),tiers:base.tiers.map(t=>({...t,arrivesOn:arrivalDate(t.days)})),status:'needs_answer',answer:null,selectedTier:null,approvedTier:null,revision:0,order:null,approvalReasons:[],scenario:'rev-c-demo'};
    db.exec('BEGIN IMMEDIATE');try{save(r);audit(r,'created');db.exec('COMMIT');return r;}catch(error){db.exec('ROLLBACK');throw error;}
  }
  function finishAnalysis(id, revision, result) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const r=get(id);
      if(r.revision!==revision)throw new AppError('Request changed during analysis. Refresh and try again.',409);
      if(r.status!=='needs_answer')throw new AppError('Request is not awaiting analysis',409);
      const match=decisions.find(d=>d.id===result.parsed?.decisionId);
      r.analysis={planner:result.planner,parsed:result.parsed,tools:result.tools||[]};
      if(!match){r.status='unsupported';r.question=null;r.analysis.note='No matching part in the demo catalog. No purchase order can be created.';}
      else {
        const identity={id:r.id,pr:r.pr,who:r.who,text:r.text};
        Object.assign(r,structuredClone(match),identity);
        r.catalogId=match.id;r.asked=Number.isInteger(result.parsed.askedTier)&&match.tiers[result.parsed.askedTier]?result.parsed.askedTier:0;
        const catalogQty=Number(match.part.match(/×\s*(\d+)/)?.[1])||null;
        r.catalogQty=catalogQty;
        r.qty=Number.isSafeInteger(result.parsed.qty)&&result.parsed.qty>0?result.parsed.qty:catalogQty;
        if(catalogQty&&r.qty)r.part=match.part.replace(/×\s*\d+/,`× ${r.qty}`);
        r.vendor=typeof result.parsed.vendor==='string'?result.parsed.vendor:null;
        r.tiers=r.tiers.map(t=>({...t,arrivesOn:arrivalDate(t.days)}));
        r.neededBy=arrivalDate(Math.min(...r.tiers.map(t=>t.days))+r.slack);
        const open=openQuestionFor(match.id);
        r.question=open?{id:open.id,text:typeof result.question?.text==='string'?result.question.text:open.ask,choices:open.choices}:null;
        r.status=open?'needs_answer':r.dep&&get(r.dep).status!=='ordered'?'waiting':'choosing';
      }
      r.revision++;save(r);audit(r,'analysis_completed');db.exec('COMMIT');return r;
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  function snapshot(){const requests=all();const approved=Object.fromEntries(requests.filter(r=>r.status==='ordered').map(r=>[r.id,true]));const resolvedBy=Object.fromEntries(requests.filter(r=>r.dep&&approved[r.dep]).map(r=>[r.id,get(r.dep).pr]));return {requests,approved,resolvedBy};}
  function mutate(id,action,input={}) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const r=get(id);
      if(!input||typeof input!=='object'||Array.isArray(input))throw new AppError('Expected a JSON object');
      if(!Number.isInteger(input.revision)||input.revision!==r.revision)throw new AppError('Request changed. Refresh and try again.',409);
      const derived=()=>deriveDecisions([r])[0];
      const checkTier=()=>{if(!Number.isInteger(input.tier)||!r.tiers[input.tier])throw new AppError('Invalid shipping option');};
      if(action==='answer') {
        if(r.status!=='needs_answer')throw new AppError('Request is not awaiting an answer',409);
        if(r.text&&!r.analysis)throw new AppError('Complete analysis before answering',409);
        input.answer=input.choiceId||input.answer;
        if(input.answer==='revb_yes')input.answer='yes';if(input.answer==='revb_no')input.answer='no';
        if(r.catalogId&&r.catalogId!=='sens')throw new AppError('This request has no Rev B question');
        if(!['yes','no'].includes(input.answer))throw new AppError('Answer must be yes or no');
        r.answer=input.answer;r.question=null;
        if(r.answer==='yes'){r.blocked=0;r.slack=30;r.basis='Dana confirmed Rev B can substitute';draft(r,0);}else r.status='choosing';
      } else if(action==='select') {
        if(r.status!=='choosing')throw new AppError('Request is not awaiting selection',409);
        checkTier();r.selectedTier=input.tier;r.approvalReasons=[...(r.tiers[input.tier].price>500?['over_limit']:[]),...(input.tier!==derived().rec.i?['off_recommendation']:[])];
        if(r.tiers[input.tier].price>500||input.tier!==derived().rec.i)r.status='pending_approval';else draft(r,input.tier);
      } else if(action==='approve') {
        if(r.status!=='pending_approval')throw new AppError('Request is not awaiting approval',409);
        if(r.dep&&get(r.dep).status!=='ordered')throw new AppError('Dependency is unresolved',409);
        checkTier();draft(r,input.tier);
      } else if(action==='reset') {
        if(id!=='sens')throw new AppError('Only the engineer demo can be restarted');
        Object.assign(r,structuredClone(decisions[0]),{asked:0,status:'needs_answer',answer:null,selectedTier:null,approvedTier:null,order:null,approvalReasons:[],analysis:null,question:null});
        // A restarted parent invalidates dependent drafts and recommendations.
        for(const child of all().filter(x=>x.dep===id)){child.status='waiting';child.order=null;child.approvedTier=null;child.revision++;save(child);audit(child,'dependency_reset');}
      } else throw new AppError('Unknown action',404);
      r.revision++;save(r);audit(r,action);
      if(r.status==='ordered')for(const child of all().filter(x=>x.status==='waiting'&&(x.dep===id||(r.catalogId&&x.dep===r.catalogId&&x.project===r.project&&(!r.catalogQty||r.qty>=r.catalogQty))))){child.dep=id;child.status='pending_approval';child.revision++;save(child);audit(child,'dependency_resolved');}
      db.exec('COMMIT');return r;
    } catch(error){db.exec('ROLLBACK');throw error;}
  }
  return {snapshot,get,create,finishAnalysis,mutate,close:()=>db.close(),audit:id=>db.prepare('SELECT * FROM audit WHERE request_id=? ORDER BY rowid').all(id).map(e=>({...e,body:JSON.parse(e.body)}))};
}
