import {createServer} from 'vite';
import {server} from './index.js';
const vite = await createServer({server:{middlewareMode:true},appType:'spa'});
server(vite).listen(5173,'127.0.0.1',()=>console.log('http://localhost:5173/request'));
