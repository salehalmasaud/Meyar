import type {Config,Context} from '@netlify/functions';
import {readJson,RelayError} from '../../server/core.ts';
export default async(req:Request,context:Context)=>{
  const headers={'cache-control':'no-store, max-age=0','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
  const reply=(body:unknown,status=200)=>Response.json(body,{status,headers});
  try{
    const url=new URL(req.url),origin=url.origin,path=url.pathname.slice(4);
    if(!(Netlify.env.get('RELAY_V3_ALLOWED_ORIGINS')||'').split(',').includes(origin))return reply({error:'unauthorized'},403);
    if(!['GET','POST'].includes(req.method))return reply({error:'method_not_allowed'},405);
    if(req.method==='POST'&&req.headers.get('origin')!==origin)return reply({error:'unauthorized'},403);
    const routes=['/status','/exchange','/login','/lock','/config','/state','/upload-ticket','/file-url','/delete-notes','/delete-files','/oauth/authorize'];
    if(!routes.includes(path))return reply({error:'not_found'},404);
    const body=req.method==='POST'?await readJson(req,24000):undefined;
    const response=await fetch(Netlify.env.get('RELAY_V3_EDGE_URL')+path+url.search,{method:req.method,headers:{'content-type':'application/json','x-relay-gateway':Netlify.env.get('RELAY_V3_GATEWAY_SECRET')||'','x-relay-origin':origin,'x-relay-client':context.ip||'unknown','x-relay-session':context.cookies.get('__Host-relay_v3')||''},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(50000)});
    const data=await response.json();
    if((path==='/exchange'||path==='/lock')&&response.ok){context.cookies.set({name:'__Host-relay_v3',value:data.session,httpOnly:true,secure:true,sameSite:'Strict',path:'/',maxAge:data.max_age});return reply({ok:true});}
    return reply(data,response.status);
  }catch(e){return reply({error:e instanceof RelayError?e.code:'temporarily_unavailable'},e instanceof RelayError?e.status:503);}
};
export const config:Config={path:'/api/*'};
