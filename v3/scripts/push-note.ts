import {makeEnvelope} from '../server/core.ts';
import {loadPrivateEnv} from './load-private-env.ts';
// Use only in a protected sender runtime. Exact UTF-8 arrives on stdin.
loadPrivateEnv();
const chunks:Buffer[]=[];let size=0;
for await(const part of process.stdin){size+=part.length;if(size>65536)throw new Error('note_too_large');chunks.push(part);}
const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
const envelope=await makeEnvelope(text,process.env.RELAY_V3_ENCRYPTION_SECRET!,process.env.RELAY_V3_PUSH_HMAC_SECRET!);
const endpoint=process.env.RELAY_V3_ALLOWED_ORIGINS!.split(',')[0]+'/push-note-v3';
// An uncertain request is retried using the SAME envelope, never a second note.
for(let attempt=0;attempt<2;attempt++){
 try{const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(envelope),signal:AbortSignal.timeout(55000)});const data=await r.json();
  if((r.ok&&data.ok&&data.version===envelope.version)||(r.status===409&&data.error==='replayed'&&data.accepted_id&&data.version===envelope.version)){console.log(JSON.stringify({ok:true,id:data.id||data.accepted_id,version:envelope.version}));process.exit(0);}
  if(r.status<500){console.error('Send not accepted. HTTP '+r.status);process.exit(1);}
 }catch{/* Do not print exceptions or payloads. */}
}
console.error('Send acknowledgement uncertain. Do not regenerate and resend blindly.');process.exitCode=2;
