import { makeEnvelope, b64, utf8 } from '../server/core.ts';
// Read exact UTF-8 bytes on stdin; never accept patient text in command-line arguments.
const chunks:Buffer[]=[];for await(const chunk of process.stdin)chunks.push(Buffer.from(chunk));
const bytes=Buffer.concat(chunks);if(bytes.length>64*1024)throw new Error('Note exceeds 64 KiB');
const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
const {RELAY_EDGE_URL,RELAY_ENCRYPTION_SECRET,RELAY_PUSH_HMAC_SECRET}=process.env;
if(!RELAY_EDGE_URL||!RELAY_ENCRYPTION_SECRET||!RELAY_PUSH_HMAC_SECRET)throw new Error('Configure sender environment first');
const envelope=await makeEnvelope(text,RELAY_ENCRYPTION_SECRET,RELAY_PUSH_HMAC_SECRET);
const get=process.argv.includes('--get');
const url=get?RELAY_EDGE_URL+'/push?envelope='+b64(utf8.encode(JSON.stringify(envelope))):RELAY_EDGE_URL+'/push';
if(get&&url.length>7000)throw new Error('Note too long for GET. Use POST.');
const response=await fetch(url,get?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(envelope)});
if(!response.ok){console.error(`Relay rejected the request (${response.status}). Content omitted.`);process.exitCode=1;}
else console.log('Sent to Relay.');
