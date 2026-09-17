import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPrivateEnv } from './load-private-env.ts';
loadPrivateEnv();
const output=process.env.RELAY_INVITE_OUTPUT||join(process.env.LOCALAPPDATA!,'TrackcareRelay','v2','setup-links.txt');
const links:string[]=[];
for(const device of ['Work computer','Phone']){
  const response=await fetch(process.env.RELAY_EDGE_URL+'/admin/invite',{method:'POST',headers:{authorization:'Bearer '+process.env.RELAY_ADMIN_SECRET}});
  if(!response.ok)throw new Error(`Invite failed (${response.status})`);
  const data=await response.json();links.push(`${device}: ${process.env.RELAY_ALLOWED_ORIGINS?.split(',')[0]}/#pair=${data.token}\nExpires: ${data.expires_at}`);
}
writeFileSync(output,links.join('\n\n')+'\n',{mode:0o600});
console.log('One-use device links saved to the private local setup file. Values omitted.');
