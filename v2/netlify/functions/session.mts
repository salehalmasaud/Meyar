import type { Config, Context } from '@netlify/functions';
import { readJson, RelayError } from '../../server/core.ts';

export default async (req: Request, context: Context) => {
  const headers: Record<string,string>={'cache-control':'no-store, max-age=0','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
  const reply=(data:unknown,status=200)=>Response.json(data,{status,headers});
  try {
    const url=new URL(req.url); const origin=url.origin;
    const allowed=(Netlify.env.get('RELAY_ALLOWED_ORIGINS')||'').split(',');
    if (!allowed.includes(origin) || (req.method!=='GET' && req.headers.get('origin')!==origin)) return reply({error:'unauthorized'},403);
    if (!['GET','POST'].includes(req.method)) return reply({error:'method_not_allowed'},405);
    const body=req.method==='POST'?await readJson(req):{};
    const action=req.method==='GET'?'status':body.action;
    if (!['status','pair','login','forget'].includes(String(action))) return reply({error:'invalid_request'},400);
    const edge=Netlify.env.get('RELAY_EDGE_URL'), secret=Netlify.env.get('RELAY_GATEWAY_SECRET');
    if (!edge||!secret) throw new Error();
    const r=await fetch(`${edge}/internal/${action}`,{method:req.method,headers:{'content-type':'application/json','x-relay-gateway':secret,'x-relay-origin':origin,'x-relay-client':context.ip||'unknown','x-relay-device':context.cookies.get('__Host-relay_device')||''},body:req.method==='POST'?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
    const data=await r.json();
    if (!r.ok) return reply(data,r.status);
    if (action==='pair') {
      context.cookies.set({name:'__Host-relay_device',value:data.device,httpOnly:true,secure:true,sameSite:'Strict',path:'/',maxAge:data.max_age});
      return reply({paired:true});
    }
    if (action==='forget') context.cookies.set({name:'__Host-relay_device',value:'',httpOnly:true,secure:true,sameSite:'Strict',path:'/',maxAge:0});
    return reply(data);
  } catch(e) { return reply({error:e instanceof RelayError?e.code:'temporarily_unavailable'},e instanceof RelayError?e.status:503); }
};
export const config: Config={path:'/api/session'};
