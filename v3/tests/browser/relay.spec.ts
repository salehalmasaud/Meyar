import {scopeInbox} from './scope.ts';
import {test,expect,type Page} from '@playwright/test';import {mkdirSync,writeFileSync} from 'node:fs';
import {site,viewer,push,db,png,pdf,login,gateway} from '../helpers.ts';import {hash} from '../../server/core.ts';
const results:Record<string,unknown>={};
async function open(page:Page){await page.goto(site+'/#access='+viewer);await expect(page.locator('#unlock')).toBeEnabled({timeout:25000});expect(new URL(page.url()).hash).toBe('');await page.locator('#code').fill('000');await page.locator('#unlock').click();await expect(page.locator('#workspace')).toBeVisible({timeout:30000});}
test('complete inbox and file workflow on live V3 preview',async({browser})=>{
 test.setTimeout(240000);
 const desktop=await browser.newContext({permissions:['clipboard-read','clipboard-write'],viewport:{width:1440,height:1000}}),mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const pc=await desktop.newPage(),phone=await mobile.newPage();const owned:string[]=[],ownedFiles:string[]=[];
 await scopeInbox(desktop,owned,ownedFiles);await scopeInbox(mobile,owned,ownedFiles);
 const errors:string[]=[];pc.on('pageerror',e=>errors.push(e.name));phone.on('pageerror',e=>errors.push(e.name));
 try{
  await open(pc);await open(phone);results.viewer_fragment_removed=true;
  const cookie=(await desktop.cookies()).find(c=>c.name==='__Host-relay_v3');expect(cookie?.httpOnly).toBe(true);expect(cookie?.secure).toBe(true);expect(cookie?.sameSite).toBe('Strict');results.secure_cookie=true;
  await expect(pc.locator('#status')).toHaveText('Live',{timeout:25000});results.realtime='Live';
  for(const text of ['Test Note A','Test Note B','Test Note C']){const r=await push(text);expect(r.status).toBe(200);owned.push(r.data.id);}
  await expect(pc.locator('.note-text')).toHaveText(['Test Note A','Test Note B','Test Note C'],{timeout:15000});await expect(phone.locator('.note-text')).toHaveText(['Test Note A','Test Note B','Test Note C']);results.acceptance_abc=true;
  await expect(pc.locator('.note-label')).toHaveText(['Note 01','Note 02','Note 03']);
  await pc.locator('.note-copy').first().click();await expect(pc.locator('.note-copy').first()).toHaveText('Copied ✓');await expect(pc.locator('.note-card').first()).toHaveClass(/copied/);
  await pc.reload();await expect(pc.locator('.note-text')).toHaveText(['Test Note A','Test Note B','Test Note C']);await expect(pc.locator('.note-copy').first()).toHaveText('Copied ✓');results.copy_refresh_retention=true;
  await pc.locator('#sort').selectOption('newest');await expect(pc.locator('.note-text')).toHaveText(['Test Note C','Test Note B','Test Note A']);await pc.locator('#copy-next').click();await expect(pc.locator('.note-copy').nth(1)).toHaveText('Copied ✓');expect(await pc.evaluate(()=>document.activeElement?.id)).toBe('note-'+owned[2]);results.copy_next_oldest_and_focus=true;
  await pc.locator('#clear-copied').click();await expect(pc.locator('#confirmation')).toBeVisible();await pc.locator('#cancel-action').click();await expect(pc.locator('.note-card')).toHaveCount(3);await pc.locator('#clear-copied').click();await pc.locator('#confirm-action').click();await expect(pc.locator('.note-text')).toHaveText(['Test Note C']);results.clear_copied_confirmation=true;
  await pc.locator('#clear-all').click();await expect(pc.locator('#confirmation')).toBeVisible();await pc.locator('#confirm-action').click();await expect(pc.locator('#empty-notes')).toBeVisible();await expect(pc.locator('#empty-notes')).toContainText('Today is clear.');results.clear_all_empty_state=true;
  const exact='Pt: SYNTHETIC TEST — not a patient\r\nDx: Workflow verification only\r\n\r\n  Exact spaces.\tTabs retained.\nاختبار النقل\n\n';
  const started=Date.now();const r=await push(exact);expect(r.status).toBe(200);owned.push(r.data.id);await expect(pc.locator('.note-text')).toHaveText(exact,{useInnerText:false,timeout:12000});results.realtime_ms=Date.now()-started;
  await pc.evaluate(()=>{const original=navigator.clipboard.write.bind(navigator.clipboard);(navigator.clipboard as unknown as {write:(items:ClipboardItems)=>Promise<void>}).write=async items=>{const item=items[0];(window as unknown as {copiedArgument:string;copiedHtml:string}).copiedArgument=await(await item.getType('text/plain')).text();(window as unknown as {copiedArgument:string;copiedHtml:string}).copiedHtml=await(await item.getType('text/html')).text();await original(items);};});
  await pc.locator('.note-copy').click();expect(await pc.evaluate(()=>(window as unknown as {copiedArgument:string}).copiedArgument)).toBe(exact);expect(await pc.evaluate(()=>(window as unknown as {copiedHtml:string}).copiedHtml)).toContain('Times New Roman');results.exact_copy_argument=true;results.trackcare_rich_copy=true;
  expect(await pc.locator('.note-text').textContent()).toBe(exact);await expect(pc.locator('.note-patient')).toHaveText('Pt: SYNTHETIC TEST — not a patient');results.metadata_client_derived=true;
  expect(await pc.evaluate(()=>Object.keys(sessionStorage))).toEqual([]);expect(await pc.evaluate(()=>Object.keys(localStorage))).toEqual(['relay-v3-copied']);expect(JSON.parse(await pc.evaluate(()=>localStorage.getItem('relay-v3-copied'))||'[]')).toContain(r.data.id);results.storage_ids_only=true;
  await pc.locator('#file-input').setInputFiles([{name:'synthetic-image.png',mimeType:'image/png',buffer:png},{name:'synthetic-document.pdf',mimeType:'application/pdf',buffer:pdf()}]);
  await expect(pc.locator('.file')).toHaveCount(2,{timeout:35000});await expect(phone.locator('.file')).toHaveCount(2,{timeout:20000});await expect(pc.locator('.file-icon img')).toBeVisible();await expect.poll(()=>pc.locator('.file-icon img').evaluateAll(nodes=>nodes.length===1&&nodes.every(n=>(n as HTMLImageElement).complete&&(n as HTMLImageElement).naturalWidth>0))).toBe(true);results.multiple_file_upload=true;results.decoded_thumbnail=true;
  await pc.evaluate(async bytes=>{await navigator.clipboard.write([new ClipboardItem({'image/png':new Blob([new Uint8Array(bytes)],{type:'image/png'})})]);},Array.from(png));
  await pc.keyboard.press(process.platform==='darwin'?'Meta+V':'Control+V');
  await expect(pc.locator('#message')).toContainText('Pasted image — uploading');await expect(pc.locator('.file')).toHaveCount(3,{timeout:20000});await expect(pc.locator('#message')).toContainText('Uploaded ✓');results.paste_image_upload=true;
  const downloaded=pc.waitForEvent('download');await pc.getByRole('button',{name:'Download synthetic-image.png',exact:true}).click();expect((await downloaded).suggestedFilename()).toBe('synthetic-image.png');await(await downloaded).cancel();results.file_download=true;
  await pc.getByRole('button',{name:'Preview synthetic-image.png',exact:true}).click();await expect(pc.locator('#file-preview img')).toBeVisible();await pc.keyboard.press('Escape');await expect(pc.locator('#file-preview')).not.toBeVisible();results.file_preview=true;
  // Retry the actual failed upload queue row after a temporary HTTP failure.
  let fail=true;await desktop.route('**/relay-v3/upload',route=>{if(fail){fail=false;return route.fulfill({status:503,contentType:'application/json',body:'{"error":"temporarily_unavailable"}'});}return route.fallback();});
  await pc.locator('#file-input').setInputFiles({name:'retry-image.png',mimeType:'image/png',buffer:png});await expect(pc.getByRole('button',{name:'Retry',exact:true})).toBeVisible({timeout:15000});await pc.getByRole('button',{name:'Retry',exact:true}).click();await expect(pc.locator('.file')).toHaveCount(4,{timeout:20000});results.failed_upload_retry=true;
  await expect(pc.locator('#queue .queue-item')).toHaveCount(0,{timeout:10000});
  // Load lower thumbnails at their actual viewport position before full-page capture.
  for(const page of [pc,phone]){for(const row of await page.locator('.file').all()){await row.scrollIntoViewIfNeeded();}await expect.poll(()=>page.locator('.file-icon img').evaluateAll(nodes=>nodes.length===3&&nodes.every(n=>(n as HTMLImageElement).complete&&(n as HTMLImageElement).naturalWidth>0)),{timeout:15000}).toBe(true);await page.evaluate(()=>window.scrollTo(0,0));}
  mkdirSync('artifacts',{recursive:true});await pc.screenshot({path:'artifacts/preview-desktop.png',fullPage:true});await phone.screenshot({path:'artifacts/preview-mobile.png',fullPage:true});
  for(const page of [pc,phone])expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);results.responsive_1440_390=true;
  await pc.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('blocked');}}});document.execCommand=()=>false;});await pc.locator('.note-copy').click();await expect(pc.locator('#message')).toContainText('Copy was blocked');await expect(pc.locator('.note-text')).toHaveText(exact,{useInnerText:false});results.blocked_copy_preserves_note=true;
  await desktop.routeWebSocket('**/realtime/v1/websocket**',ws=>ws.close());await pc.reload();await expect(pc.locator('#status')).toHaveText('Fallback',{timeout:20000});const fallback=Date.now();const f=await push('Fallback arrival');owned.push(f.data.id);await expect(pc.locator('.note-text').filter({hasText:'Fallback arrival'})).toBeVisible({timeout:16000});results.polling_fallback_ms=Date.now()-fallback;
  await desktop.setOffline(true);await expect(pc.locator('#status')).toHaveText('Offline');await desktop.setOffline(false);await expect(pc.locator('#status')).toHaveText('Fallback',{timeout:20000});results.offline_recovery=true;
  await pc.locator('#delete-files').click();await pc.locator('#confirm-action').click();await expect(pc.locator('.file')).toHaveCount(0,{timeout:20000});results.delete_all_files=true;
  await pc.locator('#clear-all').click();await pc.locator('#confirm-action').click();await expect(pc.locator('#empty-notes')).toBeVisible({timeout:20000});
  await pc.locator('#lock').click();await expect(pc.locator('#gate')).toBeVisible();expect(await pc.locator('#notes').textContent()).toBe('');await pc.locator('#code').fill('000');await pc.locator('#unlock').click();await expect(pc.locator('#workspace')).toBeVisible();results.lock_pin_reentry=true;
  const session=(await mobile.cookies()).find(c=>c.name==='__Host-relay_v3')!;await db('relay_v3_sessions?hash=eq.'+await hash(session.value),'PATCH',{expires_at:new Date(Date.now()-1000).toISOString()});await phone.reload();await expect(phone.locator('#gate')).toBeVisible();await expect(phone.locator('#gate-error')).toContainText('saved private receiver URL');results.session_expiry=true;
  expect(errors).toEqual([]);results.no_browser_errors=true;
  expect(await pc.locator('body').textContent()).not.toMatch(/pair|invite|enrollment|Save changes/i);results.no_pairing_ui=true;
  results.at=new Date().toISOString();writeFileSync('tests/browser-results.json',JSON.stringify(results,null,2)+'\n');
 }finally{
  const cleanup=await login("browser-test-cleanup");await gateway("/delete-notes",cleanup,{ids:owned});await gateway("/delete-files",cleanup,{ids:ownedFiles});await db("relay_v3_sessions?hash=eq."+await hash(cleanup),"DELETE");
  const cookie=(await desktop.cookies()).find(c=>c.name==='__Host-relay_v3');if(cookie)await db('relay_v3_sessions?hash=eq.'+await hash(cookie.value),'DELETE');await desktop.close();await mobile.close();
 }
});
