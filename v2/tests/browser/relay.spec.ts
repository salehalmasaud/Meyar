import { test,expect,type BrowserContext,type Page } from '@playwright/test';
import { readFileSync,mkdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPrivateEnv } from '../../scripts/load-private-env.ts';
import { makeEnvelope,hash } from '../../server/core.ts';
loadPrivateEnv();
const site=process.env.RELAY_ALLOWED_ORIGINS!.split(',')[0],edge=process.env.RELAY_EDGE_URL!;
const results:Record<string,unknown>={};
function syntheticPdf(){
  const stream='BT /F1 18 Tf 50 750 Td (SYNTHETIC RELAY TEST - NOT A PATIENT) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let pdf='%PDF-1.7\n';const offsets=[0];for(const [index,object]of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(x=>String(x).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(pdf);
}
const keys=JSON.parse(readFileSync(join(process.env.LOCALAPPDATA!,'TrackcareRelay','v2','supabase-keys.json'),'utf8'));
const service=keys.find((k:{name:string})=>k.name==='service_role').api_key;
async function invitation(){const r=await fetch(edge+'/admin/invite',{method:'POST',headers:{authorization:'Bearer '+process.env.RELAY_ADMIN_SECRET}});expect(r.status).toBe(200);return (await r.json()).token;}
async function push(text:string){const e=await makeEnvelope(text,process.env.RELAY_ENCRYPTION_SECRET!,process.env.RELAY_PUSH_HMAC_SECRET!);const r=await fetch(edge+'/push',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(e)});expect(r.status).toBe(200);return e.version;}
async function pair(page:Page){await page.goto(site+'/#pair='+await invitation());await expect(page.locator('#unlock')).toBeEnabled();await page.locator('#code').fill('000');await page.locator('#unlock').click();await expect(page.locator('#workspace')).toBeVisible({timeout:25000});}
async function expireData(){const root=new URL(edge).origin;const headers={apikey:service,authorization:'Bearer '+service,'content-type':'application/json'};for(const path of ['relay_v2_state?id=eq.1','relay_v2_objects?ready=eq.true']){const r=await fetch(root+'/rest/v1/'+path,{method:'PATCH',headers,body:JSON.stringify({expires_at:new Date(Date.now()-1000).toISOString()})});expect(r.ok).toBeTruthy();}await fetch(edge+'/cleanup',{method:'POST',headers:{authorization:'Bearer '+process.env.RELAY_CRON_SECRET}});}
async function forget(context:BrowserContext){const cookies=await context.cookies();const device=cookies.find(x=>x.name==='__Host-relay_device')?.value;if(device){await fetch(new URL(edge).origin+'/rest/v1/relay_v2_devices?hash=eq.'+await hash(device),{method:'DELETE',headers:{apikey:service,authorization:'Bearer '+service}});}}

test('live note, precise copy, files both ways, reload, fallback, lock and expiry',async({browser})=>{
  const desktop=await browser.newContext({permissions:['clipboard-read','clipboard-write'],viewport:{width:1440,height:1000}});
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const pc=await desktop.newPage(),phone=await mobile.newPage();
  const notes='SYNTHETIC RELAY TEST — NOT A PATIENT\n\n  Exact spaces.\tEnd.\nاختبار النقل\n';
  try{
    expect((await(await fetch(edge+'/health')).json()).preview).toBe(true);await expireData();
    await pair(pc);await pair(phone);
    expect((await desktop.cookies()).find(c=>c.name==='__Host-relay_device')?.httpOnly).toBe(true);
    await expect(pc.locator('#status')).toHaveText('Live',{timeout:25000});results.realtime='SUBSCRIBED';
    const started=Date.now();await push(notes);await expect(pc.locator('#note')).toHaveText(notes,{useInnerText:false,timeout:10000});results.live_note_ms=Date.now()-started;
    expect(await pc.locator('#note').textContent()).toBe(notes);await expect(phone.locator('#note')).toHaveText(notes,{useInnerText:false});
    await pc.evaluate(()=>{const original=navigator.clipboard.writeText.bind(navigator.clipboard);navigator.clipboard.writeText=async text=>{(window as unknown as {copiedArgument:string}).copiedArgument=text;await original(text);};});
    await pc.locator('#copy').click();await expect(pc.locator('#copy')).toHaveText('Copied ✓');
    expect(await pc.evaluate(()=>(window as unknown as {copiedArgument:string}).copiedArgument)).toBe(notes);
    // Windows' clipboard API serializes LF as CRLF; the app passes the original string unchanged.
    expect(await pc.evaluate(()=>navigator.clipboard.readText())).toBe(process.platform==='win32'?notes.replace(/\n/g,'\r\n'):notes);results.exact_copy_argument=true;results.clipboard_line_endings=process.platform==='win32'?'Windows CRLF':'native';
    await pc.reload();await expect(pc.locator('#workspace')).toBeVisible();await expect(pc.locator('#note')).toHaveText(notes,{useInnerText:false});results.reload_without_pin=true;
    expect(await pc.evaluate(()=>Object.keys(localStorage).length)).toBe(0);
    expect(await pc.evaluate(()=>Object.keys(sessionStorage))).toEqual(['relay-v2-session']);
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2cAAAAASUVORK5CYII=','base64');
    await phone.locator('#file-input').setInputFiles({name:'synthetic-phone.png',mimeType:'image/png',buffer:png});
    await expect(pc.locator('.file-name')).toContainText('synthetic-phone.png',{timeout:20000});
    await expect(pc.locator('.file-icon img')).toBeVisible();results.phone_to_pc=true;
    await pc.locator('#file-input').setInputFiles({name:'synthetic-work.pdf',mimeType:'application/pdf',buffer:syntheticPdf()});
    await expect(phone.locator('.file-name').filter({hasText:'synthetic-work.pdf'})).toBeVisible({timeout:20000});results.pc_to_phone=true;
    const downloadEvent=pc.waitForEvent('download');await pc.getByRole('button',{name:'Download synthetic-phone.png',exact:true}).click();const download=await downloadEvent;expect(download.suggestedFilename()).toBe('synthetic-phone.png');await download.cancel();results.download=true;
    const popupEvent=phone.waitForEvent('popup');await phone.getByRole('button',{name:'Open synthetic-phone.png',exact:true}).click();const popup=await popupEvent;await popup.waitForURL('**/relay-v2/file/**');await expect(popup.locator('img')).toBeVisible();await popup.close();results.open_image=true;
    // Some mobile/headless browsers download PDFs instead of mounting their desktop PDF viewer.
    const pdfResponse=mobile.waitForEvent('response',{predicate:r=>r.url().includes('/relay-v2/file/')&&r.headers()['content-type']==='application/pdf'});
    const pdfPopup=phone.waitForEvent('popup');await phone.getByRole('button',{name:'Open synthetic-work.pdf',exact:true}).click();expect((await pdfResponse).status()).toBe(200);await(await pdfPopup).close();results.open_pdf_response=true;
    mkdirSync('artifacts',{recursive:true});await pc.screenshot({path:'artifacts/preview-desktop.png',fullPage:true});await phone.screenshot({path:'artifacts/preview-mobile.png',fullPage:true});
    for(const page of [pc,phone])expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    results.responsive=true;
    await pc.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('blocked');}}});document.execCommand=()=>false;});
    await pc.locator('#copy-clear').click();await expect(pc.locator('#message')).toContainText('has been kept');expect(await pc.locator('#note').textContent()).toBe(notes);results.copy_failure_keeps_note=true;
    await pc.reload();await expect(pc.locator('#note')).toHaveText(notes,{useInnerText:false});await pc.locator('#copy-clear').click();await expect(pc.locator('#empty-note')).toBeVisible({timeout:15000});await expect(phone.locator('#empty-note')).toBeVisible();results.copy_clear=true;
    await pc.locator('#delete-all').click();await pc.locator('#confirm-action').click();await expect(pc.locator('#file-count')).toHaveText('0',{timeout:15000});await expect(phone.locator('#file-count')).toHaveText('0');results.delete_all=true;
    // Force the WebSocket transport closed; normal HTTP remains available.
    await desktop.routeWebSocket('**/realtime/v1/websocket**',ws=>ws.close());await pc.reload();await expect(pc.locator('#status')).toHaveText('Fallback polling',{timeout:15000});
    const fallbackStart=Date.now();await push(notes+'Fallback\n');await expect(pc.locator('#note')).toHaveText(notes+'Fallback\n',{useInnerText:false,timeout:12000});results.fallback_ms=Date.now()-fallbackStart;
    await desktop.setOffline(true);await expect(pc.locator('#status')).toHaveText('Offline',{timeout:10000});await desktop.setOffline(false);await expect(pc.locator('#status')).toHaveText('Fallback polling',{timeout:15000});results.recovery=true;
    // Real revocation: locking invalidates even a previously copied session token.
    const stored=await pc.evaluate(()=>sessionStorage.getItem('relay-v2-session'));const token=JSON.parse(stored!).token;
    await pc.locator('#lock').click();await expect(pc.locator('#gate')).toBeVisible({timeout:10000});expect(await pc.locator('#note').textContent()).toBe('');
    expect((await fetch(edge+'/state',{headers:{authorization:'Bearer '+token}})).status).toBe(401);results.lock_revokes=true;
    await expireData();
    await phone.reload();await expect(phone.locator('#empty-note')).toBeVisible({timeout:15000});await expect(phone.locator('#file-count')).toHaveText('0');results.expiry=true;
    await phone.evaluate(()=>{const value=JSON.parse(sessionStorage.getItem('relay-v2-session')!);value.expires_at=Date.now()+6000;sessionStorage.setItem('relay-v2-session',JSON.stringify(value));});
    await phone.reload();await expect(phone.locator('#workspace')).toBeVisible();await expect(phone.locator('#gate')).toBeVisible({timeout:10000});await expect(phone.locator('#gate-error')).toContainText('Session expired');results.ui_session_expiry=true;
    results.at=new Date().toISOString();writeFileSync('tests/browser-results.json',JSON.stringify(results,null,2)+'\n');
  }finally{await forget(desktop);await forget(mobile);await desktop.close();await mobile.close();}
});
