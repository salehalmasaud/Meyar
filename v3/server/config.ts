import { numberSetting, unb64 } from './core.ts';
export function settings(env:(key:string)=>string|undefined) {
  const required=(key:string)=>{const v=env(key);if(!v)throw new Error('configuration');return v;};
  const secrets=['VIEWER','PUSH_HMAC','ENCRYPTION','GATEWAY','RATE','LINK','TICKET'].map(k=>required(`RELAY_V3_${k}_SECRET`));
  if(secrets.some(s=>unb64(s,100).length!==32)||new Set(secrets).size!==secrets.length)throw new Error('configuration');
  const [viewer,push,encryption,gateway,rate,link,ticket]=secrets;
  return {viewer,push,encryption,gateway,rate,link,ticket,pin:'000',url:required('SUPABASE_URL'),service:required('SUPABASE_SERVICE_ROLE_KEY'),anon:required('SUPABASE_ANON_KEY'),
    origins:required('RELAY_V3_ALLOWED_ORIGINS').split(','),textTtl:43200,
    fileTtl:numberSetting(env('RELAY_V3_FILE_TTL_SECONDS'),86400,60,604800),
    sessionTtl:numberSetting(env('RELAY_V3_SESSION_TTL_SECONDS'),28800,60,43200),signedTtl:60,requestWindow:120,
    allowGet:env('RELAY_V3_ALLOW_GET_PUSH')==='true'};
}
export type Settings=ReturnType<typeof settings>;
