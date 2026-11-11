import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {analyze} from './agent/index.js';
import {createStore,AppError} from './store.js';
import {createIngest} from './ingest/index.js';
import {ingestRoutes} from './ingest/routes.js';
import {setActiveIngest} from './ingest/active.js';
import {timevalueRoutes} from './timevalue/routes.mjs';
// Real servers ingest eagerly so the agent and /graph share data from the first request.
export function startIngest(){const ingest=createIngest();setActiveIngest(ingest);ingest.sync().catch(error=>console.error('Initial sync failed:',error.message));return ingest;}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>16384)throw new AppError('Request too large',413);}try{return JSON.parse(text||'{}');}catch{throw new AppError('Invalid JSON');}}
export function server(vite,store=createStore(),analyzeRequest=analyze,ingest=null) { const inFlight=new Map(); let ingestHandler=null; return http.createServer(async (req,res) => {
  const pathname=new URL(req.url,'http://localhost').pathname;
  const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  try {
    if(pathname==='/api/requests'&&req.method==='GET')return json(store.snapshot());
    // Time Value demo card (read-only, no model call).
    if(pathname.startsWith('/api/timevalue/')&&await timevalueRoutes(req,res,pathname,json))return;
    if(req.method==='POST'&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)throw new AppError('Origin not allowed',403);
    if(pathname==='/api/requests'&&req.method==='POST')return json({request:store.create(await body(req))},201);
    // Ingestion and graph routes (Slack, calendar, dependency graph); created on first use.
    if(/^\/api\/(sync|sources|graph|documents)(\/|$)/.test(pathname)&&await (ingestHandler||=ingestRoutes(ingest||=createIngest()))(req,res,pathname,json))return;
    const detail=pathname.match(/^\/api\/requests\/([a-z0-9_-]+)$/);
    if(detail&&req.method==='GET')return json({request:store.get(detail[1]),events:store.audit(detail[1])});
    const route=pathname.match(/^\/api\/requests\/([a-z0-9_-]+)\/(run|answer|select|approve|reset|audit)$/);
    if(route){
      const [,id,action]=route;const request=store.get(id);
      if(action==='audit'&&req.method==='GET')return json({events:store.audit(id)});
      if(req.method!=='POST')throw new AppError('Method not allowed',405);
      // Local app accepts only same-origin browser mutations.
      if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)throw new AppError('Origin not allowed',403);
      if(action==='run'){
        res.writeHead(200,{'Content-Type':'application/x-ndjson','Cache-Control':'no-cache'});
        const emit=event=>{if(!res.destroyed)res.write(JSON.stringify(event)+'\n');};
        try {
          let task=inFlight.get(id);
          if(!task){
          task=(async()=>{
          let current=request;
          if(!request.analysis&&request.status==='needs_answer') {
            let tools=[];
            const track=event=>{if(event.type==='agent.fallback')tools=[];if(event.type==='tool.completed')tools.push({index:event.index,label:event.label,summary:event.summary,name:event.name});emit(event);};
            const result=await analyzeRequest({text:request.text||'ACS37002 × 40 from Digi-Key, standard shipping.',requester:request.who},track);
            result.tools=tools;
            current=store.finishAnalysis(id,request.revision,result);
          }
          return current;
          })();
          inFlight.set(id,task);
          task.then(()=>{if(inFlight.get(id)===task)inFlight.delete(id);},()=>{if(inFlight.get(id)===task)inFlight.delete(id);});
          }
          const current=await task;
          emit({type:'run.completed',question:current.question,parsed:current.analysis?.parsed,planner:current.analysis?.planner,request:current});
        } catch(error){emit({type:'run.failed',error:error.message});}
        res.end();return;
      }
      return json({request:store.mutate(id,action,await body(req))});
    }
    if(pathname.startsWith('/api/'))throw new AppError('Not found',404);
    if(vite)return vite.middlewares(req,res);
    const file=pathname.startsWith('/assets/')&&/^\/assets\/[\w.-]+$/.test(pathname)?path.join('dist',pathname):'dist/index.html';
    const data=await readFile(file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(data);
  }catch(error){if(!res.headersSent)json({error:error instanceof AppError?error.message:'Server error'},error.status||500);else res.end();}
}); }
if (process.argv[1]===fileURLToPath(import.meta.url)) server(undefined,undefined,undefined,startIngest()).listen(5173,'127.0.0.1',()=>console.log('http://localhost:5173/request'));
