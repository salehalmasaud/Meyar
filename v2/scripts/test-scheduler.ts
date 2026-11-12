import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPrivateEnv } from './load-private-env.ts';
import { makeEnvelope } from '../server/core.ts';
loadPrivateEnv();
const edge=process.env.RELAY_EDGE_URL!;assert.ok(edge.endsWith('/relay-v2'));
assert.equal((await(await fetch(edge+'/health')).json()).preview,true);
const keys=JSON.parse(readFileSync(join(process.env.LOCALAPPDATA!,'TrackcareRelay','v2','supabase-keys.json'),'utf8'));
const service=keys.find((k:{name:string})=>k.name==='service_role').api_key;
async function db(path:string,method='GET',body?:unknown){const r=await fetch(new URL(edge).origin+'/rest/v1/'+path,{method,headers:{apikey:service,authorization:'Bearer '+service,'content-type':'application/json',prefer:'return=representation'},body:body?JSON.stringify(body):undefined});assert.ok(r.ok);return r.json();}
const envelope=await makeEnvelope('SYNTHETIC SCHEDULER TEST ONLY\n',process.env.RELAY_ENCRYPTION_SECRET!,process.env.RELAY_PUSH_HMAC_SECRET!);
assert.equal((await fetch(edge+'/push',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(envelope)})).status,200);
const expiry=new Date(Date.now()+5000).toISOString();
const state=(await db('relay_v2_state?id=eq.1'))[0];
await db('relay_v2_state?id=eq.1','PATCH',{expires_at:expiry});await db('relay_v2_objects?id=eq.'+state.note_id,'PATCH',{expires_at:expiry});
console.log('Synthetic expiry scheduled. All viewer pages are closed; no cleanup endpoint is called by this test.');
const started=Date.now();let removed=false;
for(let i=0;i<7;i++){
  await new Promise(resolve=>setTimeout(resolve,15000));
  const rows=await db('relay_v2_objects?id=eq.'+state.note_id);
  if(!rows.length){removed=true;break;}
}
assert.ok(removed,'Scheduled deletion did not complete within 105 seconds');
const storage=await fetch(new URL(edge).origin+'/storage/v1/object/list/relay-v2-private',{method:'POST',headers:{apikey:service,authorization:'Bearer '+service,'content-type':'application/json'},body:JSON.stringify({prefix:state.note_id+'/',limit:10})});
assert.ok(storage.ok);assert.deepEqual(await storage.json(),[],'Expired bytes still exist in Storage');
const result={passed:true,without_viewers:true,without_manual_cleanup:true,storage_bytes_deleted:true,elapsed_ms:Date.now()-started,at:new Date().toISOString()};
writeFileSync(new URL('../tests/scheduler-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log('PASS: cron physically deleted the expired object with no viewer or manual cleanup.');
