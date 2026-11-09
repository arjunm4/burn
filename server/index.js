import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {runTools} from './tools.js';
export function server(vite) { return http.createServer(async (req,res) => {
  if (req.url === '/api/work') {
    res.writeHead(200, {'Content-Type':'application/x-ndjson','Cache-Control':'no-cache'});
    await runTools(event => { if (!res.destroyed) res.write(JSON.stringify(event)+'\n'); }); res.end(); return;
  }
  if (vite) return vite.middlewares(req,res);
  try {
    const pathname = new URL(req.url,'http://localhost').pathname;
    const file = pathname.startsWith('/assets/') ? path.join('dist',path.basename(pathname) === pathname.slice(8) ? pathname : '/invalid') : 'dist/index.html';
    const data = await readFile(file);
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(data);
  } catch {res.writeHead(404);res.end('Not found');}
}); }
if (process.argv[1].endsWith('/index.js')) server().listen(5173, '127.0.0.1', () => console.log('http://localhost:5173/request'));
