import { RelayError } from './core.ts';
import type { Settings } from './config.ts';
export interface NoteRow {id:string;version:number;sequence:number;received_at:string;expires_at:string}
export interface FileRow {id:string;mime:string;size:number;source:string;large?:boolean;ready:boolean;created_at:string;expires_at:string}
export class Store {
  constructor(readonly config:Settings){}
  async call(path:string,init:RequestInit={}) {
    const headers=new Headers(init.headers);headers.set('apikey',this.config.service);headers.set('authorization','Bearer '+this.config.service);
    const r=await fetch(this.config.url+path,{...init,headers,signal:init.signal ?? AbortSignal.timeout(25000)});
    if(!r.ok){await r.body?.cancel();throw new RelayError(503,'temporarily_unavailable');}return r;
  }
  async db<T>(path:string,method='GET',body?:unknown):Promise<T>{
    const r=await this.call('/rest/v1/'+path,{method,headers:{'content-type':'application/json',prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});
    const t=await r.text();return(t?JSON.parse(t):null)as T;
  }
  rpc<T>(name:string,body:unknown={}){return this.db<T>('rpc/relay_v3_'+name,'POST',body);}
  async put(id:string,part:string,body:Uint8Array|string){await this.call(`/storage/v1/object/relay-v3-private/${id}/${part}`,{method:'POST',headers:{'content-type':'application/octet-stream','cache-control':'no-store','x-upsert':'false'},body:body as BodyInit,signal:part.startsWith('chunk-')?AbortSignal.timeout(60000):undefined});}
  get(id:string,part:string){return this.call(`/storage/v1/object/relay-v3-private/${id}/${part}`);}
  async remove(ids:string[]){
    if(!ids.length)return;
    const rows=await this.db<{file_id:string;idx:number}[]>('relay_v3_large_chunks?select=file_id,idx&file_id=in.('+ids.join(',')+')&limit=3000');
    const paths=ids.flatMap(id=>[id+'/data',id+'/meta']);
    paths.push(...rows.map(r=>r.file_id+'/chunk-'+String(r.idx).padStart(2,'0')));
    for(let n=0;n<paths.length;n+=200){
      await this.call('/storage/v1/object/relay-v3-private',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({prefixes:paths.slice(n,n+200)})});
    }
  }
  async broadcast(topic:string){try{await this.call('/realtime/v1/api/broadcast',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:[{topic,event:'changed',payload:{},private:false}]})});}catch{/* HTTP reconciliation remains authoritative. */}}
}
