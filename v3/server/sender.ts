import {hash,hmac,makeEnvelope,RelayError,utf8,type Envelope} from './core.ts';
import type {Settings} from './config.ts';
import {Store} from './store.ts';
export type Receipt={success:true;note_id:string;version:number};
export function acknowledge(value:unknown,version:number,status:number):Receipt{
 const a=value as Record<string,unknown>;
 const id=status===409&&a?.error==='replayed'?a.accepted_id:a?.id;
 if(!((status===200&&a?.ok===true)||(status===409&&a?.error==='replayed'))||a.version!==version||typeof id!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))throw new RelayError(502,'invalid_acknowledgement');
 return {success:true,note_id:id,version};
}
export async function sendNote(note:unknown,key:string,grant:string,c:Settings,db:Store,transport:typeof fetch=fetch):Promise<Receipt>{
 if(typeof note!=='string'||!note.length||utf8.encode(note).length>65536)throw new RelayError(400,'invalid_note');
 const digest=await hmac(c.rate,'sender-content.'+note);
 type Job={status:string;object_id:string;version:number;note_id:string};
 let job:Job|undefined;
 // Cross-instance lease serializes version allocation and delivery, not just allocation.
 for(let attempt=0;attempt<12;attempt++){
  job=await db.rpc<Job>('sender_claim',{p_key:key,p_grant:grant,p_digest:digest,p_object:crypto.randomUUID()});
  if(job.status!=='busy')break;await new Promise(r=>setTimeout(r,350));
 }
 if(!job||job.status==='busy')throw new RelayError(503,'sender_busy_retry_same_request');
 if(job.status==='conflict')throw new RelayError(409,'idempotency_conflict');
 if(job.status==='complete')return {success:true,note_id:job.note_id,version:job.version};
 let receipt:Receipt|undefined;
 try{
  const rows=await db.db<{id:string;ready:boolean}[]>('relay_v3_objects?id=eq.'+job.object_id);
  let envelope:Envelope;
  if(rows.length){
   try{envelope=await(await db.get(job.object_id,'data')).json() as Envelope;}
   catch{throw new RelayError(409,'delivery_uncertain_do_not_resend');}
  }else{
   envelope=await makeEnvelope(note,c.encryption,c.push,job.version);
   if(!await db.rpc('reserve',{p_id:job.object_id,p_kind:'note',p_mime:'application/json',p_size:utf8.encode(JSON.stringify(envelope)).length,p_source:'ChatGPT'}))throw new RelayError(413,'inbox_full');
   await db.put(job.object_id,'data',JSON.stringify(envelope));
  }
  // Recover a receipt after a lost HTTP response, including after timestamp freshness.
  const prior=await db.db<{note_id:string;digest:string}[]>('relay_v3_nonces?hash=eq.'+await hash(envelope.nonce));
  if(prior[0]?.digest===await hash(JSON.stringify(envelope)))receipt={success:true,note_id:prior[0].note_id,version:job.version};
  else{
   if(Math.abs(Date.now()-envelope.timestamp)>110000)throw new RelayError(409,'delivery_uncertain_do_not_resend');
   // This is the existing public V3 POST endpoint, with its unchanged wire protocol.
   for(let attempt=0;attempt<2;attempt++){
    try{
     const response=await transport(c.origins[0]+'/push-note-v3',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(envelope),signal:AbortSignal.timeout(20000)});
     const data=await response.json();receipt=acknowledge(data,job.version,response.status);break;
    }catch(e){if(attempt===1)throw e;}
   }
  }
  if(!receipt)throw new RelayError(502,'invalid_acknowledgement');
  await db.rpc('sender_release',{p_key:key,p_note:receipt.note_id});
  await db.db('relay_v3_objects?id=eq.'+job.object_id,'PATCH',{expires_at:new Date().toISOString()});
  return receipt;
 }finally{await db.rpc('sender_release',{p_key:key}).catch(()=>{});}
}
