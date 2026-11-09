import {mkdir, readFile, readdir, writeFile, rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
let projectRoot = fileURLToPath(new URL('../', import.meta.url));
try {
  const common = execFileSync('git', ['rev-parse','--path-format=absolute','--git-common-dir'], {cwd:projectRoot,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
  if (path.basename(common) === '.git') projectRoot = path.dirname(common);
} catch {}
const root = path.join(projectRoot,'collaboration') + path.sep;
const [command, actor, target, ...words] = process.argv.slice(2);
const valid = value => { if (!/^[a-z0-9_-]+$/.test(value || '')) throw Error('Use a lowercase agent name'); return value; };
await mkdir(root+'messages',{recursive:true}); await mkdir(root+'status',{recursive:true});
async function atomic(file, value) { const temp=file+'.'+randomUUID()+'.tmp'; await writeFile(temp,JSON.stringify(value,null,2)); await rename(temp,file); }
if (command === 'send') {
 valid(actor); valid(target); if (!words.length) throw Error('Message required');
 const message={id:randomUUID(),at:new Date().toISOString(),from:actor,to:target,text:words.join(' ')};
 await atomic(root+'messages/'+message.id+'.json',message); console.log(message.id);
} else if (command === 'inbox') {
 valid(actor); const messages=await Promise.all((await readdir(root+'messages')).filter(f=>f.endsWith('.json')).map(async f=>JSON.parse(await readFile(root+'messages/'+f,'utf8'))));
 console.log(JSON.stringify(messages.filter(m=>m.to===actor||m.to==='all').sort((a,b)=>a.at.localeCompare(b.at)),null,2));
} else if (command === 'status') {
 valid(actor); if (!target) {console.log(await readFile(root+'status/'+actor+'.json','utf8'));}
 else {await atomic(root+'status/'+actor+'.json',{agent:actor,at:new Date().toISOString(),summary:[target,...words].join(' ')});}
} else {console.log('send <from> <to> <message> | inbox <agent> | status <agent> [summary]');}
