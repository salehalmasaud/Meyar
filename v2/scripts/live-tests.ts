/** Runs ONLY against the V2 namespace. All content is generated synthetic test data. */
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPrivateEnv } from './load-private-env.ts';
import { makeEnvelope,randomToken,issueSession,b64,utf8,hash,hmac } from '../server/core.ts';
loadPrivateEnv();
const edge=process.env.RELAY_EDGE_URL!, origin=process.env.RELAY_ALLOWED_ORIGINS!.split(',')[0];
assert.ok(edge.endsWith('/relay-v2'),'Refusing a non-V2 endpoint');
const keys=JSON.parse(readFileSync(join(process.env.LOCALAPPDATA!,'TrackcareRelay','v2','supabase-keys.json'),'utf8'));
const service=keys.find((k:{name:string})=>k.name==='service_role').api_key;
const anon=keys.find((k:{name:string})=>k.name==='anon').api_key;
const base=new URL(edge).origin;
const passed:string[]=[]; const timings:Record<string,number>={};
async function step(name:string,run:()=>Promise<void>){const started=Date.now();await run();timings[name]=Date.now()-started;passed.push(name);console.log('PASS '+name);}
async function db(path:string,method='GET',body?:unknown){const r=await fetch(base+'/rest/v1/'+path,{method,headers:{apikey:service,authorization:'Bearer '+service,'content-type':'application/json',prefer:'return=representation'},body:body?JSON.stringify(body):undefined});assert.ok(r.ok,`Metadata operation failed (${r.status})`);return r.json();}
async function call(path:string,body?:unknown,token?:string){return fetch(edge+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});}
async function internal(action:string,device:string,body?:unknown){return fetch(edge+'/internal/'+action,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-relay-gateway':process.env.RELAY_GATEWAY_SECRET!,'x-relay-origin':origin,'x-relay-client':'synthetic-integration','x-relay-device':device},body:body===undefined?undefined:JSON.stringify(body)});}
async function pairedDevice(){const r=await call('/admin/invite',{},process.env.RELAY_ADMIN_SECRET);assert.equal(r.status,200);const invitation=await r.json();const paired=await internal('pair','',{invite:invitation.token});assert.equal(paired.status,200);assert.equal((await internal('pair','',{invite:invitation.token})).status,400);return (await paired.json()).device as string;}
async function login(device:string){const r=await internal('login',device,{pin:'000'});assert.equal(r.status,200);return r.json();}
let device='',other='',viewer:{token:string;expires_at:number},phone:{token:string};
const synthetic='SYNTHETIC RELAY TEST — NOT A PATIENT\r\n\r\n  Keep these spaces.\t✓\nاختبار النقل\n';
let envelope:Awaited<ReturnType<typeof makeEnvelope>>,fileId='',signedUrl='';
const encryption=process.env.RELAY_ENCRYPTION_SECRET!,signing=process.env.RELAY_PUSH_HMAC_SECRET!;
await step('health and V2 endpoint',async()=>{assert.equal((await call('/health')).status,200);});
await step('unpaired browser cannot use known 000',async()=>{assert.equal((await internal('login','',{pin:'000'})).status,403);});
await step('one-time pairing and valid PIN',async()=>{device=await pairedDevice();other=await pairedDevice();viewer=await login(device);phone=await login(other);assert.ok(viewer.token);});
await step('invalid PIN rejected',async()=>{assert.equal((await internal('login',device,{pin:'999'})).status,401);});
await step('PIN rate limiting',async()=>{for(let i=0;i<5;i++)await internal('login',other,{pin:'wrong'});assert.equal((await internal('login',other,{pin:'000'})).status,429);});
await step('expired authenticated session rejected',async()=>{const s={id:crypto.randomUUID(),device:await hash(device),exp:Date.now()-1};const token=await issueSession(s,process.env.RELAY_SESSION_SECRET!);assert.equal((await call('/state',undefined,token)).status,401);});
await step('valid encrypted POST note and exact retrieval',async()=>{envelope=await makeEnvelope(synthetic,encryption,signing);assert.equal((await call('/push',envelope)).status,200);const state=await (await call('/state',undefined,viewer.token)).json();assert.equal(state.note.text,synthetic);});
await step('second device sees the same latest note',async()=>{const state=await (await call('/state',undefined,phone.token)).json();assert.equal(state.note.version,envelope.version);assert.equal(state.note.text,synthetic);});
await step('invalid signature rejected',async()=>{assert.equal((await call('/push',{...envelope,signature:randomToken()})).status,401);});
await step('wrong encryption key rejected',async()=>{const e=await makeEnvelope(synthetic,randomToken(),signing);assert.equal((await call('/push',e)).status,400);});
await step('expired request rejected',async()=>{const e=await makeEnvelope(synthetic,encryption,signing,Date.now(),Date.now()-180000);assert.equal((await call('/push',e)).status,401);});
await step('replayed request rejected',async()=>{assert.equal((await call('/push',envelope)).status,409);});
await step('duplicate and older versions rejected',async()=>{for(const v of [envelope.version,envelope.version-1]){const e=await makeEnvelope(synthetic,encryption,signing,v);assert.equal((await call('/push',e)).status,409);}});
await step('atomic competing version admits exactly one',async()=>{const version=Date.now();const a=await makeEnvelope(synthetic,encryption,signing,version),b=await makeEnvelope(synthetic,encryption,signing,version);const results=await Promise.all([call('/push',a),call('/push',b)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);});
await step('Copy/Clear cannot delete a newer note',async()=>{assert.equal((await call('/clear',{version:envelope.version},viewer.token)).status,409);const state=await (await call('/state',undefined,viewer.token)).json();assert.ok(state.note);});
await step('encrypted GET compatibility transport',async()=>{const e=await makeEnvelope(synthetic,encryption,signing);const url='/push?envelope='+b64(utf8.encode(JSON.stringify(e)));assert.equal((await call(url)).status,200);});
await step('private file upload and multi-device list',async()=>{const form=new FormData();form.append('file',new Blob(['%PDF-1.7\nSYNTHETIC FILE ONLY\n%%EOF\n'],{type:'application/pdf'}),'synthetic-only.pdf');form.append('source','Phone');const r=await fetch(edge+'/upload',{method:'POST',headers:{authorization:'Bearer '+phone.token},body:form});assert.equal(r.status,200);fileId=(await r.json()).id;const state=await (await call('/state',undefined,viewer.token)).json();assert.ok(state.files.some((f:{id:string})=>f.id===fileId));});
await step('invalid file type despite PDF name and MIME rejected',async()=>{const form=new FormData();form.append('file',new Blob(['<script>not a pdf</script>'],{type:'application/pdf'}),'pretend.pdf');const r=await fetch(edge+'/upload',{method:'POST',headers:{authorization:'Bearer '+viewer.token},body:form});assert.equal(r.status,415);});
await step('oversized file rejected',async()=>{const form=new FormData();form.append('file',new Blob([new Uint8Array(20*1024*1024+1)],{type:'image/png'}),'large.png');const r=await fetch(edge+'/upload',{method:'POST',headers:{authorization:'Bearer '+viewer.token},body:form});assert.equal(r.status,413);});
await step('short-lived signed file URL and tamper rejection',async()=>{const r=await call('/file-url',{id:fileId,mode:'download'},viewer.token);assert.equal(r.status,200);const data=await r.json();assert.ok(data.expires_at<=Date.now()+61000);signedUrl=data.url;assert.equal((await fetch(signedUrl)).status,200);assert.equal((await fetch(signedUrl.replace('mode=download','mode=open'))).status,401);});
await step('expired signed URL is rejected even with valid signature',async()=>{const expiry=Date.now()-1;const signature=await hmac(process.env.RELAY_LINK_SECRET!,`file-v2.${fileId}.${expiry}.open`);assert.equal((await fetch(`${edge}/file/${fileId}?expires=${expiry}&mode=open&signature=${signature}`)).status,401);});
await step('bucket is private and metadata/RPC denied to anon',async()=>{const r=await fetch(base+'/storage/v1/object/public/relay-v2-private/'+fileId+'/data');assert.ok(r.status>=400);for(const p of ['relay_v2_state','rpc/relay_v2_expire']){const r=await fetch(base+'/rest/v1/'+p,{method:p.startsWith('rpc')?'POST':'GET',headers:{apikey:anon,authorization:'Bearer '+anon,'content-type':'application/json'},body:p.startsWith('rpc')?'{}':undefined});assert.ok(r.status>=400);}});
await step('note and file expiry blocks reads immediately',async()=>{const expired=new Date(Date.now()-1000).toISOString();await db('relay_v2_state?id=eq.1','PATCH',{expires_at:expired});await db('relay_v2_objects?ready=eq.true','PATCH',{expires_at:expired});const state=await (await call('/state',undefined,viewer.token)).json();assert.equal(state.note,null);assert.equal(state.files.length,0);assert.equal((await fetch(signedUrl)).status,404);});
await step('physical expiration removes Storage and metadata',async()=>{assert.equal((await call('/cleanup',{},process.env.RELAY_CRON_SECRET)).status,200);const rows=await db('relay_v2_objects');assert.equal(rows.length,0);const r=await fetch(base+'/storage/v1/object/relay-v2-private/'+fileId+'/data',{headers:{apikey:service,authorization:'Bearer '+service}});assert.ok(r.status>=400);});
await step('logout revokes copied session token',async()=>{assert.equal((await call('/logout',{},viewer.token)).status,200);assert.equal((await call('/state',undefined,viewer.token)).status,401);});
// Remove only test-created device credentials, cascading test sessions.
await db('relay_v2_devices?hash=in.('+await hash(device)+','+await hash(other)+')','DELETE');
writeFileSync(new URL('../tests/live-results.json',import.meta.url),JSON.stringify({at:new Date().toISOString(),target:'isolated V2 namespace',passed,timings},null,2)+'\n');
console.log(`${passed.length} live integration checks passed.`);
