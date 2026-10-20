import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {LargeFiles,LARGE_CHUNK,chunkTotal} from '../server/large.ts';
import {RelayError,randomToken} from '../server/core.ts';
import type {Store,FileRow} from '../server/store.ts';
import type {Settings} from '../server/config.ts';

test('synthetic 21 MiB PDF survives encrypted multipart upload and cross-device download',async()=>{
 const session=randomToken();
 const idBytes=new Map<string, Uint8Array|string>();
 const records=new Map<number,{digest:string;size:number}>();
 let row:FileRow|null=null,revision=0;
 const config={
  ticket:randomToken(),link:randomToken(),encryption:randomToken(),fileTtl:86400,
  url:'https://example.invalid',origins:['https://example.invalid']
 } as Settings;
 const store={
  async db(path:string){
   if(path.startsWith('relay_v3_sessions?'))return [{hash:session,unlocked:true,expires_at:new Date(Date.now()+3600000).toISOString()}];
   if(path.startsWith('relay_v3_objects?'))return row?[row]:[];
   if(path.startsWith('relay_v3_large_chunks?')){
    const match=/idx=eq\.(\d+)/.exec(path);if(!match)return [];
    const chunk=records.get(Number(match[1]));return chunk?[chunk]:[];
   }
   throw Error('Unexpected query '+path);
  },
  async rpc(name:string,body:Record<string,unknown>){
   if(name==='reserve_large'){
    const size=Number(body.p_size);
    row={id:String(body.p_id),mime:String(body.p_mime),size,source:'Workstation',large:true,ready:false,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString()};
    return true;
   }
   if(name==='record_large_chunk'){
    const idx=Number(body.p_index);
    const existing=records.get(idx);
    if(existing)return existing.digest===body.p_digest && existing.size===body.p_size;
    records.set(idx,{size:Number(body.p_size),digest:String(body.p_digest)});return true;
   }
   if(name==='finish_large'){
    if(!row || records.size!==chunkTotal(row.size))return false;
    row.ready=true;revision++;return true;
   }
   throw Error('Unexpected RPC '+name);
  },
  async put(id:string,part:string,value:Uint8Array|string){
   const key=id+'/'+part;if(idBytes.has(key))throw new RelayError(503,'temporarily_unavailable');
   idBytes.set(key,value);
  },
  async get(id:string,part:string){
   const value=idBytes.get(id+'/'+part);
   if(value===undefined)throw new RelayError(404,'missing');
   return new Response(value as BodyInit);
  }
 } as unknown as Store;
 const svc=new LargeFiles(config,store,async()=>{},async()=>{});
 const source=new Uint8Array(21*1024*1024+37);
 for(let i=0;i<source.length;i++)source[i]=i%251;
 source.set(new TextEncoder().encode('%PDF-1.7\n'),0);
 const init=await svc.init({name:'synthetic-large.pdf',size:source.length,source:'Workstation'},session);
 assert.equal(init.count,6);
 for(let index=0;index<init.count;index++){
  const bytes=source.slice(index*LARGE_CHUNK,Math.min(source.length,(index+1)*LARGE_CHUNK));
  const req=new Request(init.upload_url+'/'+index,{
   method:'POST',headers:{authorization:'Bearer '+init.ticket,'content-type':'application/octet-stream'},body:bytes
  });
  assert.deepEqual(await svc.uploadChunk(req,'/large-chunk/'+init.id+'/'+index),{ok:true,index});
  if(index===0)assert.equal(await svc.finish({id:init.id}).then(()=>true,()=>false),false);
 }
 assert.deepEqual(await svc.finish({id:init.id}),{ok:true,id:init.id});
 assert.equal(revision,1);
 const ticket=await svc.downloadTicket({id:init.id});
 const result=new Uint8Array(source.length);let copied=0;
 for(let index=0;index<ticket.chunk_count;index++){
  const url=new URL(ticket.base_url+index+'?expires='+ticket.expires+'&signature='+ticket.signature);
  const r=await svc.downloadChunk('/large-download/'+init.id+'/'+index,url,{});
  assert.equal(r.status,200);
  const part=new Uint8Array(await r.arrayBuffer());result.set(part,copied);copied+=part.length;
 }
 assert.equal(copied,source.length);
 const sha=(a:Uint8Array)=>createHash('sha256').update(a).digest('hex');
 assert.equal(sha(source),sha(result));
});
