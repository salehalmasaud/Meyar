import { RelayError } from './core.ts';
import type { Settings } from './config.ts';
export interface ObjectRow { id: string; kind: 'file'|'note'; mime: string; size: number; source: string; ready: boolean; created_at: string; expires_at: string }
export interface StateRow { version: number; revision: number; note_id: string|null; expires_at: string|null; received_at: string|null }
export class Store {
  constructor(readonly config: Settings) {}
  async call(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('apikey',this.config.service); headers.set('authorization',`Bearer ${this.config.service}`);
    const response = await fetch(this.config.url+path,{...init,headers,signal:AbortSignal.timeout(20000)});
    if (!response.ok) { await response.body?.cancel(); throw new RelayError(503,'temporarily_unavailable'); }
    return response;
  }
  async db<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const r = await this.call('/rest/v1/'+path,{method,headers:{'content-type':'application/json','prefer':'return=representation'},body:body === undefined ? undefined : JSON.stringify(body)});
    const text=await r.text();return (text?JSON.parse(text):null) as T;
  }
  rpc<T>(name: string, body: unknown = {}) { return this.db<T>('rpc/relay_v2_'+name,'POST',body); }
  async state() { return (await this.db<StateRow[]>('relay_v2_state?id=eq.1'))[0]; }
  async objects(query: string) { return this.db<ObjectRow[]>('relay_v2_objects?'+query); }
  async put(id: string, part: 'data'|'meta', body: Uint8Array|string, type: string) {
    await this.call(`/storage/v1/object/relay-v2-private/${id}/${part}`,{method:'POST',headers:{'content-type':type,'cache-control':'no-store','x-upsert':'false'},body:body as BodyInit});
  }
  async get(id: string, part: 'data'|'meta') { return this.call(`/storage/v1/object/relay-v2-private/${id}/${part}`); }
  async removeObjects(ids: string[]) {
    if (!ids.length) return;
    await this.call('/storage/v1/object/relay-v2-private',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({prefixes:ids.flatMap(id=>[id+'/data',id+'/meta'])})});
    await this.db(`relay_v2_objects?id=in.(${ids.join(',')})`,'DELETE');
  }
  async broadcast(topic: string) {
    // Only an invalidation ping. No note, filename, timestamp, ID or version is broadcast.
    try { await this.call('/realtime/v1/api/broadcast',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:[{topic,event:'changed',payload:{},private:false}]})}); } catch { /* polling is authoritative */ }
  }
}
