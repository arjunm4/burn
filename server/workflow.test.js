import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {server} from './index.js';
import {createStore} from './store.js';
import {buildConversation} from '../src/conversation.js';
process.env.AGENT_OFFLINE='1';

test('new request crosses agent, engineer, approver, conversation and audit APIs',async()=>{
 const store=createStore(':memory:');const app=server(null,store);
 const http=(url,input)=>new Promise(resolve=>{
  const req=Readable.from(input?[JSON.stringify(input)]:[]);Object.assign(req,{url,method:input?'POST':'GET',headers:{}});
  const chunks=[];const res={headersSent:false,destroyed:false,status:200,writeHead(status){this.status=status;this.headersSent=true;},write(chunk){chunks.push(chunk);},end(chunk){if(chunk)chunks.push(chunk);resolve({status:this.status,text:chunks.join('')});}};
  app.emit('request',req,res);
 });
 const post=async(url,input)=>{const response=await http(url,input);assert.ok(response.status<300,response.text);return JSON.parse(response.text);};
 try {
  let {request}=await post('/api/requests',{text:'ACS37002 x40 from Digi-Key, standard'});const endpoint='/api/requests/'+request.id;
  const run=await http(endpoint+'/run',{});const events=run.text.trim().split('\n').map(JSON.parse);request=events.at(-1).request;
  assert.equal(request.question.choices[1].id,'revb_no');assert.equal(request.analysis.tools.length,5);
  ({request}=await post(endpoint+'/answer',{revision:request.revision,choiceId:'revb_no'}));
  assert.ok(buildConversation(request).some(m=>m.rows?.some(row=>row.action?.type==='select')));
  ({request}=await post(endpoint+'/select',{revision:request.revision,tier:2}));assert.equal(request.status,'pending_approval');
  assert.ok(buildConversation(request).some(m=>m.status==='Waiting on Priya'));
  const snapshot=JSON.parse((await http('/api/requests')).text);assert.equal(snapshot.requests.find(r=>r.id===request.id).selectedTier,2);
  ({request}=await post(endpoint+'/approve',{revision:request.revision,tier:1}));
  assert.equal(request.order.shipping.name,'Priority');assert.equal(request.order.shipping.price,650);
  assert.ok(buildConversation(request).some(m=>/Priya approved priority/.test(m.text||'')));
  const final=JSON.parse((await http('/api/requests')).text);assert.equal(final.approved[request.id],true);assert.equal(final.requests.find(r=>r.id==='cham').dep,request.id);
  const audit=JSON.parse((await http(endpoint+'/audit')).text);assert.deepEqual(audit.events.map(e=>e.action),['created','analysis_completed','answer','select','approve']);
  assert.equal((await http(endpoint+'/approve',{revision:request.revision,tier:1})).status,409);
 }finally{store.close();}
});
