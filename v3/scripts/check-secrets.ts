import {readFileSync,readdirSync,statSync} from 'node:fs';import {join} from 'node:path';import {loadPrivateEnv} from './load-private-env.ts';
loadPrivateEnv();
const secrets=Object.entries(process.env).filter(([k,v])=>k.startsWith('RELAY_V3_')&&k.endsWith('_SECRET')&&v).map(([,v])=>v!);
const keyFile=join(process.env.LOCALAPPDATA!,'TrackcareRelay','v3','supabase-keys.json');
try{const keys=JSON.parse(readFileSync(keyFile,'utf8'));for(const k of (Array.isArray(keys)?keys:keys.api_keys||keys.keys||[]))if(k.name!=='anon'&&k.api_key)secrets.push(k.api_key);}catch{/* Service-role test credentials may already be removed. */}
let files=0;const failures:string[]=[];
function walk(path:string){for(const item of readdirSync(path)){if(['node_modules','.netlify','artifacts','test-results','playwright-report'].includes(item))continue;const p=join(path,item);if(statSync(p).isDirectory())walk(p);else if(/\.(ts|mts|js|mjs|css|html|json|md|toml|ps1|svg)$/.test(item)){files++;const text=readFileSync(p,'utf8');if(secrets.some(s=>text.includes(s)))failures.push(p);}}}
walk('.');walk('../supabase/functions/relay-v3');
if(failures.length){console.error('Private secret found in: '+failures.join(', '));process.exit(1);}console.log(`PASS: ${files} V3 source, document, report and bundle files contain no provisioned backend/viewer secrets.`);
