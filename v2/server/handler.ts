import { associatedData, b64, cleanFilename, decoder, decryptText, encryptText, equalSecret, hash, hmac, issueSession, MAX_ENVELOPE, MAX_FILE, randomToken, readJson, readLimited, RelayError, sniffFile, utf8, verifyEnvelope, verifyHmac, verifySession } from './core.ts';
import type { Envelope, Session } from './core.ts';
import type { Settings } from './config.ts';
import { Store } from './store.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const validId = (value: unknown) => { if (typeof value !== 'string' || !UUID.test(value)) throw new RelayError(400,'invalid_request'); return value; };
const iso = (seconds: number) => new Date(Date.now()+seconds*1000).toISOString();
const bearer = (req: Request) => req.headers.get('authorization')?.replace(/^Bearer /,'') || '';
const responseHeaders = { 'cache-control':'no-store, max-age=0', 'pragma':'no-cache', 'x-content-type-options':'nosniff','referrer-policy':'no-referrer' };
export function createHandler(c: Settings, db = new Store(c)) {
  const topicPromise = hmac(c.link,'relay-v2-invalidation');
  async function notify() { await db.broadcast('relay-v2-'+await topicPromise); }
  async function limit(key: string, count: number, seconds: number) {
    if (!await db.rpc<boolean>('limit',{p_key:key,p_limit:count,p_seconds:seconds})) throw new RelayError(429,'try_later');
  }
  async function authenticate(req: Request): Promise<Session> {
    const session = await verifySession(bearer(req),c.session);
    validId(session.id);
    const current=encodeURIComponent(new Date().toISOString());
    const rows = await db.db<{id:string}[]>(`relay_v2_sessions?id=eq.${session.id}&device=eq.${encodeURIComponent(session.device)}&expires_at=gt.${current}&select=id,relay_v2_devices!inner(hash)&relay_v2_devices.expires_at=gt.${current}`);
    if (!rows.length) throw new RelayError(401,'session_expired');
    return session;
  }
  async function gateway(req: Request) {
    if (!await equalSecret(req.headers.get('x-relay-gateway') || '',c.gateway)) throw new RelayError(401,'unauthorized');
    if (!c.origins.includes(req.headers.get('x-relay-origin') || '')) throw new RelayError(403,'unauthorized');
  }
  async function trusted(req: Request): Promise<string> {
    const token = req.headers.get('x-relay-device') || '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new RelayError(403,'device_not_paired');
    const device = await hash(token);
    const rows = await db.db<{hash:string}[]>(`relay_v2_devices?hash=eq.${device}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=hash`);
    if (!rows.length) throw new RelayError(403,'device_not_paired');
    return device;
  }
  async function cleanup() {
    await db.rpc('expire');
    const expired = await db.objects(`expires_at=lte.${encodeURIComponent(new Date().toISOString())}&limit=100`);
    await db.removeObjects(expired.map(x=>x.id));
    await db.db('relay_v2_health?id=eq.1','PATCH',{cleanup_at:new Date().toISOString(),cleanup_ok:true});
    if (expired.length) await notify();
    return expired.length;
  }
  async function info(id: string) {
    const encrypted = await (await db.get(id,'meta')).json();
    return JSON.parse(await decryptText(encrypted,c.encryption,'file-info-v2.'+id)) as {name:string};
  }
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url); const action = url.pathname.split('/relay-v2')[1] || '/';
    const origin = req.headers.get('origin');
    const headers: Record<string,string> = {...responseHeaders};
    if (origin && c.origins.includes(origin)) { headers['access-control-allow-origin']=origin; headers.vary='Origin'; }
    const json = (value: unknown, status=200) => Response.json(value,{status,headers});
    try {
      if (origin && !c.origins.includes(origin)) throw new RelayError(403,'unauthorized');
      if (req.method === 'OPTIONS') return new Response(null,{status:204,headers:{...headers,'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'authorization,content-type','access-control-max-age':'600'}});
      if (action === '/health' && req.method === 'GET') return json({ok:true,protocol:2,preview:c.preview});
      if (action === '/sweep' && req.method === 'POST') {
        // Deliberately public, narrowly scoped trigger for the scheduler. Takes no parameters,
        // exposes no data, and can ONLY delete objects already expired by server time.
        // Concurrent/hostile invocations cannot accelerate expiry; at most two run per minute.
        const admitted=await db.rpc<boolean>('limit',{p_key:'sweeper',p_limit:2,p_seconds:60});
        if(admitted)await cleanup();
        return new Response(null,{status:204,headers});
      }
      if (action === '/admin/invite' && req.method === 'POST') {
        if (!await equalSecret(bearer(req),c.admin)) throw new RelayError(401,'unauthorized');
        const token=randomToken(); const expires=iso(86400);
        await db.db('relay_v2_invites','POST',{hash:await hash(token),expires_at:expires});
        return json({token,expires_at:expires});
      }
      if (action === '/cleanup' && req.method === 'POST') {
        if (!await equalSecret(bearer(req),c.cron)) throw new RelayError(401,'unauthorized');
        return json({ok:true,deleted:await cleanup()});
      }
      if (action.startsWith('/internal/')) {
        await gateway(req);
        const ipKey=await hmac(c.rate,'ip.'+(req.headers.get('x-relay-client') || 'unknown'));
        if (action === '/internal/status' && req.method === 'GET') {
          let paired=false; try { await trusted(req); paired=true; } catch(e) { if (!(e instanceof RelayError) || e.status!==403) throw e; }
          return json({paired,preview:c.preview,text_ttl:c.textTtl,file_ttl:c.fileTtl});
        }
        if (action === '/internal/pair' && req.method === 'POST') {
          await limit('pair.'+ipKey,10,900);
          const body=await readJson(req); const invite=body.invite;
          if (typeof invite !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(invite)) throw new RelayError(400,'invalid_invite');
          const device=randomToken();
          if (!await db.rpc<boolean>('pair',{p_invite:await hash(invite),p_device:await hash(device),p_expires:iso(c.deviceTtl)})) throw new RelayError(400,'invalid_invite');
          // This response is exclusively server-to-server. Netlify consumes device into HttpOnly cookie.
          return json({device,max_age:c.deviceTtl});
        }
        const device=await trusted(req);
        if (action === '/internal/login' && req.method === 'POST') {
          await limit('login.'+device,5,900); await limit('login-ip.'+ipKey,30,900);
          const body=await readJson(req);
          if (typeof body.pin !== 'string' || !await equalSecret(body.pin,c.pin)) throw new RelayError(401,'invalid_pin');
          await db.db(`relay_v2_limits?key=eq.login.${device}`,'DELETE');
          const s: Session={id:crypto.randomUUID(),device,exp:Date.now()+c.sessionTtl*1000};
          await db.db('relay_v2_sessions','POST',{id:s.id,device,expires_at:new Date(s.exp).toISOString()});
          return json({token:await issueSession(s,c.session),expires_at:s.exp,edge:c.url+'/functions/v1/relay-v2',realtime:{url:c.url,anon:c.anon,topic:'relay-v2-'+await topicPromise},text_ttl:c.textTtl,file_ttl:c.fileTtl});
        }
        if (action === '/internal/forget' && req.method === 'POST') { await db.db('relay_v2_devices?hash=eq.'+device,'DELETE'); return json({ok:true}); }
        throw new RelayError(404,'not_found');
      }
      if (action === '/push' && (req.method === 'POST' || req.method === 'GET')) {
        let value: unknown;
        if (req.method==='GET') {
          if (!c.allowGet) throw new RelayError(405,'method_not_allowed');
          if (url.search.length>7000 || [...url.searchParams.keys()].join(',')!=='envelope') throw new RelayError(413,'too_large');
          try { value=JSON.parse(decoder.decode(Uint8Array.from(atob((url.searchParams.get('envelope')||'').replace(/-/g,'+').replace(/_/g,'/')),x=>x.charCodeAt(0)))); } catch { throw new RelayError(400,'invalid_request'); }
        } else { if (!req.headers.get('content-type')?.startsWith('application/json')) throw new RelayError(415,'invalid_request'); value=await readJson(req,MAX_ENVELOPE); }
        const e=await verifyEnvelope(value,c.encryption,c.push,Date.now(),c.requestWindow);
        await limit('push-valid',120,60);
        const id=crypto.randomUUID(); const payload=JSON.stringify(e);
        await db.rpc('reserve',{p_id:id,p_kind:'note',p_mime:'application/json',p_size:utf8.encode(payload).length,p_source:'ChatGPT'});
        try {
          await db.put(id,'data',payload,'application/json');
          if (!await db.rpc<boolean>('publish',{p_id:id,p_version:e.version,p_nonce:await hash(e.nonce),p_expires:iso(c.textTtl)})) throw new RelayError(409,'stale_or_replayed');
        } catch(e) { await db.db('relay_v2_objects?id=eq.'+id,'PATCH',{expires_at:new Date().toISOString()}); throw e; }
        await notify(); await cleanup().catch(()=>{});
        return json({ok:true,version:e.version});
      }
      if (action.startsWith('/file/') && req.method === 'GET') {
        const id=validId(action.slice(6)), expiry=Number(url.searchParams.get('expires')), mode=url.searchParams.get('mode');
        if (!Number.isSafeInteger(expiry) || expiry<=Date.now() || expiry>Date.now()+c.signedTtl*1000+1000 || !['open','download','preview'].includes(mode||'') || !await verifyHmac(c.link,`file-v2.${id}.${expiry}.${mode}`,url.searchParams.get('signature')||'')) throw new RelayError(401,'link_expired');
        const rows=await db.objects(`id=eq.${id}&kind=eq.file&ready=eq.true&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`);
        if (!rows.length) throw new RelayError(404,'file_expired');
        const row=rows[0]; const meta=await info(id); const file=await db.get(id,'data');
        const disposition=mode==='download' ? 'attachment' : 'inline';
        return new Response(file.body,{headers:{...headers,'content-type':row.mime,'content-length':String(row.size),'content-disposition':`${disposition}; filename="relay-file"; filename*=UTF-8''${encodeURIComponent(meta.name).replace(/[!'()*]/g,x=>'%'+x.charCodeAt(0).toString(16))}`,'content-security-policy':"sandbox; default-src 'none'; style-src 'unsafe-inline'"}});
      }
      const session=await authenticate(req);
      if (action === '/logout' && req.method === 'POST') { await db.db('relay_v2_sessions?id=eq.'+session.id,'DELETE'); return json({ok:true}); }
      if (action === '/state' && req.method === 'GET') {
        const s=await db.state(); const now=Date.now();
        if (url.searchParams.get('since')===String(s.revision)) return json({unchanged:true,revision:s.revision,server_time:now});
        let note=null;
        if (s.note_id && s.expires_at && Date.parse(s.expires_at)>now) {
          const e=await (await db.get(s.note_id,'data')).json() as Envelope;
          note={text:await decryptText(e,c.encryption,associatedData(e)),version:Number(s.version),received_at:s.received_at,expires_at:s.expires_at};
        }
        const rows=await db.objects(`kind=eq.file&ready=eq.true&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&order=created_at.desc&limit=40`);
        const files=await Promise.all(rows.map(async f=>({id:f.id,name:(await info(f.id)).name,mime:f.mime,size:f.size,source:f.source,created_at:f.created_at,expires_at:f.expires_at})));
        return json({revision:s.revision,note,files,server_time:now});
      }
      if (action === '/clear' && req.method === 'POST') {
        const body=await readJson(req);
        if (!Number.isSafeInteger(body.version)) throw new RelayError(400,'invalid_request');
        if (!await db.rpc('clear',{p_version:body.version})) throw new RelayError(409,'new_note_arrived');
        await notify(); await cleanup().catch(()=>{}); return json({ok:true});
      }
      if (action === '/upload' && req.method === 'POST') {
        await limit('upload.'+session.device,60,3600);
        const bytes=await readLimited(req,MAX_FILE+64*1024);
        let form: FormData; try { form=await new Request(req.url,{method:'POST',headers:{'content-type':req.headers.get('content-type')||''},body:bytes as BodyInit}).formData(); } catch { throw new RelayError(400,'invalid_file'); }
        const file=form.get('file'); if (!(file instanceof File)) throw new RelayError(400,'invalid_file');
        const data=new Uint8Array(await file.arrayBuffer()); const mime=sniffFile(data);
        const source=form.get('source')==='Phone' ? 'Phone' : form.get('source')==='Work computer' ? 'Work computer' : 'Device';
        const id=crypto.randomUUID();
        if (!await db.rpc('reserve',{p_id:id,p_kind:'file',p_mime:mime,p_size:data.length,p_source:source})) throw new RelayError(413,'relay_full');
        try {
          const metadata=await encryptText(JSON.stringify({name:cleanFilename(file.name)}),c.encryption,'file-info-v2.'+id);
          await db.put(id,'meta',JSON.stringify(metadata),'application/json');
          await db.put(id,'data',data,mime);
          if (!await db.rpc('finish_file',{p_id:id,p_expires:iso(c.fileTtl)})) throw new RelayError(409,'upload_expired');
        } catch(e) { await db.db('relay_v2_objects?id=eq.'+id,'PATCH',{expires_at:new Date().toISOString()}); throw e; }
        await notify(); return json({ok:true,id});
      }
      if (action === '/file-url' && req.method === 'POST') {
        const body=await readJson(req); const id=validId(body.id);
        const rows=await db.objects(`id=eq.${id}&kind=eq.file&ready=eq.true&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`);
        if (!rows.length) throw new RelayError(404,'file_expired');
        const expires=Math.min(Date.now()+c.signedTtl*1000,Date.parse(rows[0].expires_at));
        const mode=body.mode==='download'?'download':body.mode==='preview'?'preview':'open';
        const signature=await hmac(c.link,`file-v2.${id}.${expires}.${mode}`);
        return json({url:`${c.url}/functions/v1/relay-v2/file/${id}?expires=${expires}&mode=${mode}&signature=${signature}`,expires_at:expires});
      }
      if (action === '/delete-files' && req.method === 'POST') {
        const body=await readJson(req,8192);
        if (!Array.isArray(body.ids) || body.ids.length>40) throw new RelayError(400,'invalid_request');
        const ids=body.ids.map(validId); await db.rpc('delete_files',{p_ids:ids});
        await notify(); await cleanup().catch(()=>{}); return json({ok:true});
      }
      throw new RelayError(404,'not_found');
    } catch(e) {
      // Never serialize exceptions: upstream exceptions can contain patient data or credentials.
      const error=e instanceof RelayError ? e : new RelayError(503,'temporarily_unavailable');
      if (error.status===429) headers['retry-after']='900';
      return json({error:error.code},error.status);
    }
  };
}
