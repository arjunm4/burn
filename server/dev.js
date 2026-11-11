import {createServer} from 'vite';
import {server, startIngest} from './index.js';
const vite = await createServer({server:{middlewareMode:true},appType:'spa'});
server(vite,undefined,undefined,startIngest()).listen(Number(process.env.PORT)||5173,'127.0.0.1',()=>console.log(`http://localhost:${Number(process.env.PORT)||5173}/`));
