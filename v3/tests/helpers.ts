import {readFileSync} from 'node:fs';import {join} from 'node:path';import {deflateSync} from 'node:zlib';import {loadPrivateEnv} from '../scripts/load-private-env.ts';import {makeEnvelope} from '../server/core.ts';
loadPrivateEnv();
export const site=process.env.RELAY_V3_ALLOWED_ORIGINS!.split(',')[0],edge=process.env.RELAY_V3_EDGE_URL!,root=new URL(edge).origin;
export const viewer=process.env.RELAY_V3_VIEWER_SECRET!,encryption=process.env.RELAY_V3_ENCRYPTION_SECRET!,signing=process.env.RELAY_V3_PUSH_HMAC_SECRET!;
const keys=JSON.parse(readFileSync(join(process.env.LOCALAPPDATA!,'TrackcareRelay','v3','supabase-keys.json'),'utf8'));
const list=Array.isArray(keys)?keys:keys.api_keys||keys.keys;
const service=list.find((k:{name:string})=>k.name==='service_role').api_key;
export async function db(path:string,method='GET',body?:unknown){const r=await fetch(root+'/rest/v1/'+path,{method,headers:{apikey:service,authorization:'Bearer '+service,'content-type':'application/json',prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw new Error('Test database operation failed '+r.status);const text=await r.text();return text?JSON.parse(text):null;}
export async function storage(path:string){return fetch(root+'/storage/v1/'+path,{headers:{apikey:service,authorization:'Bearer '+service}});}
export async function push(text:string,get=false,override?:unknown){const e=override||await makeEnvelope(text,encryption,signing);const r=await fetch(site+'/push-note-v3'+(get?'?envelope='+Buffer.from(JSON.stringify(e)).toString('base64url'):''),{method:get?'GET':'POST',headers:{'content-type':'application/json'},body:get?undefined:JSON.stringify(e)});return{status:r.status,data:await r.json(),envelope:e};}
export function gateway(path:string,token='',body?:unknown,ip='v3-automated-tests'){return fetch(edge+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-relay-gateway':process.env.RELAY_V3_GATEWAY_SECRET!,'x-relay-origin':site,'x-relay-client':ip,'x-relay-session':token},body:body===undefined?undefined:JSON.stringify(body)});}
export async function login(ip='v3-automated-tests'){const r=await gateway('/exchange','',{access:viewer},ip);if(!r.ok)throw new Error('Exchange failed');const token=(await r.json()).session;const l=await gateway('/login',token,{pin:'000'},ip);if(!l.ok)throw new Error('Login failed');return token as string;}
// A structurally valid, decodable synthetic screenshot with correct chunk CRCs.
function makePng(){
 const crc=(b:Buffer)=>{let n=0xffffffff;for(const v of b){n^=v;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0;};
 const chunk=(type:string,data:Buffer)=>{const name=Buffer.from(type),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([len,name,data,sum]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(120,0);header.writeUInt32BE(80,4);header[8]=8;header[9]=2;
 const pixels=Buffer.alloc(80*(120*3+1));for(let y=0;y<80;y++)for(let x=0;x<120;x++){const pos=y*361+1+x*3;const stripe=y>20&&y<60&&y%12<3&&x>20&&x<95;pixels.set(stripe?[38,113,83]:[230,240,229],pos);}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
export const png=makePng();
export function pdf(bytes=500){const b=Buffer.alloc(bytes,32);b.write('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n');b.write('\n%%EOF\n',b.length-7);return b;}
export async function upload(token:string,data:Buffer,name:string,type:string){const t=await(await gateway('/upload-ticket',token,{})).json();const form=new FormData();form.append('file',new Blob([new Uint8Array(data)],{type}),name);form.append('source','Workstation');const r=await fetch(t.url,{method:'POST',headers:{authorization:'Bearer '+t.ticket},body:form});return{status:r.status,data:await r.json()};}
