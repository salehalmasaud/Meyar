import type {Config,Context} from '@netlify/functions';
import {readLimited} from '../../server/core.ts';
export default async(req:Request,context:Context)=>{
 const headers={'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'};
 try{
  const url=new URL(req.url);
  if(!(Netlify.env.get('RELAY_V3_ALLOWED_ORIGINS')||'').split(',').includes(url.origin))return new Response(null,{status:403,headers});
  if(req.headers.has('origin')&&req.headers.get('origin')!==url.origin)return new Response(null,{status:403,headers});
  const upstream=new Headers({'x-relay-gateway':Netlify.env.get('RELAY_V3_GATEWAY_SECRET')||'','x-relay-client':context.ip||'unknown'});
  for(const name of ['authorization','content-type','mcp-session-id','mcp-protocol-version','accept']){const value=req.headers.get(name);if(value)upstream.set(name,value);}
  const body=['POST','PUT'].includes(req.method)?await readLimited(req,100000):undefined;
  const response=await fetch(Netlify.env.get('RELAY_V3_EDGE_URL')+url.pathname,{method:req.method,headers:upstream,body:body as BodyInit|undefined,signal:AbortSignal.timeout(55000)});
  const outgoing=new Headers(headers);for(const name of ['content-type','www-authenticate','mcp-session-id','allow']){const value=response.headers.get(name);if(value)outgoing.set(name,value);}
  return new Response(response.body,{status:response.status,headers:outgoing});
 }catch{return Response.json({error:'temporarily_unavailable'},{status:503,headers});}
};
export const config:Config={path:['/mcp','/oauth/*','/.well-known/oauth-protected-resource','/.well-known/oauth-authorization-server']};
