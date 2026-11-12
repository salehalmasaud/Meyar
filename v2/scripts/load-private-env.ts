import { readFileSync } from 'node:fs';
import { join } from 'node:path';
export function loadPrivateEnv(){
  const file=process.env.RELAY_ENV_FILE||join(process.env.LOCALAPPDATA||'','.','TrackcareRelay','v2','.env');
  for(const line of readFileSync(file,'utf8').split(/\r?\n/)){
    const at=line.indexOf('=');if(at>0&&!line.startsWith('#'))process.env[line.slice(0,at)]=line.slice(at+1);
  }
}
