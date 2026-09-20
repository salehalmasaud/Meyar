import type {Config} from '@netlify/functions';
import {readLimited,MAX_ENVELOPE,RelayError} from '../../server/core.ts';
export default async(req:Request)=>{
  const headers={'cache-control':'no-store, max-age=0','referrer-policy':'no-referrer','x-content-type-options':'nosniff','x-robots-tag':'noindex, nofollow, noarchive'};
  try{
    if(!['GET','POST'].includes(req.method))return Response.json({error:'method_not_allowed'},{status:405,headers});
    const url=new URL(req.url);if(url.search.length>7000)throw new RelayError(413,'too_large');
    const response=await fetch(Netlify.env.get('RELAY_V3_EDGE_URL')+'/push-note-v3'+url.search,{method:req.method,headers:{'content-type':req.headers.get('content-type')||'application/json'},body:req.method==='POST'?await readLimited(req,MAX_ENVELOPE) as BodyInit:undefined,signal:AbortSignal.timeout(45000)});
    return new Response(response.body,{status:response.status,headers:{...headers,'content-type':'application/json'}});
  }catch(e){return Response.json({error:e instanceof RelayError?e.code:'temporarily_unavailable'},{status:e instanceof RelayError?e.status:503,headers});}
};
export const config:Config={path:'/push-note-v3'};
