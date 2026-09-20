import {readFileSync} from 'node:fs';
import {join} from 'node:path';
export function loadPrivateEnv(){for(const line of readFileSync(process.env.RELAY_V3_ENV_FILE||join(process.env.LOCALAPPDATA!,'TrackcareRelay','v3','.env'),'utf8').split(/\r?\n/)){const at=line.indexOf('=');if(at>0&&!line.startsWith('#'))process.env[line.slice(0,at)]=line.slice(at+1);}}
