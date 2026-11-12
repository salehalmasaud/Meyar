import { readFileSync,readdirSync,statSync } from 'node:fs';
import { resolve,join,relative } from 'node:path';
import { loadPrivateEnv } from './load-private-env.ts';
loadPrivateEnv();
const secrets=Object.entries(process.env).filter(([key,value])=>key.startsWith('RELAY_')&&key.endsWith('_SECRET')&&value).map(([,value])=>value!);
const keys=JSON.parse(readFileSync(join(process.env.LOCALAPPDATA!,'TrackcareRelay','v2','supabase-keys.json'),'utf8'));
for(const key of keys)if(key.name==='service_role'||key.type==='secret')secrets.push(key.api_key);
const root=resolve('..');let scanned=0;const leaks:string[]=[];
function scan(dir:string){for(const name of readdirSync(dir)){if(['.git','node_modules','.netlify','test-results','artifacts','.temp'].includes(name))continue;const path=join(dir,name);if(statSync(path).isDirectory()){scan(path);continue;}const data=readFileSync(path);scanned++;if(secrets.some(secret=>secret&&data.includes(Buffer.from(secret))))leaks.push(relative(root,path));}}
scan(root);if(leaks.length){console.error('Secret match in: '+leaks.join(', '));process.exitCode=1;}else console.log(`PASS: ${scanned} source/build files contain none of the generated secrets or service credentials.`);
