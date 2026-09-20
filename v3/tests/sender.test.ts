import test from 'node:test';import assert from 'node:assert/strict';
import {sendNote} from '../server/sender.ts';import {randomToken,verifyEnvelope,hash,type Envelope} from '../server/core.ts';import type {Settings} from '../server/config.ts';import type {Store} from '../server/store.ts';
function fixture(){
 const c={encryption:randomToken(),push:randomToken(),rate:randomToken(),origins:['https://relay.example']} as Settings;
 const job={status:'pending',object_id:crypto.randomUUID(),version:Date.now(),note_id:''};let envelope:Envelope|undefined;let accepted=false;let released=0;
 const id=crypto.randomUUID();
 const store={
  async rpc(name:string,b:Record<string,unknown>){if(name==='sender_claim')return {...job};if(name==='reserve')return true;if(name==='sender_release'){released++;if(b.p_note){job.status='complete';job.note_id=String(b.p_note);}}},
  async db(path:string){if(path.startsWith('relay_v3_nonces'))return accepted&&envelope?[{note_id:id,digest:await hash(JSON.stringify(envelope))}]:[];return envelope?[{id:job.object_id}]:[];},
  async put(_id:string,_part:string,body:string){envelope=JSON.parse(body);},
  async get(){return Response.json(envelope);}
 } as unknown as Store;
 return {c,store,job,id,get envelope(){return envelope;},get released(){return released;},accept(){accepted=true;}};
}
test('sender encrypts exact UTF-8 with the existing protocol and returns metadata only',async()=>{
 const f=fixture(),note='  Exact\r\n\tاختبار\n';const receipt=await sendNote(note,'key',crypto.randomUUID(),f.c,f.store,async(input,init)=>{assert.equal(input,'https://relay.example/push-note-v3');assert.equal(init?.method,'POST');const e=JSON.parse(String(init?.body));await verifyEnvelope(e,f.c.encryption,f.c.push,Date.now(),120);return Response.json({ok:true,id:f.id,version:f.job.version});});assert.deepEqual(Object.keys(receipt).sort(),['note_id','success','version']);assert.ok(f.envelope?.signature);assert.notEqual(f.envelope?.ciphertext,note);
});
test('lost acknowledgement retries the identical encrypted envelope, then accepts replay receipt',async()=>{
 const f=fixture();const bodies:string[]=[];const transport:typeof fetch=async(_input,init)=>{bodies.push(String(init?.body));if(bodies.length===1)throw new TypeError('connection lost');return Response.json({error:'replayed',accepted_id:f.id,version:f.job.version},{status:409});};const r=await sendNote('Retry test','key',crypto.randomUUID(),f.c,f.store,transport);assert.equal(r.note_id,f.id);assert.equal(bodies.length,2);assert.equal(bodies[0],bodies[1]);
});
test('completed request retry never invokes the push endpoint again',async()=>{
 const f=fixture();f.job.status='complete';f.job.note_id=f.id;const r=await sendNote('Same request','key',crypto.randomUUID(),f.c,f.store,async()=>{throw new Error('must not send');});assert.equal(r.note_id,f.id);
});
test('invalid acknowledgement cannot report success and releases the lease',async()=>{
 const f=fixture();await assert.rejects(sendNote('Bad ack','key',crypto.randomUUID(),f.c,f.store,async()=>Response.json({ok:true,id:f.id,version:f.job.version+1})));assert.equal(f.job.status,'pending');assert.ok(f.released>0);
});
test('recovery after a lost response resolves the stored nonce receipt without another push',async()=>{
 const f=fixture();await assert.rejects(sendNote('Recovery','key',crypto.randomUUID(),f.c,f.store,async()=>{throw new Error('lost');}));f.accept();const r=await sendNote('Recovery','key',crypto.randomUUID(),f.c,f.store,async()=>{throw new Error('must not send');});assert.equal(r.note_id,f.id);
});
test('sender rejects oversized UTF-8 and empty notes before side effects',async()=>{const f=fixture();for(const note of ['', 'ع'.repeat(32769)])await assert.rejects(sendNote(note,'key',crypto.randomUUID(),f.c,f.store));assert.equal(f.envelope,undefined);});
