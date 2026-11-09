import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runTools} from './tools.js';
import {createStore,AppError} from './store.js';
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>16384)throw new AppError('Request too large',413);}try{return JSON.parse(text||'{}');}catch{throw new AppError('Invalid JSON');}}
export function server(vite,store=createStore()) { return http.createServer(async (req,res) => {
  const pathname=new URL(req.url,'http://localhost').pathname;
  const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  try {
    if(pathname==='/api/requests'&&req.method==='GET')return json(store.snapshot());
    if(req.method==='POST'&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)throw new AppError('Origin not allowed',403);
    if(pathname==='/api/requests'&&req.method==='POST')return json({request:store.create(await body(req))},201);
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
        await runTools(event=>{if(!res.destroyed)res.write(JSON.stringify(event)+'\n');},request);res.end();return;
      }
      return json({request:store.mutate(id,action,await body(req))});
    }
    if(pathname.startsWith('/api/'))throw new AppError('Not found',404);
    if(vite)return vite.middlewares(req,res);
    const file=pathname.startsWith('/assets/')&&/^\/assets\/[\w.-]+$/.test(pathname)?path.join('dist',pathname):'dist/index.html';
    const data=await readFile(file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(data);
  }catch(error){if(!res.headersSent)json({error:error instanceof AppError?error.message:'Server error'},error.status||500);else res.end();}
}); }
if (process.argv[1]===fileURLToPath(import.meta.url)) server().listen(5173,'127.0.0.1',()=>console.log('http://localhost:5173/request'));
