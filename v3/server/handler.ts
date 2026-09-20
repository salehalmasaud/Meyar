import { associatedData,b64,cleanFilename,decoder,decryptText,encryptText,equalSecret,hash,hmac,MAX_ENVELOPE,MAX_FILE,randomToken,readJson,readLimited,RelayError,sniffFile,unb64,utf8,verifyEnvelope,verifyHmac,encryptBytes,decryptBytes } from './core.ts';
import type { Envelope } from './core.ts';
import type { Settings } from './config.ts';
import { Store,type NoteRow,type FileRow } from './store.ts';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const validId=(v:unknown)=>{if(typeof v!=='string'||!UUID.test(v))throw new RelayError(400,'invalid_request');return v;};
const current=()=>encodeURIComponent(new Date().toISOString());
const bearer=(r:Request)=>r.headers.get('authorization')?.replace(/^Bearer /,'')||'';
type SessionRow={hash:string;unlocked:boolean;expires_at:string};
export function createHandler(c:Settings,db=new Store(c)){
  const topic=hmac(c.link,'relay-v3-invalidation');
  const notify=async()=>db.broadcast('relay-v3-'+await topic);
  async function limit(key:string,count:number,seconds:number){if(!await db.rpc<boolean>('limit',{p_key:key,p_limit:count,p_seconds:seconds}))throw new RelayError(429,'try_later');}
  async function session(token:string,unlocked=true){
    if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new RelayError(401,'session_expired');
    const rows=await db.db<SessionRow[]>(`relay_v3_sessions?hash=eq.${await hash(token)}&expires_at=gt.${current()}`);
    if(!rows.length||(unlocked&&!rows[0].unlocked))throw new RelayError(401,'session_expired');return rows[0];
  }
  async function cleanup(){
    await db.rpc('expire');
    const rows=await db.db<{id:string}[]>(`relay_v3_objects?expires_at=lte.${current()}&limit=200`);
    await db.remove(rows.map(r=>r.id));
    if(rows.length)await db.db(`relay_v3_objects?id=in.(${rows.map(r=>r.id).join(',')})`,'DELETE');
    await db.db('relay_v3_state?id=eq.1','PATCH',{cleanup_at:new Date().toISOString()});
    if(rows.length)await notify();return rows.length;
  }
  async function fileInfo(id:string){return JSON.parse(await decryptText(await(await db.get(id,'meta')).json(),c.encryption,'file-info-v3.'+id)) as {name:string};}
  async function liveFile(id:string){const rows=await db.db<FileRow[]>(`relay_v3_objects?id=eq.${id}&kind=eq.file&ready=eq.true&expires_at=gt.${current()}`);if(!rows.length)throw new RelayError(404,'file_expired');return rows[0];}
  return async(req:Request)=>{
    const url=new URL(req.url),action=url.pathname.split('/relay-v3')[1]||'/';
    const origin=req.headers.get('origin');
    const headers:Record<string,string>={'cache-control':'no-store, max-age=0',pragma:'no-cache','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow, noarchive'};
    if(origin&&c.origins.includes(origin)){headers['access-control-allow-origin']=origin;headers.vary='Origin';}
    const json=(v:unknown,status=200)=>Response.json(v,{status,headers});
    try{
      if(origin&&!c.origins.includes(origin))throw new RelayError(403,'unauthorized');
      if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'authorization,content-type','access-control-max-age':'600'}});
      if(action==='/health'&&req.method==='GET')return json({ok:true,protocol:3,preview:true});
      if(action==='/sweep'&&req.method==='POST'){
        if(await db.rpc<boolean>('limit',{p_key:'sweeper',p_limit:2,p_seconds:60}))await cleanup();
        return new Response(null,{status:204,headers});
      }
      if(action==='/push-note-v3'&&['GET','POST'].includes(req.method)){
        let value:unknown;
        if(req.method==='GET'){
          if(!c.allowGet)throw new RelayError(405,'method_not_allowed');
          if(url.search.length>7000||[...url.searchParams.keys()].join(',')!=='envelope')throw new RelayError(413,'too_large');
          try{value=JSON.parse(decoder.decode(unb64(url.searchParams.get('envelope'),7000)));}catch{throw new RelayError(400,'invalid_request');}
        }else{if(!req.headers.get('content-type')?.startsWith('application/json'))throw new RelayError(415,'invalid_request');value=await readJson(req,MAX_ENVELOPE);}
        const e=await verifyEnvelope(value,c.encryption,c.push,Date.now(),c.requestWindow);
        await limit('push-valid',120,60);
        const id=crypto.randomUUID();
        if(!await db.rpc('reserve',{p_id:id,p_kind:'note',p_mime:'application/json',p_size:utf8.encode(JSON.stringify(e)).length,p_source:'ChatGPT'}))throw new RelayError(413,'inbox_full');
        try{
          await db.put(id,'data',JSON.stringify(e));
          const result=await db.rpc<{status:string;id?:string}>('append',{p_id:id,p_version:e.version,p_nonce:await hash(e.nonce),p_digest:await hash(JSON.stringify(e))});
          if(result.status!=='accepted'){
            await db.db('relay_v3_objects?id=eq.'+id,'PATCH',{expires_at:new Date().toISOString()});
            // Read tools may fetch a URL more than once while rendering it. Return the
            // original receipt for an identical GET envelope; never append it twice.
            if(req.method==='GET'&&result.status==='replayed')return json({ok:true,id:result.id,version:e.version,replayed:true});
            return json({error:result.status,...(result.status==='replayed'?{accepted_id:result.id,version:e.version}:{})},409);
          }
        }catch(e){await db.db('relay_v3_objects?id=eq.'+id,'PATCH',{expires_at:new Date().toISOString()}).catch(()=>{});throw e;}
        await notify();return json({ok:true,id,version:e.version});
      }
      if(action.startsWith('/file/')&&req.method==='GET'){
        const id=validId(action.slice(6)),expiry=Number(url.searchParams.get('expires')),mode=url.searchParams.get('mode');
        if(!Number.isSafeInteger(expiry)||expiry<=Date.now()||expiry>Date.now()+61000||!['open','download','preview'].includes(mode||'')||!await verifyHmac(c.link,`file-v3.${id}.${expiry}.${mode}`,url.searchParams.get('signature')||''))throw new RelayError(401,'link_expired');
        const row=await liveFile(id),meta=await fileInfo(id);
        const data=await decryptBytes(new Uint8Array(await(await db.get(id,'data')).arrayBuffer()),c.encryption,'file-data-v3.'+id);
        return new Response(data as BodyInit,{headers:{...headers,'content-type':row.mime,'content-length':String(data.length),'content-disposition':`${mode==='download'?'attachment':'inline'}; filename="relay-file"; filename*=UTF-8''${encodeURIComponent(meta.name).replace(/[!'()*]/g,x=>'%'+x.charCodeAt(0).toString(16))}`,'content-security-policy':"sandbox; default-src 'none'; style-src 'unsafe-inline'"}});
      }
      if(action==='/upload'&&req.method==='POST'){
        const parts=bearer(req).split('.');
        if(parts.length!==2||!await verifyHmac(c.ticket,'upload-v3.'+parts[0],parts[1]))throw new RelayError(401,'session_expired');
        let ticket:{session:string;exp:number;id:string};try{ticket=JSON.parse(decoder.decode(unb64(parts[0],1024)));}catch{throw new RelayError(401,'session_expired');}
        if(!Number.isSafeInteger(ticket.exp)||ticket.exp<=Date.now())throw new RelayError(401,'session_expired');validId(ticket.id);
        if(!/^[A-Za-z0-9_-]{43}$/.test(ticket.session))throw new RelayError(401,'session_expired');
        const sessions=await db.db<SessionRow[]>(`relay_v3_sessions?hash=eq.${ticket.session}&unlocked=eq.true&expires_at=gt.${current()}`);
        if(!sessions.length)throw new RelayError(401,'session_expired');const s=sessions[0];
        // One admission per ticket. Retrying uses a fresh ticket.
        await limit('ticket.'+ticket.id,1,300);await limit('upload.'+s.hash,80,3600);
        const bytes=await readLimited(req,MAX_FILE+65536);
        let form:FormData;try{form=await new Request(req.url,{method:'POST',headers:{'content-type':req.headers.get('content-type')||''},body:bytes as BodyInit}).formData();}catch{throw new RelayError(400,'invalid_file');}
        const file=form.get('file');if(!(file instanceof File)||[...form.keys()].filter(k=>k==='file').length!==1)throw new RelayError(400,'invalid_file');
        const data=new Uint8Array(await file.arrayBuffer()),mime=sniffFile(data),id=crypto.randomUUID();
        const source=form.get('source')==='Phone'?'Phone':'Workstation';
        if(!await db.rpc('reserve',{p_id:id,p_kind:'file',p_mime:mime,p_size:data.length,p_source:source}))throw new RelayError(413,'inbox_full');
        try{
          await db.put(id,'meta',JSON.stringify(await encryptText(JSON.stringify({name:cleanFilename(file.name)}),c.encryption,'file-info-v3.'+id)));
          await db.put(id,'data',await encryptBytes(data,c.encryption,'file-data-v3.'+id));
          if(!await db.rpc('finish_file',{p_id:id,p_ttl:c.fileTtl}))throw new RelayError(409,'upload_expired');
        }catch(e){await db.db('relay_v3_objects?id=eq.'+id,'PATCH',{expires_at:new Date().toISOString()}).catch(()=>{});throw e;}
        await notify();return json({ok:true,id});
      }
      // Viewer routes are accessible only through the same-origin cookie gateway.
      if(!await equalSecret(req.headers.get('x-relay-gateway')||'',c.gateway)||!c.origins.includes(req.headers.get('x-relay-origin')||''))throw new RelayError(401,'unauthorized');
      const token=req.headers.get('x-relay-session')||'';
      const ip=await hmac(c.rate,'ip.'+(req.headers.get('x-relay-client')||'unknown'));
      if(action==='/exchange'&&req.method==='POST'){
        await limit('exchange.'+ip,20,900);const body=await readJson(req);
        if(typeof body.access!=='string'||!await equalSecret(body.access,c.viewer))throw new RelayError(401,'invalid_access');
        const value=randomToken(),exp=new Date(Date.now()+c.sessionTtl*1000).toISOString();
        await db.db('relay_v3_sessions','POST',{hash:await hash(value),expires_at:exp,unlocked:false});
        return json({session:value,max_age:c.sessionTtl});
      }
      if(action==='/status'&&req.method==='GET'){
        try{const s=await session(token,false);return json({trusted:true,unlocked:s.unlocked,expires_at:s.expires_at});}catch(e){if(e instanceof RelayError&&e.status===401)return json({trusted:false,unlocked:false});throw e;}
      }
      if(action==='/login'&&req.method==='POST'){
        const s=await session(token,false);await limit('pin.'+s.hash,5,900);await limit('pin-ip.'+ip,30,900);
        const body=await readJson(req);if(typeof body.pin!=='string'||!await equalSecret(body.pin,c.pin))throw new RelayError(401,'invalid_pin');
        await db.db('relay_v3_sessions?hash=eq.'+s.hash,'PATCH',{unlocked:true});
        await db.db('relay_v3_limits?key=eq.pin.'+s.hash,'DELETE');return json({ok:true});
      }
      const s=await session(token);
      if(action==='/lock'&&req.method==='POST'){await db.db('relay_v3_sessions?hash=eq.'+s.hash,'PATCH',{unlocked:false});return json({ok:true});}
      if(action==='/config'&&req.method==='GET')return json({expires_at:s.expires_at,text_ttl:c.textTtl,file_ttl:c.fileTtl,realtime:{url:c.url,anon:c.anon,topic:'relay-v3-'+await topic}});
      if(action==='/state'&&req.method==='GET'){
        const state=(await db.db<{revision:number}[]>('relay_v3_state?id=eq.1'))[0];
        if(url.searchParams.get('since')===String(state.revision))return json({unchanged:true,revision:state.revision,server_time:Date.now()});
        const rows=await db.db<NoteRow[]>(`relay_v3_notes?expires_at=gt.${current()}&order=sequence.asc&limit=500`);
        const notes=[];for(let i=0;i<rows.length;i+=10){notes.push(...await Promise.all(rows.slice(i,i+10).map(async row=>{const e=await(await db.get(row.id,'data')).json() as Envelope;return {...row,text:await decryptText(e,c.encryption,associatedData(e))};})));}
        const files=await db.db<FileRow[]>(`relay_v3_objects?kind=eq.file&ready=eq.true&expires_at=gt.${current()}&order=created_at.asc&limit=100`);
        return json({revision:state.revision,notes,files:await Promise.all(files.map(async f=>({...f,name:(await fileInfo(f.id)).name}))),server_time:Date.now()});
      }
      if(action==='/upload-ticket'&&req.method==='POST'){
        await limit('tickets.'+s.hash,120,3600);
        const payload=b64(utf8.encode(JSON.stringify({session:s.hash,exp:Date.now()+120000,id:crypto.randomUUID()})));
        return json({url:c.url+'/functions/v1/relay-v3/upload',ticket:payload+'.'+await hmac(c.ticket,'upload-v3.'+payload)});
      }
      if(action==='/file-url'&&req.method==='POST'){
        const body=await readJson(req),id=validId(body.id),row=await liveFile(id),exp=Math.min(Date.now()+c.signedTtl*1000,Date.parse(row.expires_at));
        const mode=body.mode==='download'?'download':body.mode==='preview'?'preview':'open';
        return json({url:`${c.url}/functions/v1/relay-v3/file/${id}?expires=${exp}&mode=${mode}&signature=${await hmac(c.link,`file-v3.${id}.${exp}.${mode}`)}`,expires_at:exp});
      }
      if(['/delete-notes','/delete-files'].includes(action)&&req.method==='POST'){
        const body=await readJson(req,24000);if(!Array.isArray(body.ids)||body.ids.length>500)throw new RelayError(400,'invalid_request');
        const ids=body.ids.map(validId);await db.rpc('delete_items',{p_ids:ids,p_kind:action==='/delete-notes'?'note':'file'});
        await notify();await cleanup().catch(()=>{});return json({ok:true});
      }
      throw new RelayError(404,'not_found');
    }catch(e){const err=e instanceof RelayError?e:new RelayError(503,'temporarily_unavailable');if(err.status===429)headers['retry-after']='900';return json({error:err.code},err.status);}
  };
}
