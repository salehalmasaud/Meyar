import { numberSetting, unb64 } from './core.ts';
export type Env = (key: string) => string | undefined;
export function settings(env: Env) {
  const required = (key: string) => { const v = env(key); if (!v) throw new Error('configuration'); return v; };
  const secrets = ['SESSION','PUSH_HMAC','ENCRYPTION','GATEWAY','RATE','LINK','ADMIN','CRON'].map(k => required(`RELAY_${k}_SECRET`));
  if (secrets.some(s => unb64(s,100).length !== 32) || new Set(secrets).size !== secrets.length) throw new Error('configuration');
  const [session, push, encryption, gateway, rate, link, admin, cron] = secrets;
  return { session, push, encryption, gateway, rate, link, admin, cron,
    pin: required('RELAY_VIEW_PIN'), url: required('SUPABASE_URL'), service: required('SUPABASE_SERVICE_ROLE_KEY'), anon: required('SUPABASE_ANON_KEY'),
    origins: required('RELAY_ALLOWED_ORIGINS').split(',').map(x=>x.trim()),
    textTtl: numberSetting(env('RELAY_TEXT_TTL_SECONDS'),1800,5,86400),
    fileTtl: numberSetting(env('RELAY_FILE_TTL_SECONDS'),86400,5,604800),
    sessionTtl: numberSetting(env('RELAY_SESSION_TTL_SECONDS'),3600,10,14400),
    deviceTtl: numberSetting(env('RELAY_DEVICE_TTL_SECONDS'),2592000,60,7776000),
    signedTtl: numberSetting(env('RELAY_SIGNED_URL_TTL_SECONDS'),60,5,120),
    requestWindow: numberSetting(env('RELAY_REQUEST_WINDOW_SECONDS'),120,10,300),
    allowGet: env('RELAY_ALLOW_GET_PUSH') === 'true', preview: env('RELAY_PREVIEW_ONLY') !== 'false'
  };
}
export type Settings = ReturnType<typeof settings>;
