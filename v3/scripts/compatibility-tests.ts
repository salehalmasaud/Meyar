import assert from 'node:assert/strict';import {writeFileSync} from 'node:fs';
import {makeEnvelope,hash} from '../server/core.ts';import {encryption,signing,push,login,gateway,db,upload,png} from '../tests/helpers.ts';
const token=await login('v3-compatibility-tests'),owned:string[]=[],files:string[]=[];const result:Record<string,unknown>={};
try{
 const e=await makeEnvelope('Concurrent duplicate synthetic',encryption,signing);const pair=await Promise.all([push('',false,e),push('',false,e)]);assert.deepEqual(pair.map(r=>r.status).sort(),[200,409]);owned.push(pair.find(r=>r.status===200)!.data.id);result.concurrent_single_append=true;
 const g=await makeEnvelope('GET idempotency synthetic',encryption,signing);const first=await push('',true,g),again=await push('',true,g);assert.equal(first.status,200);assert.equal(again.status,200);assert.equal(again.data.replayed,true);assert.equal(again.data.id,first.data.id);owned.push(first.data.id);result.get_same_receipt=true;
 const max=await push('x'.repeat(65536));assert.equal(max.status,200);owned.push(max.data.id);result.max_note_size=true;
 const state=await(await gateway('/state',token)).json();assert.equal(state.notes.find((n:{id:string})=>n.id===max.data.id).text.length,65536);
 const f=await upload(token,png,'expiry-real-time.png','image/png');assert.equal(f.status,200);files.push(f.data.id);const link=await(await gateway('/file-url',token,{id:f.data.id})).json();assert.equal((await fetch(link.url)).status,200);
 const wait=Math.max(0,link.expires_at-Date.now()+1000);await new Promise(r=>setTimeout(r,wait));assert.equal((await fetch(link.url)).status,401);result.real_signed_url_expiry=true;
 // Only remove known synthetic transport test notes, never arbitrary inbox content.
 owned.push(...state.notes.filter((n:{text:string})=>n.text==='TinyFish V3 transport test — synthetic only').map((n:{id:string})=>n.id));
 result.at=new Date().toISOString();writeFileSync('tests/compatibility-results.json',JSON.stringify(result,null,2)+'\n');console.log('PASS atomic concurrent append, GET idempotency, 64 KiB note and real-time signed URL expiry');
}finally{await gateway('/delete-notes',token,{ids:owned});await gateway('/delete-files',token,{ids:files});await db('relay_v3_sessions?hash=eq.'+await hash(token),'DELETE');}
